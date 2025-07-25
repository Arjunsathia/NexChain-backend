const WatchList = require("../Models/watchlistModal");

exports.addToWatchList = async (req, res) => {
  try {
    const { user_id, id } = req.body;

    // Check if this user has already saved this coin
    const exists = await WatchList.findOne({ user_id, id });

    if (exists) {
      return res
        .status(400)
        .json({ message: "Coin already in watchlist for this user" });
    }

    // Create and save the new watchlist item
    const saved = await WatchList.create(req.body);
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getWatchList = async (req, res) => {
  try {
    const { id, user_id } = req.query; // ?id=bitcoin&user_id=UUID

    const filter = {};

    // ✅ Use user_id field in filter as per your schema
    if (user_id) {
      filter.user_id = user_id;
    } else if (req.user && req.user.uuid) {
      filter.user_id = req.user.uuid;
    }

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
    const { user_id, id } = req.query;

    if (!user_id || !id) {
      return res
        .status(400)
        .json({ message: "user_id and coin id are required" });
    }

    const deleted = await WatchList.findOneAndDelete({ user_id, id });

    if (!deleted) {
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
