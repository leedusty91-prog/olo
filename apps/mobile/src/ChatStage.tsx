// 聊天时 olo 不再被小框框住：全屏覆盖层（box-none，只有角色身体能点）。落脚点带权重随机：
// 各条气泡顶、输入栏边，不总守着最新一句的末端；身体不压任何气泡文字、离正在打字的气泡远点；
// 站定 8–20 秒才换地方（同一条边走过去，换边蹦过去），闲久了坐下/打盹；能拖到任何地方，松手带速度甩出，落在气泡顶 / 输入栏上挤压回弹，停稳后蹦回落脚点。
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, PanResponder, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { Character, CharacterAppearance } from "./Character";

// h: 这块平台（气泡/输入栏）本身的高度——它的矩形就是不能挡的文字区；end: 最新回复（别站末端）；busy: 正在打字
export type Platform = { x0: number; x1: number; y: number; key: string; h?: number; end?: boolean; busy?: boolean };
type Mode = "home" | "hop" | "held" | "fling" | "walk";
type Spot = { key: string; f: number };
type Mood = "idle" | "listening" | "thinking" | "speaking";

const SIZE = 96; // 32px 像素 ×3
const FOOT = SIZE * (30 / 32); // 脚底在帧内的位置

export function ChatStage({
  platforms,
  appearance,
  mood,
  hidden,
}: {
  platforms: Platform[];
  appearance?: CharacterAppearance;
  mood: Mood;
  hidden?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const pos = useRef(new Animated.ValueXY({ x: width - 80, y: height - 120 })).current;
  const sxv = useRef(new Animated.Value(1)).current;
  const syv = useRef(new Animated.Value(1)).current;
  const [mode, setModeState] = useState<Mode>("home");
  const [perch, setPerch] = useState("");
  const reduced = useRef(false);
  const D = useRef({ mode: "home" as Mode, x: width - 80, y: height - 120, vx: 0, vy: 0, ss: 0, axis: "y", still: 0, hx: 0, hy: 0, ht: 0, hdur: 1, h0x: 0, h0y: 0, gx: 0, gy: 0, raf: 0 }).current;
  const P = useRef(platforms);
  P.current = platforms;
  const dims = useRef({ width, height });
  dims.current = { width, height };

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then((r) => (reduced.current = r)).catch(() => undefined);
    return () => cancelAnimationFrame(D.raf);
  }, []);

  const FW = SIZE * 0.5, FH = SIZE * 0.62; // 身体占的矩形（脚底往上）
  const spot = useRef<Spot | null>(null);
  const dwellUntil = useRef(0);
  const [pose, setPose] = useState<"" | "sit" | "sleep">("");
  const poseRef = useRef(pose);
  poseRef.current = pose;
  const clear = (x: number, y: number) => {
    const l = x - FW / 2, r = x + FW / 2, t = y - FH, b = y - 2;
    if (l < 4 || r > dims.current.width - 4 || t < 40) return false;
    return !P.current.some((q) => {
      const pad = q.busy ? 24 : 2;
      return l < q.x1 + pad && r > q.x0 - pad && t < q.y + (q.h ?? 40) + pad && b > q.y - pad;
    });
  };
  const posOf = (sp: Spot | null) => {
    const q = sp && P.current.find((z) => z.key === sp.key);
    return q && sp ? { x: q.x0 + sp.f * (q.x1 - q.x0), y: q.y } : null;
  };
  const pick = (): Spot => {
    const c: (Spot & { wt: number })[] = [];
    const bubbles = P.current.filter((q) => q.key.startsWith("bubble-"));
    const last = bubbles[bubbles.length - 1], busy = P.current.find((q) => q.busy);
    for (const q of P.current) {
      if (q.x1 - q.x0 < FW) continue;
      const fs = [0.12, 0.3, 0.5, 0.7, 0.88].filter((f) => !(q.end && f > 0.75) && clear(q.x0 + f * (q.x1 - q.x0), q.y));
      for (const f of fs) {
        const x = q.x0 + f * (q.x1 - q.x0);
        let wt = q.key === "composer" ? 0.9 : 1;
        if (q === last) wt *= busy ? 0.4 : 1.3;
        if (spot.current && spot.current.key === q.key && Math.abs(spot.current.f - f) < 0.1) wt *= 0.05;
        wt *= 1 / (1 + Math.hypot(x - D.x, q.y - D.y) / 700);
        if (busy && Math.abs(q.y - busy.y) < 260) wt *= 1.4;
        c.push({ key: q.key, f, wt: wt / fs.length });
      }
    }
    if (!c.length) return { key: "ground", f: 0.85 };
    let r = Math.random() * c.reduce((a, b) => a + b.wt, 0);
    for (const z of c) if ((r -= z.wt) <= 0) return z;
    return c[c.length - 1];
  };
  const dwell = () => (dwellUntil.current = Date.now() + 8000 + Math.random() * 12000);
  const target = () => {
    let p = posOf(spot.current);
    if (!p || !clear(p.x, p.y)) {
      if (D.mode === "home" || D.mode === "walk" || !p) { spot.current = pick(); p = posOf(spot.current); }
    }
    if (!p) return { x: dims.current.width - 60, y: dims.current.height - 20, key: "ground" };
    return { x: p.x, y: p.y, key: spot.current!.key };
  };
  const setMode = (m: Mode) => { D.mode = m; setModeState(m); };
  const apply = () => {
    pos.setValue({ x: D.x - SIZE / 2, y: D.y - FOOT });
    const sq = D.ss;
    sxv.setValue(D.axis === "x" ? 1 - sq : 1 + sq);
    const low = D.mode === "home" && poseRef.current ? 0.08 : 0; // 坐下/打盹：矮一点、胖一点
    sxv.setValue((D.axis === "x" ? 1 - sq : 1 + sq) + low * 0.7);
    syv.setValue((D.axis === "x" ? 1 + sq * 0.6 : 1 - sq) - low);
  };
  const loop = () => {
    D.raf = 0;
    const W = dims.current.width, H = dims.current.height;
    if (D.mode === "walk") {
      const t = target(), dx = t.x - D.x;
      D.x += Math.sign(dx) * Math.min(Math.abs(dx), 1.6);
      D.y = t.y - Math.abs(Math.sin(Date.now() / 90)) * 3;
      if (Math.abs(dx) < 1) { D.x = t.x; D.y = t.y; setMode("home"); }
    } else if (D.mode === "hop") {
      const t = target();
      const p = Math.min(1, (Date.now() - D.ht) / D.hdur);
      D.x = D.h0x + (t.x - D.h0x) * p;
      D.y = D.h0y + (t.y - D.h0y) * p - Math.sin(p * Math.PI) * Math.max(30, Math.abs(t.y - D.h0y) * 0.4);
      D.ss = p > 0.92 ? 0.15 : 0;
      if (p >= 1) { D.x = t.x; D.y = t.y; D.ss = 0; setMode("home"); }
    } else if (D.mode === "fling") {
      const oldY = D.y;
      D.vy += 1.1; D.x += D.vx; D.y += D.vy; D.vx *= 0.99;
      const half = SIZE * 0.3;
      if (D.x < half || D.x > W - half) { D.x = Math.max(half, Math.min(W - half, D.x)); D.vx *= -0.7; D.ss = Math.min(0.3, Math.abs(D.vx) * 0.02); D.axis = "x"; }
      if (D.y - FOOT < 0) { D.y = FOOT; D.vy *= -0.5; }
      // 落在平台上（气泡顶 / 输入栏），否则落到屏幕底
      let floor = H - 4;
      for (const q of P.current) if (D.x > q.x0 && D.x < q.x1 && oldY <= q.y + 1 && D.y >= q.y) floor = Math.min(floor, q.y);
      if (D.y >= floor) {
        const imp = D.vy; D.y = floor;
        if (imp > 3) { D.ss = Math.min(0.35, imp * 0.025); D.axis = "y"; D.vy = -imp * 0.58; D.vx *= 0.85; }
        else { D.vy = 0; D.vx *= 0.85; }
      }
      D.ss *= 0.8;
      D.still = Math.abs(D.vy) < 0.01 && Math.abs(D.vx) < 0.6 && D.ss < 0.02 ? D.still + 1 : 0;
      if (D.still > 14) {
        const on = P.current.find((q) => Math.abs(q.y - D.y) < 1 && D.x >= q.x0 && D.x <= q.x1);
        if (on && clear(D.x, on.y)) { spot.current = { key: on.key, f: (D.x - on.x0) / Math.max(1, on.x1 - on.x0) }; setPerch(on.key); dwell(); setMode("home"); }
        else { spot.current = pick(); dwell(); hop(); }
      }
    }
    apply();
    if (D.mode === "hop" || D.mode === "fling" || D.mode === "walk") D.raf = requestAnimationFrame(loop);
  };
  const hop = () => {
    const t = target();
    if (reduced.current) { D.x = t.x; D.y = t.y; D.ss = 0; setMode("home"); apply(); return; }
    Object.assign(D, { h0x: D.x, h0y: D.y, ht: Date.now(), hdur: 380 + Math.min(500, Math.hypot(t.x - D.x, t.y - D.y)) });
    setMode("hop");
    if (!D.raf) D.raf = requestAnimationFrame(loop);
  };

  // 换地方：先等一会儿；闲着时偶尔坐下/打盹；同一条边走过去，换边蹦过去
  const moveTo = (sp: Spot) => {
    const prev = spot.current; spot.current = sp; dwell(); setPose("");
    if (D.mode !== "home") return;
    if (prev && prev.key === sp.key && !reduced.current) { setMode("walk"); if (!D.raf) D.raf = requestAnimationFrame(loop); }
    else hop();
  };
  const moodRef = useRef(mood);
  moodRef.current = mood;
  useEffect(() => {
    dwell();
    const iv = setInterval(() => {
      if (reduced.current || D.mode !== "home" || Date.now() < dwellUntil.current) return;
      if (moodRef.current === "idle" && Math.random() < 0.3) { setPose((v) => (v ? v : Math.random() < 0.5 ? "sit" : "sleep")); dwell(); }
      else moveTo(pick());
    }, 1000);
    return () => clearInterval(iv);
  }, []);
  // 有新消息：一半机会挪近一点（但不一定站到它上面）
  const count = P.current.filter((q) => q.key.startsWith("bubble-")).length;
  useEffect(() => { if (mood !== "idle") setPose(""); }, [mood]);
  useEffect(() => { if (D.mode === "home") apply(); }, [pose]);
  useEffect(() => { if (count && Math.random() < 0.5 && !reduced.current) moveTo(pick()); }, [count]);
  // 落脚点失效（滚动 / 键盘 / 被打字气泡挤到）：在家时蹦去新地方，否则跟着平移
  const key = target().key;
  useEffect(() => {
    setPerch(key);
    if (D.mode === "home") hop();
  }, [key]);
  const t = target();
  useEffect(() => {
    if (D.mode === "home") { D.x = t.x; D.y = t.y; apply(); }
  }, [t.x, t.y]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        cancelAnimationFrame(D.raf); D.raf = 0;
        Object.assign(D, { vx: 0, vy: 0, gx: D.x, gy: D.y, ss: 0 });
        setMode("held");
      },
      onPanResponderMove: (_e, g) => {
        D.x = Math.max(0, Math.min(dims.current.width, D.gx + g.dx));
        D.y = Math.max(FOOT, Math.min(dims.current.height, D.gy + g.dy));
        const k = Math.min(0.3, Math.hypot(g.vx, g.vy) * 0.12);
        D.axis = Math.abs(g.vx) > Math.abs(g.vy) ? "x" : "y"; D.ss = D.axis === "x" ? -k : -k;
        apply();
      },
      onPanResponderRelease: (_e, g) => {
        if (reduced.current) { hop(); return; }
        D.vx = Math.max(-34, Math.min(34, g.vx * 16)); D.vy = Math.max(-34, Math.min(34, g.vy * 16));
        D.ss = 0; D.still = 0; setMode("fling");
        D.raf = requestAnimationFrame(loop);
      },
      onPanResponderTerminate: () => { D.vx = D.vy = 0; setMode("fling"); D.raf = requestAnimationFrame(loop); },
    }),
  ).current;

  if (hidden) return null;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} testID="olo-stage">
      <Animated.View
        testID="hero"
        accessibilityLabel={`olo perch:${perch} drag:${mode} pose:${pose}`}
        pointerEvents="box-none"
        style={{ position: "absolute", left: 0, top: 0, width: SIZE, height: SIZE, transform: [{ translateX: pos.x }, { translateY: pos.y }, { translateY: FOOT / 2 }, { scaleX: sxv }, { scaleY: syv }, { translateY: -FOOT / 2 }] }}
      >
        <Character size={SIZE} appearance={appearance} mood={mood} held={mode === "held" || mode === "fling"} />
        <View testID="hero-hit" {...pan.panHandlers} style={styles.hit} />
        {pose === "sleep" ? <Text style={styles.zz}>z z</Text> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  zz: { position: "absolute", right: 8, top: 6, fontSize: 11, fontWeight: "700", color: "#fff7e8", textShadowColor: "#2a1422", textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 0 },
  hit: { position: "absolute", left: "22%", width: "56%", top: "36%", height: "58%" },
});
