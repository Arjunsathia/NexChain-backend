// @ts-ignore
const axios = require("axios").default;

let cachedNews = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const getLiveNews = async (req, res) => {
  try {
    const currentTime = Date.now();

    // Check if cache is valid
    if (cachedNews && currentTime - lastFetchTime < CACHE_DURATION) {
      return res.status(200).json(cachedNews);
    }

    const headers = {
      // Add User-Agent to prevent 403 blocking by some APIs
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    };

    // Add API key if available (Critical for production)
    if (process.env.CRYPTO_COMPARE_API_KEY) {
      headers["Authorization"] = `Apikey ${process.env.CRYPTO_COMPARE_API_KEY}`;
    }

    const response = await axios.get(
      "https://min-api.cryptocompare.com/data/v2/news/?lang=EN",
      { headers }
    );

    console.log("CryptoCompare Response Status:", response.status);

    // Check for API-level error response
    if (response.data && response.data.Response === "Error") {
      console.error("CryptoCompare API Error:", response.data.Message);
      throw new Error(response.data.Message || "CryptoCompare API Error");
    }

    // Strictly validate that Data is an array
    if (response.data && Array.isArray(response.data.Data)) {
      cachedNews = response.data.Data;
      lastFetchTime = currentTime;
      return res.status(200).json(cachedNews);
    } else {
      console.error(
        "Invalid data structure from CryptoCompare:",
        JSON.stringify(response.data).slice(0, 200)
      );
      
      // If API returns valid JSON but weird structure, do NOT update cache with it.
      // If we have old cache, return it.
      if (cachedNews) {
        return res.status(200).json(cachedNews);
      }
      return res.status(500).json({ error: "Invalid data received from news provider" });
    }
  } catch (error) {
    console.error("Error fetching news:", error.message);
    if (cachedNews) {
      return res.status(200).json(cachedNews);
    }
    res.status(500).json({ error: "Internal Server Error fetching news" });
  }
};

module.exports = {
  getLiveNews,
};
