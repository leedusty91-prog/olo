import { completedBubbles, sleep, splitBubbles } from "./bubbles";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  PanResponder,
  useWindowDimensions,
  Platform as RNPlatform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PageKey } from "../App";
import { tap } from "./haptics";
import { Audio } from "expo-av";

import { Character } from "./Character";
import { Nook } from "./Nook";
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
import { colors, fonts, radii, shadows, spacing } from "../theme/illustration";
import { TOUCH } from "./theme"; // 触控尺寸：illustration.ts 暂无此 token
import { useSky } from "./daytime";
import { ChatBackdrop } from "./ChatBackdrop";
import { bgFor } from "./ChatBackdrop";
/** 卡片：大圆角 + 柔和投影（全部取自 theme/illustration）。 */
const hdCard = { borderRadius: radii.lg, ...shadows.soft } as const;
const hdBubble = { borderRadius: radii.xl, ...shadows.soft } as const;

export function HomeScreen({
  settings,
  sessionId,
  onOpenSettings,
  onNavigate,
  active = true,
}: {
  settings: Settings;
  sessionId: string;
  onOpenSettings: () => void;
  onNavigate?: (page: PageKey) => void;
  active?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [reloadTick, setReloadTick] = useState(0);
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
  const chatDark = bgFor(sky.hour) === "night";
  const { height: screenH } = useWindowDimensions();
  // 底部聊天面板：收起（只露最新一句 + 按住说）/ 半屏 / 全屏；小窝在后面不动
  const SNAP = { min: 104 + insets.bottom, half: Math.round(screenH * 0.52), full: screenH - insets.top - 62 };
  const [sheet, setSheet] = useState<"min" | "half" | "full">("min");
  const sheetH = useRef(new Animated.Value(SNAP.min)).current;
  const sheetRef = useRef({ start: SNAP.min, cur: SNAP.min, snap: SNAP });
  sheetRef.current.snap = SNAP;
  const [nookLine, setNookLine] = useState<string>();
  const snapTo = (k: "min" | "half" | "full") => {
    const to = sheetRef.current.snap[k];
    sheetRef.current.cur = to;
    setSheet(k);
    Animated.spring(sheetH, { toValue: to, useNativeDriver: false, bounciness: 4, speed: 16 }).start();
  };
  useEffect(() => { snapTo(sheet); }, [screenH, insets.bottom, insets.top]);
  const sheetPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => { sheetRef.current.start = sheetRef.current.cur; },
    onPanResponderMove: (_e, g) => {
      const { min, full } = sheetRef.current.snap;
      sheetH.setValue(Math.max(min, Math.min(full, sheetRef.current.start - g.dy)));
    },
    onPanResponderRelease: (_e, g) => {
      const { min, half, full } = sheetRef.current.snap;
      const h = Math.max(min, Math.min(full, sheetRef.current.start - g.dy - g.vy * 180));
      const opts = [["min", min], ["half", half], ["full", full]] as const;
      const best = opts.reduce((a, b) => (Math.abs(b[1] - h) < Math.abs(a[1] - h) ? b : a));
      tap("select");
      snapTo(best[0]);
    },
  })).current;
  const lastOlo = [...messages].reverse().find((m) => m.role === "assistant" && m.body && m.body !== "…");
  const latestLine = nookLine ?? (lastOlo ? (splitBubbles(lastOlo.body).filter((x) => x !== "…").slice(-1)[0] ?? lastOlo.body) : "我在小窝里，想聊天就把这里往上拉～");
  useEffect(() => { if (lastOlo) setNookLine(undefined); }, [lastOlo?.id, lastOlo?.body]);

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
            at: item.created_at,
          }));
        });
        setLoadState("ready");
      })
      .catch(() => {
        // 历史读取失败：仍可以直接聊，顶上给个可重试的提示
        if (alive) setLoadState((v) => (v === "ready" ? v : "error"));
      });
    return () => {
      alive = false;
    };
  }, [active, sessionId, settings, reloadTick]);

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
      { id: userLocalId, role: "user", body: userBody, pending: true, at: new Date().toISOString() },
      { id: assistantLocalId, role: "assistant", body: "…", at: new Date().toISOString() },
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

  const menu = [
    { k: "notebook", ico: "✎", label: "日记", run: () => onNavigate?.("notebook") },
    { k: "insights", ico: "☼", label: "洞察 · 心情", run: () => onNavigate?.("insights") },
    { k: "garden", ico: "✿", label: "花园", run: () => onNavigate?.("garden") },
    { k: "profile", ico: "◆", label: "我的 · 商店", run: () => onNavigate?.("profile") },
    { k: "voice", ico: voiceOn ? "♪" : "×", label: voiceOn ? "语音：开" : "语音：关", run: () => { if (voiceOn) { soundRef.current?.stopAsync().catch(() => undefined); setSpeaking(false); } setVoiceOn(!voiceOn); } },
    { k: "settings", ico: "⚙", label: "设置", run: onOpenSettings },
  ];
  const mood = speaking ? "speaking" : thinking ? "thinking" : listening ? "listening" : "idle";
  const open = sheet !== "min";
  return (
    <View style={[styles.root, { backgroundColor: colors.ink }]}>
      <Nook settings={settings} sky={sky} dock={SNAP.min} top={insets.top + 56} appearance={appearance} mood={mood} oloHere={!open} onLine={setNookLine} />
      <View style={{ paddingTop: insets.top, paddingHorizontal: spacing.md }} pointerEvents="box-none">
        <View style={styles.header}>
        <View style={[styles.statusPill, hdBubble]}>
          <View style={[styles.statusDot, (thinking || speaking || listening) && styles.statusDotOn]} />
          <Text style={styles.brand}>olo</Text>
          <Text style={styles.subtle} testID="status">{thinking ? "在想…" : speaking ? "在说话" : listening ? "在听你说" : "在这儿"}</Text>
        </View>
        <Pressable testID="menu-btn" accessibilityRole="button" accessibilityLabel="菜单" onPress={() => { tap("select"); setMenuOpen(true); }} style={({ pressed }) => [styles.menuBtn, hdBubble, pressed && styles.pressed]}>
          <Text style={styles.menuBtnText}>☰</Text>
        </Pressable>
      </View>
      </View>
      <KeyboardAvoidingView style={styles.sheetWrap} behavior={RNPlatform.OS === "ios" ? "padding" : undefined} pointerEvents="box-none">
      <Animated.View style={[styles.sheet, { height: sheetH }]} testID={`sheet-${sheet}`}>
        <ChatBackdrop sky={sky} />
        {open ? (
          <View pointerEvents="none" style={styles.perch} testID="olo-perch">
            <Character size={96} mood={mood === "idle" ? "happy" : mood} appearance={appearance} />
          </View>
        ) : null}
        <View {...sheetPan.panHandlers} style={styles.grabZone}>
          <Pressable testID="sheet-grab" accessibilityRole="button" accessibilityLabel={open ? "收起聊天" : "展开聊天"} onPress={() => { tap("select"); snapTo(open ? "min" : "half"); }} hitSlop={8} style={styles.grabHit}>
            <View style={styles.grab} />
          </Pressable>
          {!open ? (
            <View style={[styles.dockRow, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
              <Pressable style={styles.dockSay} onPress={() => { tap("select"); snapTo("half"); }} testID="dock-line" accessibilityLabel="展开聊天">
                <Text style={[styles.dockWho, chatDark && styles.dockWhoDark]}>{thinking ? "olo · 在想…" : speaking ? "olo · 在说话" : listening ? "olo · 在听你说" : sky.night ? "olo · 打盹中" : "olo"}</Text>
                <Text style={[styles.dockText, chatDark && styles.onDarkText]} numberOfLines={2}>{latestLine}</Text>
              </Pressable>
              <Pressable
                testID="hold"
                accessibilityRole="button"
                accessibilityLabel="按住说话"
                style={({ pressed }) => [styles.hold, hdBubble, (listening || pressed) && styles.holdActive]}
                onPressIn={() => { tap("medium"); void startRecording(); }}
                onPressOut={stopRecording}
              >
                <Text style={styles.holdText}>{listening ? "松开" : "按住说"}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        {open ? (
          <View style={styles.sheetBody}>
      {banner ? <Text style={[styles.banner, hdBubble]}>{banner}</Text> : null}
      {loadState === "error" ? (
        <Pressable testID="chat-error" onPress={() => { setLoadState("loading"); setReloadTick((n) => n + 1); }} style={[styles.errorBox, hdBubble]}>
          <Text style={styles.errorText}>聊天记录没读到 · 点这里重试</Text>
        </Pressable>
      ) : null}
      {error ? <Text style={[styles.errorBox, styles.errorText, hdBubble]}>{error}</Text> : null}

      <ScrollView
        ref={listRef}
        style={styles.thread}
        contentContainerStyle={styles.threadContent}
        scrollEventThrottle={16}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      >
        {loadState === "loading" && !messages.length ? (
          <View style={styles.empty} testID="chat-loading">
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.emptyText, chatDark && styles.onDark]}>olo 在翻之前的聊天…</Text>
          </View>
        ) : null}
        {loadState !== "loading" && !messages.length ? (
          <View style={[styles.emptyCard, hdCard]} testID="chat-empty">
            <Text style={styles.emptyTitle}>还没聊过呢</Text>
            <Text style={styles.emptyText}>跟 olo 说说今天吧，一句话也行。</Text>
            <View style={styles.chips}>
              {["今天有点累", "想听你说说话", "我回来啦"].map((t) => (
                <Pressable key={t} onPress={() => { tap("select"); setDraft(t); }} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                  <Text style={styles.chipText}>{t}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {messages.map((item, idx) => (
          <View
            key={item.id}
            style={idx === messages.length - 1 ? styles.lastItem : undefined}
          >
          {stampFor(messages, idx) ? <Text style={[styles.stamp, chatDark && styles.onDark]}>{stampFor(messages, idx)}</Text> : null}
          {item.role === "assistant"
            ? splitBubbles(item.body).slice(0, -1).map((part, i) => (
                <View key={`${item.id}-${i}`} style={styles.assistant}>
                  <Text style={styles.assistantText}>{part}</Text>
                  <View style={[styles.tail, styles.tailL]} />
                </View>
              ))
            : null}
          <View
            style={item.role === "user" ? styles.user : styles.assistant}
          >
            <Text style={item.role === "user" ? styles.userText : styles.assistantText}>
              {item.role === "assistant" ? (splitBubbles(item.body).slice(-1)[0] ?? item.body) : item.body}
            </Text>
            {item.notice ? <Text style={styles.notice}>{item.notice}</Text> : null}
            <View style={[styles.tail, item.role === "user" ? styles.tailR : styles.tailL]} />
            {item.hasAudio ? (
              <Pressable onPress={() => void playMessageAudio(item.id)} hitSlop={12}>
                <Text style={styles.audioLink}>▶ 播放语音留言</Text>
              </Pressable>
            ) : null}
            {item.role === "assistant" && item.body && voiceOn && !item.hasAudio ? (
              <Pressable onPress={() => void playVoice(item.body)} hitSlop={12} accessibilityLabel="重播语音">
                <Text style={styles.replay}>▶ 重播</Text>
              </Pressable>
            ) : null}
          </View>
          </View>
        ))}
      </ScrollView>
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) + spacing.xs }]}>
        <View style={[styles.inputBox, hdBubble]}>
          <TextInput
            testID="chat-input"
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="跟 olo 说点什么…"
            placeholderTextColor={colors.muted}
            multiline
            onFocus={() => { if (sheet !== "full") snapTo("full"); }}
            accessibilityLabel="输入消息"
          />
        </View>
        {draft.trim() ? (
          <Pressable testID="send" accessibilityRole="button" accessibilityLabel="发送" style={({ pressed }) => [styles.send, hdBubble, pressed && styles.pressed]} onPress={() => { tap("light"); void sendText(); }}>
            <Text style={styles.sendText}>▶</Text>
          </Pressable>
        ) : (
          <Pressable
            testID="hold"
            accessibilityRole="button"
            accessibilityLabel="按住说话"
            style={({ pressed }) => [styles.hold, hdBubble, (listening || pressed) && styles.holdActive]}
            onPressIn={() => { tap("medium"); void startRecording(); }}
            onPressOut={stopRecording}
          >
            <Text style={styles.holdText}>{listening ? "松开" : "按住说"}</Text>
          </Pressable>
        )}
      </View>
          </View>
        ) : null}
      </Animated.View>
      </KeyboardAvoidingView>
      {menuOpen ? (
        <View style={StyleSheet.absoluteFill} testID="menu">
          <Pressable style={styles.scrim} onPress={() => setMenuOpen(false)} accessibilityLabel="关闭菜单" testID="menu-scrim" />
          <View style={[styles.drawer, hdCard, { top: insets.top + spacing.sm + TOUCH + spacing.xs }]}>
            <Text style={styles.drawerTitle}>菜单</Text>
            {menu.map((m) => (
              <Pressable key={m.k} testID={`menu-${m.k}`} accessibilityRole="button" onPress={() => { tap("select"); if (m.k !== "voice") setMenuOpen(false); m.run(); }} style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemOn]}>
                <Text style={styles.menuIco}>{m.ico}</Text>
                <Text style={styles.menuText}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// 时间戳：第一条、或者和上一条隔了 10 分钟以上时，淡淡地标一下
function stampFor(list: ChatMessage[], i: number): string {
  const cur = list[i]?.at; if (!cur) return "";
  const prev = list[i - 1]?.at;
  const t = new Date(cur);
  if (prev && t.getTime() - new Date(prev).getTime() < 10 * 60_000) return "";
  const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  const today = new Date().toDateString() === t.toDateString();
  return today ? hm : `${t.getMonth() + 1}月${t.getDate()}日 ${hm}`;
}

const BUB = { paddingHorizontal: 12, paddingVertical: 9, marginVertical: 6, maxWidth: "80%" as const };
const styles = StyleSheet.create({
  root: { flex: 1 },
  wrap: { flex: 1, paddingHorizontal: spacing.md },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: spacing.sm, zIndex: 5 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.card, paddingHorizontal: 10, minHeight: 36 },
  statusDot: { width: 6, height: 6, backgroundColor: colors.mint },
  statusDotOn: { backgroundColor: colors.lantern },
  brand: { fontSize: fonts.size.body, color: colors.ink },
  subtle: { fontSize: fonts.size.caption, color: colors.muted },
  menuBtn: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center", backgroundColor: colors.cardGlass },
  menuBtnText: { color: colors.ink, fontSize: 20 },
  banner: { color: colors.muted, marginTop: spacing.sm, fontSize: fonts.size.caption, backgroundColor: colors.card, padding: spacing.sm },
  errorBox: { marginTop: spacing.sm, backgroundColor: colors.bgDeep, padding: spacing.sm, minHeight: TOUCH, justifyContent: "center" },
  errorText: { color: colors.error, fontSize: fonts.size.caption },
  thread: { flex: 1, marginTop: spacing.xs },
  threadContent: { paddingBottom: spacing.md, paddingTop: 64, paddingRight: 4 },
  lastItem: { marginTop: 56 },
  onDark: { color: colors.onDark, opacity: 0.9, textShadowColor: colors.scrim, textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 4 },
  stamp: { alignSelf: "center", color: colors.muted, opacity: 0.75, fontSize: 11, marginTop: spacing.sm, marginBottom: 2 },
  user: { ...hdBubble, ...BUB, alignSelf: "flex-end", backgroundColor: colors.accentSoft },
  assistant: { ...hdBubble, ...BUB, alignSelf: "flex-start", backgroundColor: colors.card },
  userText: { color: colors.ink, fontSize: fonts.size.body, lineHeight: 22 },
  assistantText: { color: colors.ink, fontSize: fonts.size.body, lineHeight: 22 },
  // 插画风气泡不要像素小尾巴
  tail: { display: "none" },
  tailL: { left: 8 },
  tailR: { right: 8 },
  notice: { color: colors.error, marginTop: 4, fontSize: 11 },
  replay: { color: colors.accent, marginTop: 6, fontSize: 11, opacity: 0.8 },
  audioLink: { color: colors.accent, marginTop: 6, fontSize: fonts.size.caption },
  empty: { alignItems: "center", gap: spacing.sm, marginTop: spacing.xl },
  emptyCard: { backgroundColor: colors.card, padding: spacing.md, marginTop: spacing.lg, gap: spacing.sm },
  emptyTitle: { color: colors.ink, fontSize: fonts.size.title },
  emptyText: { color: colors.muted, fontSize: fonts.size.caption, lineHeight: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  chip: { borderRadius: radii.pill, minHeight: TOUCH, paddingHorizontal: 12, justifyContent: "center", borderWidth: 1.5, borderColor: colors.bgDeep, backgroundColor: colors.accentSoft },
  chipText: { color: colors.ink, fontSize: fonts.size.caption },
  composer: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end", paddingTop: spacing.sm },
  inputBox: { flex: 1, backgroundColor: colors.card, minHeight: TOUCH, justifyContent: "center" },
  input: { maxHeight: 110, paddingHorizontal: 12, paddingTop: 11, paddingBottom: 11, color: colors.ink, fontSize: fonts.size.body, lineHeight: 20 },
  send: { backgroundColor: colors.accent, width: TOUCH + 4, height: TOUCH, alignItems: "center", justifyContent: "center" },
  sendText: { color: colors.onDark, fontSize: 18 },
  hold: { backgroundColor: colors.accentDeep, minWidth: TOUCH + 20, height: TOUCH, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  holdActive: { backgroundColor: colors.error },
  holdText: { color: colors.onDark, fontSize: fonts.size.caption },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.9 },
  sheetWrap: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end" },
  dockWhoDark: { color: colors.accentSoft },
  onDarkText: { color: colors.onDark },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, overflow: "hidden", ...shadows.soft, shadowOffset: { width: 0, height: -6 } },
  perch: { position: "absolute", right: 28, top: -84, zIndex: 3 },
  grabZone: { paddingHorizontal: spacing.md },
  grabHit: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 40 },
  grab: { width: 44, height: 5, borderRadius: radii.pill, backgroundColor: colors.bgDeep },
  dockRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dockSay: { flex: 1, minHeight: TOUCH, justifyContent: "center" },
  dockWho: { fontSize: 11, color: colors.muted },
  dockText: { fontSize: fonts.size.caption, color: colors.ink, lineHeight: 19 },
  sheetBody: { flex: 1, paddingHorizontal: spacing.md },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  drawer: { position: "absolute", right: spacing.md, width: 220, backgroundColor: colors.card, borderRadius: radii.lg, ...shadows.soft, padding: spacing.sm, gap: 2 },
  drawerTitle: { color: colors.accentSoft, fontSize: fonts.size.caption, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, opacity: 0.8 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: TOUCH, paddingHorizontal: spacing.sm },
  menuItemOn: { backgroundColor: colors.accentSoft, borderRadius: radii.md },
  menuIco: { width: 20, color: colors.accent, fontSize: fonts.size.body, textAlign: "center" },
  menuText: { color: colors.ink, fontSize: fonts.size.body },
});
