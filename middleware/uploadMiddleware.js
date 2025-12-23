const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");
const path = require("path");

// Fallback to disk storage if Cloudinary credentials are missing
const isCloudinaryConfigured = process.env.CLOUDINARY_CLOUD_NAME && 
                               process.env.CLOUDINARY_API_KEY && 
                               process.env.CLOUDINARY_API_SECRET;

let storage;

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: "nexchain_avatars",
      allowed_formats: ["jpg", "png", "jpeg", "webp"],
      transformation: [{ width: 500, height: 500, crop: "limit" }],
    },
  });
} else {
  // Local Disk Storage Definition
  storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, "uploads/"); 
    },
    filename: function (req, file, cb) {
      cb(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
    },
  });
}

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5000000 }, 
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Error: Images Only!"));
    }
  }
});

module.exports = upload;
