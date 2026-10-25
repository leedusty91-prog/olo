// 聊天 / 小广场背后的像素插画天空：画面由 skyScene.js（与网页同一份代码）在低分辨率里画好几层位图，
// 编码成 PNG 后贴上来；之后只做 transform / opacity 动画（原生驱动）：云层视差平移、亮星眨眼、窗灯呼吸、偶尔一颗流星。
// 位图每 5 分钟（或尺寸变化）才重画一次；减少动效时全部静止。
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, InteractionManager, StyleSheet, View } from "react-native";
import { Sky } from "./daytime";
import { paintScene, Scene } from "./skyScene";
import { layerPng } from "./skyPng";

const K = 3; // 一个像素 = 3 个点，和网页（4 css px）观感接近

type Built = { scene: Scene; back: string; front: string; lights: string | null; far: string; near: string };

function useReduced() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduced).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduced);
    return () => sub?.remove?.();
  }, []);
  return reduced;
}

function loop(v: Animated.Value, to: number, ms: number, from = 0) {
  v.setValue(from);
  return Animated.loop(Animated.timing(v, { toValue: to, duration: ms, easing: Easing.linear, useNativeDriver: true }));
}

function Clouds({ uri, w, h, ms, reduced, offset }: { uri: string; w: number; h: number; ms: number; reduced: boolean; offset: number }) {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (reduced) { x.setValue(-offset); return; } const l = loop(x, -w, ms); l.start(); return () => l.stop(); }, [reduced, w, ms]);
  return (
    <Animated.View style={{ position: "absolute", left: 0, top: 0, width: w * 2, height: h, flexDirection: "row", transform: [{ translateX: x }] }}>
      <Image source={{ uri }} style={{ width: w, height: h }} fadeDuration={0} />
      <Image source={{ uri }} style={{ width: w, height: h }} fadeDuration={0} />
    </Animated.View>
  );
}

function Twinkles({ list, reduced }: { list: Scene["twinkles"]; reduced: boolean }) {
  const vs = useRef([0, 1, 2].map(() => new Animated.Value(1))).current;
  useEffect(() => {
    if (reduced || !list.length) return;
    const ls = vs.map((v, k) => Animated.loop(Animated.sequence([
      Animated.delay(400 * k),
      Animated.timing(v, { toValue: 0.25, duration: 900 + 700 * k, useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 900 + 700 * k, useNativeDriver: true }),
      Animated.delay(1800 + 900 * k),
    ])));
    ls.forEach((l) => l.start()); return () => ls.forEach((l) => l.stop());
  }, [reduced, list.length]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="sky-stars">
      {list.map((t, i) => {
        const c = `rgb(${t.c.join(",")})`, big = i % 3 === 0;
        return (
          <Animated.View key={i} style={{ position: "absolute", left: (t.x - 1) * K, top: (t.y - 1) * K, width: K * 3, height: K * 3, opacity: reduced ? t.a : Animated.multiply(vs[i % 3], t.a) }}>
            <View style={{ position: "absolute", left: K, top: K, width: K, height: K, backgroundColor: c }} />
            {big ? <><View style={{ position: "absolute", left: 0, top: K, width: K * 3, height: K, backgroundColor: c, opacity: 0.45 }} /><View style={{ position: "absolute", left: K, top: 0, width: K, height: K * 3, backgroundColor: c, opacity: 0.45 }} /></> : null}
          </Animated.View>
        );
      })}
    </View>
  );
}

function ShootingStar({ w, h }: { w: number; h: number }) {
  const p = useRef(new Animated.Value(0)).current;
  const [at, setAt] = useState({ x: w * 0.6, y: h * 0.1 });
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout>;
    const go = () => {
      timer = setTimeout(() => {
        if (!alive) return;
        setAt({ x: w * (0.35 + Math.random() * 0.55), y: h * (0.04 + Math.random() * 0.22) });
        p.setValue(0);
        Animated.timing(p, { toValue: 1, duration: 800, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => go());
      }, 9000 + Math.random() * 16000);
    };
    go(); return () => { alive = false; clearTimeout(timer); };
  }, [w, h]);
  const tx = p.interpolate({ inputRange: [0, 1], outputRange: [0, -w * 0.32] });
  const ty = p.interpolate({ inputRange: [0, 1], outputRange: [0, w * 0.16] });
  const op = p.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 0.8, 0] });
  return (
    <Animated.View testID="sky-meteor" pointerEvents="none" style={{ position: "absolute", left: at.x, top: at.y, flexDirection: "row", opacity: op, transform: [{ translateX: tx }, { translateY: ty }, { rotate: "-26deg" }] }}>
      {[1, 0.7, 0.45, 0.25, 0.12].map((a, i) => <View key={i} style={{ width: K * (i ? 2 : 1), height: K, backgroundColor: i ? "#FFE9C8" : "#FFFFFF", opacity: a }} />)}
    </Animated.View>
  );
}

