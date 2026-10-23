// 收起聊天后的 2.5D 小场景（雾里集小广场）：背景（含雾河湾、灯串、芦婆婆的船）和道具是 scripts/gen_mobile_room.py
// 从 web/room.js 预渲染的分层图，这里用同一套等距数字摆放，道具和 olo 按深度（wx+wy）排序遮挡；
// 点道具或底部去处按钮 → olo 走过去玩并冒气泡说话；点 olo 有反应，也能抓起来扔。
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Image, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";

import { Character, CharacterAppearance } from "./Character";
import { PROPS, ROOM, ROOM_LAYERS, SPOTS } from "./roomAssets";
import { localHour, skyAt, sunProgress } from "./daytime";
import { SkyBackdrop } from "./SkyBackdrop";
import { colors, pixelBox } from "./theme";

const N = 8, TW = 20, TH = 10, WH = 30;
const { RW, RH } = ROOM;
const OX = Math.round(RW / 2), OY = Math.round((RH - N * TH + WH) / 2 + 2);
const proj = (wx: number, wy: number, z = 0) => [OX + ((wx - wy) * TW) / 2, OY + ((wx + wy) * TH) / 2 - z];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const B0 = 0.45, B1 = N - 0.45;
const HIDE: [number, number] = [5.8, 5.8];
const PART_LABEL: Record<string, string> = { dawn: "清晨", day: "白天", dusk: "傍晚", night: "夜里" };
const SPOT_IDS = [...PROPS.map((q) => q.id), "boat"];

export function daypartOf(hour: number): "dawn" | "day" | "dusk" | "night" {
  if (hour < 5 || hour >= 20) return "night";
  if (hour < 8) return "dawn";
  if (hour < 17) return "day";
  return "dusk";
}

type Mode = "home" | "held" | "fling";
type Task = { id: string; phase: "walk" | "act"; t: number; steps: number };

