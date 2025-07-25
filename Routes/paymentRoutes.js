const express = require("express");
const { createCheckoutSession } = require("../Controllers/paymentController");
const router = express.Router();

router.post("/create-checkout-session", createCheckoutSession);

module.exports = router;
