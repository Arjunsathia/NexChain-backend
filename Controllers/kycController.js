const User = require("../Models/userModel");
const AuditLog = require("../Models/AuditLog");
const Notification = require("../Models/Notification");
const privateStorage = require("../services/privateStorage");

const auditKycDecision = async (req, target, status) => {
  try {
    const admin = await User.findOne({ id: req.user.id }).select("_id");
    if (!admin) return;
    await AuditLog.create({
      adminId: admin._id,
      action: status === "verified" ? "KYC_VERIFY" : "KYC_REJECT",
      targetId: target._id,
      details: { reason: req.body.rejectionReason || undefined },
      ipAddress: req.ip,
    });
  } catch (err) {
    console.error("Audit Log Error", err);
  }
};

// Submit KYC (multipart: fields + `document` file)
exports.submitKYC = async (req, res) => {
  const { fullName, dob, address, idType, idNumber } = req.body;

  try {
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.kycStatus === "verified") {
      return res.status(400).json({ error: "KYC already verified" });
    }
    if (user.kycStatus === "pending") {
      return res.status(400).json({ error: "Your KYC submission is already under review" });
    }

    const documentRef = await privateStorage.save(req.file.buffer, {
      ext: req.file.detected.ext,
      folder: "kyc",
    });
    const previousDocument = user.kycData?.documentImage;

    user.kycData = { fullName, dob, address, idType, idNumber, documentImage: documentRef };
    user.kycStatus = "pending";
    await user.save();

    // A resubmission replaces the old document
    if (previousDocument && previousDocument !== documentRef) {
      await privateStorage.remove(previousDocument);
    }

    res.json({ success: true, message: "KYC submitted successfully", kycStatus: user.kycStatus });
  } catch (error) {
    console.error("KYC Submit Error:", error);
    res.status(500).json({ error: "Failed to submit KYC" });
  }
};

// Get KYC Status (own, or any user's for admins); id number is masked by toJSON
exports.getKYCStatus = async (req, res) => {
  try {
    const user = await User.findOne({ id: req.params.user_id }).select("kycStatus kycData");
    if (!user) return res.status(404).json({ error: "User not found" });

    const { kycData, kycStatus } = user.toJSON();
    res.json({ success: true, kycStatus, kycData });
  } catch (error) {
    console.error("KYC Status Fetch Error:", error);
    res.status(500).json({ error: "Failed to fetch KYC status" });
  }
};

// Admin: full submission for review (unmasked id number)
exports.getKYCReview = async (req, res) => {
  try {
    const user = await User.findOne({ id: req.params.userId }).select("id name email kycStatus kycData");
    if (!user) return res.status(404).json({ error: "User not found" });

    const kyc = user.kycData || {};
    res.json({
      success: true,
      kycStatus: user.kycStatus,
      kycData: {
        fullName: kyc.fullName,
        dob: kyc.dob,
        address: kyc.address,
        idType: kyc.idType,
        idNumber: kyc.idNumber,
        rejectionReason: kyc.rejectionReason,
        hasDocument: privateStorage.isStoredFile(kyc.documentImage),
      },
    });
  } catch (error) {
    console.error("KYC Review Error:", error);
    res.status(500).json({ error: "Failed to load KYC submission" });
  }
};

// Admin: the uploaded document itself
exports.getKYCDocument = async (req, res) => {
  try {
    const user = await User.findOne({ id: req.params.userId }).select("kycData");
    if (!user) return res.status(404).json({ error: "User not found" });
    await privateStorage.sendFile(user.kycData?.documentImage, res);
  } catch (error) {
    console.error("KYC Document Error:", error);
    res.status(500).json({ error: "Failed to load document" });
  }
};

// Admin: approve or reject a pending submission
exports.verifyKYC = async (req, res) => {
  const { user_id, status, rejectionReason } = req.body; // status: 'verified' or 'rejected'

  try {
    const user = await User.findOne({ id: user_id });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.kycStatus !== "pending") {
      return res.status(400).json({ error: "No pending KYC submission for this user" });
    }

    user.kycStatus = status;
    user.set(
      "kycData.rejectionReason",
      status === "rejected" ? rejectionReason || "Not specified" : undefined,
    );
    await user.save();

    await auditKycDecision(req, user, status);
    await Notification.create({
      user: user._id,
      title: status === "verified" ? "Identity Verified" : "Identity Verification Rejected",
      message:
        status === "verified"
          ? "Your KYC verification was approved."
          : `Your KYC verification was rejected: ${user.kycData.rejectionReason}. You can submit again.`,
      type: status === "verified" ? "success" : "warning",
    });

    res.json({ success: true, message: `KYC ${status}`, kycStatus: user.kycStatus });
  } catch (error) {
    console.error("KYC Verify Error:", error);
    res.status(500).json({ error: "Failed to update KYC status" });
  }
};
