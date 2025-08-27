// api/gemini-proxy.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { history, recaptchaToken, model: requestedModel, generationConfig: frontendGenerationConfig, task } = req.body; // Add task from request
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const perplexityApiKey = process.env.PERPLEXITY_API_KEY; // Added Perplexity API Key
  const recaptchaSecretKey = process.env.RECAPTCHA_SECRET_KEY;
  const openWeatherApiKey = process.env.OPEN_WEATHER_API_KEY; 
  
  // --- reCAPTCHA Verification (runs once for all tasks) ---
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

  let conversationTitle = null;

  // --- Task: Generate Conversation Title (if requested as part of a combined task) ---
  if (task === 'generate_title_and_chat') {
    if (geminiApiKey && history && history.length > 0) {
      const titleGenModel = 'gemini-2.0-flash-lite';
      const titleGenUrl = `https://generativelanguage.googleapis.com/v1beta/models/${titleGenModel}:generateContent?key=${geminiApiKey}`;
      const titleGenSystemPrompt = `You are an expert in creating concise and compelling titles. Based on the user's first message, generate a short title for the conversation. The title should be no more than 6 words long and capture the main topic or question. Do not add any introductory text like "Title:" or use quotation marks. Just return the title.`;

      const requestBody = {
        contents: history,
        systemInstruction: { parts: [{ text: titleGenSystemPrompt }] },
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 20,
          topP: 1,
          topK: 1,
        }
      };

      try {
        const apiResponse = await fetch(titleGenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
        const data = await apiResponse.json();

        if (apiResponse.ok) {
          conversationTitle = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().replace(/"/g, '') || null;
        } else {
          console.error(`Error from Gemini API for title generation:`, data);
        }
      } catch (error) {
        console.error('Error in title generation:', error);
      }
    } else {
      console.error('Could not generate title: Missing Gemini API key or history.');
    }
  }
  
  // --- Main Task: Continue with chat response generation ---

  // Determine the model to use, defaulting to gemini-2.5-flash-lite
  const modelToUse = requestedModel || 'gemini-2.5-flash-lite';

  // Define your system prompt here
  const systemPrompt = `You are a bot embedded in a tech prototype. You can use functions to generate images and get live weather information. To generate an image, you MUST call the function named 'generate_image' with a detailed textual prompt. To get weather information, you MUST call the function named 'get_weather' with a location. Only call these functions when the user explicitly asks for an image/diagram/visual content or weather information, or when such content would significantly enhance the response. Do not attempt to generate images or get weather in any other way.`;

  // API Key validation based on selected model provider
  if (modelToUse.startsWith('gemini-') && !geminiApiKey) {
    return res.status(500).json({ error: 'Gemini API key not configured.' });
  } else if (modelToUse.startsWith('perplexity-') && !perplexityApiKey) {
    return res.status(500).json({ error: 'Perplexity API key not configured.' });
  }
  
  // Validate OpenWeather API key
  if (!openWeatherApiKey) {
    console.warn('OpenWeatherMap API key not configured. Weather functionality will be disabled.');
  }


  if (!history || !Array.isArray(history) || history.length === 0) { // Validate history
    return res.status(400).json({ error: 'History is required and must be a non-empty array.' });
  }

  // Check if user is asking for an image or weather
  const lastUserMessage = history[history.length - 1];
  const userText = lastUserMessage?.parts?.[0]?.text?.toLowerCase() || '';
  const imageKeywords = ['image', 'picture', 'diagram', 'chart', 'illustration', 'draw', 'create a visual', 'show me', 'generate an image'];
  const weatherKeywords = ['weather', 'temperature', 'forecast', 'rain', 'sunny', 'cloudy', 'weather in', 'how is the weather'];
  const isImageRequest = imageKeywords.some(keyword => userText.includes(keyword));
  const isWeatherRequest = weatherKeywords.some(keyword => userText.includes(keyword));

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

  // Define the weather tool
  const weatherTool = {
    functionDeclarations: [
      {
        name: 'get_weather',
        description: 'Gets current weather information for a specific location. Use this when the user asks about weather conditions, temperature, or forecast for a particular place.',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The location to get weather for. Can be a city name, city and country, or coordinates. Examples: "New York", "London, UK", "Tokyo, Japan"'
            }
          },
          required: ['location']
        }
      }
    ]
  };

  // Combine tools
  const allTools = {
    functionDeclarations: [
      ...imageGenerationTool.functionDeclarations,
      ...(openWeatherApiKey ? weatherTool.functionDeclarations : []) // Only include weather if API key is available
    ]
  };

  // Determine if the current model supports function calling for image generation and weather
  // For this example, let's assume gemini-2.0-flash-lite and gemini-2.5-pro-preview-06-05 support it.
  // The gemini-2.5-flash-image-preview model generates images directly.
  const supportsFunctionCalling = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'].includes(modelToUse);
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
      if (systemPrompt && modelToUse !== 'gemini-2.5-flash-image-preview') {
          requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
      }
      if (supportsFunctionCalling) {
        console.log('Adding function calling tools to request for model:', modelToUse);
        console.log('Available tools:', allTools.functionDeclarations.map(tool => tool.name));
        requestBody.tools = [allTools];
      } else {
        console.log('Model does not support function calling:', modelToUse);
      }
    }

    // If the model is specifically for image generation, adjust config
    if (modelToUse === 'gemini-2.5-flash-image-preview') {
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
        // Check if the Perplexity response indicates a desire to generate an image or get weather
        // This is a simplified check; a more robust solution might involve keywords or intent detection.
        const perplexityRequestsImage = imageKeywords.some(keyword => perplexityContent.toLowerCase().includes(keyword));
        const perplexityRequestsWeather = weatherKeywords.some(keyword => perplexityContent.toLowerCase().includes(keyword));

        if ((perplexityRequestsImage || perplexityRequestsWeather) && !data.choices[0].message.tool_calls) { // If Perplexity wants a tool but didn't make a tool call itself
            // We will now make a separate call to Gemini for the function calling
            // using the content from Perplexity as a basis for the prompt.

            let promptSuffix = '';
            if (perplexityRequestsImage) {
                promptSuffix = ' - Please generate an image based on this.';
            } else if (perplexityRequestsWeather) {
                promptSuffix = ' - Please get weather information for the location mentioned.';
            }

            // Create a temporary history for Gemini function calling
            const geminiFunctionCallHistory = [
                { role: "user", parts: [{ text: perplexityContent + promptSuffix }] } 
            ];
            const geminiFcRequestBody = {
                contents: geminiFunctionCallHistory,
                tools: [allTools],
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
                // Now the existing function call handling logic will take over
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
        } else { // Perplexity did not request an image/weather or already made a tool call (if it supports it in the future)
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


    // Check for function calls (This part now primarily handles Gemini's function calls, 
    // or Gemini's function calls made on behalf of Perplexity)
    const partsContainingFunctionCalls = data.candidates?.[0]?.content?.parts?.filter(part => part.functionCall) || [];
    
    if (supportsFunctionCalling && partsContainingFunctionCalls.length > 0) {
      console.log('Function calls detected:', partsContainingFunctionCalls.map(part => ({ name: part.functionCall.name, args: part.functionCall.args })));
      
      // Process all function calls and collect their responses
      const toolResponseParts = [];
      let generatedImageDataForClient = null; // Variable to store successful image data

      for (const partContainingFunctionCall of partsContainingFunctionCalls) {
        const actualFunctionCall = partContainingFunctionCall.functionCall;
        
        if (actualFunctionCall.name === 'generate_image') {
          // Handle image generation
          const imagePrompt = actualFunctionCall.args.prompt;

          if (!imagePrompt) {
            console.error('Image generation function called without prompt');
            toolResponseParts.push({
              functionResponse: {
                name: 'generate_image',
                response: {
                  error: 'Missing prompt for image generation.',
                  content: 'Error: I need a prompt to generate an image. Please provide a description.'
                }
              }
            });
          } else {
            // Handle image generation
            console.log('Generating image with prompt:', imagePrompt);
            
            const imageModelName = 'gemini-2.5-flash-image-preview';
            const imageUrl = `https://generativelanguage.googleapis.com/v1beta/models/${imageModelName}:generateContent?key=${geminiApiKey}`;
            
            const imageGenHistory = [{role: "user", parts: [{text: `Generate an image of: ${imagePrompt}`}]}];

            const imageGenResponse = await fetch(imageUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: imageGenHistory,
                generationConfig: {
                  responseModalities: ["IMAGE", "TEXT"]
                }
              })
            });

            const imageDataResponse = await imageGenResponse.json();
            let imagePartFromResponse = null;

            if (imageGenResponse.ok && imageDataResponse.candidates?.[0]?.content?.parts) {
                imagePartFromResponse = imageDataResponse.candidates[0].content.parts.find(part => part.inlineData);
            }

            if (imagePartFromResponse) {
              console.log('Image generation successful');
              generatedImageDataForClient = imagePartFromResponse.inlineData; // Store for later
              toolResponseParts.push({
                functionResponse: {
                  name: 'generate_image',
                  response: {
                    content: `Image for prompt \"${imagePrompt}\" was successfully generated and is available.`
                  }
                }
              });
            } else {
              console.error('Image generation failed or no inlineData found:', imageDataResponse);
              toolResponseParts.push({
                functionResponse: {
                  name: 'generate_image',
                  response: {
                    error: 'Failed to generate image.',
                    content: 'Sorry, I was unable to generate the image at this time.'
                  }
                }
              });
            }
          }
        } else if (actualFunctionCall.name === 'get_weather') {
          // Handle weather function call
          const location = actualFunctionCall.args.location;
          
          if (!location) {
            console.error('Weather function called without location');
            toolResponseParts.push({
              functionResponse: {
                name: 'get_weather',
                response: {
                  error: 'Missing location for weather request.',
                  content: 'Error: I need a location to get weather information. Please provide a city name or location.'
                }
              }
            });
          } else {
            // Fetch weather data
            console.log('Fetching weather for location:', location);
            const weatherData = await fetchWeatherData(location, openWeatherApiKey);
            
            if (weatherData.error) {
              console.error('Weather fetch failed:', weatherData.error);
              toolResponseParts.push({
                functionResponse: {
                  name: 'get_weather',
                  response: {
                    error: weatherData.error,
                    content: `Sorry, I couldn't get weather information for "${location}". ${weatherData.error}`
                  }
                }
              });
            } else {
              console.log('Weather data retrieved successfully for:', weatherData.location);
              toolResponseParts.push({
                functionResponse: {
                  name: 'get_weather',
                  response: {
                    content: `Current weather in ${weatherData.location}: ${weatherData.temperature}°F, ${weatherData.description}. Feels like ${weatherData.feels_like}°F. Humidity: ${weatherData.humidity}%, Wind: ${weatherData.wind_speed} mph`,
                    data: weatherData
                  }
                }
              });
            }
          }
        } else {
          console.warn('Unknown function call:', actualFunctionCall.name);
          toolResponseParts.push({
            functionResponse: {
              name: actualFunctionCall.name,
              response: {
                error: 'Unknown function',
                content: `Sorry, I don't know how to handle the function "${actualFunctionCall.name}".`
              }
            }
          });
        }
      }

      // Send all function responses back to the original chat model
      const followupRequestBodyAfterTools = {
          contents: [
              ...history, 
              data.candidates[0].content, // Model's turn with the functionCall(s)
              { // New "tool" turn, wrapping all the toolResponseParts
                  role: "tool", 
                  parts: toolResponseParts 
              }
          ], 
      };

      let followupApiUrlAfterTools = apiUrl;
      let followupHeadersAfterTools = headers;
      let finalRequestBodyAfterTools = followupRequestBodyAfterTools;

      if (isPerplexityModel && partsContainingFunctionCalls.length > 0) {
          followupApiUrlAfterTools = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
          followupHeadersAfterTools = { 'Content-Type': 'application/json' };
          finalRequestBodyAfterTools = {
              contents: followupRequestBodyAfterTools.contents,
              tools: [allTools],
              systemInstruction: { parts: [{ text: systemPrompt }] }
          };
      } else if (!isPerplexityModel) {
          finalRequestBodyAfterTools = {
              ...requestBody,
              contents: followupRequestBodyAfterTools.contents
          };
      }

      apiResponse = await fetch(followupApiUrlAfterTools, {
          method: 'POST',
          headers: followupHeadersAfterTools,
          body: JSON.stringify(finalRequestBodyAfterTools)
      });
      
      const finalDataAfterTools = await apiResponse.json();
      
      // Manually add the image data to the final response if it was generated successfully
      if (generatedImageDataForClient && finalDataAfterTools.candidates?.[0]?.content?.parts) {
          finalDataAfterTools.candidates[0].content.parts.push({ inlineData: generatedImageDataForClient });
      }

      data = finalDataAfterTools;

      if (!apiResponse.ok) {
          console.error('Error from API after sending tool responses:', data);
          return res.status(apiResponse.status).json({ error: data?.error?.message || 'API error after tool responses' });
      }
    } // End of function call handling
    
    // Ensure the final response has candidates and parts before sending back
    // This check should apply to the 'data' object, which could be from Gemini or Perplexity (after adaptation)
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
      console.error('Invalid response structure from API (final check):', data);
      return res.status(500).json({ error: 'Invalid response structure from API after all processing' });
    }

    // Include the generated title in the response if available
    const responseToSend = {
      ...data,
      title: conversationTitle // Add title to response
    };

    res.status(200).json(responseToSend);

  } catch (error) {
    console.error('Error in proxy function:', error);
    if (!res.headersSent) { // Check if headers already sent
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
  }
}

