require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function testConnection() {
  console.log("1. Checking Environment Variables...");
  const key = process.env.GEMINI_API_KEY;
  
  if (!key) {
    console.error("❌ ERROR: GEMINI_API_KEY is not found in process.env");
    console.log("   Make sure .env file exists and has GEMINI_API_KEY=...");
    return;
  }
  
  console.log(`✅ key found: ${key.substring(0, 5)}...${key.substring(key.length - 4)}`);

  console.log("2. Testing Gemini API Connection...");
  
  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const result = await model.generateContent("Hello, are you online?");
    const response = await result.response;
    const text = response.text();
    
    console.log("✅ Success! API responded:");
    console.log("   Response:", text);
    
  } catch (error) {
    console.error("❌ API Connection Failed:");
    console.error(error.message);
  }
}

testConnection();
