const chatService = require("../services/chatService");

const MAX_MESSAGE = 500;
const TRADING_KEYWORDS = ["buy", "sell", "price", "trade", "profit", "loss", "invest"];

// What the user sees for each failure; details stay in the server log
const FAILURES = {
  AI_NOT_CONFIGURED: [503, "The assistant isn't set up on this server yet."],
  AI_BAD_KEY: [503, "The assistant can't reach its AI provider right now. An admin has been told in the server logs."],
  AI_BUSY: [503, "The AI service is very busy right now. Please try again in a minute."],
  AI_RATE_LIMITED: [429, "You're asking a little too fast. Please wait a moment and try again."],
  AI_FAILED: [502, "Something went wrong while answering. Please try again."],
};

const chatController = {
  /** Whether the assistant can answer, so the widget can show an offline state */
  status(req, res) {
    res.json({ success: true, available: chatService.isConfigured() });
  },

  async chat(req, res) {
    const { message, history } = req.body || {};
    const text = typeof message === "string" ? message.trim() : "";

    if (!text) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }
    if (text.length > MAX_MESSAGE) {
      return res.status(400).json({ success: false, message: `Please keep questions under ${MAX_MESSAGE} characters.` });
    }

    try {
      const response = await chatService.generateResponse(text, history);

      // Safety: add a disclaimer whenever trading comes up
      const lower = `${text} ${response}`.toLowerCase();
      const disclaimer = TRADING_KEYWORDS.some((k) => lower.includes(k))
        ? "Note: This information is for educational purposes only and does not constitute financial advice."
        : null;

      return res.status(200).json({ success: true, response, disclaimer });
    } catch (error) {
      const code = FAILURES[error.code] ? error.code : "AI_FAILED";
      const [status, friendly] = FAILURES[code];
      console.error(`❌ Chat Controller Error (${code}):`, error.message);
      return res.status(status).json({ success: false, code, message: friendly });
    }
  },
};

module.exports = chatController;
