// api/gemini-proxy.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { history, recaptchaToken, model: requestedModel } = req.body; // Add model from request
  const apiKey = process.env.GEMINI_API_KEY;
  const recaptchaSecretKey = process.env.RECAPTCHA_SECRET_KEY; 
  
  // Determine the model to use, defaulting to gemini-2.0-flash-lite
  const modelToUse = requestedModel || 'gemini-2.0-flash-lite';

  // Define your system prompt here
  const systemPrompt = `You are a bot embedded in a tech prototype. You can use a function to generate images. To generate an image, you MUST call the function named 'generate_image' with a detailed textual prompt. Only call this function when the user explicitly asks for an image, diagram, or visual content, or when an image would significantly enhance the response. Do not attempt to generate images in any other way or state you will generate one without calling the function.`;

  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured.' });
  }

  if (!history || !Array.isArray(history) || history.length === 0) { // Validate history
    return res.status(400).json({ error: 'History is required and must be a non-empty array.' });
  }

  // Verify reCAPTCHA token
  if (!recaptchaToken) {
    return res.status(400).json({ error: 'reCAPTCHA token is missing.' });
  }
  try {
    const recaptchaVerifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${recaptchaSecretKey}&response=${recaptchaToken}`;
    const recaptchaRes = await fetch(recaptchaVerifyUrl, { method: 'POST' });
    const recaptchaData = await recaptchaRes.json();
    if (!recaptchaData.success || recaptchaData.score < 0.5) { // Check for success and score
      console.error('reCAPTCHA verification failed:', recaptchaData);
      return res.status(403).json({ error: 'reCAPTCHA verification failed.' });
    }
  } catch (error) {
    console.error('Error verifying reCAPTCHA:', error);
    return res.status(500).json({ error: 'Error verifying reCAPTCHA.' });
  }

  // Check if user is asking for an image
  const lastUserMessage = history[history.length - 1];
  const userText = lastUserMessage?.parts?.[0]?.text?.toLowerCase() || '';
  const imageKeywords = ['image', 'picture', 'diagram', 'chart', 'illustration', 'draw', 'create a visual', 'show me', 'generate an image'];
  const isImageRequest = imageKeywords.some(keyword => userText.includes(keyword));

  // Define the image generation tool
  const imageGenerationTool = {
    functionDeclarations: [
      {
        name: 'generate_image',
        description: 'Generates an image based on a textual prompt. Use this when the user asks for an image, diagram, or visual content, or when an image would significantly enhance the response. Do not use this tool if the user has not explicitly asked for an image or visual.',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'The textual description of the image to generate. This should be detailed and specific to get a good result.'
            }
          },
          required: ['prompt']
        }
      }
    ]
  };

  // Determine if the current model supports function calling for image generation
  // For this example, let's assume gemini-2.0-flash-lite and gemini-2.5-pro-preview-06-05 support it.
  // The gemini-2.0-flash-preview-image-generation model generates images directly.
  const supportsFunctionCalling = ['gemini-2.0-flash-lite', 'gemini-2.5-pro-preview-06-05'].includes(modelToUse);

  try {
    let requestBody = {
      contents: history,
      generationConfig: {
        temperature: 0.7,
        // responseMimeType: "text/plain", // Keep as default or remove if causing issues
      }
    };

    if (systemPrompt) {
        requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    if (supportsFunctionCalling) {
      requestBody.tools = [imageGenerationTool];
    }

    // If the model is specifically for image generation, adjust config
    if (modelToUse === 'gemini-2.0-flash-preview-image-generation') {
      // This model might expect a different request structure or config for image generation.
      // For now, we assume it can take text and might return an image part directly.
      // The Vertex AI SDK handles this more gracefully. With direct REST, it's more manual.
      // Let's ensure responseModalities is set if this model requires it.
      requestBody.generationConfig.responseMimeType = 'multipart/form-data'; // Or as required by the model for mixed output
      // The API might also expect a specific structure for image prompts if not using function calling.
      // For simplicity, we'll let the model try to generate an image if the user asks for one with this model.
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${apiKey}`;

    let geminiResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    let data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error(`Error from Gemini API (${modelToUse}):`, data);
      const errorMessage = data?.error?.message || 'Error calling Gemini API';
      return res.status(geminiResponse.status).json({ error: errorMessage, details: data.error });
    }

    // Check for function call
    const partContainingFunctionCall = data.candidates?.[0]?.content?.parts?.find(part => part.functionCall);
    const actualFunctionCall = partContainingFunctionCall ? partContainingFunctionCall.functionCall : null;
    
    if (supportsFunctionCalling && actualFunctionCall && actualFunctionCall.name === 'generate_image') {
      const imagePrompt = actualFunctionCall.args.prompt;

      if (!imagePrompt) {
        // Handle missing prompt - send a text response back to the model
        const toolResponsePart = {
          functionResponse: {
            name: 'generate_image',
            response: {
              // Sending a structured response that indicates an error or missing info
              // The model should ideally understand this and ask for clarification.
              error: 'Missing prompt for image generation.',
              content: 'Error: I need a prompt to generate an image. Please provide a description.'
            }
          }
        };
        // Send this error back to the model
        const followupRequestBody = {
          ...requestBody, // Retain original request body context if needed
          contents: [...history, data.candidates[0].content, toolResponsePart ], // Add model's turn and our tool response
        };

        geminiResponse = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(followupRequestBody)
        });
        // data = await geminiResponse.json(); // Original line
        const finalDataAfterToolError = await geminiResponse.json(); // Capture in new variable
        data = finalDataAfterToolError; // CRITICAL: Reassign data to the result of this call

        if (!geminiResponse.ok) {
            console.error('Error from Gemini API after sending tool error response:', data);
            return res.status(geminiResponse.status).json({ error: data?.error?.message || 'API error after tool response' });
        }
      } else {
        // Call the image generation model (e.g., Imagen on Vertex AI or a specific Gemini image model)
        // For this example, let's use the gemini-2.0-flash-preview-image-generation model endpoint
        // IMPORTANT: This is a simplified example. Real image generation might need a different API endpoint/SDK call.
        // The `gemini-2.0-flash-preview-image-generation` model might be able to take a direct text prompt for an image.
        // Or, you might use a dedicated image generation API.
        
        const imageModelName = 'gemini-2.0-flash-preview-image-generation'; // Changed model
        const imageUrl = `https://generativelanguage.googleapis.com/v1beta/models/${imageModelName}:generateContent?key=${apiKey}`;
        
        // Construct a simple prompt for the image model
        // The actual structure might vary based on the model.
        const imageGenHistory = [{role: "user", parts: [{text: `Generate an image of: ${imagePrompt}`}]}];

        const imageGenResponse = await fetch(imageUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: imageGenHistory,
            generationConfig: {
                // temperature: 0.4, // Optional: you can set other relevant configs
                responseModalities: ["IMAGE", "TEXT"] // Keep specifying expected modalities
            }
          })
        });

        const imageDataResponse = await imageGenResponse.json();
        let toolResponsePart;
        let imagePartFromResponse = null;
        let generatedImageDataForClient = null; // Variable to store successful image data

        if (imageGenResponse.ok && imageDataResponse.candidates?.[0]?.content?.parts) {
            imagePartFromResponse = imageDataResponse.candidates[0].content.parts.find(part => part.inlineData);
        }

        if (imagePartFromResponse) {
          generatedImageDataForClient = imagePartFromResponse.inlineData; // Store for later
          toolResponsePart = {
            functionResponse: {
              name: 'generate_image',
              response: {
                // Provide a simpler response to the chat model, just confirming success.
                // The actual image data will be added by the proxy to the final client response.
                content: `Image for prompt "${imagePrompt}" was successfully generated and is available.`
                // Removed imageData from here as the chat model isn't re-packaging it.
              }
            }
          };
        } else {
          console.error('Image generation failed or no inlineData found:', imageDataResponse);
          toolResponsePart = {
            functionResponse: {
              name: 'generate_image',
              response: {
                error: 'Failed to generate image.',
                content: 'Sorry, I was unable to generate the image at this time.'
              }
            }
          };
        }

        // Send the function response back to the original chat model
        const followupRequestBody = {
            ...requestBody, 
            contents: [
                ...history, 
                data.candidates[0].content, // Model's turn with the functionCall
                { // New "tool" turn, wrapping the toolResponsePart
                    role: "tool", 
                    parts: [toolResponsePart] 
                }
            ], 
        };

        geminiResponse = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(followupRequestBody)
        });
        // data = await geminiResponse.json(); // Original line
        const finalDataAfterImageGen = await geminiResponse.json(); 
        
        // Manually add the image data to the final response if it was generated successfully
        if (generatedImageDataForClient && finalDataAfterImageGen.candidates?.[0]?.content?.parts) {
            finalDataAfterImageGen.candidates[0].content.parts.push({ inlineData: generatedImageDataForClient });
        }

        data = finalDataAfterImageGen; 

        if (!geminiResponse.ok) {
            console.error('Error from Gemini API after sending tool response:', data);
            return res.status(geminiResponse.status).json({ error: data?.error?.message || 'API error after tool response' });
        }
      }
    } // End of function call handling
    
    // Ensure the final response has candidates and parts before sending back
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
      console.error('Invalid response structure from Gemini API (initial call, no function call):', data);
      return res.status(500).json({ error: 'Invalid response structure from Gemini API' });
    }

    res.status(200).json(data);

  } catch (error) {
    console.error('Error in proxy function:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
