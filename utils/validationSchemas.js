const Joi = require("joi");

// Shared trading fields: finite, strictly positive and bounded, so negative or
// absurd amounts can never reach the balance math.
const coinId = Joi.string().trim().max(100).required();
const quantity = Joi.number().positive().max(1e12);
const price = Joi.number().positive().max(1e9);

// New passwords: at least 8 characters with a letter and a number
const newPassword = Joi.string()
  .min(8)
  .max(128)
  .pattern(/[A-Za-z]/)
  .pattern(/\d/)
  .messages({
    "string.min": "Password must be at least 8 characters",
    "string.pattern.base": "Password must contain at least one letter and one number",
  });

const schemas = {
  register: Joi.object({
    name: Joi.string().min(2).required(),
    email: Joi.string().email().required(),
    phone: Joi.string().required(),
    user_name: Joi.string().alphanum().min(3).max(30).required(),
    password: newPassword.required(),
    confirm_password: Joi.any().valid(Joi.ref('password')).required().messages({
        "any.only": "Passwords must match"
    }),
    // Accepted but ignored: the controller always creates role "user"
    role: Joi.any(),
  }),

  login: Joi.object({
    email: Joi.string().required(), // email or username
    password: Joi.string().required(),
    totp: Joi.string().pattern(/^\d{6}$/).allow("", null),
  }),

  forgotPassword: Joi.object({
    email: Joi.string().email().required(),
  }),

  resetPassword: Joi.object({
    password: newPassword.required(),
    confirmPassword: Joi.any().valid(Joi.ref('password')).required().messages({
      "any.only": "Passwords must match"
    }),
    token: Joi.string().required(),
    id: Joi.string().required(),
  }),

  resendOTP: Joi.object({
    email: Joi.string().email().required(),
  }),

  verifyEmail: Joi.object({
    email: Joi.string().email().required(),
    otp: Joi.string().length(6).required(),
  }),

  // Trading payloads allow unknown keys because the frontend sends extra display
  // fields (user_id, coin_symbol, total_cost...) that the server ignores.
  buy: Joi.object({
    coin_id: coinId,
    quantity: quantity.required(),
    image: Joi.string().max(500).allow("", null),
  }).unknown(true),

  sell: Joi.object({
    coin_id: coinId,
    quantity: quantity.required(),
  }).unknown(true),

  createOrder: Joi.object({
    coin_id: coinId,
    type: Joi.string().valid("buy", "sell").required(),
    category: Joi.string().valid("limit", "stop_limit", "stop_market").default("limit"),
    limit_price: price.when("category", {
      is: Joi.valid("limit", "stop_limit"),
      then: Joi.required(),
      otherwise: Joi.optional().allow(null),
    }),
    stop_price: price.when("category", {
      is: Joi.valid("stop_limit", "stop_market"),
      then: Joi.required(),
      otherwise: Joi.optional().allow(null),
    }),
    quantity: quantity.required(),
    coin_image: Joi.string().max(500).allow("", null),
  }).unknown(true),

  createOCO: Joi.object({
    coin_id: coinId,
    type: Joi.string().valid("buy", "sell").required(),
    quantity: quantity.required(),
    tp_limit_price: price.required(),
    sl_stop_price: price.required(),
    sl_limit_price: price.allow(null),
    coin_image: Joi.string().max(500).allow("", null),
  }).unknown(true),

  updateOrder: Joi.object({
    limit_price: price,
    stop_price: price,
    quantity,
  })
    .or("limit_price", "stop_price", "quantity")
    .unknown(true),

  createAlert: Joi.object({
    coin_id: coinId,
    target_price: price.required(),
    condition: Joi.string().valid("above", "below").required(),
    coin_image: Joi.string().max(500).allow("", null),
  }).unknown(true),

  kycSubmit: Joi.object({
    fullName: Joi.string().trim().min(2).max(100).required(),
    dob: Joi.date().max("now").required(),
    address: Joi.string().trim().max(300).required(),
    idType: Joi.string().trim().max(50).required(),
    idNumber: Joi.string().trim().max(50).required(),
    documentImage: Joi.string().max(500).allow("", null),
  }).unknown(true),

  kycVerify: Joi.object({
    user_id: Joi.string().required(),
    status: Joi.string().valid("verified", "rejected").required(),
    rejectionReason: Joi.string().max(500).allow("", null),
  }),

  updateUser: Joi.object({
    name: Joi.string().trim().min(2).max(100),
    email: Joi.string().trim().lowercase().email(),
    phone: Joi.string().trim().max(30).allow(""),
    user_name: Joi.string().trim().lowercase().alphanum().min(3).max(30),
    currentPassword: Joi.string().allow(""),
    newPassword: newPassword.allow(""),
    confirmPassword: Joi.string().allow(""),
    confirm_password: Joi.string().allow(""),
    role: Joi.string().valid("user", "admin", "superadmin"),
    isFrozen: Joi.boolean(),
    isDeleted: Joi.boolean(),
  }).unknown(true),
};

module.exports = schemas;
