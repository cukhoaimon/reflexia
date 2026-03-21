import { RefObject } from "react";
import { AudioMeterCard } from "./AudioMeterCard";

interface LocalCameraPreviewProps {
  containerRef: RefObject<HTMLDivElement>;
  joined: boolean;
  cameraEnabled: boolean;
  micEnabled: boolean;
  micStatus: string;
  localAudioLevel: number;
  localMeterSegments: boolean[];
}

export function LocalCameraPreview({
  containerRef,
  joined,
  cameraEnabled,
  micEnabled,
  micStatus,
  localAudioLevel,
  localMeterSegments,
}: LocalCameraPreviewProps) {
  return (
    <article className="call-tile">
      <div className="tile-topbar">
        <div>
          <span className="tile-label">You</span>
          <strong className="tile-title">Your camera preview</strong>
        </div>
        <span className="tile-badge">{cameraEnabled ? "Camera live" : "Camera idle"}</span>
      </div>
      <div ref={containerRef} className="video-stage" />
      <div className="video-overlay">
        <span>{joined ? "Ready for your call" : "Camera preview will appear here after joining"}</span>
        <strong>{micEnabled ? "Microphone on" : "Microphone off"}</strong>
      </div>
      <AudioMeterCard
        title="Voice Activity"
        status={micStatus === "speaking" ? "Speaking" : micEnabled ? "Listening" : "Muted"}
        level={localAudioLevel}
        segments={localMeterSegments}
        barPrefix="local"
      />
    </article>
  );
}
