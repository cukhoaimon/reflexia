import { EmotionConfig } from "../lib/types";
import { EmotionAvatar } from "./EmotionAvatar";

interface EmotionAvatarTileProps {
  currentEmotion: EmotionConfig;
  audioSignalDetected: boolean;
  avatarSignalLevel: number;
}

export function EmotionAvatarTile({
  currentEmotion,
  audioSignalDetected,
  avatarSignalLevel,
}: EmotionAvatarTileProps) {
  return (
    <article className={`meet-tile${audioSignalDetected ? " meet-tile--speaking" : ""}`}>
      <EmotionAvatar
        emotion={currentEmotion.key}
        speaking={audioSignalDetected}
        speechLevel={avatarSignalLevel}
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
