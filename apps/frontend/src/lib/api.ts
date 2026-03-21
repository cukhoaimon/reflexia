export type AppMode = "broadcast" | "debug";

export type AgoraSession = {
  appId: string;
  channel: string;
  token: string | null;
  uid: number | string | null;
  source: string;
  useStringUid?: boolean;
  expiresInSeconds?: number;
};

export type AgoraAgentSession = {
  agent_id: string;
  create_ts?: number;
  status: string;
  agentUid: string;
  channel: string;
};

async function getErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}

export async function fetchAgoraSession(
  backendBaseUrl: string,
  requestedMode: AppMode,
  channelName: string
) {
  const url = new URL("/agora/session", backendBaseUrl);
  url.searchParams.set("channel", channelName);
  url.searchParams.set("role", requestedMode);

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as AgoraSession;
}

export async function startAgoraAgent(
  backendBaseUrl: string,
  options: {
    channel: string;
    uid: string;
    emotion: string;
  }
) {
  const url = new URL("/agora/agent/start", backendBaseUrl);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as AgoraAgentSession;
}

export async function stopAgoraAgent(backendBaseUrl: string, agentId: string) {
  const url = new URL(`/agora/agent/${agentId}/leave`, backendBaseUrl);
  const response = await fetch(url.toString(), {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as { status?: string };
}