export function Room({
  appearance,
  name = "olo",
  tz,
  onOpenChat,
}: {
  appearance?: CharacterAppearance;
  name?: string;
  tz?: string;
  onOpenChat: () => void;
}) {
  const [box, setBox] = useState({ w: 360, h: 480 });
  const [, setTick] = useState(0);
  const [reduced, setReduced] = useState(false);
  const reducedRef = useRef(false);
  reducedRef.current = reduced;
  const [taps, setTaps] = useState(0);
  const hr = localHour(tz);
  const part = daypartOf(hr);
  const minute = Math.round(hr * 60);
  const roomSky = useMemo(() => skyAt(minute / 60), [minute]);
  const clockText = `${PART_LABEL[part]} ${String(Math.floor(hr)).padStart(2, "0")}:${String(Math.floor((hr % 1) * 60)).padStart(2, "0")}`;
  const K = clamp(Math.floor(Math.min(box.w / 172, (box.h - 110) / RH) * 2) / 2, 1, 4);
  const left = (box.w - RW * K) / 2, top = Math.max(44, (box.h - 40 - RH * K) / 2);
  const D = useRef({
    mode: "home" as Mode,
    x: 3.2,
    y: 4.8,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    ss: 0,
    goal: null as number[] | null,
    wait: 40,
    ph: 0,
    still: 0,
    react: 0,
    t0: 0,
    moved: false,
    lx: 0,
    ly: 0,
    lt: 0,
    task: null as Task | null,
    ignore: null as string | null,
    ignoreT: 0,
    sayText: "",
    sayT: 0,
    thrown: false,
  }).current;
  const geo = useRef({ K, left, top, part });
  geo.current = { K, left, top, part };
  const form = appearance?.form ?? "buddy";

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduced).catch(() => undefined);
  }, []);

  const propAt = (id: string) => PROPS.find((q) => q.id === id);
  const targetOf = (id: string): [number, number] => {
    if (id === "bench") {
      const b = propAt("bench")!;
      return [b.x, b.y];
    }
    return SPOTS[id]?.at ?? propAt(id)?.at ?? [3.2, 4.8];
  };
  const say = (text: string, frames = 170) => {
    D.sayText = text;
    D.sayT = reducedRef.current ? 1e9 : frames;
  };
  const endTask = () => {
    if (!D.task) return;
    const id = D.task.id;
    D.task = null;
    if (id === "bench" || id === "crates") {
      D.ignore = id;
      D.ignoreT = 70;
    }
    D.z = 0;
    D.ss = 0;
  };
  const startAct = () => {
    const T = D.task;
    if (!T) return;
    T.phase = "act";
    T.t = 0;
    const S = SPOTS[T.id];
    const lines = geo.current.part === "night" && S.night ? S.night : S.say;
    if (T.id === "crates") {
      D.ignore = "crates";
      say("（躲好了……）", 120);
    } else {
      say(pick(lines));
    }
    if (reducedRef.current && T.id === "bench") D.z = 7;
  };
  const go = (id: string) => {
    if (!SPOTS[id] || D.mode !== "home") return;
    endTask();
    D.goal = null;
    D.task = { id, phase: "walk", t: 0, steps: 0 };
    D.ignore = id === "bench" ? "bench" : null;
    if (reducedRef.current) {
      [D.x, D.y] = targetOf(id);
      startAct();
    }
    setTick((t) => (t + 1) % 1e6);
  };

  const blocked = (x: number, y: number, pad = 0.35) => PROPS.some((q) => Math.hypot(x - q.x, y - q.y) < q.r + pad);
  const collide = (bounce: boolean) => {
    if (D.x < B0 || D.x > B1) { D.x = clamp(D.x, B0, B1); if (bounce) { D.vx *= -0.7; D.ss = Math.min(0.35, Math.abs(D.vx) * 1.6); } }
    if (D.y < B0 || D.y > B1) { D.y = clamp(D.y, B0, B1); if (bounce) { D.vy *= -0.7; D.ss = Math.min(0.35, Math.abs(D.vy) * 1.6); } }
    for (const q of PROPS) {
      if (q.id === D.ignore) continue;
      const dx = D.x - q.x, dy = D.y - q.y, d = Math.hypot(dx, dy), R = q.r + 0.3;
      if (d < R && D.z < q.h) {
        const nx = dx / (d || 1), ny = dy / (d || 1);
        D.x = q.x + nx * R; D.y = q.y + ny * R;
        const vn = D.vx * nx + D.vy * ny;
        if (bounce && vn < 0) { D.vx -= 1.7 * vn * nx; D.vy -= 1.7 * vn * ny; D.ss = Math.min(0.35, -vn * 1.6); }
      }
    }
  };

  const hitSpot = (mx: number, my: number): string | null => {
    const bx = OX + Math.round(Math.sin(0.55) * 36), by = OY + N * TH + 15;
    if (mx > bx - 14 && mx < bx + 14 && my > by - 18 && my < by + 4) return "boat";
    for (const q of [...PROPS].sort((a, b) => b.x + b.y - (a.x + a.y))) {
      const [X, Y] = proj(q.x, q.y);
      if (mx > X - q.box[0] && mx < X + q.box[0] && my > Y - q.box[1] && my < Y + 3) return q.id;
    }
    return null;
  };

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const step = () => {
      if (D.ignoreT > 0 && --D.ignoreT === 0 && !D.task) D.ignore = null;
      if (D.sayT > 0 && --D.sayT === 0) D.sayText = "";
      if (D.mode === "home") {
        if (D.react > 0) {
          D.react--;
          D.z = Math.max(0, Math.sin((D.react / 45) * Math.PI) * 10);
        } else if (D.task?.phase === "act") {
          const T = D.task, t = ++T.t, S = SPOTS[T.id];
          if (T.id === "bench") {
            D.z = t < 18 ? 7 * (t / 18) + Math.sin((Math.PI * t) / 18) * 6 : t >= S.dur - 14 ? 7 * ((S.dur - t) / 14) : 7;
          } else if (T.id === "lamp" || T.id === "boat" || T.id === "come") {
            D.z = t < 80 ? Math.abs(Math.sin(t / 10)) * 9 : 0;
          } else if (T.id === "pot") {
            D.z = Math.abs(Math.sin(t / 8)) * 2;
          } else if (T.id === "crates") {
            const at = SPOTS.crates.at ?? propAt("crates")!.at;
            if (t <= 24) {
              const f = t / 24;
              D.x = lerp(at[0], HIDE[0], f);
              D.y = lerp(at[1], HIDE[1], f);
              D.ss = 0.22 * f;
            } else if (t < 170) {
              D.ss = 0.22;
            } else {
              const f = Math.min(1, (t - 170) / 18);
              D.x = lerp(HIDE[0], at[0], f);
              D.y = lerp(HIDE[1], at[1], f);
              D.ss = 0;
              D.z = Math.sin(Math.PI * f) * 10;
              if (t === 171) say(pick(S.say));
            }
          }
          if (t >= S.dur) {
            endTask();
            D.wait = 90 + Math.random() * 120;
          }
        } else if (D.task) {
          const [tx, ty] = targetOf(D.task.id), dx = tx - D.x, dy = ty - D.y, d = Math.hypot(dx, dy), sp = form === "cloud" ? 0.024 : 0.036;
          if (d < sp || ++D.task.steps > 420) {
            D.x = tx;
            D.y = ty;
            D.z = 0;
            startAct();
          } else {
            D.x += (dx / d) * sp;
            D.y += (dy / d) * sp;
            D.ph += 0.18;
            D.z = form === "buddy" ? Math.abs(Math.sin(D.ph)) * 4 : 0;
            collide(false);
          }
        } else if (!D.goal) {
          if (--D.wait <= 0) {
            if (Math.random() < 0.3) go(pick(PROPS).id);
            else {
              for (let i = 0; i < 30; i++) {
                const x = 0.8 + Math.random() * (N - 1.6), y = 0.8 + Math.random() * (N - 1.6);
                if (!blocked(x, y, 0.6)) { D.goal = [x, y]; break; }
              }
            }
          }
        } else {
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
        if (D.still > 12) {
          D.mode = "home";
          D.goal = null;
          D.wait = 50;
          D.react = 40;
          if (D.thrown) say(pick(["晕乎乎……", "再来一次！", "我会飞啦！"]), 120);
          D.thrown = false;
        }
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
        if (mx > X - 12 && mx < X + 12 && my > Y - 28 && my < Y + 4) return true;
        const spot = hitSpot(mx, my);
        if (spot) go(spot);
        return false;
      },
      onMoveShouldSetPanResponder: () => false,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        endTask();
        D.ignore = null;
        Object.assign(D, { mode: "held", goal: null, vx: 0, vy: 0, t0: Date.now(), moved: false, lx: 0, ly: 0, lt: Date.now() });
        setTick((t) => t + 1);
      },
      onPanResponderMove: (e, g) => {
        if (Math.hypot(g.dx, g.dy) > 6) D.moved = true;
        const { K } = geo.current;
        void e;
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
          Object.assign(D, { mode: "home", z: 0, react: 45, thrown: false });
          say(pick(["嘿嘿。", "痒！", "再戳一下？", "找我呀？"]), 110);
          setTaps((n) => n + 1);
        } else if (reducedRef.current) {
          Object.assign(D, { mode: "home", z: 0, thrown: false });
        } else {
          D.vx = clamp(D.vx, -0.35, 0.35); D.vy = clamp(D.vy, -0.35, 0.35); D.vz = 2; D.still = 0; D.ss = 0;
          D.thrown = true;
          D.mode = "fling";
        }
        collide(false);
        setTick((t) => t + 1);
      },
    }),
  ).current;

  const layers = ROOM_LAYERS[part];
  const sitting = D.task?.id === "bench" && D.task.phase === "act";
  const items = [...PROPS.map((q) => ({ id: q.id, d: q.x + q.y })), { id: "olo", d: D.x + D.y + (sitting ? 0.05 : 0) }].sort((a, b) => a.d - b.d);
  const [X, Y] = proj(D.x, D.y, sitting ? 7 : 0);
  const air = clamp((D.z - (sitting ? 7 : 0)) / 30, 0, 1);
  const size = 32 * K;
  const sx = 1 + D.ss, sy = 1 - D.ss;
  const happyAct = D.task?.phase === "act" && ["pot", "tree", "lamp", "boat", "come"].includes(D.task.id);
  const mood = D.mode === "home" && (D.react > 0 || happyAct) ? "listening" : "idle";
  const full = { position: "absolute" as const, left, top, width: RW * K, height: RH * K };
  const doingText =
    D.mode === "held"
      ? "被你拎起来了"
      : D.mode === "fling"
        ? "飞起来啦"
        : D.task
          ? D.task.phase === "walk"
            ? `正跑去${SPOTS[D.task.id].verb.replace(/^(去|给|朝)/, "")}`
            : SPOTS[D.task.id].doing
          : "在广场上溜达";
  const bubbleX = clamp(left + X * K, 84, box.w - 84);
  const bubbleY = Math.max(52, top + (Y - D.z) * K - size - 12);

  return (
    <View
      style={styles.wrap}
      testID="room"
      accessibilityLabel={`雾里集的小广场 ${part} taps:${taps} drag:${D.mode} order:${items.map((i) => i.id).join(",")}`}
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      {...pan.panHandlers}
    >
      <SkyBackdrop sky={roomSky} sunP={roomSky.sun > 0.15 ? sunProgress(roomSky.hour) : null} />
      <View style={styles.hud} testID="room-hud" pointerEvents="none">
        <Text style={styles.hudPlace}>雾里集 · 小广场</Text>
        <Text style={styles.hudClock} testID="room-clock">{clockText}</Text>
        <Text style={styles.hudDoing} testID="room-doing">{`${name} ${doingText}`}</Text>
      </View>

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

      {D.sayText ? (
        <View
          testID="room-bubble"
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[styles.bubble, { left: bubbleX, top: bubbleY }]}
        >
          <Text style={styles.bubbleText}>{D.sayText}</Text>
        </View>
      ) : null}

      <View style={styles.dock} pointerEvents="box-none">
        <View style={styles.chips}>
          {SPOT_IDS.map((id) => {
            const on = D.task?.id === id;
            return (
              <Pressable
                key={id}
                testID={`spot-${id}`}
                accessibilityRole="button"
                accessibilityLabel={SPOTS[id].verb}
                onPress={() => go(id)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={styles.chipText}>{SPOTS[id].label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.actions}>
          <Pressable testID="room-call" accessibilityRole="button" style={styles.callBtn} onPress={() => go("come")}>
            <Text style={styles.callText}>♪ 叫它过来</Text>
          </Pressable>
          <Pressable testID="room-open-chat" accessibilityRole="button" style={styles.open} onPress={onOpenChat}>
            <Text style={styles.openText}>✉ 回去聊天</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: "hidden" },
  hud: {
    ...pixelBox,
    position: "absolute",
    top: 8,
    left: 12,
    right: 12,
    zIndex: 2,
    backgroundColor: "#5a2c34",
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 8,
  },
  hudPlace: { color: "#ffd98a", fontSize: 13, fontWeight: "700" },
  hudClock: { color: "#f0b8a0", fontSize: 12 },
  hudDoing: { color: "#fff3dc", fontSize: 12, marginLeft: "auto" },
  shadow: { position: "absolute", backgroundColor: "#2a1422", borderRadius: 99 },
  bubble: {
    ...pixelBox,
    position: "absolute",
    zIndex: 3,
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    paddingVertical: 4,
    transform: [{ translateX: -60 }],
  },
  bubbleText: { color: colors.ink, fontSize: 12, fontWeight: "600" },
  dock: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    zIndex: 2,
    alignItems: "center",
    gap: 8,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
  },
  chip: {
    ...pixelBox,
    backgroundColor: colors.bg,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  chipOn: {
    backgroundColor: colors.sun,
  },
  chipText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10 },
  callBtn: {
    ...pixelBox,
    backgroundColor: "#74393a",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  callText: { color: "#fff3dc", fontSize: 13, fontWeight: "700" },
  open: {
    ...pixelBox,
    backgroundColor: colors.sun,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  openText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
});
