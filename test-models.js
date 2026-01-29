require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function listModels() {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // For listing models, we don't need to pick one yet, but the SDK doesn't always expose a direct list method easily on the instance.
    // Actually, newer SDKs might not have a clean listModels helper on the main class without using the raw API.
    // Let's try to just run a simple prompt on a few common models to see which one works.
    
    const candidates = [
      "gemini-1.5-flash",
      "gemini-1.5-flash-latest",
      "gemini-1.0-pro",
      "gemini-pro"
    ];
    
    console.log("Testing common models for availability...");

    for (const modelName of candidates) {
      process.stdout.write(`Testing ${modelName}... `);
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Test");
        const response = await result.response;
        console.log(`✅ WORKS!`);
      } catch (err) {
        console.log(`❌ FAILED: ${err.message.split(' ').slice(0, 10).join(' ')}...`);
      }
    }

  } catch (error) {
    console.error("Script Error:", error);
  }
}

listModels();
