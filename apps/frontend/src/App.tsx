import { useEffect, useMemo, useRef, useState } from "react";
import AgoraRTC, {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
} from "agora-rtc-sdk-ng";
import AgoraRTM, { RTMClient } from "agora-rtm";
import {
  AgoraAgentSession,
  AgoraSession,
  AppMode,
  fetchAgoraSession,
  startAgoraAgent,
  stopAgoraAgent,
} from "./lib/api";
import { ConversationalAIAPI } from "./lib/conversational-ai-api";
import {
  EAgentState,
  EConversationalAIAPIEvents,
  EMessageType,
  ETranscriptHelperMode,
  ETurnStatus,
  IAgentTranscription,
  ITranscriptHelperItem,
  IUserTranscription,
} from "./lib/conversational-ai-api/type";
import { SUPPORTED_EMOTIONS, SupportedEmotion } from "./lib/emotions";

const { RTM } = AgoraRTM;

type TranscriptRow = {
  id: string;
  speaker: "agent" | "user";
  text: string;
  status: "listening" | "complete" | "interrupted";
  createdAt: string;
};

const envAppId = import.meta.env.VITE_AGORA_APP_ID ?? "";
const envChannel = import.meta.env.VITE_AGORA_CHANNEL ?? "emotalk";
const envToken = import.meta.env.VITE_AGORA_TOKEN ?? null;
const envUidRaw = import.meta.env.VITE_AGORA_UID;
const backendBaseUrl = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3000";

try {
  const rtcWithParameter = AgoraRTC as typeof AgoraRTC & {
    setParameter?: (key: string, value: unknown) => void;
  };
  rtcWithParameter.setParameter?.("ENABLE_AUDIO_PTS_METADATA", true);
} catch {
  // Older SDK builds may ignore this parameter.
}

function parseEnvUid(rawUid: string | undefined) {
  if (!rawUid) {
    return null;
  }

  const numericUid = Number(rawUid);
  return Number.isNaN(numericUid) ? rawUid : numericUid;
}

function getModeFromLocation(): AppMode {
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get("mode") === "debug" ? "debug" : "broadcast";
}

function getChannelFromLocation() {
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get("channel") || envChannel;
}

function shouldAutoJoin() {
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get("autojoin") === "1";
}

function getTimeLabel() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function mapAgentStateToLabel(state: EAgentState | null) {
  switch (state) {
    case EAgentState.LISTENING:
      return "Listening for the end of your sentence.";
    case EAgentState.THINKING:
      return "Thinking about the reply.";
    case EAgentState.SPEAKING:
      return "Speaking back into the meeting.";
    case EAgentState.SILENT:
      return "Waiting quietly for the next turn.";
    case EAgentState.IDLE:
      return "Ready for the next turn.";
    default:
      return "Join the channel to start the interactive meeting.";
  }
}

function mapTranscriptStatus(status: ETurnStatus) {
  switch (status) {
    case ETurnStatus.END:
      return "complete";
    case ETurnStatus.INTERRUPTED:
      return "interrupted";
    default:
      return "listening";
  }
}

