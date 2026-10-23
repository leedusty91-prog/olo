import { deviceTimeZone } from "./daytime";
import { fetch as expoFetch } from "expo/fetch";

export const PLACEHOLDER_BASE = "http://<your-server-host>:8000";
export const CLEARTEXT_WARNING =
  "只在自己家的 Wi-Fi 使用。咖啡馆、公司访客网络和任何你不控制的局域网都会看到 token 和聊天内容。换 token 也挡不住正在被听的明文。";
export const UNPERSISTED_NOTE = "这句没记下，但我先回你";
export const MEMORY_BANNER = "我还想不起以前的事，但这会儿听得见你";
export const MAX_VOICE_MS = 60_000;

export type Settings = {
  baseUrl: string;
  token: string;
  allowCleartext: boolean;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  pending?: boolean;
  notice?: string;
  hasAudio?: boolean;
};

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

export function clientMsgId(): string {
  let out = "";
  for (let i = 0; i < 16; i += 1) {
    out += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return out;
}

export function assertBaseAllowed(baseUrl: string, allowCleartext: boolean): void {
  const trimmed = baseUrl.trim();
  if (!trimmed || trimmed === PLACEHOLDER_BASE) {
    throw new Error("先在设置里填写这台 Mac 的 https 地址");
  }
  if (trimmed.startsWith("http://") && !allowCleartext) {
    throw new Error("明文地址被拒绝。只有打开允许明文之后才能用 http://");
  }
  if (!trimmed.startsWith("https://") && !trimmed.startsWith("http://")) {
    throw new Error("地址要以 https:// 开头");
  }
}

type TurnJson = {
  user_message?: { id?: string; body?: string };
  assistant_message?: { id?: string; body?: string; segments?: string[] };
  degraded?: string | null;
  persisted?: boolean;
  banner?: string | null;
};

export async function postTurn(
  settings: Settings,
  sessionId: string,
  body: { text?: string; audio?: { uri: string; type: string; name: string } },
): Promise<TurnJson> {
  assertBaseAllowed(settings.baseUrl, settings.allowCleartext);
  const url = `${settings.baseUrl.replace(/\/$/, "")}/v1/sessions/${sessionId}/turns`;
  const clientMsg = clientMsgId();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${settings.token}`,
    Accept: "application/json",
  };
  let response: Response;
  if (body.audio) {
    const form = new FormData();
    form.append("client_msg_id", clientMsg);
    form.append("audio", {
      uri: body.audio.uri,
      type: body.audio.type,
      name: body.audio.name,
    } as unknown as Blob);
    response = await fetch(url, { method: "POST", headers, body: form });
  } else {
    headers["Content-Type"] = "application/json";
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ client_msg_id: clientMsg, text: body.text ?? "" }),
    });
  }
  const payload = (await response.json()) as TurnJson & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload.error?.message || `请求失败 ${response.status}`);
  }
  return payload;
}

export function bannerFor(payload: TurnJson): string | undefined {
  if (payload.banner) return payload.banner;
  if (payload.degraded === "voicemem_warming" || payload.degraded === "voicemem_unavailable") {
    return MEMORY_BANNER;
  }
  return undefined;
}

export type NotebookEntry = {
  id: string;
  entry_date: string;
  kind: string;
  title: string;
  body: string;
  image_prompt: string | null;
  image_relpath: string | null;
  created_at: string;
  mood?: string | null;
};

export type Insight = {
  id: string;
  category: string;
  body: string;
  stars: number;
  created_at: string;
};

type ErrorBody = { error?: { message?: string } };

function requestUrl(settings: Settings, path: string): string {
  assertBaseAllowed(settings.baseUrl, settings.allowCleartext);
  return `${settings.baseUrl.replace(/\/$/, "")}${path}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & ErrorBody;
  if (!response.ok) {
    throw new Error(payload.error?.message || `请求失败 ${response.status}`);
  }
  return payload;
}

export async function fetchNotebook(settings: Settings, limit = 20): Promise<NotebookEntry[]> {
  const response = await fetch(requestUrl(settings, `/v1/notebook?limit=${limit}`), {
    headers: { Authorization: `Bearer ${settings.token}`, Accept: "application/json" },
  });
  const payload = await readJson<{ entries: NotebookEntry[] }>(response);
  return payload.entries;
}

export async function generateNotebook(
  settings: Settings,
  sessionId?: string,
): Promise<NotebookEntry> {
  const response = await fetch(requestUrl(settings, "/v1/notebook/generate"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(sessionId ? { session_id: sessionId } : {}),
  });
  return readJson<NotebookEntry>(response);
}

export async function fetchInsights(settings: Settings, limit = 20): Promise<Insight[]> {
  const response = await fetch(requestUrl(settings, `/v1/insights?limit=${limit}`), {
    headers: { Authorization: `Bearer ${settings.token}`, Accept: "application/json" },
  });
  const payload = await readJson<{ insights: Insight[] }>(response);
  return payload.insights;
}

export async function generateInsight(settings: Settings, sessionId?: string): Promise<Insight> {
  const response = await fetch(requestUrl(settings, "/v1/insights/generate"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(sessionId ? { session_id: sessionId } : {}),
  });
  return readJson<Insight>(response);
}

export function notebookImageSource(
  settings: Settings,
  entryId: string,
): { uri: string; headers: Record<string, string> } {
  return {
    uri: requestUrl(settings, `/v1/notebook/${entryId}/image`),
    headers: { Authorization: `Bearer ${settings.token}` },
  };
}

export type Milestone = { key: string; label: string; reached: boolean };

export type GardenState = {
  level: number;
  max_level: number;
  growth: number;
  score: number;
  next_level_score: number | null;
  messages: number;
  entries: number;
  insights: number;
  days: number;
  milestones: Milestone[];
};

export async function fetchGarden(settings: Settings): Promise<GardenState> {
  const response = await fetch(requestUrl(settings, "/v1/garden"), {
    headers: { Authorization: `Bearer ${settings.token}`, Accept: "application/json" },
  });
  return readJson<GardenState>(response);
}

export type SpeechResult = { id: string; url: string; media_type: string };

export async function synthesizeSpeech(settings: Settings, text: string): Promise<SpeechResult> {
  const response = await fetch(requestUrl(settings, "/v1/speech"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ text }),
  });
  return readJson<SpeechResult>(response);
}

