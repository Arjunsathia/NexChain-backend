const Joi = require("joi");

const schemas = {
  register: Joi.object({
    name: Joi.string().min(2).required(),
    email: Joi.string().email().required(),
    phone: Joi.string().required(),
    user_name: Joi.string().alphanum().min(3).required(),
    password: Joi.string().min(6).required(),
    confirm_password: Joi.any().valid(Joi.ref('password')).required().messages({
        "any.only": "Passwords must match"
    }),
    // role: Joi.string().valid("user", "admin").optional(), // REMOVED FOR SECURITY
  }),

  login: Joi.object({
    email: Joi.string().required(), // Can be email or username in controller logic, but ensuring string
    password: Joi.string().required(),
  }),

  forgotPassword: Joi.object({
    email: Joi.string().email().required(),
  }),

  resetPassword: Joi.object({
    password: Joi.string().min(6).required(),
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
};

module.exports = schemas;
