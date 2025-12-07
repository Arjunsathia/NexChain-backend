const User = require("../Models/userModel");

// Submit KYC
exports.submitKYC = async (req, res) => {
  const { user_id, fullName, dob, address, idType, idNumber, documentImage } = req.body;

  try {
    const user = await User.findOne({ id: user_id });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.kycStatus === 'verified') {
        return res.status(400).json({ error: "KYC already verified" });
    }

    user.kycData = {
        fullName,
        dob,
        address,
        idType,
        idNumber,
        documentImage
    };
    user.kycStatus = 'pending';
    await user.save();

    res.json({ success: true, message: "KYC submitted successfully", user });

  } catch (error) {
    console.error("KYC Submit Error:", error);
    res.status(500).json({ error: "Failed to submit KYC" });
  }
};

// Get KYC Status
exports.getKYCStatus = async (req, res) => {
    try {
        const { user_id } = req.params;
        const user = await User.findOne({ id: user_id }).select('kycStatus kycData rejectionReason');
        if (!user) return res.status(404).json({ error: "User not found" });

        res.json({ success: true, kycStatus: user.kycStatus, kycData: user.kycData });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch KYC status" });
    }
};

// Admin: Verify KYC
exports.verifyKYC = async (req, res) => {
    const { user_id, status, rejectionReason } = req.body; // status: 'verified' or 'rejected'

    try {
        const user = await User.findOne({ id: user_id });
        if (!user) return res.status(404).json({ error: "User not found" });

        user.kycStatus = status;
        if (status === 'rejected') {
            user.kycData.rejectionReason = rejectionReason;
        }
        await user.save();

        res.json({ success: true, message: `KYC ${status}`, user });
    } catch (error) {
        res.status(500).json({ error: "Failed to update KYC status" });
    }
};
