import { useEffect, useMemo, useRef, useState } from "react";
import AgoraRTC, { IAgoraRTCClient, IAgoraRTCRemoteUser, ICameraVideoTrack, IMicrophoneAudioTrack } from "agora-rtc-sdk-ng";
import { EmotionAvatarTile } from "./components/EmotionAvatarTile";
import { CallSetupPanel } from "./components/CallSetupPanel";
import { LiveResponsePanel } from "./components/LiveResponsePanel";
import { LocalCameraPreview } from "./components/LocalCameraPreview";
import { AnalysisResponse, AgoraSession, AgoraAgentSession, AppMode, analyzeLiveAudio, fetchAgoraSession, requestAvatarSpeech, startAgoraAgent, stopAgoraAgent } from "./lib/api";
import AgoraRTM from "agora-rtm";
import { ConversationalAIAPI, ETranscriptHelperMode, EConversationalAIAPIEvents } from "./lib/conversational-ai-api";
import type { TStateChangeEvent, TModuleError, ITranscriptHelperItem, IUserTranscription, IAgentTranscription } from "./lib/conversational-ai-api";
import { EMOTIONS, LIVE_CHUNK_DURATION_MS, LIVE_CHUNK_GAP_MS, MIN_ANALYSIS_BLOB_SIZE_BYTES } from "./lib/constants";
import { SupportedEmotion } from "./lib/emotions";
import { TranscriptEntry } from "./lib/types";

const envAppId = import.meta.env.VITE_AGORA_APP_ID ?? "";
const envChannel = import.meta.env.VITE_AGORA_CHANNEL ?? "emotalk";
const envToken = import.meta.env.VITE_AGORA_TOKEN || null;
const envUidRaw = import.meta.env.VITE_AGORA_UID;
const backendBaseUrl = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3000";

function parseEnvUid(rawUid: string | undefined) { if (!rawUid) return null; const numericUid = Number(rawUid); return Number.isNaN(numericUid) ? rawUid : numericUid; }
function getModeFromLocation(): AppMode { const searchParams = new URLSearchParams(window.location.search); return searchParams.get("mode") === "debug" ? "debug" : "broadcast"; }
function getChannelFromLocation() { const searchParams = new URLSearchParams(window.location.search); return searchParams.get("channel") || envChannel; }
function shouldAutoJoin() { const searchParams = new URLSearchParams(window.location.search); return searchParams.get("autojoin") === "1"; }
function getTimeLabel() { return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function getSupportedLiveAudioMimeType() { const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]; return mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? ""; }
function getLiveAudioExtension(mimeType: string) { return mimeType.includes("mp4") ? "mp4" : "webm"; }
function getAudioMeterSegments(level: number) { const normalizedLevel = Math.max(0, Math.min(level, 100)); return Array.from({ length: 10 }, (_, index) => normalizedLevel >= (index + 1) * 10); }
function normalizeTrackVolume(level: number) { return Math.max(0, Math.min(Math.round(level * 100), 100)); }

