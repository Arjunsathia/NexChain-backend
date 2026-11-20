const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const newsService = require("./newsService");

// Integrated Price Fetching Logic (formerly priceService.js)
async function getCryptoPrice(symbol, currency = "USDT") {
  try {
    const pair = `${symbol.toUpperCase()}${currency.toUpperCase()}`;
    // Using Binance API as primary source
    const endpoints = [
      `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`,
      `https://api.binance.us/api/v3/ticker/price?symbol=${pair}`,
      `https://data-api.binance.vision/api/v3/ticker/price?symbol=${pair}`
    ];

    for (const url of endpoints) {
      try {
        // @ts-ignore
        const response = await axios.get(url, { timeout: 3000 });
        if (response.data && response.data.price) {
          return parseFloat(response.data.price);
        }
      } catch {
        // Continue to next endpoint
      }
    }
    console.warn(`[ChatService] ⚠️ Could not fetch price for ${pair}`);
    return null;
  } catch (error) {
    console.error("[ChatService] Price Fetch Error:", error.message);
    return null;
  }
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

// Tried in order. A model that is overloaded or retired is skipped for a minute,
// so the next questions go straight to one that works. Override with GEMINI_MODELS.
// The lite model answers in about a second; the larger ones often time out or report busy, so they're backups
const DEFAULT_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.5-flash"];
const MODEL_TIMEOUT_MS = 12_000;
const COOLDOWN_MS = 60_000;
const MAX_TOOL_ROUNDS = 2;

const modelNames = (process.env.GEMINI_MODELS || "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const MODELS = modelNames.length ? modelNames : DEFAULT_MODELS;

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "get_crypto_price",
        description: "Get the current live price of a cryptocurrency. Use this when the user asks for the price of a specific coin.",
        parameters: {
          type: "OBJECT",
          properties: {
            symbol: { type: "STRING", description: "The crypto symbol (ticker), e.g. BTC, ETH, XRP, SOL." },
            currency: { type: "STRING", description: "The quote currency, e.g. USDT, USD, INR. Default is USDT." },
          },
          required: ["symbol"],
        },
      },
      {
        name: "get_crypto_news",
        description: "Get the latest cryptocurrency and industry news. Use this when the user asks for news, updates, or what's happening in the crypto world.",
        parameters: {
          type: "OBJECT",
          properties: { limit: { type: "NUMBER", description: "The number of news items to fetch. Default is 5." } },
        },
      },
    ],
  },
];

let genAI = null;
try {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[AI-CHAT ] ⚠️  GEMINI_API_KEY not set: the assistant is offline");
  } else {
    genAI = new GoogleGenerativeAI(apiKey);
    console.log(`[AI-CHAT ] ✅ Ready (models: ${MODELS.join(" → ")})`);
  }
} catch (err) {
  console.error("❌ [AI-CHAT ] Initialization error:", err.message);
}

const cooledUntil = new Map();

/** Error with a code the controller turns into a status and a friendly message */
const aiError = (code, message) => Object.assign(new Error(message), { code });

const classify = (err) => {
  const msg = String(err?.message || "");
  const status = err?.status;
  if (status === 429 || /\b429\b|quota|exhausted/i.test(msg)) return "AI_RATE_LIMITED";
  if (status === 503 || status === 500 || /\b50[03]\b|overloaded|high demand|unavailable/i.test(msg)) return "AI_BUSY";
  if (status === 404 || /\b404\b|not found|no longer available/i.test(msg)) return "AI_MODEL_GONE";
  if (/abort|timed? ?out/i.test(msg)) return "AI_BUSY";
  if (status === 400 && /api key/i.test(msg)) return "AI_BAD_KEY";
  if (status === 401 || status === 403 || /api key|permission/i.test(msg)) return "AI_BAD_KEY";
  return "AI_FAILED";
};

/**
 * Gemini wants alternating turns that start with the user. The widget sends its
 * last few messages, which may open with the bot's greeting or repeat a role.
 */
const toHistory = (history) => {
  const turns = [];
  for (const msg of Array.isArray(history) ? history.slice(-10) : []) {
    const text = typeof msg?.content === "string" ? msg.content.slice(0, 2000).trim() : "";
    if (!text) continue;
    const role = msg.role === "user" ? "user" : "model";
    if (!turns.length && role !== "user") continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.parts[0].text += `\n\n${text}`;
    else turns.push({ role, parts: [{ text }] });
  }
  // The new message is a user turn, so history has to end on the model
  if (turns.length && turns[turns.length - 1].role === "user") turns.pop();
  return turns;
};

