import React, { useState } from 'react';

export default function ChatDemo() {
  // These variables must be set in your Vercel dashboard and prefixed with NEXT_PUBLIC_
  const perplexityApiKey = process.env.NEXT_PUBLIC_PERPLEXITY_API_KEY;
  const perplexityApiEndpoint = process.env.NEXT_PUBLIC_PERPLEXITY_API_ENDPOINT;

  const [messages, setMessages] = useState([]);

  const sendMessage = async (e) => {
    e.preventDefault();
    const input = e.target.elements.chatInput;
    const userMessage = input.value.trim();
    if (!userMessage) return;
    setMessages((prev) => [...prev, { sender: 'User', text: userMessage }]);
    input.value = '';

    try {
      const response = await fetch(perplexityApiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${perplexityApiKey}`
        },
        body: JSON.stringify({ prompt: userMessage })
      });
      const data = await response.json();
      setMessages((prev) => [
        ...prev,
        { sender: 'Bot', text: data.answer || 'No response received.' }
      ]);
    } catch (error) {
      console.error('Error with Perplexity API:', error);
      setMessages((prev) => [
        ...prev,
        { sender: 'Bot', text: 'Sorry, there was an error contacting Perplexity.' }
      ]);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'Arial, sans-serif' }}>
      {/* Left Panel: Instructions or additional info */}
      <div style={{ flex: 1, background: '#f7f7f7', padding: 20, overflowY: 'auto' }}>
        <h2>Demo Instructions</h2>
        <p>
          This demo page connects to the Perplexity LLM API using environment variables
          set in Vercel. Type your question on the right to see the model in action.
        </p>
      </div>

      {/* Right Panel: Chat Interface */}
      <div style={{ flex: 1, padding: 20, borderLeft: '1px solid #ccc', display: 'flex', flexDirection: 'column' }}>
        <div
          id="chat-panel"
          style={{ flex: 1, border: '1px solid #ccc', padding: 10, overflowY: 'auto', marginBottom: 10 }}
        >
          {messages.map((msg, index) => (
            <div key={index} style={{ margin: '5px 0' }}>
              <span style={{ fontWeight: 'bold', color: msg.sender === 'Bot' ? 'blue' : 'black' }}>
                {msg.sender}:
              </span> {msg.text}
            </div>
          ))}
        </div>
        <form id="chat-form" onSubmit={sendMessage} style={{ display: 'flex' }}>
          <input
            type="text"
            name="chatInput"
            placeholder="Type your message..."
            required
            style={{ flex: 1, padding: 8, fontSize: '1em' }}
          />
          <button type="submit" style={{ padding: '8px 12px', fontSize: '1em' }}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}