const axios = require("axios").default;

let cachedNews = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const fetchNews = async () => {
  try {
    const currentTime = Date.now();

    if (cachedNews && currentTime - lastFetchTime < CACHE_DURATION) {
      return cachedNews;
    }

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    };

    if (process.env.CRYPTO_COMPARE_API_KEY) {
      headers["Authorization"] = `Apikey ${process.env.CRYPTO_COMPARE_API_KEY}`;
    }

    const response = await axios.get(
      "https://min-api.cryptocompare.com/data/v2/news/?lang=EN",
      { headers, timeout: 5000 }
    );

    if (response.data && response.data.Response === "Error") {
      throw new Error(response.data.Message || "CryptoCompare API Error");
    }

    if (response.data && Array.isArray(response.data.Data)) {
      cachedNews = response.data.Data;
      lastFetchTime = currentTime;
      return cachedNews;
    } else {
      if (cachedNews) return cachedNews;
      throw new Error("Invalid data structure from news provider");
    }
  } catch (error) {
    console.error("[NewsService] Error:", error.message);
    if (cachedNews) return cachedNews;
    throw error;
  }
};

module.exports = { fetchNews };
