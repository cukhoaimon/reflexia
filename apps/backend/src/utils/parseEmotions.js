const { EMOTION_PROMPTS } = require("../config/emotions");
const { createHttpError } = require("./httpError");

function parseEmotions(rawEmotions) {
  if (!rawEmotions) {
    throw createHttpError(400, "The emotions field is required.");
  }

  let parsedEmotions;

  try {
    parsedEmotions = JSON.parse(rawEmotions);
  } catch (error) {
    throw createHttpError(400, "The emotions field must be a valid JSON array.");
  }

  if (!Array.isArray(parsedEmotions) || parsedEmotions.length === 0) {
    throw createHttpError(400, "Provide at least one emotion in a JSON array.");
  }

  if (parsedEmotions.length > 3) {
    throw createHttpError(400, "You can request a maximum of 3 emotions.");
  }

  const normalizedEmotions = parsedEmotions.map((emotion) =>
    String(emotion).trim().toLowerCase()
  );

  const uniqueEmotions = [...new Set(normalizedEmotions)];

  if (uniqueEmotions.length !== normalizedEmotions.length) {
    throw createHttpError(400, "Duplicate emotions are not allowed.");
  }

  const invalidEmotion = uniqueEmotions.find((emotion) => !EMOTION_PROMPTS[emotion]);

  if (invalidEmotion) {
    throw createHttpError(
      400,
      `Unsupported emotion "${invalidEmotion}". Supported emotions: ${Object.keys(EMOTION_PROMPTS).join(", ")}.`
    );
  }

  return uniqueEmotions;
}

module.exports = {
  parseEmotions
};