export const SkyBackdrop = memo(function SkyBackdrop({ sky, sunP: _sunP }: { sky: Sky; sunP?: number | null }) {
  const [box, setBox] = useState({ w: 390, h: 844 });
  const reduced = useReduced();
  const W = Math.ceil(box.w / K), H = Math.ceil(box.h / K);
  const slot = Math.round(sky.hour * 12); // 5 分钟一档
  const [built, setBuilt] = useState<Built | null>(null);
  useEffect(() => {
    let cancelled = false;
    const job = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      const scene = paintScene({ ...sky, hour: slot / 12 }, { W, H, date: new Date() });
      setBuilt({
        scene, back: layerPng(scene.back, K), front: layerPng(scene.front, K),
        lights: scene.hasLights ? layerPng(scene.lights, K) : null,
        far: layerPng(scene.cloudsFar, K), near: layerPng(scene.cloudsNear, K),
      });
    });
    return () => { cancelled = true; job.cancel?.(); };
  }, [slot, W, H, sky.sky.join()]);
  const glow = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced || !built?.lights) return;
    const l = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 0.72, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    l.start(); return () => l.stop();
  }, [reduced, !!built?.lights]);
  const scrim = useMemo(() => (sky.star > 0.4 ? "rgba(14,8,26,0.22)" : sky.sun > 0.8 ? "rgba(255,250,240,0.10)" : "rgba(30,14,30,0.12)"), [sky.star > 0.4, sky.sun > 0.8]);
  const s = built?.scene, pw = W * K, ph = H * K;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, { backgroundColor: `rgb(${sky.sky[1].map(Math.round).join(",")})` }]} testID={`sky-${sky.phase}`} accessibilityLabel={`sky ${sky.phase} ${sky.hour.toFixed(2)}`} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {built && s ? (
        <>
          <Image source={{ uri: built.back }} style={{ position: "absolute", left: 0, top: 0, width: pw, height: ph }} fadeDuration={0} testID="sky-back" />
          {s.twinkles.length ? <Twinkles list={s.twinkles} reduced={reduced} /> : null}
          {!reduced && sky.star > 0.7 ? <ShootingStar w={pw} h={ph} /> : null}
          <Clouds uri={built.far} w={s.cloudsFar.W * K} h={s.cloudsFar.H * K} ms={420000} reduced={reduced} offset={pw * 0.3} />
          <Clouds uri={built.near} w={s.cloudsNear.W * K} h={s.cloudsNear.H * K} ms={210000} reduced={reduced} offset={pw * 0.7} />
          <Image source={{ uri: built.front }} style={{ position: "absolute", left: 0, top: 0, width: pw, height: ph }} fadeDuration={0} />
          {built.lights ? <Animated.Image source={{ uri: built.lights }} style={{ position: "absolute", left: 0, top: 0, width: pw, height: ph, opacity: reduced ? 1 : glow }} fadeDuration={0} testID="sky-lights" /> : null}
          {s.geometry.sun && sky.sun > 0.15 ? <View testID="sky-sun" style={{ position: "absolute", left: s.geometry.sun.x * K, top: s.geometry.sun.y * K, width: 1, height: 1 }} /> : null}
          {sky.star > 0.5 ? <View testID="sky-moon" style={{ position: "absolute", left: s.geometry.moon.x * K, top: s.geometry.moon.y * K, width: 1, height: 1 }} /> : null}
        </>
      ) : null}
      {/* 聊天区的柔和衬底：中间浓、上下淡，夜里压暗、白天提亮一点 */}
      <View style={[styles.scrim, { top: "6%", bottom: "6%", backgroundColor: scrim, opacity: 0.5 }]} />
      <View style={[styles.scrim, { top: "14%", bottom: "14%", backgroundColor: scrim, opacity: 0.7 }]} />
    </View>
  );
});

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  scrim: { position: "absolute", left: 0, right: 0 },
});