const runTool = async (call) => {
  if (call.name === "get_crypto_price") {
    const { symbol, currency = "USDT" } = call.args || {};
    console.log(`[AI-CHAT ] 🛠️ Tool Call: get_crypto_price(${symbol}, ${currency})`);
    const price = await getCryptoPrice(symbol, currency);
    return { symbol, price, currency, error: price ? null : "Price not found." };
  }
  if (call.name === "get_crypto_news") {
    const limit = Math.min(10, Number(call.args?.limit) || 5);
    console.log(`[AI-CHAT ] 🛠️ Tool Call: get_crypto_news(limit: ${limit})`);
    try {
      const allNews = await newsService.fetchNews();
      const news = allNews.slice(0, limit).map((item) => ({
        title: item.title,
        source: item.source,
        url: item.url,
        body: `${String(item.body || "").substring(0, 150)}...`,
      }));
      return { news, count: news.length };
    } catch (newsError) {
      console.error("[AI-CHAT ] News Tool Error:", newsError.message);
      return { error: "Failed to fetch news." };
    }
  }
  return { error: `Unknown tool ${call.name}` };
};

const askModel = async (name, userMessage, history) => {
  const model = genAI.getGenerativeModel(
    { model: name, systemInstruction: SYSTEM_PROMPT, tools: TOOLS, generationConfig: { maxOutputTokens: 1500 } },
    { timeout: MODEL_TIMEOUT_MS },
  );
  // The conversation is built by hand instead of with startChat: the SDK's chat
  // sends tool results under a "function" role that current models reject
  const contents = [...history, { role: "user", parts: [{ text: userMessage }] }];
  let response = (await model.generateContent({ contents })).response;

  // The model may ask for a live price or the news before it answers
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const calls = response.functionCalls() || [];
    if (!calls.length) break;
    const results = await Promise.all(
      calls.map(async (call) => ({ functionResponse: { name: call.name, response: await runTool(call) } })),
    );
    // Echo the model's turn unchanged (newer models attach signatures they expect back)
    contents.push(response.candidates[0].content, { role: "user", parts: results });
    response = (await model.generateContent({ contents })).response;
  }

  const text = response.text().trim();
  if (!text) throw aiError("AI_FAILED", "The model returned an empty answer");
  return text;
};

const chatService = {
  /** Whether an API key is configured (the widget shows "offline" otherwise) */
  isConfigured() {
    return !!genAI;
  },

  /**
   * Generates a response from the AI model.
   * @param {string} userMessage - The current user message.
   * @param {Array<{role: string, content: string}>} history - Earlier turns (optional).
   * @returns {Promise<string>} - The AI response.
   */
  async generateResponse(userMessage, history = []) {
    if (!genAI) throw aiError("AI_NOT_CONFIGURED", "GEMINI_API_KEY is not set");

    const turns = toHistory(history);
    const now = Date.now();
    const ready = MODELS.filter((m) => (cooledUntil.get(m) || 0) <= now);
    // If every model is cooling down, try them all anyway rather than refuse
    const queue = ready.length ? ready : MODELS;

    let lastCode = "AI_FAILED";
    for (const name of queue) {
      try {
        const text = await askModel(name, userMessage, turns);
        cooledUntil.delete(name);
        return text;
      } catch (err) {
        const code = err.code || classify(err);
        console.error(`[AI-CHAT ] ${name} failed (${code}):`, String(err.message).slice(0, 200));
        if (code === "AI_BAD_KEY") throw aiError(code, err.message);
        lastCode = code;
        if (code === "AI_BUSY" || code === "AI_MODEL_GONE" || code === "AI_RATE_LIMITED") {
          cooledUntil.set(name, Date.now() + COOLDOWN_MS);
          continue;
        }
        throw aiError(code, err.message);
      }
    }
    throw aiError(lastCode === "AI_MODEL_GONE" ? "AI_BUSY" : lastCode, "Every configured model failed");
  },
};

module.exports = chatService;
module.exports._toHistory = toHistory;
