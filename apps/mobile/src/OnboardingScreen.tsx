// 相遇仪式 v3（插画风）：开场短片（旁白 + 配乐 + 字幕已压进视频）→ 原生叠层：起名 → 选 10 种灯籽 → 称呼（可跳过）→ 收尾短片。
// 离线安全：视频/音频全部打包在本地；视频出错就退回静帧；提交失败先存本机、进入 App，稍后补交。
// 减少动态：不自动播视频，用静帧 + 文字代替。
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo, ActivityIndicator, Animated, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View, useWindowDimensions,
} from "react-native";
import { Audio, ResizeMode, Video } from "expo-av";
import { Settings, UserGender, completeOnboarding } from "./api";
import { saveOnboarded, savePendingOnboarding } from "./onboarding";
import { DENGZI_FORMS, DengziForm } from "./onboardForms";
import { TOUCH, border, bubble, caption, chip, chipOn, colors, fonts, radii, shadows, spacing, textShadow } from "../theme/illustration";

type Phase = "intro" | "name" | "form" | "gender" | "outro";

const CLIP = {
  intro: require("../assets/onboard/intro.mp4"),
  idle: require("../assets/onboard/idle.mp4"),
  outro: require("../assets/onboard/outro.mp4"),
};
const STILL = { intro: require("../assets/onboard/intro.jpg"), idle: require("../assets/onboard/idle.jpg") };
const SOUND = {
  music: require("../assets/onboard/music.m4a"),
  name: require("../assets/onboard/vo_n6.m4a"),
  form: require("../assets/onboard/vo_n7.m4a"),
};
const GENDERS: [UserGender, string][] = [["male", "男生"], ["female", "女生"], ["unspecified", "不想说"]];

async function play(src: number, opts: { loop?: boolean; volume?: number } = {}): Promise<Audio.Sound | null> {
  try {
    const { sound } = await Audio.Sound.createAsync(src, { shouldPlay: true, isLooping: !!opts.loop, volume: opts.volume ?? 1 });
    return sound;
  } catch {
    return null; // 没有声音也能走完流程
  }
}

