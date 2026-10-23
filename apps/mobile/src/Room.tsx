// 收起聊天后的 2.5D 小场景（雾里集小广场）：背景和道具是 scripts/gen_mobile_room.py 从 web/room.js 预渲染的分层图，
// 这里用同一套等距数字摆放，道具和 olo 按深度（wx+wy）排序遮挡；olo 会溜达、点一下有反应、能抓起来扔。
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Image, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";

import { Character, CharacterAppearance } from "./Character";
import { PROPS, ROOM, ROOM_LAYERS } from "./roomAssets";
import { localHour } from "./daytime";

const N = 8, TW = 20, TH = 10, WH = 30;
const { RW, RH } = ROOM;
const OX = Math.round(RW / 2), OY = Math.round((RH - N * TH + WH) / 2 + 12);
const proj = (wx: number, wy: number, z = 0) => [OX + ((wx - wy) * TW) / 2, OY + ((wx + wy) * TH) / 2 - z];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const B0 = 0.45, B1 = N - 0.45;

export function daypartOf(hour: number): "dawn" | "day" | "dusk" | "night" {
  if (hour < 5 || hour >= 20) return "night";
  if (hour < 8) return "dawn";
  if (hour < 17) return "day";
  return "dusk";
}

type Mode = "home" | "held" | "fling";

