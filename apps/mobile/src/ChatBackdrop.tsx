// 聊天面板的背景：chatBg.js（与网页 web/chat-bg.js 同一份）按此刻时间画的暖色像素风景（小屋、草坡、小路、灯笼），
// 每 5 分钟或尺寸变化才重画；夜里萤火、白天花粉在上面慢慢飘（原生驱动），减少动效时静止。
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, useWindowDimensions, View } from "react-native";
import { Sky, skyAt } from "./daytime";
import { paintChatScene } from "./chatBg";
import { paintScene } from "./skyScene";
import { layerPng } from "./skyPng";

const K = 3;

function Mote({ x, y, c, a, i, dark, reduced }: { x: number; y: number; c: number[]; a: number; i: number; dark: boolean; reduced: boolean }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { t.setValue(0.5); return; }
    const l = Animated.loop(Animated.sequence([
      Animated.delay((i * 530) % 2400),
      Animated.timing(t, { toValue: 1, duration: 5200 + (i % 4) * 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      Animated.timing(t, { toValue: 0, duration: 5200 + (i % 3) * 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
    ]));
    l.start(); return () => l.stop();
  }, [reduced]);
  const s = dark && i % 3 === 0 ? K * 2 : K;
  return (
    <Animated.View style={{ position: "absolute", left: x * K, top: y * K, width: s, height: s, backgroundColor: `rgb(${c.join(",")})`,
      opacity: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [a * 0.15, a, a * 0.3] }),
      transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -K * 6] }) }, { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, (i % 2 ? 1 : -1) * K * 3] }) }] }} />
  );
}

export const ChatBackdrop = memo(function ChatBackdrop({ sky }: { sky: Sky }) {
  const win = useWindowDimensions();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [reduced, setReduced] = useState(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled?.().then(setReduced).catch(() => undefined); const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduced); return () => sub?.remove?.(); }, []);
  const slot = Math.round(sky.hour * 12) / 12;
  const W = Math.ceil(size.w / K), H = Math.ceil(size.h / K);
  const built = useMemo(() => {
    if (!W || !H) return null;
    const r = paintChatScene(skyAt(slot), { W, H, paintScene, date: new Date() });
    return { uri: layerPng(r, K), motes: r.motes, dark: r.dark };
  }, [W, H, slot]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => { const { width, height } = e.nativeEvent.layout; setSize((s) => (Math.abs(s.w - width) < 2 && Math.abs(s.h - height) < 24 * K ? s : { w: width, h: Math.max(height, s.h, win.height * 0.9) })); }} testID={built ? `chatbg-${built.dark ? "dark" : "light"}` : undefined}>
      {built ? (
        <View style={{ position: "absolute", left: 0, bottom: 0, width: W * K, height: H * K }}>
          {/* 贴底：半屏时看到草坡、小路和小屋，拉满时整幅风景连天空一起露出来 */}
          <Image source={{ uri: built.uri }} style={{ position: "absolute", left: 0, top: 0, width: W * K, height: H * K }} fadeDuration={0} />
          {built.motes.map((m, i) => <Mote key={i} {...m} i={i} dark={built.dark} reduced={reduced} />)}
        </View>
      ) : null}
    </View>
  );
});