export function speechSource(
  settings: Settings,
  speech: SpeechResult,
): { uri: string; headers: Record<string, string> } {
  return {
    uri: requestUrl(settings, speech.url),
    headers: { Authorization: `Bearer ${settings.token}` },
  };
}

export type ShopItem = {
  id: string;
  kind: string;
  value: string;
  name: string;
  price: number;
  base_price: number;
  owned: boolean;
};

export type ShopState = {
  tokens: number;
  can_claim: boolean;
  claim_amount: number;
  items: ShopItem[];
};

export async function fetchShop(settings: Settings): Promise<ShopState> {
  const response = await fetch(requestUrl(settings, "/v1/shop"), {
    headers: { Authorization: `Bearer ${settings.token}`, Accept: "application/json" },
  });
  return readJson<ShopState>(response);
}

export async function claimTokens(settings: Settings): Promise<{ tokens: number; claimed: number }> {
  const response = await fetch(requestUrl(settings, "/v1/shop/claim"), {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.token}`, Accept: "application/json" },
  });
  return readJson<{ tokens: number; claimed: number }>(response);
}

export async function buyShopItem(
  settings: Settings,
  itemId: string,
): Promise<{ item_id: string; tokens: number; tokens_spent: number }> {
  const response = await fetch(requestUrl(settings, "/v1/shop/buy"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ item_id: itemId }),
  });
  return readJson<{ item_id: string; tokens: number; tokens_spent: number }>(response);
}

export type CheckIn = {
  id: string;
  kind: "text" | "call";
  message: string;
  scheduled_for: string;
  recurrence: "none" | "daily";
  status: "pending" | "sent" | "cancelled";
  sent_at: string | null;
};

export type CheckInList = { upcoming: CheckIn[]; recent: CheckIn[] };

export async function fetchCheckIns(settings: Settings): Promise<CheckInList> {
  const response = await fetch(requestUrl(settings, "/v1/check-ins"), {
    headers: { Authorization: `Bearer ${settings.token}`, Accept: "application/json" },
  });
  return readJson<CheckInList>(response);
}

export async function createCheckIn(
  settings: Settings,
  body: { kind: "text" | "call"; scheduled_for: string; recurrence?: "none" | "daily"; message?: string },
): Promise<CheckIn> {
  const response = await fetch(requestUrl(settings, "/v1/check-ins"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  return readJson<CheckIn>(response);
}

export async function cancelCheckIn(settings: Settings, id: string): Promise<void> {
  const response = await fetch(requestUrl(settings, `/v1/check-ins/${id}`), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${settings.token}`, Accept: "application/json" },
  });
  await readJson<{ cancelled: boolean }>(response);
}

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  body: string;
  modality: string;
  created_at: string;
  has_audio?: boolean;
};