// Helper function to fetch weather data
async function fetchWeatherData(location, openWeatherApiKey) {
  if (!openWeatherApiKey) {
    console.error('OpenWeatherMap API key not configured');
    return { error: 'Weather service is not configured' };
  }

  console.log(`Fetching weather data for location: ${location}`);
  
  try {
    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${openWeatherApiKey}&units=imperial`;
    
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = await weatherResponse.json();
    
    if (!weatherResponse.ok) {
      console.error('OpenWeatherMap API error:', weatherData);
      return { 
        error: weatherData.message || 'Failed to fetch weather data',
        code: weatherData.cod
      };
    }
    
    console.log('Weather data fetched successfully:', {
      location: weatherData.name,
      country: weatherData.sys.country,
      temperature: weatherData.main.temp,
      description: weatherData.weather[0].description
    });
    
    return {
      location: `${weatherData.name}, ${weatherData.sys.country}`,
      temperature: Math.round(weatherData.main.temp),
      feels_like: Math.round(weatherData.main.feels_like),
      description: weatherData.weather[0].description,
      humidity: weatherData.main.humidity,
      pressure: weatherData.main.pressure,
      wind_speed: weatherData.wind?.speed || 0,
      wind_direction: weatherData.wind?.deg || 0,
      visibility: weatherData.visibility ? weatherData.visibility / 1000 : null, // Convert to km
      icon: weatherData.weather[0].icon,
      timestamp: new Date(weatherData.dt * 1000).toISOString()
    };
  } catch (error) {
    console.error('Error fetching weather data:', error);
    return { error: 'Failed to fetch weather data', details: error.message };
  }
}
