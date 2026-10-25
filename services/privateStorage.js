const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;

// Storage for sensitive files (KYC documents). Never served statically:
// - production: Cloudinary "authenticated" assets, readable only via signed URLs
// - local dev:  private_uploads/ (outside the public /uploads folder)
// References are stored as "cloudinary:<public_id>.<format>" or "local:<file>".
const LOCAL_DIR = path.join(__dirname, "..", "private_uploads");

const useCloudinary = () =>
  !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );

// Identify a file by its bytes, not its (client-controlled) name or MIME type
const SIGNATURES = [
  { ext: "jpg", mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "png", mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "webp", mime: "image/webp", test: (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
  { ext: "pdf", mime: "application/pdf", test: (b) => b.toString("ascii", 0, 5) === "%PDF-" },
];

/** @returns {{ ext: string, mime: string } | null} */
const detectFileType = (buffer) => {
  if (!buffer || buffer.length < 12) return null;
  const match = SIGNATURES.find((sig) => sig.test(buffer));
  return match ? { ext: match.ext, mime: match.mime } : null;
};

const MIME_BY_EXT = Object.fromEntries(SIGNATURES.map((s) => [s.ext, s.mime]));

/** @returns {Promise<string>} storage reference */
const save = async (buffer, { ext, folder }) => {
  if (useCloudinary()) {
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { type: "authenticated", folder: `nexchain_${folder}`, resource_type: "image" },
          (err, res) => (err ? reject(err) : resolve(res)),
        )
        .end(buffer);
    });
    return `cloudinary:${result.public_id}.${result.format}`;
  }

  const name = `${crypto.randomUUID()}.${ext}`;
  await fs.mkdir(path.join(LOCAL_DIR, folder), { recursive: true });
  await fs.writeFile(path.join(LOCAL_DIR, folder, name), buffer);
  return `local:${folder}/${name}`;
};

const parseRef = (ref) => {
  if (typeof ref !== "string") return null;
  if (ref.startsWith("local:")) {
    const rel = ref.slice("local:".length);
    if (!/^[a-z_]+\/[0-9a-f-]+\.(jpg|png|webp|pdf)$/.test(rel)) return null;
    return { kind: "local", file: path.join(LOCAL_DIR, rel), ext: path.extname(rel).slice(1) };
  }
  if (ref.startsWith("cloudinary:")) {
    const rest = ref.slice("cloudinary:".length);
    const dot = rest.lastIndexOf(".");
    return { kind: "cloudinary", publicId: rest.slice(0, dot), ext: rest.slice(dot + 1) };
  }
  return null; // e.g. old "mock_image_url" values
};

const isStoredFile = (ref) => !!parseRef(ref);

/** Sends the file to an (already authorized) admin: streams it or redirects to a short-lived signed URL */
const sendFile = async (ref, res) => {
  const parsed = parseRef(ref);
  if (!parsed) return res.status(404).json({ error: "No document on file" });

  if (parsed.kind === "cloudinary") {
    const url = cloudinary.utils.private_download_url(parsed.publicId, parsed.ext, {
      type: "authenticated",
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });
    return res.redirect(url);
  }

  try {
    const data = await fs.readFile(parsed.file);
    res.set("Content-Type", MIME_BY_EXT[parsed.ext] || "application/octet-stream");
    res.set("Cache-Control", "no-store");
    res.set("Content-Disposition", "inline");
    res.send(data);
  } catch {
    res.status(404).json({ error: "No document on file" });
  }
};

const remove = async (ref) => {
  const parsed = parseRef(ref);
  if (!parsed) return;
  try {
    if (parsed.kind === "cloudinary") {
      await cloudinary.uploader.destroy(parsed.publicId, { type: "authenticated" });
    } else {
      await fs.unlink(parsed.file);
    }
  } catch {
    // already gone
  }
};

module.exports = { detectFileType, save, sendFile, remove, isStoredFile, MIME_BY_EXT };
