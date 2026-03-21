const express = require("express");

const upload = require("../middleware/uploadMiddleware");
const { analyzeAudio } = require("../controllers/analyzeAudioController");

const router = express.Router();

router.post("/analyze-audio", upload.single("file"), analyzeAudio);

module.exports = router;
