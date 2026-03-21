import { AgoraSession } from "../lib/api";
import type { AvatarSpeechPerformance } from "../lib/api";
import { EMOTIONS } from "../lib/constants";
import { SupportedEmotion, SUPPORTED_EMOTIONS } from "../lib/emotions";
import { EmotionConfig } from "../lib/types";
import { EmotionAvatar } from "./EmotionAvatar";

interface EmotionAvatarTileProps {
  currentEmotion: EmotionConfig;
  selectedEmotion: SupportedEmotion;
  avatarSpeaking: boolean;
  avatarStageStatus: string;
  avatarSignalLevel: number;
  avatarMeterSegments: boolean[];
  avatarSpeechSource: "idle" | "text" | "voice";
  avatarResponseText: string;
  avatarSpeechStartedAt: number;
  avatarSpeechPerformance: AvatarSpeechPerformance | null;
  joined: boolean;
  session: AgoraSession | null;
  channelInput: string;
  onSelectEmotion: (emotion: SupportedEmotion) => void;
}

export function EmotionAvatarTile({
  currentEmotion,
  selectedEmotion,
  avatarSpeaking,
  avatarStageStatus,
  avatarSignalLevel,
  avatarMeterSegments,
  avatarSpeechSource,
  avatarResponseText,
  avatarSpeechStartedAt,
  avatarSpeechPerformance,
  joined,
  session,
  channelInput,
  onSelectEmotion,
}: EmotionAvatarTileProps) {
  const liveCue = avatarSpeechSource === "voice"
    ? "Voice-synced"
    : avatarSpeechSource === "text"
      ? "Text-driven"
      : "Standby";
  const responsePreview = avatarResponseText.trim()
    ? avatarResponseText.trim()
    : "The avatar will animate its mouth and gestures from the next response.";
  const responseAge = avatarSpeechStartedAt
    ? Math.max(0, Math.round((Date.now() - avatarSpeechStartedAt) / 1000))
    : 0;
  const gestureLabel = avatarSpeechPerformance?.gesturePlan.style
    ? avatarSpeechPerformance.gesturePlan.style.replace(/^\w/, (char) => char.toUpperCase())
    : "Adaptive";

  return (
    <article className="call-tile">
      <div className="tile-topbar">
        <div>
          <span className="tile-label">Emotion Avatar</span>
          <strong className="tile-title">{currentEmotion.title} avatar is active</strong>
        </div>
        <span className={avatarSpeaking ? "tile-badge active" : "tile-badge"}>{avatarStageStatus}</span>
      </div>
      <EmotionAvatar
        emotion={currentEmotion.key}
        speaking={avatarSpeaking}
        speechLevel={avatarSignalLevel}
        responseText={avatarResponseText}
        speechSource={avatarSpeechSource}
        speechStartedAt={avatarSpeechStartedAt}
        performance={avatarSpeechPerformance}
      />
      <div className="avatar-emotion-panel">
        <div className="avatar-emotion-summary">
          <span className="tile-label">Selected Emotion Layer</span>
          <strong>{currentEmotion.title} · {currentEmotion.mood}</strong>
          <p>{currentEmotion.description}</p>
        </div>
        <div className="avatar-response-card">
          <div className="avatar-response-meta">
            <span className="tile-label">Response Motion</span>
            <strong>{liveCue}</strong>
          </div>
          <p>{responsePreview}</p>
          <small>
            {avatarSpeechStartedAt
              ? `Updated ${responseAge}s ago. Gesture profile: ${gestureLabel}.`
              : "Waiting for the next reply."}
          </small>
        </div>
        <div className="emotion-picker-grid avatar-emotion-grid">
          {SUPPORTED_EMOTIONS.map((emotion) => {
            const config = EMOTIONS.find((entry) => entry.key === emotion) ?? EMOTIONS[0];
            const selected = selectedEmotion === emotion;
            return (
              <button
                key={emotion}
                type="button"
                className={selected ? "emotion-option selected" : "emotion-option"}
                onClick={() => onSelectEmotion(emotion)}
              >
                {config.imageSrc ? (
                  <img
                    src={config.imageSrc}
                    alt={`${config.title} option`}
                    className="emotion-option-image"
                  />
                ) : null}
                <span>{config.title}</span>
                <small>{config.mood}</small>
              </button>
            );
          })}
        </div>
      </div>
      <div className="video-overlay">
        <span>
          {joined
            ? `The avatar is synced to ${session?.channel ?? channelInput}, reacts to reply text, and intensifies gestures when voice playback is active.`
            : "Join the call to activate the avatar and switch among the four emotion layers."}
        </span>
        <strong>{avatarSpeaking ? `Avatar ${liveCue.toLowerCase()}` : `${currentEmotion.title} avatar ready`}</strong>
      </div>
      <AudioMeterCard
        title="Emotion Pulse"
        status={`${avatarStageStatus[0].toUpperCase()}${avatarStageStatus.slice(1)}`}
        level={avatarSignalLevel}
        segments={avatarMeterSegments}
        barPrefix="avatar"
        remote
      />
      <div className="meet-nameplate">
        <span>Emotion Avatar</span>
        <span className="meet-emotion-badge">
          {currentEmotion.emoji} {currentEmotion.title}
        </span>
      </div>
    </article>
  );
}
