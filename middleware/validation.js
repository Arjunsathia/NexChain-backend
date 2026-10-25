

const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, { abortEarly: false });

  if (error) {
    const errorMessages = error.details.map((detail) => detail.message);
    return res.status(400).json({
      success: false,
      message: errorMessages[0], // shown directly by the UI's error toasts
      error: errorMessages[0],
      errors: errorMessages,
    });
  }
  // Use the converted values so numeric strings like "0.1" arrive as numbers
  req.body = value;
  next();
};

module.exports = validate;
