// api/gemini-proxy.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { history } = req.body; // Changed from prompt to history
  const apiKey = process.env.GEMINI_API_KEY;
  const model = 'gemini-2.0-flash-lite'; // Use text-only model 

  // Define your system prompt here
  const systemPrompt = `Your  are an AI assistant embedded in a learning platform. Your job is to help high school students and teachers explore ideas through multi-turn conversations, render and format Markdown (including code, lists, tables, and links.
You operate in a U.S. high school environment and must maintain an appropriate, respectful, and educational tone at all times. If a user requests or ventures into a topic that is not suitable for a school setting - such as explicit content, hate speech, self-harm, or other disallowed subject matter - you must immediately stop generating and reply:
'I’m sorry, but I can’t discuss that topic. Your teacher may be notified to review this conversation.'
Key guidelines:
- Always prioritize student safety, privacy, and age-appropriate content.  
- Help with learning, creativity, and problem solving; do not enable cheating or academic dishonesty.  
- When in doubt, err on the side of caution and refuse.  
- Support teachers by producing concise summaries of sessions and flagging any potential issues.  
- Use clear, friendly, and encouraging language.  
You have access to an image generation function. Only call it when the user explicitly asks for an image, diagram, or visual content. Do not generate images unless specifically requested.`;

  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured.' });
  }

  if (!history || !Array.isArray(history) || history.length === 0) { // Validate history
    return res.status(400).json({ error: 'History is required and must be a non-empty array.' });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Define image generation function
  const imageGenerationTool = {
    function_declarations: [{
      name: "generate_image",
      description: "Generate an image based on a text description. Only use when the user explicitly asks for an image, diagram, or visual content.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "A detailed description of the image to generate"
          }
        },
        required: ["prompt"]
      }
    }]
  };

  try {
    const geminiResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: history,
        tools: [imageGenerationTool],
        generationConfig: {
          temperature: 0.7
        }
      })
    });

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error('Error from Gemini API:', data);
      const errorMessage = data?.error?.message || 'Error calling Gemini API';
      return res.status(geminiResponse.status).json({ error: errorMessage, details: data.error });
    }
    
    // Check if the response contains function calls
    const candidate = data.candidates?.[0];
    if (candidate?.content?.parts) {
      const parts = candidate.content.parts;
      const functionCalls = parts.filter(part => part.functionCall);
      
      if (functionCalls.length > 0) {
        // Handle function calls (image generation)
        const updatedParts = [];
        
        for (const part of parts) {
          if (part.functionCall && part.functionCall.name === 'generate_image') {
            // Generate image using imagen
            const imagePrompt = part.functionCall.args.prompt;
            try {
              const imageResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  contents: [{
                    parts: [{ text: imagePrompt }]
                  }],
                  generationConfig: {
                    responseModalities: ["IMAGE"]
                  }
                })
              });
              
              const imageData = await imageResponse.json();
              if (imageResponse.ok && imageData.candidates?.[0]?.content?.parts) {
                // Add the generated image to the response
                const imageParts = imageData.candidates[0].content.parts.filter(p => p.inlineData);
                updatedParts.push(...imageParts);
              }
            } catch (imageError) {
              console.error('Error generating image:', imageError);
              // Add error message instead of image
              updatedParts.push({ text: `Sorry, I couldn't generate the requested image: ${imageError.message}` });
            }
          } else {
            // Keep non-function call parts as-is
            updatedParts.push(part);
          }
        }
        
        // Update the response with generated images
        data.candidates[0].content.parts = updatedParts;
      }
    }
    
    // Ensure the response has candidates and parts before sending back
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
      console.error('Invalid response structure from Gemini API:', data);
      return res.status(500).json({ error: 'Invalid response structure from Gemini API' });
    }

    res.status(200).json(data);
  } catch (error) {
    console.error('Error in proxy function:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
