const openai = require("../config/openai");
const { EMOTION_PROMPTS } = require("../config/emotions");
const { createHttpError } = require("../utils/httpError");

async function generateEmotionResponse(emotion, transcript) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.9,
      messages: [
        {
          role: "system",
          content: `${EMOTION_PROMPTS[emotion]} Respond in English using 2 to 4 sentences. Make the tone clearly distinct for this emotion.`
        },
        {
          role: "user",
          content: transcript
        }
      ]
    });

    return {
      emotion,
      text: completion.choices[0]?.message?.content?.trim() || ""
    };
  } catch (error) {
    throw createHttpError(
      502,
      `OpenAI chat generation failed for "${emotion}": ${error.message || "Unknown generation error."}`
    );
  }
}

async function generateEmotionResponses(emotions, transcript) {
  return Promise.all(emotions.map((emotion) => generateEmotionResponse(emotion, transcript)));
}

module.exports = {
  generateEmotionResponses
};
