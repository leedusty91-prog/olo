// olo 角色：与网页同一套像素形态（麻薯 / 云朵 / 微光），帧图由 scripts/gen_mobile_sprites.py 从 web/pixel.js 渲染。
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Image,
  ImageSourcePropType,
  PanResponder,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

import { LAYERS } from "./oloLayers";

export type Mood = "idle" | "listening" | "thinking" | "speaking" | "happy" | "sleep";

export type CharacterAppearance = {
  color?: string;
  eyes?: string;
  cheeks?: string;
  hair?: string;
  voice?: string;
  form?: string;
};

type Props = {
  size?: number;
  mood?: Mood;
  appearance?: CharacterAppearance;
  /** 内部用：拖拽时用「被抓起来」的惊讶帧 */
  held?: boolean;
};

const FRAMES = 12;
const FRAME_MS = 220;

/* eslint-disable @typescript-eslint/no-require-imports */
const SHEETS: Record<string, Record<string, ImageSourcePropType>> = {
  buddy: {
    idle: require("../assets/olo/buddy-idle.png"),
    happy: require("../assets/olo/buddy-happy.png"),
    talking: require("../assets/olo/buddy-talking.png"),
    sad: require("../assets/olo/buddy-sad.png"),
    thinking: require("../assets/olo/buddy-thinking.png"),
    held: require("../assets/olo/buddy-held.png"),
    sleep: require("../assets/olo/buddy-sleep.png"),
  },
  cloud: {
    idle: require("../assets/olo/cloud-idle.png"),
    happy: require("../assets/olo/cloud-happy.png"),
    talking: require("../assets/olo/cloud-talking.png"),
    sad: require("../assets/olo/cloud-sad.png"),
    thinking: require("../assets/olo/cloud-thinking.png"),
    held: require("../assets/olo/cloud-held.png"),
    sleep: require("../assets/olo/cloud-sleep.png"),
  },
  glow: {
    idle: require("../assets/olo/glow-idle.png"),
    happy: require("../assets/olo/glow-happy.png"),
    talking: require("../assets/olo/glow-talking.png"),
    sad: require("../assets/olo/glow-sad.png"),
    thinking: require("../assets/olo/glow-thinking.png"),
    held: require("../assets/olo/glow-held.png"),
    sleep: require("../assets/olo/glow-sleep.png"),
  },
};

const STATE_FOR: Record<Mood, string> = {
  idle: "idle",
  listening: "happy",
  thinking: "thinking",
  speaking: "talking",
  happy: "happy",
  sleep: "sleep",
};

