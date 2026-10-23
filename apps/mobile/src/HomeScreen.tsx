import { completedBubbles, sleep, splitBubbles } from "./bubbles";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LayoutRectangle } from "react-native";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Audio } from "expo-av";

import { ChatStage, Platform } from "./ChatStage";
import { WorldView } from "./WorldView";
import {
  Appearance,
  ChatMessage,
  MAX_VOICE_MS,
  MEMORY_BANNER,
  Settings,
  UNPERSISTED_NOTE,
  fetchMessages,
  fetchPersona,
  postTurnStream,
  syncTimezone,
  speechSource,
  synthesizeSpeech,
} from "./api";
import { colors, spacing } from "./theme";
import { useSky } from "./daytime";
import { SkyBody } from "./SkyBody";

export function HomeScreen({
  settings,
  sessionId,
  onOpenSettings,
  active = true,
}: {
  settings: Settings;
  sessionId: string;
  onOpenSettings: () => void;
  active?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [banner, setBanner] = useState<string>();
  const [error, setError] = useState<string>();
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const recording = useRef<Audio.Recording | null>(null);
  const startedAt = useRef(0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const listRef = useRef<ScrollView>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [appearance, setAppearance] = useState<Appearance>();
  const [userTz, setUserTz] = useState<string>();
  const sky = useSky(userTz);
  const [roomOpen, setRoomOpen] = useState(false);
  // 覆盖层落脚点：线程在 wrap 里的位置 + 每条消息在内容里的位置 + 滚动偏移
  const lay = useRef({ thread: { x: 0, y: 0, width: 0, height: 0 } as LayoutRectangle, composer: { x: 0, y: 0, width: 0, height: 0 } as LayoutRectangle, items: {} as Record<string, { y: number; bx: number; by: number; bw: number; bh?: number }>, scroll: 0 }).current;
  const [layoutTick, setLayoutTick] = useState(0);
  const bump = () => setLayoutTick((n) => (n + 1) % 1e6);
  const platforms = useMemo<Platform[]>(() => {
    const out: Platform[] = [];
    const top = lay.thread.y, bottom = lay.thread.y + lay.thread.height;
    messages.forEach((m, i) => {
      const L = lay.items[m.id];
      if (!L) return;
      const y = top + L.y + L.by - lay.scroll;
      if (y < top + 20 || y > bottom) return;
      const x0 = lay.thread.x + L.bx, x1 = x0 + L.bw;
      const last = i === messages.length - 1;
      out.push({ x0, x1, y, h: L.bh ?? 40, key: `bubble-${i}`, end: last && m.role !== "user", busy: last && m.role !== "user" && thinking });
    });
    const c = lay.composer;
    if (c.width) out.push({ x0: c.x, x1: c.x + c.width, y: c.y, h: c.height, key: "composer" });
    return out;
  }, [messages, layoutTick, thinking]);

  useEffect(() => {
    syncTimezone(settings).then(setUserTz).catch(() => undefined);
  }, [settings]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    fetchMessages(settings, sessionId)
      .then((list) => {
        if (!alive) return;
        setMessages((current) => {
          if (current.some((item) => item.pending)) return current;
          return list.map((item) => ({
            id: item.id,
            role: item.role,
            body: item.body,
            hasAudio: item.has_audio,
          }));
        });
      })
      .catch(() => {
        // 历史读取失败时从空白开始
      });
    return () => {
      alive = false;
    };
  }, [active, sessionId, settings]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    fetchPersona(settings)
      .then((state) => {
        if (alive) setAppearance(state.appearance);
      })
      .catch(() => {
        // 外观读取失败时用默认形象
      });
    return () => {
      alive = false;
    };
  }, [active, settings]);

  async function playMessageAudio(messageId: string) {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => undefined);
      }
      const url = `${settings.baseUrl.replace(/\/$/, "")}/v1/messages/${messageId}/audio`;
      const { sound } = await Audio.Sound.createAsync(
        { uri: url, headers: { Authorization: `Bearer ${settings.token}` } },
        { shouldPlay: true },
      );
      soundRef.current = sound;
      setSpeaking(true);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) setSpeaking(false);
      });
    } catch {
      // 语音留言播放失败时安静退回文字
    }
  }

  async function playVoice(text: string) {
    if (!voiceOn || !text.trim()) return;
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      const speech = await synthesizeSpeech(settings, text);
      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => undefined);
      }
      const { sound } = await Audio.Sound.createAsync(speechSource(settings, speech), {
        shouldPlay: true,
      });
      soundRef.current = sound;
      setSpeaking(true);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) setSpeaking(false);
      });
    } catch {
      // 语音不可用时安静退回文字
    }
  }

  async function streamTurn(
    payload: { text: string } | { audio: { uri: string; type: string; name: string } },
    userBody: string,
  ) {
    setError(undefined);
    setThinking(true);
    const userLocalId = `local-${Date.now()}`;
    let assistantLocalId = `a-${Date.now()}`;
    let doneId: string | undefined;
    let finalSegments: string[] | undefined;
    setMessages((current) => [
      ...current,
      { id: userLocalId, role: "user", body: userBody, pending: true },
      { id: assistantLocalId, role: "assistant", body: "…" },
    ]);
    let assistantText = "";
    try {
      await postTurnStream(settings, sessionId, payload, {
        onAck: (ack) =>
          setMessages((current) =>
            current.map((item) =>
              item.id === userLocalId
                ? {
                    ...item,
                    id: ack.user_message_id || userLocalId,
                    pending: false,
                    notice: ack.persisted === false ? UNPERSISTED_NOTE : undefined,
                  }
                : item,
            ),
          ),
        onRetrieval: (payload) =>
          setBanner(
            payload.banner ||
              (payload.degraded && payload.degraded.startsWith("voicemem")
                ? MEMORY_BANNER
                : undefined),
          ),
        onDelta: (chunk) => {
          assistantText += chunk;
          // 像发消息一样：只显示已经说完的那几条，正在打的那条用「…」占位
          const shown = completedBubbles(assistantText);
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantLocalId ? { ...item, body: [...shown, "…"].join("\n\n") } : item,
            ),
          );
        },
        onDone: (done) => {
          doneId = done.assistant_message_id || undefined;
          const segs = done.segments;
          if (segs && segs.length) finalSegments = segs;
        },
      });
      const segs = finalSegments ?? splitBubbles(assistantText);
      const already = completedBubbles(assistantText).length;
      for (let n = Math.max(1, already); n <= segs.length; n++) {
        if (n > already) await sleep(n === 1 ? 0 : 600);
        const body = segs.slice(0, n).join("\n\n") + (n < segs.length ? "\n\n…" : "");
        setMessages((current) =>
          current.map((item) =>
            item.id === assistantLocalId ? { ...item, id: n === segs.length && doneId ? doneId : item.id, body } : item,
          ),
        );
      }
      if (doneId) assistantLocalId = doneId;
      if (segs.length) void playVoice(segs.join("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setThinking(false);
    }
  }

  async function sendText() {
    const text = draft.trim();
    if (!text || thinking) return;
    setDraft("");
    await streamTurn({ text }, text);
  }

  async function startRecording() {
    if (thinking) return;
    setError(undefined);
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      setError("没有麦克风权限");
      return;
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const next = new Audio.Recording();
    await next.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await next.startAsync();
    recording.current = next;
    startedAt.current = Date.now();
    setListening(true);
  }

  async function stopRecording() {
    const current = recording.current;
    recording.current = null;
    setListening(false);
    if (!current) return;
    const elapsed = Date.now() - startedAt.current;
    await current.stopAndUnloadAsync();
    if (elapsed > MAX_VOICE_MS) {
      setError("超过 60 秒，没有上传");
      return;
    }
    const uri = current.getURI();
    if (!uri) return;
    await streamTurn({ audio: { uri, type: "audio/m4a", name: "note.m4a" } }, "语音备忘");
  }

  return (
    <View style={[styles.wrap, { backgroundColor: sky.color }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>olo</Text>
          <Text style={styles.subtle}>
            {thinking ? "在想…" : speaking ? "在说话" : listening ? "在听你说" : "在这儿"}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => {
              if (voiceOn) {
                soundRef.current?.stopAsync().catch(() => undefined);
                setSpeaking(false);
              }
              setVoiceOn(!voiceOn);
            }}
            hitSlop={8}
            style={[styles.voiceToggle, voiceOn && styles.voiceToggleOn]}
          >
            <Text style={[styles.voiceToggleText, voiceOn && styles.voiceToggleTextOn]}>
              {voiceOn ? "语音开" : "语音关"}
            </Text>
          </Pressable>
          <Pressable
            testID="room-toggle"
            accessibilityRole="button"
            accessibilityState={{ selected: roomOpen }}
            onPress={() => setRoomOpen(!roomOpen)}
            hitSlop={8}
          >
            <Text style={styles.settings}>{roomOpen ? "✉ 聊天" : "⌂ 雾里集"}</Text>
          </Pressable>
          <Pressable onPress={onOpenSettings} hitSlop={8}>
            <Text style={styles.settings}>设置</Text>
          </Pressable>
        </View>
      </View>

      <SkyBody sun={sky.sun} height={260} />
      {roomOpen ? (
        <WorldView baseUrl={settings.baseUrl} token={settings.token} appearance={appearance} tz={userTz} onOpenChat={() => setRoomOpen(false)} />
      ) : (
      <>
      {banner ? <Text style={styles.banner}>{banner}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView
        ref={listRef}
        style={styles.thread}
        contentContainerStyle={styles.threadContent}
        scrollEventThrottle={16}
        onScroll={(e) => { lay.scroll = e.nativeEvent.contentOffset.y; bump(); }}
        onLayout={(e) => { lay.thread = e.nativeEvent.layout; bump(); }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((item, idx) => (
          <View
            key={item.id}
            style={idx === messages.length - 1 ? styles.lastItem : undefined}
            onLayout={(e) => { lay.items[item.id] = { ...(lay.items[item.id] ?? { bx: 0, by: 0, bw: 0 }), y: e.nativeEvent.layout.y }; bump(); }}
          >
          {item.role === "assistant"
            ? splitBubbles(item.body).slice(0, -1).map((part, i) => (
                <View key={`${item.id}-${i}`} style={styles.assistant}>
                  <Text style={styles.assistantText}>{part}</Text>
                </View>
              ))
            : null}
          <View
            style={item.role === "user" ? styles.user : styles.assistant}
            onLayout={(e) => { const l = e.nativeEvent.layout; lay.items[item.id] = { ...(lay.items[item.id] ?? { y: 0 }), bx: l.x, by: l.y, bw: l.width, bh: l.height }; bump(); }}
          >
            <Text style={item.role === "user" ? styles.userText : styles.assistantText}>
              {item.role === "assistant" ? (splitBubbles(item.body).slice(-1)[0] ?? item.body) : item.body}
            </Text>
            {item.notice ? <Text style={styles.notice}>{item.notice}</Text> : null}
            {item.hasAudio ? (
              <Pressable onPress={() => void playMessageAudio(item.id)} hitSlop={6}>
                <Text style={styles.audioLink}>▶ 播放语音留言</Text>
              </Pressable>
            ) : null}
            {item.role === "assistant" && item.body && voiceOn && !item.hasAudio ? (
              <Pressable onPress={() => void playVoice(item.body)} hitSlop={6}>
                <Text style={styles.replay}>重播</Text>
              </Pressable>
            ) : null}
          </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.composer} onLayout={(e) => { lay.composer = e.nativeEvent.layout; bump(); }}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="说点什么"
          placeholderTextColor={colors.muted}
          multiline
        />
        <Pressable style={styles.send} onPress={sendText}>
          <Text style={styles.sendText}>发送</Text>
        </Pressable>
        <Pressable
          style={[styles.hold, listening && styles.holdActive]}
          onPressIn={startRecording}
          onPressOut={stopRecording}
        >
          <Text style={styles.sendText}>{listening ? "松开" : "按住"}</Text>
        </Pressable>
      </View>
      </>
      )}
      <ChatStage
        platforms={platforms}
        appearance={appearance}
        hidden={roomOpen}
        mood={speaking ? "speaking" : thinking ? "thinking" : listening ? "listening" : "idle"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.md },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
  },
  brand: { fontSize: 22, fontWeight: "700", color: colors.ink, letterSpacing: 0.5 },
  subtle: { fontSize: 12, color: colors.muted, marginTop: 2 },
  settings: { color: colors.accent, fontSize: 14 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  voiceToggle: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  voiceToggleOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  voiceToggleText: { color: colors.muted, fontSize: 11 },
  voiceToggleTextOn: { color: colors.accent },
  banner: { color: colors.muted, marginTop: spacing.sm, fontSize: 12 },
  error: { color: colors.error, marginTop: spacing.sm, fontSize: 12 },
  thread: { flex: 1, marginTop: spacing.sm },
  threadContent: { paddingBottom: spacing.sm, paddingTop: 70 },
  lastItem: { marginTop: 56 },
  user: {
    alignSelf: "flex-end",
    backgroundColor: colors.accentSoft,
    borderRadius: 16,
    borderBottomRightRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 4,
    maxWidth: "82%",
  },
  assistant: {
    alignSelf: "flex-start",
    backgroundColor: colors.card,
    borderRadius: 16,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 4,
    maxWidth: "82%",
  },
  userText: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  assistantText: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  notice: { color: colors.error, marginTop: 4, fontSize: 11 },
  replay: { color: colors.accent, marginTop: 4, fontSize: 11 },
  audioLink: { color: colors.accent, marginTop: 4, fontSize: 12, fontWeight: "600" },
  composer: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-end",
    paddingVertical: spacing.md,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    backgroundColor: colors.card,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.ink,
    fontSize: 15,
  },
  send: {
    backgroundColor: colors.accent,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  hold: {
    backgroundColor: colors.mintDark,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  holdActive: { backgroundColor: colors.error },
  sendText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
});
