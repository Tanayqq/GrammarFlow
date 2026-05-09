const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL_NAME = "llama-3.3-70b-versatile";

async function callGroqAPI(systemPrompt, userText, temperature = 0.7) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error("GROQ_API_KEY is not configured on the server.");
    }

    let attempts = 0;
    const maxRetries = 3;
    const timeoutMs = 90000; // 90 seconds (increased for large document consolidation)

    while (attempts < maxRetries) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            console.log(`[AI SERVICE] Calling Groq API (Attempt ${attempts + 1})...`);
            
            const response = await fetch(GROQ_API_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: MODEL_NAME,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userText }
                    ],
                    temperature: temperature
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                const errorMsg = errorBody.error?.message || `Groq API Error: ${response.status}`;
                console.error(`[\x1b[31mAI ERROR\x1b[0m] Status: ${response.status} - ${errorMsg}`);
                
                // Handle specific status codes
                if (response.status === 401) throw new Error("Invalid API Key");
                if (response.status === 429) throw new Error("Groq API rate limit exceeded");
                
                throw new Error(errorMsg);
            }

            const data = await response.json();
            if (!data.choices || !data.choices[0]) {
                throw new Error("Invalid response format from Groq API");
            }
            
            return data.choices[0].message.content.trim();

        } catch (error) {
            clearTimeout(timeoutId);
            attempts++;
            
            const isTimeout = error.name === 'AbortError';
            const errorMessage = isTimeout ? "Request timed out after 30s" : error.message;
            
            console.error(`[AI SERVICE] Attempt ${attempts} failed: ${errorMessage}`);
            
            if (attempts >= maxRetries) {
                throw new Error(isTimeout 
                    ? "Connection to AI timed out. Please try again." 
                    : `Connection to AI failed: ${error.message}`);
            }
            
            // Exponential backoff: 1s, 2s, 4s
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempts - 1)));
        }
    }
}

module.exports = {
    callGroqAPI
};
