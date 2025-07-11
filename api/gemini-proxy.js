// api/gemini-proxy.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { history, recaptchaToken, model: requestedModel, generationConfig: frontendGenerationConfig } = req.body; // Add model and generationConfig from request
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const perplexityApiKey = process.env.PERPLEXITY_API_KEY; // Added Perplexity API Key
  const recaptchaSecretKey = process.env.RECAPTCHA_SECRET_KEY; 
  
  // Determine the model to use, defaulting to gemini-2.0-flash-lite
  const modelToUse = requestedModel || 'gemini-2.0-flash-lite';

  // Define your system prompt here
  const systemPrompt = `You are a bot embedded in a tech prototype. You can use a function to generate images. To generate an image, you MUST call the function named \'generate_image\' with a detailed textual prompt. Only call this function when the user explicitly asks for an image, diagram, or visual content, or when an image would significantly enhance the response. Do not attempt to generate images in any other way or state you will generate one without calling the function.`;

  // API Key validation based on selected model provider
  if (modelToUse.startsWith('gemini-') && !geminiApiKey) {
    return res.status(500).json({ error: 'Gemini API key not configured.' });
  } else if (modelToUse.startsWith('perplexity-') && !perplexityApiKey) {
    return res.status(500).json({ error: 'Perplexity API key not configured.' });
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
  const supportsFunctionCalling = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite-preview-06-17'].includes(modelToUse);
  const isPerplexityModel = modelToUse.startsWith('perplexity-');

  try {
    let requestBody;
    let apiUrl;
    let headers = { 'Content-Type': 'application/json' };

    if (isPerplexityModel) {
      apiUrl = 'https://api.perplexity.ai/chat/completions';
      headers['Authorization'] = `Bearer ${perplexityApiKey}`;
      
      // Transform history for Perplexity format
      const perplexityHistory = history.map(turn => ({
        role: turn.role,
        content: turn.parts.map(part => part.text).join(' ') // Combine parts into a single content string
      }));

      requestBody = {
        model: modelToUse.replace('perplexity-', ''), // e.g., sonar-medium-chat
        messages: perplexityHistory,
        // Perplexity uses a different structure for tools/function calling if supported.
        // For now, we will call Gemini for image generation separately if a Perplexity model is chosen.
        // Add other Perplexity specific parameters if needed, e.g., temperature
      };
      if (systemPrompt) {
        // Perplexity expects system prompt as the first message with role 'system'
        requestBody.messages.unshift({ role: 'system', content: systemPrompt });
      }

    } else { // Gemini models
      apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${geminiApiKey}`;
      requestBody = {
        contents: history,
        generationConfig: {
          temperature: 0.7,
        }
      };
      if (frontendGenerationConfig) {
        requestBody.generationConfig = { ...requestBody.generationConfig, ...frontendGenerationConfig };
      }
      if (systemPrompt && modelToUse !== 'gemini-2.0-flash-preview-image-generation') {
          requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
      }
      if (supportsFunctionCalling) {
        requestBody.tools = [imageGenerationTool];
      }
    }

    // If the model is specifically for image generation, adjust config
    if (modelToUse === 'gemini-2.0-flash-preview-image-generation') {
      // This model might expect a different request structure or config for image generation.
      // For now, we assume it can take text and might return an image part directly.
      // The Vertex AI SDK handles this more gracefully. With direct REST, it's more manual.
      // Let's ensure responseModalities is set if this model requires it.
      // requestBody.generationConfig.responseMimeType = 'multipart/form-data'; // REMOVED - Frontend will send this if needed via frontendGenerationConfig
      // The API might also expect a specific structure for image prompts if not using function calling.
      // For simplicity, we'll let the model try to generate an image if the user asks for one with this model.
    }

    // const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${apiKey}`; // Original URL logic

    let apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    let data = await apiResponse.json();

    if (!apiResponse.ok) {
      console.error(`Error from ${isPerplexityModel ? 'Perplexity' : 'Gemini'} API (${modelToUse}):`, data);
      const errorMessage = data?.error?.message || data?.message || `Error calling ${isPerplexityModel ? 'Perplexity' : 'Gemini'} API`;
      return res.status(apiResponse.status).json({ error: errorMessage, details: data.error || data });
    }

    // Adapt Perplexity response to Gemini-like structure for frontend compatibility
    if (isPerplexityModel) {
      if (data.choices && data.choices.length > 0) {
        const perplexityContent = data.choices[0].message.content;
        // Check if the Perplexity response indicates a desire to generate an image
        // This is a simplified check; a more robust solution might involve keywords or intent detection.
        const perplexityRequestsImage = imageKeywords.some(keyword => perplexityContent.toLowerCase().includes(keyword));

        if (perplexityRequestsImage && !data.choices[0].message.tool_calls) { // If Perplexity wants an image but didn't make a tool call itself
            // We will now make a separate call to Gemini for the image generation function
            // using the content from Perplexity as a basis for the prompt.

            // Create a temporary history for Gemini function calling
            const geminiFunctionCallHistory = [
                { role: "user", parts: [{ text: perplexityContent + " - Please generate an image based on this." }] } 
            ];
            const geminiFcRequestBody = {
                contents: geminiFunctionCallHistory,
                tools: [imageGenerationTool],
                systemInstruction: { parts: [{ text: systemPrompt }] }, // Gemini needs its system prompt
                generationConfig: { temperature: 0.7 }
            };
            const geminiFcUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`; // Use a capable Gemini model

            const geminiFcResponse = await fetch(geminiFcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(geminiFcRequestBody)
            });
            const geminiFcData = await geminiFcResponse.json();

            if (geminiFcResponse.ok && geminiFcData.candidates?.[0]?.content?.parts?.find(part => part.functionCall)) {
                // If Gemini responded with a function call, replace Perplexity's data with Gemini's
                data = geminiFcData; 
                // Now the existing Gemini function call handling logic will take over
            } else {
                // If Gemini didn't make a function call, or errored, proceed with Perplexity's original text response
                 data = {
                    candidates: [{
                        content: {
                            parts: [{ text: perplexityContent }],
                            role: "model"
                        },
                        finishReason: "STOP",
                        index: 0,
                        safetyRatings: [] // Add dummy safety ratings if needed by frontend
                    }]
                };
            }
        } else { // Perplexity did not request an image or already made a tool call (if it supports it in the future)
            data = { // Standard adaptation
                candidates: [{
                    content: {
                        parts: [{ text: data.choices[0].message.content }],
                        role: "model" // Perplexity uses 'assistant', map to 'model'
                    },
                    finishReason: data.choices[0].finish_reason ? data.choices[0].finish_reason.toUpperCase() : "STOP",
                    index: 0,
                    safetyRatings: [] // Add dummy safety ratings if needed by frontend
                }]
            };
        }
      } else {
        // Handle cases where Perplexity response might be empty or malformed
        data = { candidates: [{ content: { parts: [{ text: "Sorry, I could not process that." }], role: "model" } }] };
      }
    }


    // Check for function call (This part now primarily handles Gemini's function calls, 
    // or Gemini's function calls made on behalf of Perplexity)
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
          // ...requestBody, // Retain original request body context if needed - This needs to be conditional
          contents: [...history, data.candidates[0].content, {role: "tool", parts: [toolResponsePart]} ], // Add model\'s turn and our tool response
        };
        // Determine which API to call for followup
        let followupApiUrl = apiUrl; // Default to original API
        let followupHeaders = headers; // Default to original headers
        let followupBody = followupRequestBody;

        if (isPerplexityModel && partContainingFunctionCall) { 
          // If the function call originated from a Gemini call made on behalf of Perplexity,
          // the followup should go to that Gemini model.
          followupApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`; // Or the specific Gemini model used for FC
          followupHeaders = { 'Content-Type': 'application/json' };
          // Gemini expects 'contents' and potentially 'systemInstruction'
          followupBody = {
            contents: followupRequestBody.contents, // Already in Gemini format
            tools: [imageGenerationTool], // Resend tools
            systemInstruction: { parts: [{ text: systemPrompt }] }
          };
        } else if (!isPerplexityModel) {
          // If it was a direct Gemini call, use the original Gemini request body structure
          followupBody = {
            ...requestBody, // Original Gemini request body
            contents: followupRequestBody.contents
          };
        }


        apiResponse = await fetch(followupApiUrl, { // Use followupApiUrl
            method: 'POST',
            headers: followupHeaders, // Use followupHeaders
            body: JSON.stringify(followupBody) // Use followupBody
        });
        // data = await apiResponse.json(); // Original line
        const finalDataAfterToolError = await apiResponse.json(); // Capture in new variable
        data = finalDataAfterToolError; // CRITICAL: Reassign data to the result of this call

        if (!apiResponse.ok) {
            console.error('Error from Gemini API after sending tool error response:', data);
            return res.status(apiResponse.status).json({ error: data?.error?.message || 'API error after tool response' });
        }
      } else {
        // Call the image generation model (e.g., Imagen on Vertex AI or a specific Gemini image model)
        // For this example, let's use the gemini-2.0-flash-preview-image-generation model endpoint
        // IMPORTANT: This is a simplified example. Real image generation might need a different API endpoint/SDK call.
        // The `gemini-2.0-flash-preview-image-generation` model might be able to take a direct text prompt for an image.
        // Or, you might use a dedicated image generation API.
        
        const imageModelName = 'gemini-2.0-flash-preview-image-generation'; // Changed model
        const imageUrl = `https://generativelanguage.googleapis.com/v1beta/models/${imageModelName}:generateContent?key=${geminiApiKey}`;
        
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
                content: `Image for prompt \"${imagePrompt}\" was successfully generated and is available.`
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
        const followupRequestBodyAfterTool = {
            // ...requestBody, // This needs to be conditional
            contents: [
                ...history, 
                data.candidates[0].content, // Model\'s turn with the functionCall
                { // New \"tool\" turn, wrapping the toolResponsePart
                    role: "tool", 
                    parts: [toolResponsePart] 
                }
            ], 
        };

        let followupApiUrlAfterTool = apiUrl;
        let followupHeadersAfterTool = headers;
        let finalRequestBodyAfterTool = followupRequestBodyAfterTool;

        if (isPerplexityModel && partContainingFunctionCall) {
            // If the function call originated from a Gemini call made on behalf of Perplexity,
            // the followup should go to that Gemini model.
            followupApiUrlAfterTool = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
            followupHeadersAfterTool = { 'Content-Type': 'application/json' };
            finalRequestBodyAfterTool = { // Gemini format
                contents: followupRequestBodyAfterTool.contents,
                tools: [imageGenerationTool],
                systemInstruction: { parts: [{ text: systemPrompt }] }
            };
        } else if (!isPerplexityModel) {
            // If it was a direct Gemini call, use the original Gemini request body structure
            finalRequestBodyAfterTool = {
                ...requestBody, // Original Gemini request body
                contents: followupRequestBodyAfterTool.contents
            };
        }


        apiResponse = await fetch(followupApiUrlAfterTool, { // Use followupApiUrlAfterTool
            method: 'POST',
            headers: followupHeadersAfterTool, // Use followupHeadersAfterTool
            body: JSON.stringify(finalRequestBodyAfterTool) // Use finalRequestBodyAfterTool
        });
        // data = await apiResponse.json(); // Original line
        const finalDataAfterImageGen = await apiResponse.json(); 
        
        // Manually add the image data to the final response if it was generated successfully
        if (generatedImageDataForClient && finalDataAfterImageGen.candidates?.[0]?.content?.parts) {
            finalDataAfterImageGen.candidates[0].content.parts.push({ inlineData: generatedImageDataForClient });
        }

        data = finalDataAfterImageGen; 

        if (!apiResponse.ok) {
            console.error('Error from Gemini API after sending tool response:', data);
            return res.status(apiResponse.status).json({ error: data?.error?.message || 'API error after tool response' });
        }
      }
    } // End of function call handling
    
    // Ensure the final response has candidates and parts before sending back
    // This check should apply to the 'data' object, which could be from Gemini or Perplexity (after adaptation)
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
      console.error('Invalid response structure from API (final check):', data);
      return res.status(500).json({ error: 'Invalid response structure from API after all processing' });
    }

    res.status(200).json(data);

  } catch (error) {
    console.error('Error in proxy function:', error);
    if (!res.headersSent) { // Check if headers already sent
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
  }
}
