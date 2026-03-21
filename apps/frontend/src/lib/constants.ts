import { EmotionConfig } from "./types";

export const LIVE_CHUNK_DURATION_MS = 6000;
export const LIVE_CHUNK_GAP_MS = 350;
export const MIN_ANALYSIS_BLOB_SIZE_BYTES = 2048;

export const EMOTIONS: EmotionConfig[] = [
  { key: "joy", title: "Joy", mood: "Bright Lift", emoji: "^_^", accent: "linear-gradient(135deg, #ff9ccf 0%, #8b5cf6 48%, #60a5fa 100%)", glow: "rgba(244, 114, 182, 0.4)", description: "Warm, optimistic energy for upbeat conversations and supportive responses." },
  { key: "sadness", title: "Sadness", mood: "Soft Rain", emoji: "T_T", accent: "linear-gradient(135deg, #60a5fa 0%, #4f46e5 52%, #8b5cf6 100%)", glow: "rgba(96, 165, 250, 0.36)", description: "Cool, reflective visuals suited to slower and more empathetic tones." },
  { key: "anger", title: "Anger", mood: "Heat Pulse", emoji: ">:(", accent: "linear-gradient(135deg, #fb7185 0%, #f97316 55%, #facc15 100%)", glow: "rgba(249, 115, 22, 0.34)", description: "Sharper contrast and hotter highlights for tense moments that need attention." },
  { key: "fear", title: "Fear", mood: "Night Echo", emoji: "o_o", accent: "linear-gradient(135deg, #2dd4bf 0%, #3b82f6 55%, #6366f1 100%)", glow: "rgba(59, 130, 246, 0.3)", description: "Nervous, alert atmosphere for uncertain or high-stakes emotional states." },
  { key: "disgust", title: "Disgust", mood: "Acid Drift", emoji: "-_-", accent: "linear-gradient(135deg, #84cc16 0%, #14b8a6 55%, #0ea5e9 100%)", glow: "rgba(20, 184, 166, 0.34)", description: "Tighter, uneasy gradients for moments of discomfort or rejection." },
];
