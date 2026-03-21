const fs = require("fs");

const openai = require("../config/openai");
const { createHttpError } = require("../utils/httpError");

async function transcribeAudio(filePath) {
  try {
    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "gpt-4o-mini-transcribe"
    });

    return transcript.text ? transcript.text.trim() : "";
  } catch (error) {
    throw createHttpError(
      502,
      `OpenAI transcription failed: ${error.message || "Unknown transcription error."}`
    );
  }
}

module.exports = {
  transcribeAudio
};
