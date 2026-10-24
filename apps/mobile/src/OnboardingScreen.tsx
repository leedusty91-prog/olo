// 整屏引导：暖色风景铺满、olo 弹跳入场、花粉萤火；步骤与网页一致（标题→故事→破壳→起名→昵称→性别→样子）。
// 减少动态时仍是整屏，但关掉弹跳和花粉。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Character } from "./Character";
import { Settings, UserGender, completeOnboarding } from "./api";
import { paintChatScene } from "./chatBg";
import { skyAt } from "./daytime";
import { saveOnboarded } from "./onboarding";
import { OB_BEATS, OB_FORMS, OB_GENDERS, OB_WORDS, seedMotes, stepMotes } from "./onboardFx";
import { layerPng } from "./skyPng";
import { paintScene } from "./skyScene";
import { FONT, colors, pixelBox, spacing, type } from "./theme";

type Step = "title" | "story" | "hatch" | "name" | "nick" | "gender" | "form";

export function OnboardingScreen({ settings, onDone }: { settings: Settings; onDone: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const [step, setStep] = useState<Step>("title");
  const [beat, setBeat] = useState(0);
  const [name, setName] = useState("olo");
  const [nickname, setNickname] = useState("");
  const [gender, setGender] = useState<UserGender>("unspecified");
  const [form, setForm] = useState("buddy");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reduced, setReduced] = useState(false);
  const bounce = useRef(new Animated.Value(0)).current;
  const panelY = useRef(new Animated.Value(40)).current;
  const panelA = useRef(new Animated.Value(0)).current;
  const hatchT = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduced);
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduced).catch(() => undefined);
    return () => sub?.remove?.();
  }, []);

  useEffect(() => {
    panelY.setValue(40); panelA.setValue(0);
    Animated.parallel([
      Animated.timing(panelY, { toValue: 0, duration: reduced ? 0 : 420, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
      Animated.timing(panelA, { toValue: 1, duration: reduced ? 0 : 360, useNativeDriver: true }),
    ]).start();
    if (step === "title" || step === "form" || step === "hatch") {
      bounce.setValue(0);
      if (!reduced) Animated.spring(bounce, { toValue: 1, friction: 4, tension: 80, useNativeDriver: true }).start();
      else bounce.setValue(1);
    }
    if (step === "hatch") {
      hatchT.setValue(0);
      Animated.timing(hatchT, { toValue: 1, duration: reduced ? 0 : 700, easing: Easing.linear, useNativeDriver: true }).start();
    }
  }, [step, beat, reduced, bounce, panelY, panelA, hatchT]);

  const hour = step === "story" ? OB_BEATS[beat].hour : step === "hatch" ? 20.2 : step === "form" ? 19 : 17.8;
  const bg = useMemo(() => {
    const u = Math.max(1, Math.round(Math.min(W, H) / 180));
    const w = Math.max(120, Math.round(W / u)), h = Math.max(80, Math.round(H / u));
    return { uri: layerPng(paintChatScene(skyAt(hour), { W: w, H: h, paintScene, date: new Date(), seed: 5, scrim: 0 }), 3), w, h };
  }, [W, H, hour]);

  const color = OB_FORMS.find((f) => f[0] === form)?.[3] ?? "sun";
  const scale = bounce.interpolate({ inputRange: [0, 0.55, 0.75, 1], outputRange: [0.2, 1.22, 0.9, 1] });
  const hatchScaleAnim = hatchT.interpolate({
    inputRange: [0, 0.35, 0.55, 0.75, 1],
    outputRange: [0.15, 1.3, 0.85, 1.1, 1],
  });

  async function finish() {
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      await completeOnboarding(settings, {
        name: name.trim() || "olo",
        form,
        color,
        user_gender: gender,
        user_nickname: nickname.trim() || undefined,
      });
      await saveOnboarded();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "连不上，稍后再试");
      setBusy(false);
    }
  }

  return (
    <View style={styles.root} testID="onboard-fs">
      <Image source={{ uri: bg.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} />
      <View style={styles.veil} pointerEvents="none" />
      {!reduced ? <Motes W={W} H={H} night={hour >= 19} /> : null}

      {(step === "title" || step === "form") && (
        <Animated.View style={[styles.hero, { transform: [{ scale: step === "form" ? scale : scale }] }]}>
          <Character size={Math.min(220, W * 0.48)} mood="happy" appearance={{ form, color }} />
        </Animated.View>
      )}
      {step === "hatch" && (
        <Animated.View style={[styles.hero, { transform: [{ scale: hatchScaleAnim }] }]} testID="hatch">
          <Character size={Math.min(240, W * 0.52)} mood="happy" appearance={{ form: "buddy", color: "sun" }} />
        </Animated.View>
      )}
      {step === "story" && beat === 0 ? <FloatingWords W={W} H={H} /> : null}

      <Animated.View style={[styles.sheet, pixelBox, { opacity: panelA, transform: [{ translateY: panelY }] }]}>
        {step === "title" && (
          <>
            <Text style={styles.logo}>olo</Text>
            <Text style={styles.tag}>一颗会听你说话的灯籽</Text>
            <Pressable style={styles.btn} testID="start" onPress={() => setStep("story")}><Text style={styles.btnT}>▶ 开始相遇</Text></Pressable>
            <Pressable testID="skip-story" onPress={() => setStep("hatch")}><Text style={styles.skip}>跳过故事</Text></Pressable>
          </>
        )}
        {step === "story" && (
          <>
            <View style={styles.dots}>{OB_BEATS.map((_, i) => <View key={i} style={[styles.dot, i <= beat && styles.dotOn]} />)}</View>
            <Text style={styles.who}>{OB_BEATS[beat].who}</Text>
            <Pressable testID="next" onPress={() => (beat + 1 < OB_BEATS.length ? setBeat(beat + 1) : setStep("hatch"))}>
              <Text style={styles.story} data-beat={beat}>{OB_BEATS[beat].text}</Text>
              <Text style={styles.caret}>▼</Text>
            </Pressable>
          </>
        )}
        {step === "hatch" && (
          <>
            <Text style={styles.who}>???</Text>
            <Text style={styles.story}>嗨……是你在叫我吗？</Text>
            <Pressable style={styles.btn} testID="hello" onPress={() => setStep("name")}><Text style={styles.btnT}>是我！</Text></Pressable>
          </>
        )}
        {step === "name" && (
          <>
            <Character size={96} mood="idle" appearance={{ form: "buddy", color: "sun" }} />
            <Text style={styles.h2}>给我起个名字吧</Text>
            <Text style={styles.hint}>芦婆婆说，被叫过名字的灯籽，会亮得更久。</Text>
            <TextInput style={styles.input} testID="name" value={name} onChangeText={setName} maxLength={12} placeholder="olo" placeholderTextColor={colors.muted} />
            <Pressable style={styles.btn} testID="name-ok" onPress={() => setStep("nick")}><Text style={styles.btnT}>就叫这个</Text></Pressable>
          </>
        )}
        {step === "nick" && (
          <View testID="nickname-step">
            <Text style={styles.h2}>你想让 {name.trim() || "olo"} 怎么称呼你？</Text>
            <Text style={styles.hint}>可以不填，之后可以在设置里改。</Text>
            <TextInput style={styles.input} testID="nickname-input" value={nickname} onChangeText={setNickname} maxLength={12} placeholder="你的昵称" placeholderTextColor={colors.muted} />
            <View style={styles.row}>
              <Pressable style={[styles.btn, styles.ghost]} testID="nickname-skip" onPress={() => { setNickname(""); setStep("gender"); }}><Text style={styles.btnT}>跳过</Text></Pressable>
              <Pressable style={styles.btn} testID="nickname-ok" onPress={() => setStep("gender")}><Text style={styles.btnT}>好</Text></Pressable>
            </View>
          </View>
        )}
        {step === "gender" && (
          <View testID="gender-step">
            <Text style={styles.h2}>{(name.trim() || "olo")} 在日记里该怎么称呼你？</Text>
            <Text style={styles.hint}>只用在日记里，之后可以改。</Text>
            {OB_GENDERS.map(([id, label, d]) => (
              <Pressable key={id} testID={`gender-${id}`} onPress={() => setGender(id as UserGender)} style={[styles.choice, gender === id && styles.choiceOn]}>
                <Text style={styles.choiceT}>{label}</Text>
                <Text style={styles.hint}>{d}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.btn} testID="gender-ok" onPress={() => setStep("form")}><Text style={styles.btnT}>好</Text></Pressable>
          </View>
        )}
        {step === "form" && (
          <>
            <Text style={styles.h2}>{(name.trim() || "olo")} 想长成什么样子？</Text>
            <View style={styles.forms}>
              {OB_FORMS.map(([id, label, d, col]) => (
                <Pressable key={id} testID={`form-${id}`} onPress={() => setForm(id)} style={[styles.formCard, form === id && styles.choiceOn]}>
                  <Character size={56} mood="happy" appearance={{ form: id, color: col }} />
                  <Text style={styles.choiceT}>{label}</Text>
                  <Text style={styles.hint}>{d}</Text>
                </Pressable>
              ))}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable style={styles.btn} testID="form-ok" onPress={finish} disabled={busy}>
              <Text style={styles.btnT}>{busy ? "点灯中…" : "就是这样，开始聊天 ▶"}</Text>
            </Pressable>
          </>
        )}
      </Animated.View>
    </View>
  );
}

function FloatingWords({ W, H }: { W: number; H: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {OB_WORDS.map((w, j) => (
        <Text key={w} style={[styles.float, { left: `${6 + j * 11}%` as unknown as number, bottom: H * (0.24 + (j % 3) * 0.09) }]}>{w}</Text>
      ))}
    </View>
  );
}

function Motes({ W, H, night }: { W: number; H: number; night: boolean }) {
  const [ticks, setTicks] = useState(0);
  const motes = useRef(seedMotes(22, W, H, night)).current;
  useEffect(() => {
    const id = setInterval(() => { stepMotes(motes, W, H, 1, false); setTicks((t) => t + 1); }, 48);
    return () => clearInterval(id);
  }, [W, H, motes]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {motes.map((m, i) => (
        <View key={i} style={{ position: "absolute", left: m.x, top: m.y, width: m.r * 2, height: m.r * 2, backgroundColor: m.warm ? "#ffd98a" : "#fff6e0", opacity: 0.45 + (Math.sin(m.ph + ticks * 0.04) + 1) * 0.2 }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#2a1422" },
  veil: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(42,20,34,0.18)" },
  hero: { position: "absolute", top: "28%", alignSelf: "center", zIndex: 2 },
  sheet: {
    position: "absolute", left: 16, right: 16, bottom: 24, backgroundColor: "#5a2c34",
    padding: spacing.md, gap: spacing.sm, alignItems: "center", zIndex: 3, maxHeight: "62%",
  },
  logo: { fontFamily: FONT, fontSize: 56, color: "#ffd98a", letterSpacing: 4 },
  tag: { fontFamily: FONT, fontSize: type.sm, color: colors.muted, textAlign: "center" },
  h2: { fontFamily: FONT, fontSize: type.lg, color: "#fff3dc", textAlign: "center" },
  hint: { fontFamily: FONT, fontSize: type.xs, color: colors.muted, textAlign: "center" },
  who: { fontFamily: FONT, fontSize: type.xs, color: "#2a140c", backgroundColor: "#ffd98a", paddingHorizontal: 8, alignSelf: "flex-start" },
  story: { fontFamily: FONT, fontSize: type.md, color: "#fff3dc", lineHeight: 28 },
  caret: { fontFamily: FONT, fontSize: type.xs, color: "#ffd98a", alignSelf: "flex-end" },
  btn: { backgroundColor: "#ffb347", paddingVertical: 12, paddingHorizontal: 22, borderWidth: 2, borderColor: "#2a140c", marginTop: 6 },
  ghost: { backgroundColor: "#74393a" },
  btnT: { fontFamily: FONT, fontSize: type.md, color: "#2a140c", textAlign: "center" },
  skip: { fontFamily: FONT, fontSize: type.xs, color: colors.muted, textDecorationLine: "underline", marginTop: 4 },
  input: { width: "100%", borderWidth: 2, borderColor: "#2a140c", backgroundColor: "#fff3dc", paddingHorizontal: 12, paddingVertical: 8, fontFamily: FONT, fontSize: type.md, color: colors.ink },
  row: { flexDirection: "row", gap: 10 },
  choice: { width: "100%", backgroundColor: "#fffaf0", borderWidth: 2, borderColor: "#2a140c", padding: 10, marginTop: 6 },
  choiceOn: { backgroundColor: "#ffd98a" },
  choiceT: { fontFamily: FONT, fontSize: type.md, color: colors.ink },
  forms: { flexDirection: "row", gap: 8 },
  formCard: { flex: 1, alignItems: "center", backgroundColor: "#fffaf0", borderWidth: 2, borderColor: "#2a140c", padding: 6 },
  dots: { flexDirection: "row", gap: 8, marginBottom: 6 },
  dot: { width: 10, height: 10, backgroundColor: "#74393a" },
  dotOn: { backgroundColor: "#ffb347" },
  error: { fontFamily: FONT, fontSize: type.xs, color: colors.error },
  float: { position: "absolute", fontFamily: FONT, fontSize: 11, color: "#fff0d8", opacity: 0.7 },
});
