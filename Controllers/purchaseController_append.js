
// NEW: Get detailed list of today's transactions
exports.getTodayTransactions = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const transactions = await Transaction.aggregate([
      { 
        $match: { 
          transactionDate: { $gte: today } 
        } 
      },
      {
        $lookup: {
          from: "users",
          localField: "user_id",
          foreignField: "id",
          as: "userDetails"
        }
      },
      { 
        $unwind: { 
          path: "$userDetails", 
          preserveNullAndEmptyArrays: true 
        } 
      },
      { 
        $sort: { transactionDate: -1 } 
      },
      {
        $project: {
          _id: 1,
          transactionDate: 1,
          type: 1,
          coinName: 1,
          coinSymbol: 1,
          quantity: 1,
          price: 1,
          totalValue: 1,
          image: 1,
          user_id: 1,
          userName: { $ifNull: ["$userDetails.name", "Unknown User"] },
          userEmail: { $ifNull: ["$userDetails.email", "No Email"] },
          userRole: { $ifNull: ["$userDetails.role", "user"] }
        }
      }
    ]);

    res.json({
      success: true,
      data: transactions
    });
  } catch (error) {
    console.error("Error fetching today's transactions:", error);
    res.status(500).json({
      success: false,
      error: "Unable to fetch transactions"
    });
  }
};
