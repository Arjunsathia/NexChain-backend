const multer = require("multer");
const { detectFileType } = require("../services/privateStorage");

// Files kept in memory so they can be checked by content before anything is
// stored (KYC documents) or so they're never stored at all (support attachments).
const MAX_BYTES = 5 * 1024 * 1024;

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

/**
 * Accepts at most one file in `field`; rejects anything that isn't really a
 * JPEG, PNG, WebP or PDF. Sets req.file.detected = { ext, mime }.
 */
const singleDocument = (field, { required = false } = {}) => [
  (req, res, next) =>
    memoryUpload.single(field)(req, res, (err) => {
      if (!err) return next();
      const message =
        err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 5 MB)" : "Invalid file upload";
      res.status(400).json({ success: false, message, error: message });
    }),
  (req, res, next) => {
    if (!req.file) {
      if (!required) return next();
      return res.status(400).json({ success: false, message: "A document file is required", error: "A document file is required" });
    }
    const detected = detectFileType(req.file.buffer);
    if (!detected) {
      return res.status(400).json({ success: false, message: "Only JPG, PNG, WebP or PDF files are allowed", error: "Only JPG, PNG, WebP or PDF files are allowed" });
    }
    req.file.detected = detected;
    next();
  },
];

module.exports = { singleDocument };