export async function fetchMessages(
  settings: Settings,
  sessionId: string,
  limit = 40,
): Promise<StoredMessage[]> {
  const response = await fetch(
    requestUrl(settings, `/v1/sessions/${sessionId}/messages?limit=${limit}`),
    { headers: { Authorization: `Bearer ${settings.token}`, Accept: "application/json" } },
  );
  const payload = await readJson<{ messages: StoredMessage[] }>(response);
  return payload.messages;
}

export type StreamHandlers = {
  onAck?: (payload: { user_message_id?: string | null; persisted?: boolean }) => void;
  onRetrieval?: (payload: {
    degraded?: string | null;
    banner?: string | null;
    consulted_left?: boolean;
    consulted_right?: boolean;
  }) => void;
  onDelta: (text: string) => void;
  onDone: (payload: {
    assistant_message_id?: string | null;
    memory_decision?: string;
    memory_reason?: string;
    memory_status?: string;
    segments?: string[];
  }) => void;
};

function utf8DecodeFallback(bytes: Uint8Array): string {
  let out = "";
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index++];
    if (first < 0x80) {
      out += String.fromCharCode(first);
    } else if (first >= 0xc0 && first < 0xe0 && index < bytes.length) {
      const second = bytes[index++];
      out += String.fromCharCode(((first & 0x1f) << 6) | (second & 0x3f));
    } else if (first >= 0xe0 && first < 0xf0 && index + 1 < bytes.length) {
      const second = bytes[index++];
      const third = bytes[index++];
      out += String.fromCharCode(
        ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f),
      );
    } else if (first >= 0xf0 && index + 2 < bytes.length) {
      const second = bytes[index++];
      const third = bytes[index++];
      const fourth = bytes[index++];
      const codePoint =
        ((first & 0x07) << 18) |
        ((second & 0x3f) << 12) |
        ((third & 0x3f) << 6) |
        (fourth & 0x3f);
      out += String.fromCodePoint(codePoint);
    } else {
      out += "\ufffd";
    }
  }
  return out;
}

export async function postTurnStream(
  settings: Settings,
  sessionId: string,
  body: { text: string } | { audio: { uri: string; type: string; name: string } },
  handlers: StreamHandlers,
): Promise<void> {
  assertBaseAllowed(settings.baseUrl, settings.allowCleartext);
  const url = `${settings.baseUrl.replace(/\/$/, "")}/v1/sessions/${sessionId}/turns`;
  let init: Parameters<typeof expoFetch>[1];
  if ("audio" in body) {
    const form = new FormData();
    form.append("client_msg_id", clientMsgId());
    form.append("audio", {
      uri: body.audio.uri,
      type: body.audio.type,
      name: body.audio.name,
    } as unknown as Blob);
    init = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.token}`,
        Accept: "text/event-stream",
      },
      body: form,
    };
  } else {
    init = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ client_msg_id: clientMsgId(), text: body.text }),
    };
  }
  const response = await expoFetch(url, init);
  if (!response.ok) {
    let message = `请求失败 ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      message = payload.error?.message || message;
    } catch {
      // 保留状态码文案
    }
    throw new Error(message);
  }
  if (!response.body) {
    throw new Error("服务端没有返回流");
  }

  const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
  const reader = response.body.getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder ? decoder.decode(value, { stream: true }) : utf8DecodeFallback(value);
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      dispatchSseBlock(block, handlers);
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) {
    dispatchSseBlock(buffer, handlers);
  }
}

