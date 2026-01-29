const { GoogleGenerativeAI } = require("@google/generative-ai");
const priceService = require("./priceService");

let model;

try {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ CRITICAL ERROR: GEMINI_API_KEY is missing in process.env!");
  } else {
    console.log("✅ ChatService: GEMINI_API_KEY found (Length: " + apiKey.length + ")");
    const genAI = new GoogleGenerativeAI(apiKey);
    // Switching to 'gemini-flash-latest' which is the stable 1.5 Flash model.
    // This model has much higher rate limits (15 RPM) compared to experimental 2.0 models.
    model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
  }
} catch (err) {
  console.error("❌ ChatService Initialization Error:", err);
}

const SYSTEM_PROMPT = `
You are NexChain's AI Crypto Assistant.
ROLE:
- You are a knowledgeable, patient, and objective crypto educator.
- You explain concepts like a mentor (blockchain, DeFi, trading basics).

STRICT SAFETY RULES:
1. NO FINANCIAL ADVICE. Never say "Buy", "Sell", "Long", or "Short".
2. If asked for predictions ("Will BTC go up?"), respond: "Market movements are unpredictable. Technical analysis suggests X, but always do your own research."
3. If asked about "How to trade", explain the MECHANISM (Order types, leverage risks), not the STRATEGY.
4. REJECT non-crypto topics politely: "I focus only on crypto and trading education."

TONE:
- Professional but accessible (Junior Trader level).
- No "To the moon!" hype.
- Use markdown for readability (bold key terms).
- Keep responses concise (under 150 words) unless asked for a detailed explanation.

CONTEXT:
- The user is using a DEMO trading platform. Mentions of "losses" are virtual.
`;

const chatService = {
  /**
   * Generates a response from the AI model.
   * @param {string} userMessage - The current user message.
   * @param {Array} history - Previous conversation history (optional).
   * @returns {Promise<string>} - The AI response.
   */
  async generateResponse(userMessage, history = []) {
    if (!model) {
       console.error("Attempted to call generateResponse but model is not initialized (Missing Key?)");
       throw new Error("AI Model not initialized. Check server logs for API Key error.");
    }

    // 1. Define Tools
    const tools = [
      {
        functionDeclarations: [
          {
            name: "get_crypto_price",
            description: "Get the current live price of a cryptocurrency. Use this when the user asks for the price of a specific coin.",
            parameters: {
              type: "OBJECT",
              properties: {
                symbol: {
                  type: "STRING",
                  description: "The crypto symbol (ticker), e.g. BTC, ETH, XRP, SOL."
                },
                currency: {
                  type: "STRING",
                  description: "The quote currency, e.g. USDT, USD, INR. Default is USDT."
                }
              },
              required: ["symbol"]
            }
          }
        ]
      }
    ];

    try {
      // 2. Start Chat Session
      const chat = model.startChat({
        history: [
          {
            role: "user",
            parts: [{ text: SYSTEM_PROMPT }],
          },
          {
            role: "model",
            parts: [{ text: "Understood. I am ready to help with crypto prices and education." }],
          },
          ...history.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
          }))
        ],
        generationConfig: {
          maxOutputTokens: 1500,
        },
        tools: tools, 
      });

      // 3. Send User Message
      let result = await chat.sendMessage(userMessage);
      let response = await result.response;
      let text = response.text();

      // 4. Handle Function Calls (if any)
      const functionCalls = response.functionCalls();
      
      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        
        if (call.name === "get_crypto_price") {
          const { symbol, currency } = call.args;
          console.log(`[ChatService] 🛠️ Tool Call: get_crypto_price(${symbol}, ${currency})`);
          
          let price = await priceService.getPrice(symbol, currency || "USDT");
          
          // Basic logic for manual currency conversion (since we only fetch Binance pairs mostly)
          // If the user asked for INR but we fetched USDT (because BTCINR might not exist on global Binance),
          // we could roughly estimate or just return the USDT price with a note.
          // For now, we return what we found.
          
          const functionResponse = {
            functionResponse: {
              name: "get_crypto_price",
              response: {
                symbol: symbol,
                price: price,
                currency: currency || "USDT",
                error: price ? null : "Price not found."
              }
            }
          };

          // 5. Send Function Result back to Model
          // The model will generate a natural language response based on this data.
          result = await chat.sendMessage([functionResponse]);
          response = await result.response;
          text = response.text();
        }
      }

      return text;

    } catch (error) {
      console.error("Gemini API Error details:", error);
      throw new Error("Failed to generate AI response: " + error.message);
    }
  }
};

module.exports = chatService;