export function Room({
  appearance,
  tz,
  onOpenChat,
}: {
  appearance?: CharacterAppearance;
  tz?: string;
  onOpenChat: () => void;
}) {
  const [box, setBox] = useState({ w: 360, h: 480 });
  const [, setTick] = useState(0);
  const [reduced, setReduced] = useState(false);
  const reducedRef = useRef(false);
  reducedRef.current = reduced;
  const [taps, setTaps] = useState(0);
  const part = daypartOf(localHour(tz));
  const K = clamp(Math.floor(Math.min(box.w / 165, box.h / RH) * 2) / 2, 1, 4);
  const left = (box.w - RW * K) / 2, top = (box.h - RH * K) / 2;
  const D = useRef({ mode: "home" as Mode, x: 3.2, y: 4.8, z: 0, vx: 0, vy: 0, vz: 0, ss: 0, goal: null as number[] | null, wait: 40, ph: 0, still: 0, react: 0, t0: 0, moved: false, lx: 0, ly: 0, lt: 0 }).current;
  const geo = useRef({ K, left, top });
  geo.current = { K, left, top };
  const form = appearance?.form ?? "buddy";

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduced).catch(() => undefined);
  }, []);

  const blocked = (x: number, y: number, pad = 0.35) => PROPS.some((q) => Math.hypot(x - q.x, y - q.y) < q.r + pad);
  const collide = (bounce: boolean) => {
    if (D.x < B0 || D.x > B1) { D.x = clamp(D.x, B0, B1); if (bounce) { D.vx *= -0.7; D.ss = Math.min(0.35, Math.abs(D.vx) * 1.6); } }
    if (D.y < B0 || D.y > B1) { D.y = clamp(D.y, B0, B1); if (bounce) { D.vy *= -0.7; D.ss = Math.min(0.35, Math.abs(D.vy) * 1.6); } }
    for (const q of PROPS) {
      const dx = D.x - q.x, dy = D.y - q.y, d = Math.hypot(dx, dy), R = q.r + 0.3;
      if (d < R && D.z < q.h) {
        const nx = dx / (d || 1), ny = dy / (d || 1);
        D.x = q.x + nx * R; D.y = q.y + ny * R;
        const vn = D.vx * nx + D.vy * ny;
        if (bounce && vn < 0) { D.vx -= 1.7 * vn * nx; D.vy -= 1.7 * vn * ny; D.ss = Math.min(0.35, -vn * 1.6); }
      }
    }
  };

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const step = () => {
      if (D.mode === "home") {
        if (D.react > 0) { D.react--; D.z = Math.max(0, Math.sin((D.react / 45) * Math.PI) * 10); }
        else if (!D.goal) { if (--D.wait <= 0) for (let i = 0; i < 30; i++) { const x = 0.8 + Math.random() * (N - 1.6), y = 0.8 + Math.random() * (N - 1.6); if (!blocked(x, y, 0.6)) { D.goal = [x, y]; break; } } }
        else {
          const dx = D.goal[0] - D.x, dy = D.goal[1] - D.y, d = Math.hypot(dx, dy), sp = form === "cloud" ? 0.018 : 0.028;
          if (d < sp) { D.goal = null; D.wait = 60 + Math.random() * 140; D.z = 0; }
          else { D.x += (dx / d) * sp; D.y += (dy / d) * sp; D.ph += 0.16; D.z = form === "buddy" ? Math.abs(Math.sin(D.ph)) * 4 : 0; collide(false); }
        }
      } else if (D.mode === "held") {
        D.z += (14 - D.z) * 0.3;
      } else {
        D.vz -= 0.4; D.x += D.vx; D.y += D.vy; D.z += D.vz;
        collide(true);
        if (D.z <= 0) {
          const imp = -D.vz; D.z = 0;
          if (imp > 1.3) { D.ss = Math.min(0.42, imp * 0.07); D.vz = imp * 0.55; D.vx *= 0.8; D.vy *= 0.8; }
          else { D.vz = 0; D.vx *= 0.86; D.vy *= 0.86; }
        }
        D.ss *= 0.8;
        D.still = D.z === 0 && Math.hypot(D.vx, D.vy) < 0.006 && D.ss < 0.02 ? D.still + 1 : 0;
        if (D.still > 12) { D.mode = "home"; D.goal = null; D.wait = 50; D.react = 40; }
      }
      setTick((t) => (t + 1) % 1e6);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reduced, form]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (e) => {
        const { K, left, top } = geo.current;
        const mx = (e.nativeEvent.locationX - left) / K, my = (e.nativeEvent.locationY - top) / K;
        const [X, Y] = proj(D.x, D.y, D.z);
        return mx > X - 12 && mx < X + 12 && my > Y - 28 && my < Y + 4;
      },
      onMoveShouldSetPanResponder: () => false,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        Object.assign(D, { mode: "held", goal: null, vx: 0, vy: 0, t0: Date.now(), moved: false, lx: 0, ly: 0, lt: Date.now() });
        setTick((t) => t + 1);
      },
      onPanResponderMove: (e, g) => {
        if (Math.hypot(g.dx, g.dy) > 6) D.moved = true;
        const { K } = geo.current;
        void e;
        // 用相对位移换算：屏幕位移 → 世界位移（等距反投影）
        const ddx = (g.dx - D.lx) / K, ddy = (g.dy - D.ly) / K;
        D.lx = g.dx; D.ly = g.dy;
        const a = ddx / (TW / 2), b = ddy / (TH / 2);
        const mx = (a + b) / 2, my = (b - a) / 2;
        D.x = clamp(D.x + mx, B0, B1); D.y = clamp(D.y + my, B0, B1);
        const now = Date.now(), dt = Math.max(16, now - D.lt); D.lt = now;
        D.vx = (mx * 16) / dt; D.vy = (my * 16) / dt;
        if (reducedRef.current) setTick((t) => t + 1);
      },
      onPanResponderRelease: () => {
        if (!D.moved && Date.now() - D.t0 < 350) {
          Object.assign(D, { mode: "home", z: 0, react: 45 });
          setTaps((n) => n + 1);
        } else if (reducedRef.current) {
          Object.assign(D, { mode: "home", z: 0 });
        } else {
          D.vx = clamp(D.vx, -0.35, 0.35); D.vy = clamp(D.vy, -0.35, 0.35); D.vz = 2; D.still = 0; D.ss = 0;
          D.mode = "fling";
        }
        collide(false);
        setTick((t) => t + 1);
      },
    }),
  ).current;

  const layers = ROOM_LAYERS[part];
  const items = [...PROPS.map((q) => ({ id: q.id, d: q.x + q.y })), { id: "olo", d: D.x + D.y }].sort((a, b) => a.d - b.d);
  const [X, Y] = proj(D.x, D.y, 0);
  const air = clamp(D.z / 30, 0, 1);
  const size = 32 * K;
  const sx = 1 + D.ss, sy = 1 - D.ss;
  const mood = D.mode === "home" && D.react > 0 ? "listening" : "idle";
  const full = { position: "absolute" as const, left, top, width: RW * K, height: RH * K };

  return (
    <View
      style={styles.wrap}
      testID="room"
      accessibilityLabel={`雾里集的小广场 ${part} taps:${taps} drag:${D.mode} order:${items.map((i) => i.id).join(",")}`}
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      {...pan.panHandlers}
    >
      <Image source={layers.floor} style={full} resizeMode="stretch" fadeDuration={0} />
      {items.map((it) =>
        it.id === "olo" ? (
          <View key="olo" pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={[styles.shadow, { left: left + (X - 9 * (1 - 0.5 * air)) * K, top: top + (Y - 1.5) * K, width: 18 * (1 - 0.5 * air) * K, height: 3 * K, opacity: 0.35 * (1 - air * 0.6) }]} />
            <View testID="olo-room-actor" style={{ position: "absolute", left: left + X * K - size / 2, top: top + (Y - D.z) * K - size + 2 * K, width: size, height: size, transform: [{ translateY: size / 2 }, { scaleX: sx }, { scaleY: sy }, { translateY: -size / 2 }] }}>
              <Character size={size} appearance={appearance} mood={mood} held={D.mode !== "home"} />
            </View>
          </View>
        ) : (
          <Image key={it.id} source={layers.props[it.id]} style={full} resizeMode="stretch" fadeDuration={0} />
        ),
      )}
      <Pressable testID="room-open-chat" style={styles.open} onPress={onOpenChat}>
        <Text style={styles.openText}>✉ 打开聊天</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: "hidden" },
  shadow: { position: "absolute", backgroundColor: "#2a1422", borderRadius: 99 },
  open: { position: "absolute", alignSelf: "center", bottom: 16, backgroundColor: "#e8a33a", borderWidth: 3, borderColor: "#3a1e2a", paddingHorizontal: 18, paddingVertical: 10 },
  openText: { color: "#2a1422", fontSize: 14, fontWeight: "700" },
});
