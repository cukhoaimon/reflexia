import { AgoraSession } from "../lib/api";
import { EMOTIONS } from "../lib/constants";
import { SupportedEmotion, SUPPORTED_EMOTIONS } from "../lib/emotions";
import { EmotionConfig } from "../lib/types";
import { AudioMeterCard } from "./AudioMeterCard";
import { EmotionAvatar } from "./EmotionAvatar";

interface EmotionAvatarTileProps {
  currentEmotion: EmotionConfig;
  selectedEmotion: SupportedEmotion;
  audioSignalDetected: boolean;
  avatarStageStatus: string;
  avatarSignalLevel: number;
  avatarMeterSegments: boolean[];
  joined: boolean;
  session: AgoraSession | null;
  channelInput: string;
  onSelectEmotion: (emotion: SupportedEmotion) => void;
}

export function EmotionAvatarTile({
  currentEmotion,
  selectedEmotion,
  audioSignalDetected,
  avatarStageStatus,
  avatarSignalLevel,
  avatarMeterSegments,
  joined,
  session,
  channelInput,
  onSelectEmotion,
}: EmotionAvatarTileProps) {
  return (
    <article className="call-tile">
      <div className="tile-topbar">
        <div>
          <span className="tile-label">Emotion Avatar</span>
          <strong className="tile-title">{currentEmotion.title} avatar is active</strong>
        </div>
        <span className={audioSignalDetected ? "tile-badge active" : "tile-badge"}>{avatarStageStatus}</span>
      </div>
      <EmotionAvatar emotion={currentEmotion.key} speaking={audioSignalDetected} speechLevel={avatarSignalLevel} />
      <div className="avatar-emotion-panel">
        <div className="avatar-emotion-summary">
          <span className="tile-label">Selected Emotion Layer</span>
          <strong>{currentEmotion.title} · {currentEmotion.mood}</strong>
          <p>{currentEmotion.description}</p>
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
            ? `The avatar is synced to ${session?.channel ?? channelInput} and switches instantly with the selected emotion layer.`
            : "Join the call to activate the avatar and switch among the five emotion layers."}
        </span>
        <strong>{audioSignalDetected ? "Live signal detected" : `${currentEmotion.title} avatar ready`}</strong>
      </div>
      <AudioMeterCard
        title="Emotion Pulse"
        status={`${avatarStageStatus[0].toUpperCase()}${avatarStageStatus.slice(1)}`}
        level={avatarSignalLevel}
        segments={avatarMeterSegments}
        barPrefix="avatar"
        remote
      />
    </article>
  );
}
