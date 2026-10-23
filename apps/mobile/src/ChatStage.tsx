// 聊天时 olo 不再被小框框住：全屏覆盖层（box-none，只有角色身体能点），站在最新气泡或输入栏上，
// 新消息来了蹦过去；能拖到任何地方，松手带速度甩出，落在气泡顶 / 输入栏上挤压回弹，停稳后蹦回落脚点。
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, PanResponder, StyleSheet, View, useWindowDimensions } from "react-native";

import { Character, CharacterAppearance } from "./Character";

export type Platform = { x0: number; x1: number; y: number; key: string; perchX: number; perch?: boolean };
type Mode = "home" | "hop" | "held" | "fling";
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

  const target = () => {
    const list = P.current;
    const p = list.find((q) => q.perch) ?? list[list.length - 1];
    if (!p) return { x: dims.current.width - 60, y: dims.current.height - 20, key: "ground" };
    return { x: p.perchX, y: p.y, key: p.key };
  };
  const setMode = (m: Mode) => { D.mode = m; setModeState(m); };
  const apply = () => {
    pos.setValue({ x: D.x - SIZE / 2, y: D.y - FOOT });
    const sq = D.ss;
    sxv.setValue(D.axis === "x" ? 1 - sq : 1 + sq);
    syv.setValue(D.axis === "x" ? 1 + sq * 0.6 : 1 - sq);
  };
  const loop = () => {
    D.raf = 0;
    const W = dims.current.width, H = dims.current.height;
    if (D.mode === "hop") {
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
      if (D.still > 14) hop();
    }
    apply();
    if (D.mode === "hop" || D.mode === "fling") D.raf = requestAnimationFrame(loop);
  };
  const hop = () => {
    const t = target();
    if (reduced.current) { D.x = t.x; D.y = t.y; D.ss = 0; setMode("home"); apply(); return; }
    Object.assign(D, { h0x: D.x, h0y: D.y, ht: Date.now(), hdur: 380 + Math.min(500, Math.hypot(t.x - D.x, t.y - D.y)) });
    setMode("hop");
    if (!D.raf) D.raf = requestAnimationFrame(loop);
  };

  // 落脚点变了（新气泡 / 滚动 / 键盘）：在家时蹦过去，或跟着平移
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
        accessibilityLabel={`olo perch:${perch} drag:${mode}`}
        pointerEvents="box-none"
        style={{ position: "absolute", left: 0, top: 0, width: SIZE, height: SIZE, transform: [{ translateX: pos.x }, { translateY: pos.y }, { translateY: FOOT / 2 }, { scaleX: sxv }, { scaleY: syv }, { translateY: -FOOT / 2 }] }}
      >
        <Character size={SIZE} appearance={appearance} mood={mood} held={mode === "held" || mode === "fling"} />
        <View testID="hero-hit" {...pan.panHandlers} style={styles.hit} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { position: "absolute", left: "22%", width: "56%", top: "36%", height: "58%" },
});