export function OnboardingScreen({ settings, onDone }: { settings: Settings; onDone: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const [phase, setPhase] = useState<Phase>("intro");
  const [reduced, setReduced] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [name, setName] = useState("");
  const [form, setForm] = useState<DengziForm>("buddy");
  const [gender, setGender] = useState<UserGender>("unspecified");
  const [busy, setBusy] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const music = useRef<Audio.Sound | null>(null);
  const voice = useRef<Audio.Sound | null>(null);
  const finished = useRef(false);

  useEffect(() => {
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduced);
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduced).catch(() => undefined);
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => undefined);
    return () => {
      sub?.remove?.();
      music.current?.unloadAsync().catch(() => undefined);
      voice.current?.unloadAsync().catch(() => undefined);
    };
  }, []);

  // 叠层淡入
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: reduced ? 0 : 420, useNativeDriver: true }).start();
  }, [phase, reduced, fade]);

  // 每一步的旁白 + 叠层阶段的配乐
  useEffect(() => {
    let alive = true;
    (async () => {
      if ((phase === "name" || phase === "form" || phase === "gender") && !music.current) {
        music.current = await play(SOUND.music, { loop: true, volume: 0.35 });
      }
      if (phase === "outro") {
        await music.current?.unloadAsync().catch(() => undefined);
        music.current = null;
      }
      const vo = phase === "name" ? SOUND.name : phase === "form" ? SOUND.form : null;
      await voice.current?.unloadAsync().catch(() => undefined);
      voice.current = vo && alive ? await play(vo) : null;
    })();
    return () => { alive = false; };
  }, [phase]);

  const chosen = DENGZI_FORMS.find((f) => f.id === form) ?? DENGZI_FORMS[0];
  const oloName = name.trim() || chosen.label;

  async function finish() {
    if (finished.current) return;
    finished.current = true;
    setBusy(true);
    const body = { name: oloName.slice(0, 12), form, user_gender: gender };
    try {
      await completeOnboarding(settings, body);
    } catch {
      await savePendingOnboarding(body); // 离线 / 服务器没起来：先进 App，下次启动补交
    }
    await music.current?.unloadAsync().catch(() => undefined);
    await saveOnboarded();
    onDone();
  }

  const big = phase === "intro" || phase === "outro";
  const clip = phase === "intro" ? CLIP.intro : phase === "outro" ? CLIP.outro : CLIP.idle;
  const still = phase === "intro" ? STILL.intro : STILL.idle;
  const showVideo = !videoFailed && !(reduced && !big);
  const autoAdvance = () => (phase === "intro" ? setPhase("name") : phase === "outro" ? finish() : undefined);

  return (
    <View style={styles.root} testID="onboard-fs">
      {showVideo && !(reduced && big) ? (
        <Video
          key={phase === "name" || phase === "form" || phase === "gender" ? "idle" : phase}
          source={clip}
          style={StyleSheet.absoluteFill}
          resizeMode={ResizeMode.COVER}
          shouldPlay
          isLooping={!big}
          isMuted={!big}
          posterSource={still}
          usePoster
          onError={() => { setVideoFailed(true); if (big) autoAdvance(); }}
          onPlaybackStatusUpdate={(s) => { if (big && "didJustFinish" in s && s.didJustFinish) autoAdvance(); }}
          testID={`onboard-video-${phase}`}
        />
      ) : (
        <Image source={still} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}
      {phase === "form" && <View style={[StyleSheet.absoluteFill, styles.dim]} pointerEvents="none" />}

      {reduced && big && (
        <View style={styles.center}>
          <Text style={styles.reducedText}>
            {phase === "intro"
              ? "河的那一边，每一句没说出口的话，都会化成光雨，凝成一粒粒发光的灯籽。\n渡灯翁撑船，把其中一粒送到了你身边。"
              : "从今天起，我们的花园，就靠你的话来浇灌啦。"}
          </Text>
          <Pressable style={[styles.primary, { marginTop: spacing.lg }]} onPress={autoAdvance} testID="onboard-continue">
            <Text style={styles.primaryT}>继续</Text>
          </Pressable>
        </View>
      )}

      {big && (
        <Pressable style={styles.skip} onPress={autoAdvance} hitSlop={8} accessibilityRole="button" testID="onboard-skip">
          <Text style={styles.skipT}>{phase === "intro" ? "跳过" : "进入"}</Text>
        </Pressable>
      )}

      {phase === "name" && (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.bottom}>
          <Animated.View style={{ opacity: fade, gap: spacing.sm }}>
            <View style={[bubble, styles.left]}><Text style={styles.bubbleT}>嗨……是你在叫我吗？</Text></View>
            <View style={[bubble, styles.left]}><Text style={styles.bubbleT}>给我起个名字吧</Text></View>
            <View style={styles.inputRow}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="比如：麻薯"
                placeholderTextColor={colors.muted}
                maxLength={12}
                style={styles.input}
                returnKeyType="done"
                onSubmitEditing={() => setPhase("form")}
                testID="onboard-name"
              />
              <Pressable style={styles.okBtn} onPress={() => setPhase("form")} testID="onboard-name-ok">
                <Text style={styles.primaryT}>好了</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>渡灯翁说，被叫过名字的灯籽，会亮得更久</Text>
          </Animated.View>
        </KeyboardAvoidingView>
      )}

      {phase === "form" && (
        <Animated.View style={[styles.formWrap, { opacity: fade, paddingTop: Math.max(48, H * 0.07) }]}>
          <Text style={styles.title}>{oloName}想换个样子给你看看</Text>
          <Text style={styles.sub}>你喜欢哪一种？以后也能在商店里换</Text>
          <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
            {DENGZI_FORMS.map((f) => {
              const on = f.id === form;
              const w = Math.min(168, (W - spacing.md * 2 - spacing.sm * 2) / 2 - 2);
              return (
                <Pressable
                  key={f.id}
                  onPress={() => setForm(f.id)}
                  style={[styles.card, { width: w }, on && styles.cardOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  testID={`onboard-form-${f.id}`}
                >
                  <Image source={f.img} style={{ width: w * 0.62, height: w * 0.62 }} resizeMode="contain" />
                  <Text style={styles.cardT}>{f.label}</Text>
                  <Text style={styles.cardD}>{f.desc}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable style={[styles.primary, styles.formOk]} onPress={() => setPhase("gender")} testID="onboard-form-ok">
            <Text style={styles.primaryT}>就决定是{chosen.label}啦</Text>
          </Pressable>
        </Animated.View>
      )}

      {phase === "gender" && (
        <Animated.View style={[styles.bottom, { opacity: fade }]}>
          <View style={[bubble, styles.left]}><Text style={styles.bubbleT}>{oloName}：我该怎么称呼你呀？</Text></View>
          <View style={styles.chips}>
            {GENDERS.map(([g, label]) => (
              <Pressable key={g} style={[chip, styles.chipTouch, gender === g && chipOn]} onPress={() => setGender(g)} testID={`onboard-gender-${g}`}>
                <Text style={[styles.chipT, gender === g && { color: colors.onDark }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>只用来在日记里称呼你，可以不说</Text>
          <View style={styles.row}>
            <Pressable style={styles.ghost} onPress={() => { setGender("unspecified"); setPhase("outro"); }} testID="onboard-gender-skip">
              <Text style={styles.ghostT}>跳过</Text>
            </Pressable>
            <Pressable style={[styles.primary, { flex: 1 }]} onPress={() => setPhase("outro")} testID="onboard-gender-ok">
              <Text style={styles.primaryT}>好</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}

      {busy && <View style={[StyleSheet.absoluteFill, styles.center]}><ActivityIndicator color={colors.accent} /></View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.night },
  dim: { backgroundColor: "rgba(40,22,30,0.38)" },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  reducedText: { ...caption, fontFamily: fonts.body, fontSize: fonts.size.title, lineHeight: 32 },
  skip: {
    position: "absolute", top: 52, right: spacing.md, minHeight: TOUCH, minWidth: TOUCH * 1.6, paddingHorizontal: spacing.md,
    borderRadius: radii.pill, backgroundColor: colors.scrim, borderWidth: border.width, borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  skipT: { fontFamily: fonts.body, color: colors.onDark, fontSize: fonts.size.body },
  bottom: { position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.xl, gap: spacing.sm },
  left: { alignSelf: "flex-start", maxWidth: "86%" },
  bubbleT: { fontFamily: fonts.body, color: colors.ink, fontSize: fonts.size.body + 1 },
  inputRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  input: {
    flex: 1, minWidth: 0, width: 0, minHeight: TOUCH + 8, borderRadius: radii.pill, backgroundColor: colors.card, paddingHorizontal: spacing.lg,
    fontFamily: fonts.body, fontSize: fonts.size.body + 1, color: colors.ink, borderWidth: border.width, borderColor: border.colorInk,
  },
  okBtn: { minHeight: TOUCH + 8, paddingHorizontal: spacing.lg, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", ...shadows.glow },
  hint: { fontFamily: fonts.body, color: colors.onDark, fontSize: fonts.size.caption + 1, textAlign: "center", ...textShadow },
  formWrap: { ...StyleSheet.absoluteFillObject, paddingHorizontal: spacing.md },
  title: { fontFamily: fonts.body, color: colors.onDark, fontSize: fonts.size.h1 - 4, textAlign: "center", ...textShadow },
  sub: { fontFamily: fonts.body, color: colors.onDark, opacity: 0.9, fontSize: fonts.size.caption + 1, textAlign: "center", marginTop: 4, marginBottom: spacing.md, ...textShadow },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm, paddingBottom: 120 },
  card: {
    alignItems: "center", paddingVertical: spacing.sm, borderRadius: radii.lg, backgroundColor: colors.cardGlass,
    borderWidth: border.width, borderColor: border.color, ...shadows.soft,
  },
  cardOn: { backgroundColor: colors.card, borderColor: colors.accent, borderWidth: 3, ...shadows.glow },
  cardT: { fontFamily: fonts.body, color: colors.ink, fontSize: fonts.size.title },
  cardD: { fontFamily: fonts.body, color: colors.muted, fontSize: fonts.size.caption },
  formOk: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.xl },
  primary: { minHeight: TOUCH + 8, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, ...shadows.glow },
  primaryT: { fontFamily: fonts.body, color: colors.onDark, fontSize: fonts.size.title - 2 },
  chips: { flexDirection: "row", gap: spacing.sm, justifyContent: "center", marginTop: spacing.sm },
  chipTouch: { minHeight: TOUCH, justifyContent: "center" },
  chipT: { fontFamily: fonts.body, color: colors.ink, fontSize: fonts.size.body },
  row: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  ghost: { minHeight: TOUCH + 8, paddingHorizontal: spacing.lg, borderRadius: radii.pill, borderWidth: border.width, borderColor: "rgba(255,255,255,0.7)", alignItems: "center", justifyContent: "center", backgroundColor: colors.scrim },
  ghostT: { fontFamily: fonts.body, color: colors.onDark, fontSize: fonts.size.body },
});