function mapTranscriptRows(
  items: ITranscriptHelperItem<Partial<IUserTranscription | IAgentTranscription>>[]
): TranscriptRow[] {
  return items
    .filter((item) => item.text.trim())
    .slice(-12)
    .reverse()
    .map((item) => ({
      id: `${item.uid}-${item.turn_id}-${item.stream_id}`,
      speaker:
        item.metadata?.object === EMessageType.AGENT_TRANSCRIPTION
          ? ("agent" as const)
          : ("user" as const),
      text: item.text,
      status: mapTranscriptStatus(item.status) as TranscriptRow["status"],
      createdAt: new Date(item._time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    }));
}

function App() {
  const mode = getModeFromLocation();
  const isDebugMode = mode === "debug";
  const autoJoin = shouldAutoJoin();
  const clientState = useMemo<{ client: IAgoraRTCClient | null; clientError: string | null }>(() => {
    try {
      return {
        client: AgoraRTC.createClient({ mode: "rtc", codec: "vp8" }),
        clientError: null,
      };
    } catch (error) {
      return {
        client: null,
        clientError:
          error instanceof Error ? error.message : "Agora RTC failed to initialize.",
      };
    }
  }, []);
  const client = clientState.client;
  const clientError = clientState.clientError;
  const localContainerRef = useRef<HTMLDivElement>(null);
  const remoteContainerRef = useRef<HTMLDivElement>(null);
  const cameraTrackRef = useRef<ICameraVideoTrack | null>(null);
  const micTrackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const rtmClientRef = useRef<RTMClient | null>(null);
  const conversationalApiRef = useRef<ConversationalAIAPI | null>(null);
  const agentSessionRef = useRef<AgoraAgentSession | null>(null);
  const selectedEmotionRef = useRef<SupportedEmotion>("joy");
  const lastAppliedEmotionRef = useRef<SupportedEmotion | null>(null);
  const hasAutoJoinedRef = useRef(false);
  const joinedRef = useRef(false);
  const startingAgentRef = useRef(false);
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [session, setSession] = useState<AgoraSession | null>(null);
  const [agentSession, setAgentSession] = useState<AgoraAgentSession | null>(null);
  const [agentState, setAgentState] = useState<EAgentState | null>(null);
  const [channelInput, setChannelInput] = useState(getChannelFromLocation());
  const [logs, setLogs] = useState<string[]>([]);
  const [selectedEmotion, setSelectedEmotion] = useState<SupportedEmotion>("joy");
  const [liveStatus, setLiveStatus] = useState("Join the channel to start the interactive meeting.");
  const [transcriptRows, setTranscriptRows] = useState<TranscriptRow[]>([]);
  const [latestAgentText, setLatestAgentText] = useState("");

  const appendLog = (message: string) => {
    setLogs((currentLogs) => [`${getTimeLabel()}  ${message}`, ...currentLogs].slice(0, 24));
  };

  useEffect(() => {
    joinedRef.current = joined;
  }, [joined]);

  useEffect(() => {
    selectedEmotionRef.current = selectedEmotion;
  }, [selectedEmotion]);

  useEffect(() => {
    agentSessionRef.current = agentSession;
  }, [agentSession]);

  useEffect(() => {
    if (!client) {
      return;
    }

    const handleUserPublished = async (
      user: IAgoraRTCRemoteUser,
      mediaType: "audio" | "video"
    ) => {
      appendLog(`Remote user ${user.uid} published ${mediaType}.`);
      await client.subscribe(user, mediaType);

      if (mediaType === "video" && user.videoTrack && remoteContainerRef.current) {
        remoteContainerRef.current.querySelector(".empty-state")?.remove();
        let remotePlayer = document.getElementById(`remote-${user.uid}`);
        if (!remotePlayer) {
          remotePlayer = document.createElement("div");
          remotePlayer.id = `remote-${user.uid}`;
          remotePlayer.className = "video-tile";
          remoteContainerRef.current.appendChild(remotePlayer);
        }

        user.videoTrack.play(remotePlayer);
      }

      if (mediaType === "audio" && user.audioTrack) {
        user.audioTrack.play();
      }
    };

    const removeRemoteUser = (user: IAgoraRTCRemoteUser) => {
      appendLog(`Remote user ${user.uid} left or unpublished.`);
      const remotePlayer = document.getElementById(`remote-${user.uid}`);
      if (remotePlayer) {
        remotePlayer.remove();
      }
    };

    const handleConnectionStateChange = (currentState: string, previousState: string) => {
      appendLog(`Connection ${previousState} -> ${currentState}.`);
    };

    client.on("user-published", handleUserPublished);
    client.on("user-unpublished", removeRemoteUser);
    client.on("user-left", removeRemoteUser);
    client.on("connection-state-change", handleConnectionStateChange);

    return () => {
      client.off("user-published", handleUserPublished);
      client.off("user-unpublished", removeRemoteUser);
      client.off("user-left", removeRemoteUser);
      client.off("connection-state-change", handleConnectionStateChange);
    };
  }, [client]);

  const renderEmptyState = (container: HTMLDivElement | null, message: string) => {
    if (!container) {
      return;
    }

    container.innerHTML = "";
    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.textContent = message;
    container.appendChild(emptyState);
  };

  useEffect(() => {
    if (isDebugMode) {
      renderEmptyState(localContainerRef.current, "Local capture is disabled in debug mode.");
    }

    renderEmptyState(remoteContainerRef.current, "No remote tracks connected yet.");
  }, [isDebugMode]);

  const renderLocalVideo = (track: ICameraVideoTrack) => {
    if (!localContainerRef.current) {
      return;
    }

    localContainerRef.current.innerHTML = "";
    const localPlayer = document.createElement("div");
    localPlayer.className = "video-tile";
    localContainerRef.current.appendChild(localPlayer);
    track.play(localPlayer);
  };

  const clearVideoContainers = () => {
    if (localContainerRef.current) {
      localContainerRef.current.innerHTML = "";
      if (isDebugMode) {
        renderEmptyState(localContainerRef.current, "Local capture is disabled in debug mode.");
      }
    }

    if (remoteContainerRef.current) {
      renderEmptyState(remoteContainerRef.current, "No remote tracks connected yet.");
    }
  };

  const cleanupLocalTracks = () => {
    cameraTrackRef.current?.stop();
    cameraTrackRef.current?.close();
    micTrackRef.current?.stop();
    micTrackRef.current?.close();
    cameraTrackRef.current = null;
    micTrackRef.current = null;
  };

  const detachConversationalApi = async () => {
    const api = conversationalApiRef.current;
    conversationalApiRef.current = null;

    if (api) {
      api.removeAllEventListeners();
      api.unsubscribe();
    }
  };

  const disconnectRtm = async () => {
    const rtmClient = rtmClientRef.current;
    rtmClientRef.current = null;

    if (rtmClient) {
      try {
        if (session?.channel) {
          await rtmClient.unsubscribe(session.channel);
        }
      } catch {
        // Best-effort cleanup.
      }

      try {
        await rtmClient.logout();
      } catch {
        // Best-effort cleanup.
      }
    }
  };

  const stopAgentSession = async (appendStopLog = true) => {
    const currentAgentSession = agentSessionRef.current;

    if (!currentAgentSession) {
      return;
    }

    agentSessionRef.current = null;
    setAgentSession(null);
    setAgentState(null);

    try {
      await stopAgoraAgent(backendBaseUrl, currentAgentSession.agent_id);
      if (appendStopLog) {
        appendLog(`Stopped agent ${currentAgentSession.agent_id}.`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to stop the Agora agent cleanly.";
      appendLog(`Agent stop warning: ${message}`);
    }
  };

  const attachConversationalApi = (
    nextClient: IAgoraRTCClient,
    nextRtmClient: RTMClient,
    channelName: string
  ) => {
    const api = ConversationalAIAPI.init({
      rtcEngine: nextClient,
      rtmEngine: nextRtmClient,
      renderMode: ETranscriptHelperMode.TEXT,
      enableLog: false,
      enableRenderModeFallback: true,
    });

    api.subscribeMessage(channelName);
    api.on(EConversationalAIAPIEvents.TRANSCRIPT_UPDATED, (items) => {
      const rows = mapTranscriptRows(items);
      setTranscriptRows(rows);
      const latestAgentRow = rows.find((row) => row.speaker === "agent");
      setLatestAgentText(latestAgentRow?.text ?? "");
    });
    api.on(EConversationalAIAPIEvents.AGENT_STATE_CHANGED, (agentUserId, event) => {
      if (agentSessionRef.current && agentUserId !== agentSessionRef.current.agentUid) {
        return;
      }

      setAgentState(event.state);
      setLiveStatus(mapAgentStateToLabel(event.state));
    });
    api.on(EConversationalAIAPIEvents.AGENT_ERROR, (agentUserId, error) => {
      if (agentSessionRef.current && agentUserId !== agentSessionRef.current.agentUid) {
        return;
      }

      setAgentError(error.message);
      appendLog(`Agent error: ${error.message}`);
    });
    api.on(EConversationalAIAPIEvents.MESSAGE_ERROR, (_agentUserId, error) => {
      setAgentError(error.message);
      appendLog(`Agent message error: ${error.message}`);
    });

    conversationalApiRef.current = api;
  };

  const initializeRtm = async (nextSession: AgoraSession, userUid: string) => {
    const nextRtmClient = new RTM(nextSession.appId, userUid, {
      useStringUserId: true,
    });

    await nextRtmClient.login(nextSession.token ? { token: nextSession.token } : undefined);
    await nextRtmClient.subscribe(nextSession.channel);
    rtmClientRef.current = nextRtmClient;
    attachConversationalApi(client as IAgoraRTCClient, nextRtmClient, nextSession.channel);
    appendLog(`RTM subscribed to ${nextSession.channel}.`);
  };

  const startAgentSession = async (
    emotion: SupportedEmotion,
    options?: { sessionOverride?: AgoraSession; joinedOverride?: boolean }
  ) => {
    const activeSession = options?.sessionOverride ?? session;
    const isJoined = options?.joinedOverride ?? joinedRef.current;

    if (isDebugMode || !activeSession || !isJoined || startingAgentRef.current) {
      return;
    }

    startingAgentRef.current = true;
    setAgentError(null);
    setLiveStatus(`Starting the Agora voice agent for ${emotion}.`);

    try {
      if (agentSessionRef.current) {
        await stopAgentSession(false);
      }

      const nextAgentSession = await startAgoraAgent(backendBaseUrl, {
        channel: activeSession.channel,
        uid: String(activeSession.uid),
        emotion,
      });

      agentSessionRef.current = nextAgentSession;
      lastAppliedEmotionRef.current = emotion;
      setAgentSession(nextAgentSession);
      setAgentState(null);
      setLiveStatus("Agent joined the meeting. Start talking naturally.");
      appendLog(`Agent ${nextAgentSession.agentUid} started with ${emotion}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start the Agora agent.";
      setAgentError(message);
      setLiveStatus("Agent failed to start.");
      appendLog(`Agent start failed: ${message}`);
    } finally {
      startingAgentRef.current = false;
    }
  };

  const leaveChannel = async () => {
    try {
      if (!client) {
        throw new Error(clientError || "Agora RTC client is unavailable.");
      }

      await stopAgentSession();
      await detachConversationalApi();
      await disconnectRtm();
      cleanupLocalTracks();
      clearVideoContainers();
      await client.leave();
      setJoined(false);
      setSession(null);
      setTranscriptRows([]);
      setLatestAgentText("");
      setLiveStatus("Join the channel to start the interactive meeting.");
      appendLog("Left the Agora channel.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to leave channel.";
      setConnectionError(message);
    }
  };

  useEffect(() => {
    return () => {
      void leaveChannel();
    };
    // Cleanup on unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveSession = async (requestedMode: AppMode, channelName: string) => {
    try {
      return await fetchAgoraSession(backendBaseUrl, requestedMode, channelName);
    } catch (fetchError) {
      const message =
        fetchError instanceof Error ? fetchError.message : "Request to backend session endpoint failed.";
      appendLog(`Backend session endpoint failed: ${message}`);
    }

    if (!envAppId || !envToken) {
      throw new Error(
        "Missing backend Agora session. Set AGORA_APP_ID, AGORA_APP_CERTIFICATE, and AGORA_CAI credentials on the backend."
      );
    }

    return {
      appId: envAppId,
      channel: channelName,
      token: envToken,
      uid: parseEnvUid(envUidRaw),
      source: "frontend-env",
      useStringUid: true,
    } satisfies AgoraSession;
  };

  const joinChannel = async () => {
    if (connecting || joined) {
      return;
    }

    try {
      if (!client) {
        throw new Error(clientError || "Agora RTC client is unavailable.");
      }

      setConnecting(true);
      setConnectionError(null);
      setAgentError(null);
      setTranscriptRows([]);
      setLatestAgentText("");

      const nextSession = await resolveSession(mode, channelInput.trim() || envChannel);
      appendLog(`Using Agora session from ${nextSession.source}.`);
      const joinedUid = await client.join(
        nextSession.appId,
        nextSession.channel,
        nextSession.token,
        nextSession.uid
      );
      const normalizedUid = String(joinedUid);

      if (isDebugMode) {
        appendLog(`Joined debug viewer for channel ${nextSession.channel} as ${joinedUid}.`);
        setSession({ ...nextSession, uid: normalizedUid });
        setJoined(true);
        return;
      }

      const [microphoneTrack, nextCameraTrack] =
        await AgoraRTC.createMicrophoneAndCameraTracks();

      micTrackRef.current = microphoneTrack;
      cameraTrackRef.current = nextCameraTrack;

      await client.publish([microphoneTrack, nextCameraTrack]);
      renderLocalVideo(nextCameraTrack);
      await initializeRtm({ ...nextSession, uid: normalizedUid }, normalizedUid);

      const activeSession = { ...nextSession, uid: normalizedUid };
      joinedRef.current = true;
      setSession(activeSession);
      setJoined(true);
      appendLog(`Publishing mic + camera to channel ${nextSession.channel} as ${normalizedUid}.`);
      await startAgentSession(selectedEmotionRef.current, {
        sessionOverride: activeSession,
        joinedOverride: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to join channel.";
      setConnectionError(message);
      appendLog(`Join failed: ${message}`);
      await detachConversationalApi();
      await disconnectRtm();
      cleanupLocalTracks();
      if (client) {
        try {
          await client.leave();
        } catch {
          // Best-effort cleanup.
        }
      }
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    if (!isDebugMode || !autoJoin || hasAutoJoinedRef.current) {
      return;
    }

    hasAutoJoinedRef.current = true;
    void joinChannel();
    // Auto-join only once for the debug viewer route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoin, isDebugMode]);

  useEffect(() => {
    if (
      isDebugMode ||
      !joined ||
      !session ||
      !agentSessionRef.current ||
      startingAgentRef.current ||
      lastAppliedEmotionRef.current === selectedEmotion
    ) {
      return;
    }

    appendLog(`Restarting agent tone as ${selectedEmotion}.`);
    void startAgentSession(selectedEmotion);
  }, [isDebugMode, joined, selectedEmotion, session]);

  const openDebugViewer = () => {
    const debugUrl = new URL(window.location.href);
    debugUrl.searchParams.set("mode", "debug");
    debugUrl.searchParams.set("channel", channelInput.trim() || envChannel);
    debugUrl.searchParams.set("autojoin", "1");
    window.open(debugUrl.toString(), "_blank", "noopener,noreferrer");
  };

  const interruptAgent = async () => {
    const api = conversationalApiRef.current;
    const currentAgentSession = agentSessionRef.current;

    if (!api || !currentAgentSession) {
      return;
    }

    try {
      await api.interrupt(currentAgentSession.agentUid);
      appendLog(`Interrupted agent ${currentAgentSession.agentUid}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to interrupt the agent.";
      setAgentError(message);
      appendLog(`Interrupt failed: ${message}`);
    }
  };

  return (
    <main className="page">
      <section className="hero card">
        <div>
          <p className="eyebrow">Agora Live Emotion Call</p>
          <h1>{isDebugMode ? "Debug Viewer" : "Interactive Voice Meeting"}</h1>
          <p className="summary">
            {isDebugMode
              ? "Subscribe in a separate tab to verify the audio and video feed that the broadcaster is actually sending."
              : "Join once, let Agora detect the end of each spoken turn, and have the voice agent answer back inside the meeting without recorder chunks or manual uploads."}
          </p>
        </div>

        <div className="session-panel">
          <label className="field">
            <span>Channel</span>
            <input
              value={channelInput}
              onChange={(event) => setChannelInput(event.target.value)}
              disabled={joined || connecting}
            />
          </label>

          <div className="actions">
            <button onClick={joinChannel} disabled={joined || connecting}>
              {connecting ? "Connecting..." : isDebugMode ? "Join Debug" : "Join Call"}
            </button>
            <button onClick={() => void leaveChannel()} disabled={!joined && !connecting}>
              Leave
            </button>
            {!isDebugMode ? (
              <button onClick={interruptAgent} className="secondary" disabled={!agentSession}>
                Interrupt Agent
              </button>
            ) : null}
            {!isDebugMode ? (
              <button onClick={openDebugViewer} className="ghost-button">
                Open Debug Tab
              </button>
            ) : null}
          </div>

          <dl className="meta-grid">
            <div>
              <dt>Mode</dt>
              <dd>{mode}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{joined ? "joined" : "idle"}</dd>
            </div>
            <div>
              <dt>Session source</dt>
              <dd>{session?.source ?? "not connected yet"}</dd>
            </div>
            <div>
              <dt>UID</dt>
              <dd>{String(session?.uid ?? "-")}</dd>
            </div>
          </dl>

          {connectionError ? <p className="error">{connectionError}</p> : null}
          {clientError ? <p className="error">{clientError}</p> : null}
        </div>
      </section>

      {!isDebugMode ? (
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>Emotion Steering</h2>
              <p>
                Pick one tone before joining or switch it mid-call. The app restarts the live
                agent with the new emotion while the RTC meeting stays connected.
              </p>
            </div>
            <div className={`status-pill ${agentState ? "status-pill-live" : ""}`}>{liveStatus}</div>
          </div>

          <div className="emotion-grid">
            {SUPPORTED_EMOTIONS.map((emotion) => (
              <button
                key={emotion}
                type="button"
                className={`emotion-chip ${selectedEmotion === emotion ? "emotion-chip-selected" : ""}`}
                onClick={() => setSelectedEmotion(emotion)}
              >
                {emotion}
              </button>
            ))}
          </div>

          <div className="agent-summary-grid">
            <article className="analysis-card">
              <p className="eyebrow">Active Emotion</p>
              <p className="analysis-response">{selectedEmotion}</p>
            </article>
            <article className="analysis-card">
              <p className="eyebrow">Agent State</p>
              <p className="analysis-response">{agentState ?? "not started"}</p>
            </article>
            <article className="analysis-card">
              <p className="eyebrow">Agent UID</p>
              <p className="analysis-response">{agentSession?.agentUid ?? "-"}</p>
            </article>
          </div>

          {agentError ? <p className="error">{agentError}</p> : null}
        </section>
      ) : null}

      {!isDebugMode ? (
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>Live Transcript</h2>
              <p>
                Transcript and response state now come from Agora RTM events instead of uploaded
                MediaRecorder chunks.
              </p>
            </div>
          </div>

          {latestAgentText ? (
            <div className="analysis-layout">
              <article className="analysis-card analysis-card-wide">
                <p className="eyebrow">Latest Agent Reply</p>
                <p className="transcript">{latestAgentText}</p>
              </article>
            </div>
          ) : (
            <p className="muted">No spoken reply yet. Join and speak naturally.</p>
          )}

          <div className="section-heading section-heading-tight">
            <div>
              <h2>Conversation Timeline</h2>
              <p>Sentence-level turns as they arrive from the Agora conversational agent.</p>
            </div>
          </div>

          <div className="timeline-list">
            {transcriptRows.length === 0 ? (
              <p className="muted">No transcript events yet.</p>
            ) : (
              transcriptRows.map((entry) => (
                <article key={entry.id} className={`timeline-card timeline-card-${entry.speaker}`}>
                  <div className="timeline-meta">
                    <strong>{entry.speaker === "agent" ? "Agent" : "You"}</strong>
                    <span>
                      {entry.createdAt} · {entry.status}
                    </span>
                  </div>
                  <p className="timeline-text">{entry.text}</p>
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}

      <section className="video-grid">
        <div className="card">
          <div className="section-heading">
            <div>
              <h2>Local Feed</h2>
              <p>
                {isDebugMode
                  ? "Debug viewer does not capture local media."
                  : "Your live camera preview while the Agora meeting and conversational agent stay active."}
              </p>
            </div>
          </div>
          <div ref={localContainerRef} className="video-stack empty-aware" />
        </div>

        <div className="card">
          <div className="section-heading">
            <div>
              <h2>Remote Feed</h2>
              <p>
                This shows what the other client, including the agent audio/video tracks, sends
                into the Agora channel.
              </p>
            </div>
          </div>
          <div ref={remoteContainerRef} className="video-stack empty-aware" />
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <h2>Debug Log</h2>
            <p>
              Lightweight event log for RTC join/publish flow, RTM subscription, and agent
              lifecycle events.
            </p>
          </div>
        </div>
        <div className="log-list">
          {logs.length === 0 ? (
            <p className="muted">No events yet.</p>
          ) : (
            logs.map((entry) => (
              <p key={entry} className="log-entry">
                {entry}
              </p>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
