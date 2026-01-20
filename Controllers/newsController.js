const axios = require("axios");

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

    // Fetch from CryptoCompare API (Free, Public)
    const response = await axios.get(
      "https://min-api.cryptocompare.com/data/v2/news/?lang=EN"
    );

    if (response.data && response.data.Data) {
      cachedNews = response.data.Data;
      lastFetchTime = currentTime;
      return res.status(200).json(cachedNews);
    } else {
      // If API fails but we have old cache, return it even if expired to show something
      if (cachedNews) {
        return res.status(200).json(cachedNews);
      }
      return res.status(500).json({ error: "Failed to fetch news data" });
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
