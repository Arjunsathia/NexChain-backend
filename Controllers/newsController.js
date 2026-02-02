const newsService = require("../services/newsService");

const getLiveNews = async (req, res) => {
  try {
    const news = await newsService.fetchNews();
    return res.status(200).json(news);
  } catch (error) {
    console.error("Error fetching news:", error.message);
    res.status(500).json({ error: error.message || "Internal Server Error fetching news" });
  }
};

module.exports = {
  getLiveNews,
};
