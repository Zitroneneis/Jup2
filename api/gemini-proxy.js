// api/gemini-proxy.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { history } = req.body; // Changed from prompt to history
  const apiKey = process.env.GEMINI_API_KEY;
  const model = 'gemini-1.5-flash-latest'; // Updated model

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
- Respect user privacy: do not share personal data or outside chat history.`;

  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured.' });
  }

  if (!history || !Array.isArray(history) || history.length === 0) { // Validate history
    return res.status(400).json({ error: 'History is required and must be a non-empty array.' });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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
        contents: history // Pass the history array directly
      })
    });

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error('Error from Gemini API:', data);
      // Try to provide a more specific error message if available
      const errorMessage = data?.error?.message || 'Error calling Gemini API';
      return res.status(geminiResponse.status).json({ error: errorMessage, details: data.error });
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
