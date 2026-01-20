const express = require("express");
const router = express.Router(); // Mistake here, should be express.Router() or just const router = require("express").Router();
const { getLiveNews } = require("../Controllers/newsController");

router.get("/", getLiveNews);

module.exports = router;
