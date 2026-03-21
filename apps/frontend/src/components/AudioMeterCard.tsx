interface AudioMeterCardProps {
  title: string;
  status: string;
  level: number;
  segments: boolean[];
  barPrefix: string;
  remote?: boolean;
}

export function AudioMeterCard({ title, status, level, segments, barPrefix, remote = false }: AudioMeterCardProps) {
  return (
    <div className="audio-meter-card">
      <div className="audio-meter-header">
        <span>{title}</span>
        <strong>{status}</strong>
      </div>
      <div className="audio-meter-bars" aria-label={`${title} level ${level}`}>
        {segments.map((active, index) => (
          <span
            key={`${barPrefix}-meter-${index}`}
            className={active ? `audio-meter-bar active${remote ? " remote" : ""}` : "audio-meter-bar"}
          />
        ))}
      </div>
    </div>
  );
}
