import { useEffect, useMemo, useRef, useState } from "react";
import AgoraRTC, { IAgoraRTCClient, IAgoraRTCRemoteUser, ICameraVideoTrack, IMicrophoneAudioTrack } from "agora-rtc-sdk-ng";
import { EmotionAvatarTile } from "./components/EmotionAvatarTile";
import { CallSetupPanel } from "./components/CallSetupPanel";
import { LiveResponsePanel } from "./components/LiveResponsePanel";
import { LocalCameraPreview } from "./components/LocalCameraPreview";
import { AnalysisResponse, AgoraSession, AppMode, fetchAgoraSession, requestAvatarSpeech, sendChatMessage } from "./lib/api";
import { EMOTIONS } from "./lib/constants";
import { SupportedEmotion } from "./lib/emotions";
import { TranscriptEntry } from "./lib/types";

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onstart: null | (() => void);
  onend: null | (() => void);
  onerror: null | ((event: { error?: string }) => void);
  onresult: null | ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void);
};

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition;

const envAppId = import.meta.env.VITE_AGORA_APP_ID ?? "";
const envChannel = import.meta.env.VITE_AGORA_CHANNEL ?? "emotalk";
const envToken = import.meta.env.VITE_AGORA_TOKEN || null;
const envUidRaw = import.meta.env.VITE_AGORA_UID;
const backendBaseUrl = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3000";

