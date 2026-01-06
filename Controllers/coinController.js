const FrozenCoin = require("../models/frozenCoinModel");

// @desc    Get all frozen coins
// @route   GET /api/coins/frozen
// @access  Public
exports.getFrozenCoins = async (req, res) => {
  try {
    const frozenCoins = await FrozenCoin.find({}).select("coinId -_id");
    // Return array of IDs for easy filtering
    const ids = frozenCoins.map(c => c.coinId);
    
    res.status(200).json({
      success: true,
      count: ids.length,
      frozenIds: ids,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Freeze a coin
// @route   POST /api/coins/freeze
// @access  Admin
exports.freezeCoin = async (req, res) => {
  const { coinId, symbol, name } = req.body;

  if (!coinId || !symbol) {
    return res.status(400).json({ success: false, message: "Coin ID and Symbol are required" });
  }

  try {
    const exists = await FrozenCoin.findOne({ coinId });
    if (exists) {
      return res.status(400).json({ success: false, message: "Coin is already frozen" });
    }

    const frozenCoin = await FrozenCoin.create({
      coinId,
      symbol,
      name: name || symbol,
      frozenBy: req.user._id
    });

    res.status(201).json({
      success: true,
      data: frozenCoin,
      message: `${name || coinId} has been frozen successfully`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Unfreeze a coin
// @route   POST /api/coins/unfreeze
// @access  Admin
exports.unfreezeCoin = async (req, res) => {
  const { coinId } = req.body;

  try {
    const result = await FrozenCoin.findOneAndDelete({ coinId });
    
    if (!result) {
      return res.status(404).json({ success: false, message: "Coin not found in frozen list" });
    }

    res.status(200).json({
      success: true,
      message: "Coin has been unfrozen successfully"
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
