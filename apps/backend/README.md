# Audio Emotion Backend

Node.js + Express backend that accepts an uploaded audio file, transcribes it with OpenAI, and returns multiple emotion-based AI responses.

## Features

- Upload `.wav`, `.mp4`, or `.m4a` audio files with `multer`
- Validate a JSON `emotions` array with a max of 3 emotions
- Transcribe audio with the OpenAI transcription API
- Generate one chat response per emotion in parallel with `Promise.all`
- Basic rate limiting for API safety
- Save each successful result to `outputs/latest-output.json` and a timestamped JSON file
- Clean modular structure for hackathon-friendly maintenance

## Project Structure

```text
src/
  config/
  controllers/
  middleware/
  routes/
  services/
  utils/
```

## Setup

```bash
npm install
```

Create a `.env` file:

```env
OPENAI_API_KEY=your_key_here
PORT=3000
```

Run the server:

```bash
npm run dev
```

Or:

```bash
npm start
```

## API

### `POST /analyze-audio`

Form-data fields:

- `file`: `.wav`, `.mp4`, or `.m4a` audio file
- `emotions`: JSON string such as `["joy","fear"]`

### Example response

```json
{
  "transcript": "I failed my exam, what should I do?",
  "responses": [
    {
      "emotion": "joy",
      "text": "This is just a setback! You can absolutely recover from this."
    },
    {
      "emotion": "fear",
      "text": "If you do not act quickly, this could affect your next steps, so make a plan right away."
    }
  ],
  "output": {
    "directory": "D:\\My Progress\\lotus\\backend\\outputs",
    "timestampedFilename": "analysis-2026-03-21T01-23-45-000Z.json",
    "latestFilename": "latest-output.json"
  }
}
```

## Notes

- Supported emotions: `joy`, `sadness`, `anger`, `fear`, `disgust`
- Invalid file types, missing emotions, more than 3 emotions, and OpenAI API failures return JSON errors
- Uploaded files are deleted after each request finishes
- Successful requests also write JSON output files into the `outputs/` folder

## Example curl

```bash
curl -X POST http://localhost:3000/analyze-audio \
  -F "file=@./sample.wav" \
  -F "emotions=[\"joy\",\"sadness\"]"
```
