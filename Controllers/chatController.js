const chatService = require("../services/chatService");

const chatController = {
  async chat(req, res) {
    try {
      const { message, history } = req.body;

      if (!message) {
        return res.status(400).json({ success: false, message: "Message is required" });
      }

      // Basic input validation
      if (message.length > 500) {
        return res.status(400).json({ success: false, message: "Message too long (max 500 chars)" });
      }

      const response = await chatService.generateResponse(message, history || []);

      // Safety: Auto-append disclaimer if trading keywords are detected
      const tradingKeywords = ["buy", "sell", "price", "trade", "profit", "loss", "invest"];
      const containsTradingContext = tradingKeywords.some(keyword => 
        message.toLowerCase().includes(keyword) || response.toLowerCase().includes(keyword)
      );

      let finalResponse = response;
      let disclaimer = null;

      if (containsTradingContext) {
        disclaimer = "Note: This information is for educational purposes only and does not constitute financial advice.";
      }

      // ✅ Send Success Response
      return res.status(200).json({
        success: true,
        response: finalResponse,
        disclaimer: disclaimer
      });

    } catch (error) {
      console.error("❌ Chat Controller Error:", error.message);
      
      // Check for Rate Limit (429) or Overloaded (503)
      if (error.message.includes("429") || error.message.includes("Quota") || error.message.includes("Resource has been exhausted")) {
        return res.status(429).json({ 
          success: false, 
          message: "I'm thinking too fast! Please wait a moment before asking again. (Rate Limit Reached)"
        });
      }
      
      if (error.message.includes("503")) {
         return res.status(503).json({ 
          success: false, 
          message: "My brain is a bit overloaded right now. Please try again in a few seconds."
        });
      }

      res.status(500).json({ 
        success: false, 
        message: "AI service Error: " + error.message
      });
    }
  }
};

module.exports = chatController;
