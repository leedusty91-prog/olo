// 聊天 / 小广场背后的天：14 条色带（与网页同一张关键帧表插值）+ 太阳沿弧线走 + 夜里月亮和会眨的星星 + 晨昏地平线暖光。
// 只在分钟变化时重渲染；星星眨眼用原生驱动的 Animated（减少动效时不眨）。
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import { Sky, bands } from "./daytime";

const STARS: [number, number, number][] = Array.from({ length: 22 }, (_, i) => {
  const r = (n: number) => { const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
  return [Math.round(r(1) * 96 + 2), Math.round(r(2) * 52 + 2), r(3) < 0.25 ? 3 : 2];
});

function Stars({ alpha, reduced }: { alpha: number; reduced: boolean }) {
  const tw = useRef([new Animated.Value(1), new Animated.Value(0.4)]).current;
  useEffect(() => {
    if (reduced || alpha < 0.05) return;
    const loops = tw.map((v, k) => Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.35, duration: 1400 + k * 500, useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 1400 + k * 500, useNativeDriver: true }),
    ])));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduced, alpha < 0.05]);
  if (alpha < 0.05) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: alpha }]} testID="sky-stars">
      {STARS.map(([x, y, s], i) => (
        <Animated.View key={i} style={[styles.star, { left: `${x}%`, top: `${y}%`, width: s, height: s, opacity: reduced ? 0.85 : tw[i % 2] }]} />
      ))}
    </View>
  );
}

export const SkyBackdrop = memo(function SkyBackdrop({ sky, sunP }: { sky: Sky; sunP: number | null }) {
  const [box, setBox] = useState({ w: 390, h: 844 });
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduced).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduced);
    return () => sub?.remove?.();
  }, []);
  const cols = useMemo(() => bands(sky.sky), [sky.sky.join()]);
  const arcH = box.h * 0.42;
  const sun = sunP === null ? null : { x: box.w * (0.08 + sunP * 0.84), y: box.h * 0.5 - Math.sin(Math.PI * sunP) * arcH };
  const low = sunP !== null && Math.sin(Math.PI * sunP) < 0.35;
  const warm = sky.phase === "dawn" || sky.phase === "dusk" ? Math.max(0, 1 - Math.abs(sky.sun - 0.55) * 2) : 0;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID={`sky-${sky.phase}`} accessibilityLabel={`sky ${sky.phase} ${sky.hour.toFixed(2)}`} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {cols.map((c, i) => <View key={i} style={{ flex: 1, backgroundColor: c }} />)}
      {warm > 0.02 ? <View style={[styles.horizon, { opacity: warm * 0.5, backgroundColor: sky.phase === "dawn" ? "#FFB89A" : "#FF9A6A" }]} /> : null}
      <Stars alpha={sky.star} reduced={reduced} />
      {sun ? (
        <View testID="sky-sun" style={{ position: "absolute", left: sun.x - 22, top: sun.y - 22, opacity: Math.min(1, sky.sun * 1.4) }}>
          <View style={[styles.glow, { backgroundColor: low ? "rgba(255,150,90,0.28)" : "rgba(255,226,150,0.32)" }]} />
          <View style={[styles.sun, { backgroundColor: low ? "#FFA25A" : "#FFE08A" }]} />
        </View>
      ) : null}
      {sky.star > 0.5 ? (
        <View testID="sky-moon" style={[styles.moon, { right: box.w * 0.12, top: box.h * 0.09, opacity: Math.min(1, (sky.star - 0.4) * 2) }]}>
          <View style={[styles.moonCut, { backgroundColor: cols[1] }]} />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  star: { position: "absolute", backgroundColor: "#FFF3DC" },
  glow: { position: "absolute", left: 0, top: 0, width: 44, height: 44 },
  sun: { position: "absolute", left: 8, top: 8, width: 28, height: 28 },
  moon: { position: "absolute", width: 26, height: 26, backgroundColor: "#F4E7C8", overflow: "hidden" },
  moonCut: { position: "absolute", width: 22, height: 22, left: 9, top: -5 },
  horizon: { position: "absolute", left: 0, right: 0, bottom: 0, height: "35%" },
});
