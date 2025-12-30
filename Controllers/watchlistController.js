const WatchList = require("../Models/watchlistModel");

exports.addToWatchList = async (req, res) => {
  try {
    let { user_id } = req.body;
    const { id } = req.body;

    if (!user_id && req.user) {
      user_id = req.user.id;
    }

    if (!user_id || !id) {
       return res.status(400).json({ message: "User ID and Coin ID are required" });
    }

    // Check if this user has already saved this coin
    const exists = await WatchList.findOne({ user_id, id });

    if (exists) {
      return res
        .status(400)
        .json({ message: "Coin already in watchlist for this user" });
    }

    // Create and save the new watchlist item
    const saved = await WatchList.create({ ...req.body, user_id });
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getWatchList = async (req, res) => {
  try {
    const { id } = req.query; 
    let { user_id } = req.query;

    if (!user_id && req.user) {
        user_id = req.user.id;
    }

    if (!user_id) {
        return res.status(400).json({ message: "User ID required" });
    }

    const filter = { user_id };

    if (id) {
      filter.id = id;
    }

    const list = await WatchList.find(filter);
    res.status(200).json(list);
  } catch (err) {
    console.error("Error fetching watchlist:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.removeFromWatchList = async (req, res) => {
  try {
    let { user_id, id } = req.query;

    if (!user_id && req.user) {
        user_id = req.user.id;
    }

    if (!user_id || !id) {
      return res
        .status(400)
        .json({ message: "user_id and coin id are required" });
    }

    const deleted = await WatchList.findOneAndDelete({ user_id, id });

    if (!deleted) {
      // Idempotency: success even if not found, distinct message or just success?
      // Frontend expects success or handles error. Returning 404 effectively tells FE it wasn't there.
      return res
        .status(404)
        .json({ message: "Coin not found in watchlist for this user" });
    }

    res
      .status(200)
      .json({ message: "Coin removed from watchlist", data: deleted });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getTrendingCoin = async (req, res) => {
  try {
    const trending = await WatchList.aggregate([
      {
        $group: {
          _id: "$id",
          count: { $sum: 1 },
          symbol: { $first: "$symbol" },
          price_change_percentage_24h: { $first: "$price_change_percentage_24h" }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]);

    if (trending.length > 0) {
      res.status(200).json(trending[0]);
    } else {
      res.status(200).json(null);
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