function dispatchSseBlock(block: string, handlers: StreamHandlers): void {
  let event = "message";
  let data = "{}";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data = line.slice("data:".length).trim();
    }
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return;
  }
  if (event === "delta" && typeof parsed.text === "string") {
    handlers.onDelta(parsed.text);
  } else if (event === "ack") {
    handlers.onAck?.(parsed as Parameters<NonNullable<StreamHandlers["onAck"]>>[0]);
  } else if (event === "retrieval") {
    handlers.onRetrieval?.(parsed as Parameters<NonNullable<StreamHandlers["onRetrieval"]>>[0]);
  } else if (event === "done") {
    handlers.onDone?.(parsed as Parameters<StreamHandlers["onDone"]>[0]);
  }
}

export type SubscriptionState = {
  tier: "free" | "plus";
  is_plus: boolean;
  status: "active" | "canceled";
  plan: string | null;
  started_at: string | null;
  renews_at: string | null;
  limits: { messages: number; notebook: number; insights: number } | null;
  usage: { messages: number; notebook: number; insights: number };
  perks?: { daily_tokens: number; shop_discount: number };
};

export async function fetchSubscription(settings: Settings): Promise<SubscriptionState> {
  const response = await fetch(requestUrl(settings, "/v1/subscription"), {
    headers: { Authorization: `Bearer ${settings.token}`, Accept: "application/json" },
  });
  return readJson<SubscriptionState>(response);
}

export async function activateSubscription(
  settings: Settings,
  plan: "monthly" | "yearly",
): Promise<SubscriptionState> {
  const response = await fetch(requestUrl(settings, "/v1/subscription/activate"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ plan }),
  });
  return readJson<SubscriptionState>(response);
}

export async function cancelSubscription(settings: Settings): Promise<SubscriptionState> {
  const response = await fetch(requestUrl(settings, "/v1/subscription/cancel"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.token}`,
      Accept: "application/json",
    },
  });
  return readJson<SubscriptionState>(response);
}

export type ToneOption = { id: string; label: string; description: string };

export type AppearanceOption = { id: string; label: string };

export type Appearance = {
  color?: string;
  eyes?: string;
  cheeks?: string;
  hair?: string;
};

export type PersonaState = {
  name: string;
  tone: string;
  options: ToneOption[];
  appearance: Appearance;
  appearance_options: Record<string, AppearanceOption[]>;
  user_gender?: UserGender | null;
  user_nickname?: string | null;
  timezone?: string | null;
};

export type UserGender = "male" | "female" | "unspecified";

export async function fetchPersona(settings: Settings): Promise<PersonaState> {
  const response = await fetch(requestUrl(settings, "/v1/persona"), {
    headers: { Authorization: `Bearer ${settings.token}`, Accept: "application/json" },
  });
  return readJson<PersonaState>(response);
}

export async function updatePersona(
  settings: Settings,
  patch: { tone?: string; appearance?: Appearance; user_gender?: UserGender; user_nickname?: string; timezone?: string },
): Promise<PersonaState> {
  const response = await fetch(requestUrl(settings, "/v1/persona"), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${settings.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(patch),
  });
  return readJson<PersonaState>(response);
}

export async function updatePersonaTone(
  settings: Settings,
  tone: string,
): Promise<PersonaState> {
  return updatePersona(settings, { tone, timezone: deviceTimeZone() });
}

/** Send the device's IANA zone if the server has a different one; returns the stored zone. */
export async function syncTimezone(settings: Settings): Promise<string | undefined> {
  const device = deviceTimeZone();
  const current = await fetchPersona(settings);
  if (device && current.timezone !== device) {
    return (await updatePersona(settings, { timezone: device })).timezone ?? device;
  }
  return current.timezone ?? device;
}
