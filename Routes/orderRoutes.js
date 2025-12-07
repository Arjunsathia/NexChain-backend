const express = require("express");
const router = express.Router();
const { createOrder, getOpenOrders, cancelOrder, executeOrder } = require("../Controllers/orderController");
const { protect } = require("../middleware/authMiddleware");

router.post("/create", protect, createOrder);
router.post("/execute", protect, executeOrder);
router.get("/:user_id", protect, getOpenOrders);
router.put("/cancel/:orderId", protect, cancelOrder);

module.exports = router;
