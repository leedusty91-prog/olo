// 聊天面板的背景：雾里集高清插画（黎明 / 白天 / 黄昏 / 夜里四幅），按此刻时间选图并淡入切换；
// 上面飘着几粒光雨（原生驱动），减少动效时静止。网页端仍用 chatBg.js 像素画法（与 web/chat-bg.js 保持同一份）。
import { memo, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, useWindowDimensions } from "react-native";
import { Sky } from "./daytime";
import { colors, illustration } from "../theme/illustration";

/* eslint-disable @typescript-eslint/no-require-imports */
const BG = {
  dawn: require("../assets/hd/bg-dawn.jpg"),
  day: require("../assets/hd/bg-day.jpg"),
  dusk: require("../assets/hd/bg-dusk.jpg"),
  night: require("../assets/hd/bg-night.jpg"),
};
export type BgKey = keyof typeof BG;
export function bgFor(hour: number): BgKey {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 16.5) return "day";
  if (hour >= 16.5 && hour < 19.5) return "dusk";
  return "night";
}
export const bgSource = (hour: number) => BG[bgFor(hour)];

const MOTES = 14;
function Mote({ i, w, h, reduced }: { i: number; w: number; h: number; reduced: boolean }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { t.setValue(0.5); return; }
    const d = illustration.motion.durationMs * (18 + (i % 5) * 4);
    const l = Animated.loop(Animated.sequence([
      Animated.delay((i * 610) % 4000),
      Animated.timing(t, { toValue: 1, duration: d, easing: Easing.linear, useNativeDriver: true, isInteraction: false }),
      Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true, isInteraction: false }),
    ]));
    l.start(); return () => l.stop();
  }, [reduced]);
  const r = 2 + (i % 3);
  const x = ((i * 137) % 100) / 100 * w;
  return (
    <Animated.View style={{ position: "absolute", left: x, top: -10, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: colors.lantern,
      shadowColor: colors.lantern, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
      opacity: t.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 0.85, 0.6, 0] }),
      transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, h * (0.5 + (i % 4) * 0.12)] }) }] }} />
  );
}

export const ChatBackdrop = memo(function ChatBackdrop({ sky }: { sky: Sky }) {
  const win = useWindowDimensions();
  const [reduced, setReduced] = useState(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled?.().then(setReduced).catch(() => undefined); const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduced); return () => sub?.remove?.(); }, []);
  const key = bgFor(sky.hour);
  const [shown, setShown] = useState<{ cur: BgKey; prev: BgKey | null }>({ cur: key, prev: null });
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (key === shown.cur) return;
    setShown({ cur: key, prev: shown.cur });
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: reduced ? 0 : illustration.motion.durationMs * 4, useNativeDriver: true }).start();
  }, [key]);
  const dark = key === "night";
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID={`chatbg-${dark ? "dark" : "light"}`}>
      {shown.prev ? <Animated.Image source={BG[shown.prev]} resizeMode="cover" style={StyleSheet.absoluteFill} /> : null}
      <Animated.Image source={BG[shown.cur]} resizeMode="cover" style={[StyleSheet.absoluteFill, { opacity: fade }]} />
      {Array.from({ length: MOTES }, (_, i) => <Mote key={i} i={i} w={win.width} h={win.height} reduced={reduced} />)}
    </View>
  );
});
