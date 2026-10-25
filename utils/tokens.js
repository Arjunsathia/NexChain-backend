const jwt = require("jsonwebtoken");

const ACCESS_TTL = "15m";
const REFRESH_TTL = "30d";
const ACCESS_MAX_AGE = 15 * 60 * 1000;
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

// Cross-site in production (Vercel frontend, Render API), so SameSite=None + Secure
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
});

// `typ` keeps the two token kinds from being used in place of each other, and
// `tv` (tokenVersion) lets the server revoke every outstanding token for a user.
const signAccessToken = (user) =>
  jwt.sign(
    { id: user.id, role: user.role, tv: user.tokenVersion || 0, typ: "access" },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TTL },
  );

const signRefreshToken = (user) =>
  jwt.sign({ id: user.id, tv: user.tokenVersion || 0, typ: "refresh" }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TTL,
  });

/** @returns {{ id: string, role: string, tv: number } | null} */
const verifyAccessToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded && decoded.typ === "access" && decoded.id ? decoded : null;
  } catch {
    return null;
  }
};

/** @returns {{ id: string, tv: number } | null} */
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    return decoded && decoded.typ === "refresh" && decoded.id ? decoded : null;
  } catch {
    return null;
  }
};

/** Sets both auth cookies and returns the access token for the response body */
const issueTokens = (res, user) => {
  const accessToken = signAccessToken(user);
  res.cookie("refreshToken", signRefreshToken(user), { ...cookieOptions(), maxAge: REFRESH_MAX_AGE });
  res.cookie("token", accessToken, { ...cookieOptions(), maxAge: ACCESS_MAX_AGE });
  return accessToken;
};

const clearAuthCookies = (res) => {
  res.clearCookie("token", cookieOptions());
  res.clearCookie("refreshToken", cookieOptions());
};

/** The fields the frontend keeps about the logged-in user */
const sessionUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  user_name: user.user_name,
  image: user.image,
  phone: user.phone,
  twoFactorEnabled: !!user.twoFactorEnabled,
  createdAt: user.createdAt,
});

module.exports = {
  signAccessToken,
  verifyAccessToken,
  verifyRefreshToken,
  issueTokens,
  clearAuthCookies,
  sessionUser,
};
