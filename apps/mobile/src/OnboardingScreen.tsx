// 整屏引导 v2：门扉推开 → 虹膜分镜 → 空中碎壳 → 墨点写名 → 形态拖影 → 暗角收束。
// 与网页同一套 onboardFx；减少动态时仍整屏，但关掉门扉/碎片/墨点动画。
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
import {
  OB_BEATS, OB_FORMS, OB_GENDERS, OB_WORDS,
  crackPhase, doorOpen, morphTrail, nameInkTargets, seedInk, seedShards, stepInk, stepShards,
} from "./onboardFx";
import { layerPng } from "./skyPng";
import { paintScene } from "./skyScene";
import { FONT, colors, pixelBox, spacing, type } from "./theme";

type Step = "title" | "story" | "hatch" | "name" | "nick" | "gender" | "form" | "settle";

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
  const [doorT, setDoorT] = useState(0);
  const [hatchT, setHatchT] = useState(0);
  const [morph, setMorph] = useState(1);
  const bloom = useRef(new Animated.Value(0)).current;
  const walkX = useRef(new Animated.Value(-W * 0.4)).current;
  const vig = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduced);
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduced).catch(() => undefined);
    return () => sub?.remove?.();
  }, []);

  // 门扉打开（标题）
  useEffect(() => {
    if (step !== "title") return;
    if (reduced) { setDoorT(1); walkX.setValue(0); return; }
    let i = 0;
    const id = setInterval(() => { i++; setDoorT(Math.min(1, i / 16)); if (i >= 16) clearInterval(id); }, 30);
    Animated.timing(walkX, { toValue: 0, duration: 1200, delay: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    return () => clearInterval(id);
  }, [step, reduced, walkX]);

  // 空中碎壳
  useEffect(() => {
    if (step !== "hatch") return;
    if (reduced) { setHatchT(1); return; }
    setHatchT(0);
    let i = 0;
    const id = setInterval(() => { i++; setHatchT(Math.min(1, i / 70)); if (i >= 70) clearInterval(id); }, 28);
    return () => clearInterval(id);
  }, [step, reduced]);

  // 中央花开
  useEffect(() => {
    bloom.setValue(0);
    Animated.timing(bloom, { toValue: 1, duration: reduced ? 0 : 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [step, beat, reduced, bloom]);

  const hour = step === "story" ? OB_BEATS[beat].hour : step === "hatch" ? 20.2 : step === "form" ? 19 : 17.8;
  const bg = useMemo(() => {
    const u = Math.max(1, Math.round(Math.min(W, H) / 180));
    const w = Math.max(120, Math.round(W / u)), h = Math.max(80, Math.round(H / u));
    return { uri: layerPng(paintChatScene(skyAt(hour), { W: w, H: h, paintScene, date: new Date(), seed: 5, scrim: 0 }), 3) };
  }, [W, H, hour]);

  const color = OB_FORMS.find((f) => f[0] === form)?.[3] ?? "sun";
  const door = doorOpen(doorT);
  const crack = crackPhase(hatchT);
  const bloomStyle = {
    opacity: bloom,
    transform: [{ scale: bloom.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }],
  };

  async function finish() {
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      await completeOnboarding(settings, {
        name: name.trim() || "olo", form, color,
        user_gender: gender, user_nickname: nickname.trim() || undefined,
      });
      setStep("settle");
      if (!reduced) {
        await new Promise<void>((r) => Animated.sequence([
          Animated.timing(vig, { toValue: 0.9, duration: 480, useNativeDriver: true }),
          Animated.timing(vig, { toValue: 0, duration: 420, useNativeDriver: true }),
        ]).start(() => r()));
      }
      await saveOnboarded();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "连不上，稍后再试");
      setBusy(false); setStep("form");
    }
  }

  const trails = morphTrail(morph, 1);

  return (
    <View style={styles.root} testID="onboard-fs">
      <Image source={{ uri: bg.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} />
      <View style={styles.veil} pointerEvents="none" />

      {step === "title" && (
        <>
          <View style={styles.door} testID="door" pointerEvents="none">
            <View style={[styles.leaf, styles.leafL, { transform: [{ translateX: door.left * W * 0.5 }] }]}><View style={styles.knob} /></View>
            <View style={[styles.leaf, styles.leafR, { transform: [{ translateX: door.right * W * 0.5 }] }]}><View style={styles.knob} /></View>
          </View>
          <Animated.View style={[styles.heroWalk, { transform: [{ translateX: walkX }] }]}>
            <Character size={Math.min(200, W * 0.46)} mood="happy" appearance={{ form: "buddy", color: "sun" }} />
          </Animated.View>
        </>
      )}

      {step === "hatch" && (
        <View style={styles.hatch} testID="hatch">
          {crack.eggA > 0.05 && (
            <View style={[styles.egg, { opacity: crack.eggA, transform: [{ translateY: crack.floatY }] }]}>
              <View style={styles.eggBody} />
              {crack.crack ? <View style={styles.crackLine} /> : null}
            </View>
          )}
          {crack.showOlo && (
            <View style={{ opacity: crack.oloA, transform: [{ translateY: crack.floatY }] }}>
              <Character size={Math.min(220, W * 0.5)} mood="happy" appearance={{ form: "buddy", color: "sun" }} />
            </View>
          )}
          {!reduced && hatchT > 0.4 && hatchT < 0.95 ? <ShardBurst W={W} H={H} /> : null}
        </View>
      )}

      {(step === "form" || step === "settle") && (
        <View style={styles.heroCenter}>
          {!reduced && trails.slice(0, 2).map((tr, i) => (
            <View key={i} style={{ position: "absolute", opacity: tr.a, transform: [{ translateX: tr.ox }, { translateY: tr.oy }] }}>
              <Character size={Math.min(200, W * 0.44)} mood="happy" appearance={{ form, color }} />
            </View>
          ))}
          <Character size={Math.min(200, W * 0.44)} mood="happy" appearance={{ form, color }} />
        </View>
      )}

      {step === "story" && beat === 0 ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {OB_WORDS.map((w, j) => (
            <Text key={w} style={[styles.float, { left: W * (0.06 + j * 0.11), bottom: H * (0.24 + (j % 3) * 0.09) }]}>{w}</Text>
          ))}
        </View>
      ) : null}

      {step === "name" && !reduced ? <InkName name={name || "olo"} W={W} H={H} /> : null}

      <Animated.View style={[styles.sheet, pixelBox, bloomStyle]}>
        {step === "title" && (
          <>
            <Text style={styles.logo}>olo</Text>
            <Text style={styles.tag}>一颗会听你说话的灯籽</Text>
            <Pressable style={styles.btn} testID="start" onPress={() => setStep("story")}><Text style={styles.btnT}>▶ 推开这扇门</Text></Pressable>
            <Pressable testID="skip-story" onPress={() => setStep("hatch")}><Text style={styles.skip}>跳过故事</Text></Pressable>
          </>
        )}
        {step === "story" && (
          <>
            <View style={styles.dots}>{OB_BEATS.map((_, i) => <View key={i} style={[styles.dot, i <= beat && styles.dotOn]} />)}</View>
            <Text style={styles.who}>{OB_BEATS[beat].who}</Text>
            <Pressable testID="next" onPress={() => (beat + 1 < OB_BEATS.length ? setBeat(beat + 1) : setStep("hatch"))}>
              <Text style={styles.story}>{OB_BEATS[beat].text}</Text>
              <Text style={styles.caret}>▼</Text>
            </Pressable>
          </>
        )}
        {step === "hatch" && (
          <>
            <Text style={styles.who}>???</Text>
            <Text style={styles.story}>嗨……是你在叫我吗？</Text>
            <Pressable style={styles.btn} testID="hello" onPress={() => setStep("name")} disabled={hatchT < 0.6 && !reduced}>
              <Text style={styles.btnT}>是我！</Text>
            </Pressable>
          </>
        )}
        {step === "name" && (
          <>
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
        {(step === "form" || step === "settle") && (
          <>
            <Text style={styles.h2}>{(name.trim() || "olo")} 想长成什么样子？</Text>
            <View style={styles.forms}>
              {OB_FORMS.map(([id, label, d, col]) => (
                <Pressable key={id} testID={`form-${id}`} onPress={() => { setForm(id); setMorph(0); requestAnimationFrame(() => setMorph(1)); }} style={[styles.formCard, form === id && styles.choiceOn]}>
                  <Character size={52} mood="happy" appearance={{ form: id, color: col }} />
                  <Text style={styles.choiceT}>{label}</Text>
                  <Text style={styles.hint}>{d}</Text>
                </Pressable>
              ))}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable style={styles.btn} testID="form-ok" onPress={finish} disabled={busy || step === "settle"}>
              <Text style={styles.btnT}>{busy || step === "settle" ? "点灯中…" : "就是这样，开始聊天 ▶"}</Text>
            </Pressable>
          </>
        )}
      </Animated.View>

      <Animated.View pointerEvents="none" style={[styles.vignette, { opacity: vig }]} />
    </View>
  );
}

function InkName({ name, W, H }: { name: string; W: number; H: number }) {
  const pts = useMemo(() => nameInkTargets(name, W / 2, H * 0.22, 4), [name, W, H]);
  const inks = useRef(seedInk(pts, 48)).current;
  const [tick, setTick] = useState(0);
  useEffect(() => { inks.splice(0, inks.length, ...seedInk(pts, 48)); setTick(0); }, [pts, inks]);
  useEffect(() => {
    const id = setInterval(() => { stepInk(inks, Math.min(1, tick / 40)); setTick((t) => t + 1); }, 32);
    return () => clearInterval(id);
  }, [inks, tick]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {inks.map((d, i) => <View key={i} style={{ position: "absolute", left: d.x, top: d.y, width: 3, height: 3, backgroundColor: "#2a140c", opacity: 0.7 }} />)}
    </View>
  );
}

function ShardBurst({ W, H }: { W: number; H: number }) {
  const shards = useRef(seedShards(18, 0, 0)).current;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { stepShards(shards, false); setTick((t) => t + 1); }, 32);
    return () => clearInterval(id);
  }, [shards]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {shards.map((s, i) => (
        <View key={i} style={{
          position: "absolute", left: W / 2 + s.x * 10, top: H * 0.36 + s.y * 10,
          width: s.w * 3, height: s.h * 3, backgroundColor: ["#ffc455", "#ffd98a", "#b36b1e"][s.tone],
          opacity: Math.max(0, 1 - s.life / s.max), transform: [{ rotate: `${s.rot}rad` }],
        }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#2a1422" },
  veil: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(42,20,34,0.2)" },
  door: { ...StyleSheet.absoluteFillObject, flexDirection: "row", zIndex: 5 },
  leaf: { flex: 1, backgroundColor: "#6b3a2e", borderColor: "#2a140c", borderWidth: 4, justifyContent: "center" },
  leafL: { alignItems: "flex-end", paddingRight: 14 },
  leafR: { alignItems: "flex-start", paddingLeft: 14 },
  knob: { width: 12, height: 12, backgroundColor: "#ffd98a", borderWidth: 2, borderColor: "#2a140c" },
  heroWalk: { position: "absolute", top: "34%", left: "28%", zIndex: 2 },
  heroCenter: { position: "absolute", top: "22%", alignSelf: "center", zIndex: 2, width: 220, height: 220, alignItems: "center", justifyContent: "center" },
  hatch: { position: "absolute", top: "28%", alignSelf: "center", width: 240, height: 240, alignItems: "center", justifyContent: "center", zIndex: 2 },
  egg: { position: "absolute", alignItems: "center", justifyContent: "center" },
  eggBody: { width: 72, height: 88, borderRadius: 36, backgroundColor: "#ffc455", borderWidth: 3, borderColor: "#b36b1e" },
  crackLine: { position: "absolute", width: 3, height: 50, backgroundColor: "#4f3510", transform: [{ rotate: "18deg" }] },
  sheet: {
    position: "absolute", left: 18, right: 18, top: "52%", backgroundColor: "#5a2c34",
    padding: spacing.md, gap: spacing.sm, alignItems: "center", zIndex: 3, maxHeight: "44%",
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
  vignette: { ...StyleSheet.absoluteFillObject, backgroundColor: "#2a1422", zIndex: 8 },
});
