require("dotenv").config();
const axios = require("axios");

async function listModelsRaw() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("No API KEY found");
    return;
  }

  console.log(`Checking models for key: ${key.substring(0, 5)}...`);
  
  // Try v1beta
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
  
  try {
    const response = await axios.get(url);
    console.log("\n--- Available Models (v1beta) ---");
    const models = response.data.models;
    if (models) {
        const valid = models
            .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
            .map(m => m.name.replace("models/", ""));
            
        const fs = require("fs");
        fs.writeFileSync("models.txt", valid.join("\n"));
        console.log("Written to models.txt");
    } else {
        console.log("No models found in response.");
    }
  } catch (error) {
    console.error("\n❌ Failed to list models:", error.response ? error.response.data : error.message);
  }
}

listModelsRaw();