export function Character({ size = 220, mood = "idle", appearance, held = false }: Props) {
  const form = appearance?.form && SHEETS[appearance.form] ? appearance.form : "buddy";
  const state = held ? "held" : STATE_FOR[mood] ?? "idle";
  const sheet = SHEETS[form][state];
  // 装扮层：只含与默认外观不同的像素，叠在底图上（发型 / 眼睛 / 脸颊各一层）
  const overlays = (["eyes", "cheeks", "hair"] as const)
    .map((k) => LAYERS[`${form}/${state}/${k}/${appearance?.[k] ?? ""}`])
    .filter((src): src is ImageSourcePropType => !!src);
  const [frame, setFrame] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduced).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (reduced) {
      setFrame(0);
      return;
    }
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES), FRAME_MS);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <View
      style={[styles.box, { width: size, height: size }]}
      accessibilityRole="image"
      accessibilityLabel="olo"
      testID={`olo-${form}`}
    >
      {[sheet, ...overlays].map((src, i) => (
        <Image
          key={i}
          source={src}
          resizeMode="stretch"
          fadeDuration={0}
          style={[styles.sheet, { width: size * FRAMES, height: size, transform: [{ translateX: -frame * size }] }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: "hidden" },
  sheet: { position: "absolute", left: 0, top: 0 },
});

type Phase = "home" | "held" | "fling" | "return";

/**
 * 可拖拽的 olo：抓起来跟手、沿速度方向拉伸；松手后带速度甩出，
 * 撞屏幕边/地面挤压回弹，静止后一蹦一蹦回到原位。系统"减弱动态效果"时只跟手、松手直接归位。
 */
export function DraggableCharacter(props: Props) {
  const size = props.size ?? 220;
  const { width } = useWindowDimensions();
  const maxX = Math.max(0, (width - size) / 2);
  const maxUp = size * 0.9;
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scaleX = useRef(new Animated.Value(1)).current;
  const scaleY = useRef(new Animated.Value(1)).current;
  const [phase, setPhase] = useState<Phase>("home");
  const [reduced, setReduced] = useState(false);
  const S = useRef({ x: 0, y: 0, vx: 0, vy: 0, sx: 1, sy: 1, ss: 0, axis: "y", still: 0, raf: 0, t0: 0, x0: 0, phase: "home" as Phase, gx: 0, gy: 0 });

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduced).catch(() => undefined);
    return () => cancelAnimationFrame(S.current.raf);
  }, []);

  const apply = () => {
    const s = S.current;
    pos.setValue({ x: s.x, y: s.y });
    scaleX.setValue(s.sx);
    scaleY.setValue(s.sy);
  };
  const go = (p: Phase) => {
    S.current.phase = p;
    setPhase(p);
  };
  const step = () => {
    const s = S.current;
    s.raf = 0;
    const G = 1.1;
    if (s.phase === "fling") {
      s.vy += G;
      s.x += s.vx;
      s.y += s.vy;
      s.vx *= 0.99;
      if (Math.abs(s.x) > maxX) {
        s.x = Math.sign(s.x) * maxX;
        s.ss = Math.min(0.3, Math.abs(s.vx) * 0.02);
        s.axis = "x";
        s.vx *= -0.7;
      }
      if (s.y < -maxUp) {
        s.y = -maxUp;
        s.vy *= -0.5;
      }
      if (s.y > 0) {
        const imp = s.vy;
        s.y = 0;
        if (imp > 3) {
          s.ss = Math.min(0.35, imp * 0.025);
          s.axis = "y";
          s.vy = -imp * 0.6;
          s.vx *= 0.85;
        } else {
          s.vy = 0;
          s.vx *= 0.88;
        }
      }
      s.ss *= 0.8;
      const sq = s.ss;
      s.sx = s.axis === "x" ? 1 - sq : 1 + sq;
      s.sy = s.axis === "x" ? 1 + sq * 0.6 : 1 - sq;
      s.still = s.y === 0 && Math.abs(s.vx) < 0.6 && sq < 0.02 ? s.still + 1 : 0;
      if (s.still > 12) {
        s.t0 = Date.now();
        s.x0 = s.x;
        go("return");
      }
    } else if (s.phase === "return") {
      const dur = Math.max(0.5, Math.abs(s.x0) / 260);
      const p = Math.min(1, (Date.now() - s.t0) / 1000 / dur);
      const e = 1 - (1 - p) ** 2;
      const hp = (p * Math.max(1, Math.round(dur / 0.3))) % 1;
      s.x = s.x0 * (1 - e);
      s.y = -Math.sin(hp * Math.PI) * size * 0.1 * (1 - p * 0.5);
      s.sx = hp < 0.1 ? 1.1 : 1;
      s.sy = hp < 0.1 ? 0.9 : 1;
      if (p >= 1) {
        Object.assign(s, { x: 0, y: 0, sx: 1, sy: 1 });
        go("home");
      }
    }
    apply();
    if (s.phase === "fling" || s.phase === "return") s.raf = requestAnimationFrame(step);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const s = S.current;
        cancelAnimationFrame(s.raf);
        s.raf = 0;
        Object.assign(s, { vx: 0, vy: 0, gx: s.x, gy: s.y });
        go("held");
      },
      onPanResponderMove: (_e, g) => {
        const s = S.current;
        const k = Math.min(0.3, Math.hypot(g.vx, g.vy) * 0.12);
        const horiz = Math.abs(g.vx) > Math.abs(g.vy);
        s.x = Math.max(-maxX, Math.min(maxX, s.gx + g.dx));
        s.y = Math.max(-maxUp, Math.min(0, s.gy + g.dy));
        s.sx = horiz ? 1 + k : 1 - k * 0.6;
        s.sy = horiz ? 1 - k * 0.6 : 1 + k;
        apply();
      },
      onPanResponderRelease: (_e, g) => {
        const s = S.current;
        if (reducedRef.current) {
          Object.assign(s, { x: 0, y: 0, sx: 1, sy: 1 });
          apply();
          go("home");
          return;
        }
        // g.vx/vy 单位是 px/ms，换算成每帧（16ms）像素
        s.vx = Math.max(-40, Math.min(40, g.vx * 16));
        s.vy = Math.max(-40, Math.min(40, g.vy * 16));
        s.ss = 0;
        s.still = 0;
        go("fling");
        s.raf = requestAnimationFrame(step);
      },
      onPanResponderTerminate: () => {
        const s = S.current;
        s.vx = s.vy = 0;
        go("fling");
        s.raf = requestAnimationFrame(step);
      },
    }),
  ).current;
  const reducedRef = useRef(false);
  reducedRef.current = reduced;

  return (
    <Animated.View
      {...pan.panHandlers}
      testID="olo-drag"
      accessibilityHint="可以拖动"
      style={{
        zIndex: phase === "home" ? 0 : 10,
        transform: [
          { translateX: pos.x },
          { translateY: pos.y },
          // 以脚底为锚点挤压：先下移半个高度再缩放再移回
          { translateY: size / 2 },
          { scaleX },
          { scaleY },
          { translateY: -size / 2 },
        ],
      }}
    >
      <Character {...props} held={phase === "held" || phase === "fling"} />
    </Animated.View>
  );
}