function App() {
  const mode = getModeFromLocation();
  const isDebugMode = mode === "debug";
  const autoJoin = shouldAutoJoin();
  const clientState = useMemo<{ client: IAgoraRTCClient | null; clientError: string | null }>(() => {
    try { return { client: AgoraRTC.createClient({ mode: "rtc", codec: "vp8" }), clientError: null }; }
    catch (error) { return { client: null, clientError: error instanceof Error ? error.message : "Agora RTC failed to initialize." }; }
  }, []);
  const client = clientState.client;
  const clientError = clientState.clientError;
  const localContainerRef = useRef<HTMLDivElement>(null);
  const cameraTrackRef = useRef<ICameraVideoTrack | null>(null);
  const micTrackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const agentSessionRef = useRef<AgoraAgentSession | null>(null);
  const rtmClientRef = useRef<InstanceType<typeof AgoraRTM.RTM> | null>(null);
  const hasAutoJoinedRef = useRef(false);
  const selectedEmotionRef = useRef<SupportedEmotion>("joy");
  const joinedRef = useRef(false);
  const liveAudioStreamRef = useRef<MediaStream | null>(null);
  const liveRecorderRef = useRef<MediaRecorder | null>(null);
  const liveChunkPartsRef = useRef<Blob[]>([]);
  const liveChunkTimeoutRef = useRef<number | null>(null);
  const liveLoopEnabledRef = useRef(false);
  const liveRequestSequenceRef = useRef(0);
  const previousEmotionKeyRef = useRef("");
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentSession, setAgentSession] = useState<AgoraAgentSession | null>(null);
  const [agentState, setAgentState] = useState<string>("idle");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [session, setSession] = useState<AgoraSession | null>(null);
  const [channelInput, setChannelInput] = useState(getChannelFromLocation());
  const [cameraTrack, setCameraTrack] = useState<ICameraVideoTrack | null>(null);
  const [micTrack, setMicTrack] = useState<IMicrophoneAudioTrack | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [selectedEmotion, setSelectedEmotion] = useState<SupportedEmotion>("joy");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isListeningLive, setIsListeningLive] = useState(false);
  const [liveStatus, setLiveStatus] = useState("Join the channel to start live listening.");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(null);
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);
  const [conversationSessionId, setConversationSessionId] = useState<string | null>(null);
  const [localAudioLevel, setLocalAudioLevel] = useState(0);
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0);
  const [audioSignalDetected, setAudioSignalDetected] = useState(false);
  const currentEmotion = EMOTIONS.find((emotion) => emotion.key === selectedEmotion) ?? EMOTIONS[0];
  const localMeterSegments = getAudioMeterSegments(localAudioLevel);
  const avatarSignalLevel = Math.max(localAudioLevel, remoteAudioLevel);
  const avatarMeterSegments = getAudioMeterSegments(avatarSignalLevel);
  const micStatus = !joined ? "offline" : !micEnabled ? "muted" : localAudioLevel > 8 ? "speaking" : "live";
  const avatarStageStatus = !joined ? "idle" : audioSignalDetected ? "live" : isAnalyzing ? "tracking" : "ready";
  const combinedError = connectionError || analysisError || clientError;

  const appendLog = (message: string) => setLogs((currentLogs) => [`${getTimeLabel()}  ${message}`, ...currentLogs].slice(0, 18));
  const renderEmptyState = (container: HTMLDivElement | null, title: string, message: string, accentClass = "") => {
    if (!container) return;
    container.innerHTML = "";
    const emptyState = document.createElement("div");
    emptyState.className = `video-placeholder ${accentClass}`.trim();
    emptyState.innerHTML = `<strong>${title}</strong><p>${message}</p>`;
    container.appendChild(emptyState);
  };
  const renderLocalPreview = (track: ICameraVideoTrack) => {
    if (!localContainerRef.current) return;
    localContainerRef.current.innerHTML = "";
    const player = document.createElement("div");
    player.className = "agora-player local-player";
    localContainerRef.current.appendChild(player);
    track.play(player);
  };
  const clearVideoContainers = () => {
    renderEmptyState(localContainerRef.current, isDebugMode ? "Viewer mode" : "Local preview", isDebugMode ? "This tab subscribes only. Open the main screen to publish camera and microphone." : "Join the room to preview your own published camera.");
  };

  useEffect(() => { clearVideoContainers(); }, [isDebugMode]);
  useEffect(() => { joinedRef.current = joined; }, [joined]);
  useEffect(() => { selectedEmotionRef.current = selectedEmotion; }, [selectedEmotion]);

  useEffect(() => {
    if (!client) return;
    const handleUserPublished = async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
      appendLog(`Remote user ${user.uid} published ${mediaType}.`);
      if (mediaType !== "audio") return;
      await client.subscribe(user, mediaType);
      if (user.audioTrack) user.audioTrack.play();
    };
    const removeRemoteUser = (user: IAgoraRTCRemoteUser) => {
      appendLog(`Remote user ${user.uid} left or unpublished.`);
      setRemoteAudioLevel(0);
    };
    const handleConnectionStateChange = (currentState: string, previousState: string) => appendLog(`Connection ${previousState} -> ${currentState}.`);
    const handleVolumeIndicator = (volumes: Array<{ uid: number | string; level: number }>) => {
      const ownUid = session?.uid;
      const localEntry = volumes.find((entry) => ownUid !== null && ownUid !== undefined && String(entry.uid) === String(ownUid));
      const remoteLevel = volumes.filter((entry) => ownUid === null || ownUid === undefined || String(entry.uid) !== String(ownUid)).reduce((maxLevel, entry) => Math.max(maxLevel, entry.level), 0);
      setRemoteAudioLevel(remoteLevel);
      setAudioSignalDetected((localEntry?.level ?? 0) > 0 || remoteLevel > 0);
    };
    client.on("user-published", handleUserPublished);
    client.on("user-unpublished", removeRemoteUser);
    client.on("user-left", removeRemoteUser);
    client.on("connection-state-change", handleConnectionStateChange);
    client.on("volume-indicator", handleVolumeIndicator);
    return () => {
      client.off("user-published", handleUserPublished);
      client.off("user-unpublished", removeRemoteUser);
      client.off("user-left", removeRemoteUser);
      client.off("connection-state-change", handleConnectionStateChange);
      client.off("volume-indicator", handleVolumeIndicator);
    };
  }, [client, session?.uid]);

  useEffect(() => {
    if (!micTrack || !joined || isDebugMode) return;
    const intervalId = window.setInterval(() => {
      const nextLevel = normalizeTrackVolume(micTrack.getVolumeLevel());
      setLocalAudioLevel(nextLevel);
      setAudioSignalDetected((currentDetected) => currentDetected || nextLevel > 0);
    }, 200);
    return () => window.clearInterval(intervalId);
  }, [isDebugMode, joined, micTrack]);

  useEffect(() => {
    if (!joined) { setAudioSignalDetected(false); return; }
    setAudioSignalDetected(localAudioLevel > 0 || remoteAudioLevel > 0);
  }, [joined, localAudioLevel, remoteAudioLevel]);

  const clearLiveAudioStream = () => { liveAudioStreamRef.current?.getTracks().forEach((track) => track.stop()); liveAudioStreamRef.current = null; };
  const clearLiveChunkTimeout = () => {
    if (liveChunkTimeoutRef.current !== null) { window.clearTimeout(liveChunkTimeoutRef.current); liveChunkTimeoutRef.current = null; }
  };
  const stopLiveListeningLoop = (statusMessage?: string) => {
    liveLoopEnabledRef.current = false;
    clearLiveChunkTimeout();
    const recorder = liveRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else { clearLiveAudioStream(); liveRecorderRef.current = null; }
    liveChunkPartsRef.current = [];
    setIsListeningLive(false);
    if (statusMessage) setLiveStatus(statusMessage);
  };
  const resetAnalysisState = () => {
    setTranscriptEntries([]);
    setAnalysisResult(null);
    setConversationSessionId(null);
  };
  const cleanupLocalTracks = () => {
    cameraTrackRef.current?.stop();
    cameraTrackRef.current?.close();
    micTrackRef.current?.stop();
    micTrackRef.current?.close();
    cameraTrackRef.current = null;
    micTrackRef.current = null;
    setCameraTrack(null);
    setMicTrack(null);
    setCameraEnabled(false);
    setMicEnabled(false);
    setLocalAudioLevel(0);
    setRemoteAudioLevel(0);
    setAudioSignalDetected(false);
  };

  const sendLiveAudioChunk = async (audioBlob: Blob, mimeType: string, emotion: SupportedEmotion) => {
    const chunkId = `${Date.now()}`;
    const requestId = ++liveRequestSequenceRef.current;
    const file = new File([audioBlob], `emotalk-live-${chunkId}.${getLiveAudioExtension(mimeType)}`, { type: mimeType });
    try {
      setIsAnalyzing(true);
      setAnalysisError(null);
      setLiveStatus(`Analyzing live speech for ${emotion}.`);
      const result = await analyzeLiveAudio(backendBaseUrl, file, emotion, conversationSessionId ?? undefined);
      if (requestId !== liveRequestSequenceRef.current) return;
      if (result === null) return;
      setConversationSessionId(result.sessionId ?? null);
      setAnalysisResult(result);
      setTranscriptEntries((currentEntries) => [{ id: chunkId, createdAt: getTimeLabel(), transcript: result.transcript, emotion }, ...currentEntries].slice(0, 6));
      appendLog(`Live response updated for ${emotion}.`);
      try {
        const audioBlob = await requestAvatarSpeech(backendBaseUrl, result.reply, emotion);
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.onended = () => URL.revokeObjectURL(audioUrl);
        await audio.play();
      } catch (speechErr) {
        appendLog(`Avatar speech failed: ${speechErr instanceof Error ? speechErr.message : "unknown error"}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Live audio analysis failed.";
      setAnalysisError(message);
      appendLog(`Live analysis failed: ${message}`);
    } finally {
      setIsAnalyzing(false);
      if (!liveLoopEnabledRef.current || !joinedRef.current || !selectedEmotionRef.current) {
        setIsListeningLive(false);
        return;
      }
      window.setTimeout(() => { void startLiveListeningChunk(); }, LIVE_CHUNK_GAP_MS);
    }
  };

  async function startLiveListeningChunk() {
    if (!liveLoopEnabledRef.current || !joinedRef.current || !micTrackRef.current) return;
    const mimeType = getSupportedLiveAudioMimeType();
    if (!mimeType) {
      setAnalysisError("This browser does not support live audio chunk recording for analysis.");
      stopLiveListeningLoop("Live listening is unavailable in this browser.");
      return;
    }
    const emotion = selectedEmotionRef.current;
    if (!emotion) { stopLiveListeningLoop("Pick one emotion to start live listening."); return; }
    clearLiveAudioStream();
    liveChunkPartsRef.current = [];
    const audioStream = new MediaStream([micTrackRef.current.getMediaStreamTrack().clone()]);
    const recorder = new MediaRecorder(audioStream, { mimeType });
    liveAudioStreamRef.current = audioStream;
    liveRecorderRef.current = recorder;
    setIsListeningLive(true);
    setLiveStatus(`Listening live for ${emotion}.`);
    recorder.ondataavailable = (event) => { if (event.data.size > 0) liveChunkPartsRef.current.push(event.data); };
    recorder.onerror = () => {
      setAnalysisError("MediaRecorder failed during live listening.");
      stopLiveListeningLoop("Live listening stopped after a recorder error.");
    };
    recorder.onstop = () => {
      clearLiveChunkTimeout();
      const parts = liveChunkPartsRef.current;
      liveChunkPartsRef.current = [];
      liveRecorderRef.current = null;
      clearLiveAudioStream();
      if (!liveLoopEnabledRef.current || !joinedRef.current) { setIsListeningLive(false); return; }
      const nextEmotion = selectedEmotionRef.current;
      const audioBlob = new Blob(parts, { type: mimeType });
      if (audioBlob.size < MIN_ANALYSIS_BLOB_SIZE_BYTES) {
        setLiveStatus("Listening for speech...");
        window.setTimeout(() => { void startLiveListeningChunk(); }, LIVE_CHUNK_GAP_MS);
        return;
      }
      if (!nextEmotion) { stopLiveListeningLoop("Pick one emotion to start live listening."); return; }
      void sendLiveAudioChunk(audioBlob, mimeType, nextEmotion);
    };
    recorder.start();
    liveChunkTimeoutRef.current = window.setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, LIVE_CHUNK_DURATION_MS);
  }

  const leaveChannel = async () => {
    try {
      if (!client) throw new Error(clientError || "Agora RTC client is unavailable.");
      cleanupLocalTracks();
      clearVideoContainers();

      // Stop agent (best-effort)
      if (agentSessionRef.current) {
        try { await stopAgoraAgent(backendBaseUrl, agentSessionRef.current.agent_id); } catch { /* best-effort */ }
        agentSessionRef.current = null;
        setAgentSession(null);
      }

      // Cleanup ConversationalAI (best-effort)
      try { const convAI = ConversationalAIAPI.getInstance(); convAI.unsubscribe(); convAI.destroy(); } catch { /* not initialized */ }

      // Cleanup RTM (best-effort)
      if (rtmClientRef.current) {
        try { await rtmClientRef.current.logout(); } catch { /* best-effort */ }
        rtmClientRef.current = null;
      }

      await client.leave();
      setJoined(false);
      setSession(null);
      resetAnalysisState();
      appendLog("Left the Agora channel.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to leave channel.";
      setConnectionError(message);
    }
  };

  useEffect(() => {
    return () => { void leaveChannel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveSession = async (requestedMode: AppMode, channelName: string) => {
    try { return await fetchAgoraSession(backendBaseUrl, requestedMode, channelName); }
    catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Request to backend session endpoint failed.";
      appendLog(`Backend session endpoint failed: ${message}`);
    }
    if (!envAppId) throw new Error("Missing Agora config. Set AGORA_APP_ID on the backend or VITE_AGORA_APP_ID in the frontend.");
    return { appId: envAppId, channel: channelName, token: envToken, uid: parseEnvUid(envUidRaw), source: "frontend-env" } satisfies AgoraSession;
  };

  const joinChannel = async () => {
    if (connecting || joined) return;
    try {
      if (!client) throw new Error(clientError || "Agora RTC client is unavailable.");
      setConnecting(true);
      setConnectionError(null);
      setAnalysisError(null);
      const nextSession = await resolveSession(mode, channelInput.trim() || envChannel);
      appendLog(`Using Agora session from ${nextSession.source}.`);
      client.enableAudioVolumeIndicator();
      const joinedUid = await client.join(nextSession.appId, nextSession.channel, nextSession.token, nextSession.uid);
      if (isDebugMode) {
        setSession({ ...nextSession, uid: joinedUid });
        setJoined(true);
        appendLog(`Joined debug viewer for channel ${nextSession.channel} as ${joinedUid}.`);
        return;
      }
      const [microphoneTrack, nextCameraTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
      micTrackRef.current = microphoneTrack;
      cameraTrackRef.current = nextCameraTrack;
      setMicTrack(microphoneTrack);
      setCameraTrack(nextCameraTrack);
      setMicEnabled(microphoneTrack.enabled);
      setCameraEnabled(nextCameraTrack.enabled);
      await client.publish([microphoneTrack, nextCameraTrack]);
      renderLocalPreview(nextCameraTrack);
      setSession({ ...nextSession, uid: joinedUid });
      setJoined(true);

      // Start agent + RTM (non-fatal — call still proceeds if this fails)
      try {
        const agentSess = await startAgoraAgent(backendBaseUrl, {
          channel: nextSession.channel,
          uid: String(joinedUid),
          emotion: selectedEmotionRef.current,
        });
        agentSessionRef.current = agentSess;
        setAgentSession(agentSess);
        appendLog(`Agent started as uid ${agentSess.agentUid}.`);

        const rtmClient = new AgoraRTM.RTM(nextSession.appId, String(joinedUid));
        await rtmClient.login({ token: nextSession.token ?? undefined });
        await rtmClient.subscribe(nextSession.channel);
        rtmClientRef.current = rtmClient;

        const convAI = ConversationalAIAPI.init({
          rtcEngine: client,
          rtmEngine: rtmClient,
          renderMode: ETranscriptHelperMode.WORD,
          enableLog: true,
        });
        convAI.on(EConversationalAIAPIEvents.AGENT_STATE_CHANGED, (_uid: string, event: TStateChangeEvent) => {
          setAgentState(event.state);
          appendLog(`Agent state: ${event.state}`);
        });
        convAI.on(EConversationalAIAPIEvents.TRANSCRIPT_UPDATED, (history: ITranscriptHelperItem<Partial<IUserTranscription | IAgentTranscription>>[]) => {
          const last = history[history.length - 1];
          if (last) {
            setTranscriptEntries((prev) =>
              [{ id: String(Date.now()), createdAt: getTimeLabel(), transcript: last.text ?? "", emotion: selectedEmotionRef.current }, ...prev].slice(0, 6)
            );
          }
        });
        convAI.on(EConversationalAIAPIEvents.AGENT_ERROR, (_uid: string, err: TModuleError) => {
          setAgentError(err.message);
          appendLog(`Agent error: ${err.message}`);
        });
        convAI.subscribeMessage(nextSession.channel);
      } catch (agentErr) {
        appendLog(`Agent/RTM init failed (call continues): ${agentErr instanceof Error ? agentErr.message : "unknown error"}`);
      }

      resetAnalysisState();
      appendLog(`Publishing mic + camera to channel ${nextSession.channel} as ${joinedUid}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to join channel.";
      setConnectionError(message);
      appendLog(`Join failed: ${message}`);
      cleanupLocalTracks();
      if (client) { try { await client.leave(); } catch { /* Best-effort cleanup. */ } }
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    if (!isDebugMode || !autoJoin || hasAutoJoinedRef.current) return;
    hasAutoJoinedRef.current = true;
    void joinChannel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoin, isDebugMode]);

  useEffect(() => {
    if (isDebugMode) return;
    if (!joined || !micTrackRef.current) {
      setIsListeningLive(false);
      setLiveStatus("Join the channel to start live listening.");
      return;
    }
    if (liveLoopEnabledRef.current) return;
    liveLoopEnabledRef.current = true;
    setAnalysisError(null);
    setLiveStatus(`Listening live for ${selectedEmotion}.`);
    appendLog(`Live listening started for ${selectedEmotion}.`);
    void startLiveListeningChunk();
  }, [isDebugMode, joined, selectedEmotion]);

  useEffect(() => {
    const emotionKey = selectedEmotion;
    if (emotionKey === previousEmotionKeyRef.current) return;
    previousEmotionKeyRef.current = emotionKey;
    if (isDebugMode) return;
    if (joined) {
      appendLog(`Live emotion updated: ${selectedEmotion}.`);
      setLiveStatus(`Listening live for ${selectedEmotion}.`);
    }
  }, [isDebugMode, joined, selectedEmotion]);

  const toggleCamera = async () => {
    if (!cameraTrackRef.current) { setConnectionError("Join the channel before toggling the camera."); return; }
    const nextEnabled = !cameraTrackRef.current.enabled;
    await cameraTrackRef.current.setEnabled(nextEnabled);
    setCameraEnabled(nextEnabled);
    appendLog(nextEnabled ? "Camera enabled." : "Camera disabled.");
    if (nextEnabled) renderLocalPreview(cameraTrackRef.current);
    else renderEmptyState(localContainerRef.current, "Camera off", "Turn the camera back on to resume the local preview.");
  };

  const toggleMic = async () => {
    if (!micTrackRef.current) { setConnectionError("Join the channel before toggling the microphone."); return; }
    const nextEnabled = !micTrackRef.current.enabled;
    await micTrackRef.current.setEnabled(nextEnabled);
    setMicEnabled(nextEnabled);
    appendLog(nextEnabled ? "Microphone enabled." : "Microphone muted.");
  };

  const openDebugViewer = () => {
    const debugUrl = new URL(window.location.href);
    debugUrl.searchParams.set("mode", "debug");
    debugUrl.searchParams.set("channel", channelInput.trim() || envChannel);
    debugUrl.searchParams.set("autojoin", "1");
    window.open(debugUrl.toString(), "_blank", "noopener,noreferrer");
  };

  const selectEmotion = (emotion: SupportedEmotion) => {
    setAnalysisError(null);
    setSelectedEmotion(emotion);
  };

  void agentError; // used for future agent error surfacing
  void agentSession; // used for future agent session surfacing
  void agentState; // used for future agent state surfacing

  return (
    <main className="app-shell">
      <section className="hero-bar">
        <div className="hero-copy-block">
          <p className="eyebrow">Emotion Call</p>
          <h1>Emotion Call Studio</h1>
          <p className="hero-copy">Join once, keep talking naturally, and let the app continuously transcribe live speech into emotion-shaped replies.</p>
        </div>
      </section>
      <section className="meet-shell">
        <div className="stage-grid">
          <LocalCameraPreview
            containerRef={localContainerRef}
            joined={joined}
            cameraEnabled={cameraEnabled}
            micEnabled={micEnabled}
            micStatus={micStatus}
            localAudioLevel={localAudioLevel}
            localMeterSegments={localMeterSegments}
          />
          <EmotionAvatarTile
            currentEmotion={currentEmotion}
            selectedEmotion={selectedEmotion}
            audioSignalDetected={audioSignalDetected}
            avatarStageStatus={avatarStageStatus}
            avatarSignalLevel={avatarSignalLevel}
            avatarMeterSegments={avatarMeterSegments}
            joined={joined}
            session={session}
            channelInput={channelInput}
            onSelectEmotion={selectEmotion}
          />
        </div>
        <aside className="control-rail">
          <CallSetupPanel
            channelInput={channelInput}
            joined={joined}
            connecting={connecting}
            cameraEnabled={cameraEnabled}
            micEnabled={micEnabled}
            cameraTrack={cameraTrack}
            micTrack={micTrack}
            isDebugMode={isDebugMode}
            mode={mode}
            session={session}
            isListeningLive={isListeningLive}
            currentEmotion={currentEmotion}
            combinedError={combinedError}
            onChannelInputChange={setChannelInput}
            onJoin={() => void joinChannel()}
            onLeave={() => void leaveChannel()}
            onToggleCamera={() => void toggleCamera()}
            onToggleMic={() => void toggleMic()}
            onOpenDebugViewer={openDebugViewer}
          />
          {!isDebugMode ? (
            <LiveResponsePanel
              analysisResult={analysisResult}
              transcriptEntries={transcriptEntries}
              isAnalyzing={isAnalyzing}
              liveStatus={liveStatus}
            />
          ) : null}
        </aside>
      </section>
    </main>
  );
}

export default App;
