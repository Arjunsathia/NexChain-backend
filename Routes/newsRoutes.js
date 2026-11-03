const express = require("express");
const router = express.Router();
const { getLiveNews } = require("../Controllers/newsController");

router.get("/", getLiveNews);

module.exports = router;