function parseEnvUid(rawUid: string | undefined) {
  if (!rawUid) return null;
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
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getAudioMeterSegments(level: number) {
  const normalizedLevel = Math.max(0, Math.min(level, 100));
  return Array.from({ length: 10 }, (_, index) => normalizedLevel >= (index + 1) * 10);
}

function normalizeTrackVolume(level: number) {
  return Math.max(0, Math.min(Math.round(level * 100), 100));
}

function App() {
  const mode = getModeFromLocation();
  const isDebugMode = mode === "debug";
  const autoJoin = shouldAutoJoin();
  const clientState = useMemo<{ client: IAgoraRTCClient | null; clientError: string | null }>(() => {
    try {
      return { client: AgoraRTC.createClient({ mode: "rtc", codec: "vp8" }), clientError: null };
    } catch (error) {
      return { client: null, clientError: error instanceof Error ? error.message : "Agora RTC failed to initialize." };
    }
  }, []);

  const client = clientState.client;
  const clientError = clientState.clientError;
  const localContainerRef = useRef<HTMLDivElement>(null);
  const cameraTrackRef = useRef<ICameraVideoTrack | null>(null);
  const micTrackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const recognitionRestartTimeoutRef = useRef<number | null>(null);
  const responseAudioRef = useRef<HTMLAudioElement | null>(null);
  const hasAutoJoinedRef = useRef(false);
  const selectedEmotionRef = useRef<SupportedEmotion>("joy");
  const joinedRef = useRef(false);
  const previousEmotionKeyRef = useRef("");

  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
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

  const appendLog = (message: string) => {
    setLogs((currentLogs) => [`${getTimeLabel()}  ${message}`, ...currentLogs].slice(0, 18));
  };

  const getSpeechRecognitionCtor = () => {
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };

    return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
  };

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
    renderEmptyState(
      localContainerRef.current,
      isDebugMode ? "Viewer mode" : "Local preview",
      isDebugMode
        ? "This tab subscribes only. Open the main screen to publish camera and microphone."
        : "Join the room to preview your own published camera."
    );
  };

  useEffect(() => {
    clearVideoContainers();
  }, [isDebugMode]);

  useEffect(() => {
    joinedRef.current = joined;
  }, [joined]);

  useEffect(() => {
    selectedEmotionRef.current = selectedEmotion;
  }, [selectedEmotion]);

  useEffect(() => {
    if (!client) return;

    const handleUserPublished = async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
      appendLog(`Remote user ${user.uid} published ${mediaType}.`);
      if (mediaType !== "audio") return;
      await client.subscribe(user, mediaType);
      if (user.audioTrack) {
        user.audioTrack.play();
      }
    };

    const removeRemoteUser = (user: IAgoraRTCRemoteUser) => {
      appendLog(`Remote user ${user.uid} left or unpublished.`);
      setRemoteAudioLevel(0);
    };

    const handleConnectionStateChange = (currentState: string, previousState: string) => {
      appendLog(`Connection ${previousState} -> ${currentState}.`);
    };

    const handleVolumeIndicator = (volumes: Array<{ uid: number | string; level: number }>) => {
      const ownUid = session?.uid;
      const localEntry = volumes.find((entry) => ownUid !== null && ownUid !== undefined && String(entry.uid) === String(ownUid));
      const remoteLevel = volumes
        .filter((entry) => ownUid === null || ownUid === undefined || String(entry.uid) !== String(ownUid))
        .reduce((maxLevel, entry) => Math.max(maxLevel, entry.level), 0);

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
    if (!joined) {
      setAudioSignalDetected(false);
      return;
    }

    setAudioSignalDetected(localAudioLevel > 0 || remoteAudioLevel > 0);
  }, [joined, localAudioLevel, remoteAudioLevel]);

  const clearRecognitionRestartTimeout = () => {
    if (recognitionRestartTimeoutRef.current !== null) {
      window.clearTimeout(recognitionRestartTimeoutRef.current);
      recognitionRestartTimeoutRef.current = null;
    }
  };

  const stopLiveListeningLoop = (statusMessage?: string) => {
    clearRecognitionRestartTimeout();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListeningLive(false);
    if (statusMessage) {
      setLiveStatus(statusMessage);
    }
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

  const playAvatarSpeech = async (text: string, emotion: SupportedEmotion) => {
    try {
      responseAudioRef.current?.pause();
      const audioBlob = await requestAvatarSpeech(backendBaseUrl, text, emotion);
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      responseAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        if (responseAudioRef.current === audio) {
          responseAudioRef.current = null;
        }
      };
      await audio.play();
    } catch (speechErr) {
      appendLog(`Avatar speech failed: ${speechErr instanceof Error ? speechErr.message : "unknown error"}`);
    }
  };

  const sendTranscript = async (transcript: string, emotion: SupportedEmotion) => {
    const chunkId = `${Date.now()}`;

    try {
      setIsAnalyzing(true);
      setAnalysisError(null);
      setLiveStatus(`Sending transcript for ${emotion}.`);
      appendLog(`Sending transcript to backend: "${transcript}"`);

      const result = await sendChatMessage(backendBaseUrl, transcript, emotion, conversationSessionId ?? undefined);

      setConversationSessionId(result.sessionId ?? null);
      setAnalysisResult({
        transcript,
        emotion: result.emotion,
        reply: result.reply,
        sessionId: result.sessionId,
        toolEvents: result.toolEvents,
      });
      setTranscriptEntries((currentEntries) => [
        { id: chunkId, createdAt: getTimeLabel(), transcript, emotion },
        ...currentEntries,
      ].slice(0, 6));
      appendLog(`Live response updated for ${emotion}.`);
      void playAvatarSpeech(result.reply, emotion);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Live text analysis failed.";
      setAnalysisError(message);
      appendLog(`Live analysis failed: ${message}`);
    } finally {
      setIsAnalyzing(false);
      if (!joinedRef.current || !micTrackRef.current?.enabled || isDebugMode) {
        setIsListeningLive(false);
        return;
      }
      setLiveStatus(`Listening live for ${emotion}.`);
    }
  };

  const startLiveListening = () => {
    if (!joinedRef.current || !micTrackRef.current?.enabled || isDebugMode) return;
    if (recognitionRef.current) return;

    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) {
      setAnalysisError("This browser does not support live speech recognition.");
      stopLiveListeningLoop("Live speech recognition is unavailable in this browser.");
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsListeningLive(true);
      setLiveStatus(`Listening live for ${selectedEmotionRef.current}.`);
      appendLog("Speech recognition started.");
    };

    recognition.onerror = (event) => {
      const message = event.error || "speech-recognition-error";
      setAnalysisError(`Speech recognition failed: ${message}`);
      appendLog(`Speech recognition failed: ${message}`);
    };

    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result?.isFinal) continue;
        const transcript = result[0]?.transcript?.trim();
        if (!transcript) continue;
        void sendTranscript(transcript, selectedEmotionRef.current);
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (!joinedRef.current || !micTrackRef.current?.enabled || isDebugMode) {
        setIsListeningLive(false);
        return;
      }

      clearRecognitionRestartTimeout();
      recognitionRestartTimeoutRef.current = window.setTimeout(() => {
        startLiveListening();
      }, 250);
    };

    recognition.start();
  };

  const leaveChannel = async () => {
    try {
      if (!client) throw new Error(clientError || "Agora RTC client is unavailable.");
      stopLiveListeningLoop();
      responseAudioRef.current?.pause();
      responseAudioRef.current = null;
      cleanupLocalTracks();
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
    return () => {
      void leaveChannel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveSession = async (requestedMode: AppMode, channelName: string) => {
    try {
      return await fetchAgoraSession(backendBaseUrl, requestedMode, channelName);
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Request to backend session endpoint failed.";
      appendLog(`Backend session endpoint failed: ${message}`);
    }

    if (!envAppId) throw new Error("Missing Agora config. Set AGORA_APP_ID on the backend or VITE_AGORA_APP_ID in the frontend.");

    return {
      appId: envAppId,
      channel: channelName,
      token: envToken,
      uid: parseEnvUid(envUidRaw),
      source: "frontend-env",
    } satisfies AgoraSession;
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
      resetAnalysisState();
      appendLog(`Publishing mic + camera to channel ${nextSession.channel} as ${joinedUid}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to join channel.";
      setConnectionError(message);
      appendLog(`Join failed: ${message}`);
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
    if (!isDebugMode || !autoJoin || hasAutoJoinedRef.current) return;
    hasAutoJoinedRef.current = true;
    void joinChannel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoin, isDebugMode]);

  useEffect(() => {
    if (isDebugMode || !joined || !micTrackRef.current || !micEnabled) {
      stopLiveListeningLoop(joined ? "Enable the microphone to continue live listening." : "Join the channel to start live listening.");
      setIsListeningLive(false);
      return;
    }

    setAnalysisError(null);
    setLiveStatus(`Listening live for ${selectedEmotion}.`);
    appendLog(`Live listening started for ${selectedEmotion}.`);
    startLiveListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDebugMode, joined, micEnabled, selectedEmotion]);

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
    if (!cameraTrackRef.current) {
      setConnectionError("Join the channel before toggling the camera.");
      return;
    }

    const nextEnabled = !cameraTrackRef.current.enabled;
    await cameraTrackRef.current.setEnabled(nextEnabled);
    setCameraEnabled(nextEnabled);
    appendLog(nextEnabled ? "Camera enabled." : "Camera disabled.");

    if (nextEnabled) {
      renderLocalPreview(cameraTrackRef.current);
    } else {
      renderEmptyState(localContainerRef.current, "Camera off", "Turn the camera back on to resume the local preview.");
    }
  };

  const toggleMic = async () => {
    if (!micTrackRef.current) {
      setConnectionError("Join the channel before toggling the microphone.");
      return;
    }

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
