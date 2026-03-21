import { AnalysisResponse } from "../lib/api";
import { TranscriptEntry } from "../lib/types";

interface LiveResponsePanelProps {
  analysisResult: AnalysisResponse | null;
  transcriptEntries: TranscriptEntry[];
  isAnalyzing: boolean;
  liveStatus: string;
}

export function LiveResponsePanel({ analysisResult, transcriptEntries, isAnalyzing, liveStatus }: LiveResponsePanelProps) {
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Live Response</p>
            <h2>Latest AI output</h2>
          </div>
          <span className="tile-badge active">{isAnalyzing ? "Responding" : liveStatus}</span>
        </div>
        {analysisResult ? (
          <div className="stack-panel">
            <article className="analysis-card analysis-card-wide">
              <p className="eyebrow">Transcript</p>
              <p className="transcript">{analysisResult.transcript}</p>
            </article>
            <article className="analysis-card">
              <p className="eyebrow">{analysisResult.emotion}</p>
              <p className="analysis-response">{analysisResult.reply}</p>
            </article>
          </div>
        ) : (
          <p className="empty-copy">No live transcript yet. Join the room and start speaking.</p>
        )}
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Transcript Chunks</p>
            <h2>Recent segments</h2>
          </div>
        </div>
        <div className="timeline-list">
          {transcriptEntries.length === 0 ? (
            <p className="empty-copy">No live chunks processed yet.</p>
          ) : (
            transcriptEntries.map((entry) => (
              <article key={entry.id} className="timeline-card">
                <div className="timeline-meta">
                  <strong>{entry.createdAt}</strong>
                  <span>{entry.emotion}</span>
                </div>
                <p className="timeline-text">{entry.transcript}</p>
              </article>
            ))
          )}
        </div>
      </section>
    </>
  );
}
