const express = require("express");
const router = express.Router();
const {
  createOrder,
  createOCOOrder,
  getOpenOrders,
  cancelOrder,
  updateOrder,
  executeOrder,
} = require("../Controllers/orderController");
const { protect, selfOrAdmin } = require("../middleware/authMiddleware");
const validate = require("../middleware/validation");
const schemas = require("../utils/validationSchemas");

router.post("/create", protect, validate(schemas.createOrder), createOrder);
router.post("/create-oco", protect, validate(schemas.createOCO), createOCOOrder);
router.post("/execute", protect, executeOrder);
router.get("/:user_id", protect, selfOrAdmin(), getOpenOrders);
router.put("/cancel/:orderId", protect, cancelOrder);
router.put("/update/:orderId", protect, validate(schemas.updateOrder), updateOrder);

module.exports = router;
