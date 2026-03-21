import { ICameraVideoTrack, IMicrophoneAudioTrack } from "agora-rtc-sdk-ng";
import { AgoraSession, AppMode } from "../lib/api";
import { EmotionConfig } from "../lib/types";

interface CallSetupPanelProps {
  channelInput: string;
  joined: boolean;
  connecting: boolean;
  cameraEnabled: boolean;
  micEnabled: boolean;
  cameraTrack: ICameraVideoTrack | null;
  micTrack: IMicrophoneAudioTrack | null;
  isDebugMode: boolean;
  mode: AppMode;
  session: AgoraSession | null;
  isListeningLive: boolean;
  currentEmotion: EmotionConfig;
  combinedError: string | null;
  onChannelInputChange: (value: string) => void;
  onJoin: () => void;
  onLeave: () => void;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onOpenDebugViewer: () => void;
}

export function CallSetupPanel({
  channelInput,
  joined,
  connecting,
  cameraEnabled,
  micEnabled,
  cameraTrack,
  micTrack,
  isDebugMode,
  mode,
  session,
  isListeningLive,
  currentEmotion,
  combinedError,
  onChannelInputChange,
  onJoin,
  onLeave,
  onToggleCamera,
  onToggleMic,
  onOpenDebugViewer,
}: CallSetupPanelProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Call Setup</p>
          <h2>Setup your call</h2>
        </div>
      </div>
      <label className="field">
        <span>Room name</span>
        <input
          value={channelInput}
          onChange={(event) => onChannelInputChange(event.target.value)}
          disabled={joined || connecting}
        />
      </label>
      <div className="control-row">
        <button type="button" className="control-chip selected" onClick={onJoin} disabled={joined || connecting}>
          {connecting ? "Connecting..." : "Join call"}
        </button>
        <button type="button" className="control-chip" onClick={onLeave} disabled={!joined && !connecting}>
          Leave call
        </button>
      </div>
      <div className="control-row">
        <button
          type="button"
          className={cameraEnabled ? "control-chip active" : "control-chip"}
          onClick={onToggleCamera}
          disabled={!cameraTrack}
        >
          {cameraEnabled ? "Turn camera off" : "Turn camera on"}
        </button>
        <button
          type="button"
          className={micEnabled ? "control-chip active" : "control-chip"}
          onClick={onToggleMic}
          disabled={!micTrack}
        >
          {micEnabled ? "Mute microphone" : "Enable microphone"}
        </button>
      </div>
      {!isDebugMode ? (
        <button type="button" className="control-chip" onClick={onOpenDebugViewer}>
          Open debug tab
        </button>
      ) : null}
      <dl className="meta-grid">
        <div><dt>Mode</dt><dd>{mode}</dd></div>
        <div><dt>Status</dt><dd>{joined ? "joined" : "idle"}</dd></div>
        <div><dt>Session source</dt><dd>{session?.source ?? "not connected yet"}</dd></div>
        <div><dt>UID</dt><dd>{String(session?.uid ?? "-")}</dd></div>
      </dl>
      <div className="status-card">
        <span className={`status-dot ${combinedError ? "danger" : ""}`} />
        <p>
          {combinedError
            ? combinedError
            : joined
            ? `You are in ${session?.channel}. Live listening is ${isListeningLive ? "running" : "ready"} for ${currentEmotion.title}.`
            : "Enter a room name, choose one emotion layer, and join when you are ready."}
        </p>
      </div>
    </section>
  );
}
