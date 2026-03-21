const fs = require("fs/promises");

const { parseEmotions } = require("../utils/parseEmotions");
const { createHttpError } = require("../utils/httpError");
const { transcribeAudio } = require("../services/speechService");
const { generateEmotionResponses } = require("../services/aiService");
const { saveAnalysisResult } = require("../services/outputService");

async function analyzeAudio(req, res, next) {
  const uploadedFilePath = req.file?.path;

  try {
    if (!req.file) {
      throw createHttpError(400, "Audio file is required.");
    }

    const emotions = parseEmotions(req.body.emotions);
    const transcript = await transcribeAudio(req.file.path);

    if (!transcript) {
      throw createHttpError(422, "The audio was transcribed, but no text was returned.");
    }

    const responses = await generateEmotionResponses(emotions, transcript);
    const result = {
      transcript,
      responses
    };

    const output = await saveAnalysisResult(result);

    res.status(200).json({
      ...result,
      output
    });
  } catch (error) {
    next(error);
  } finally {
    if (uploadedFilePath) {
      await fs.unlink(uploadedFilePath).catch(() => {});
    }
  }
}

module.exports = {
  analyzeAudio
};
