// 雾里集（完整版）：和网页同一套 2.5D 世界，铺满屏幕。
// 原生端用 WebView 打开服务器上的 /app/world.html，Web 导出用 iframe；token 放在 # 后面（不会发给服务器日志）。
// 没配置服务器地址或加载失败时，退回到原生画的小广场 <Room/>。
import React, { useMemo, useState } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import { Character } from "./Character";
import type { CharacterAppearance } from "./Character";
import { Room } from "./Room";

type Props = { baseUrl: string; token: string; appearance?: CharacterAppearance; name?: string; tz?: string; onOpenChat: () => void };

export function worldUrl({ baseUrl, token, appearance, name, tz }: Omit<Props, "onOpenChat">): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ base, token, name: name || "olo", tz: tz || "" });
  for (const k of ["form", "color", "hair", "eyes", "cheeks"] as const) { const v = appearance?.[k]; if (v) q.set(k, v); }
  return `${base}/app/world.html#${q.toString()}`;
}

export function WorldView(props: Props) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fade = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => { if (loaded) Animated.timing(fade, { toValue: 0, duration: 260, useNativeDriver: true }).start(); }, [loaded]);
  // 加载中：深色底 + 像素小人 + 一行字，加载完淡出
  const loader = (
    <Animated.View pointerEvents={loaded ? "none" : "auto"} style={[StyleSheet.absoluteFill, styles.loader, { opacity: fade }]} testID="world-loader">
      <Character size={96} appearance={props.appearance} mood="listening" />
      <Text style={styles.loadText}>正在走去雾里集…</Text>
    </Animated.View>
  );
  const uri = useMemo(() => worldUrl(props), [props.baseUrl, props.token, props.appearance, props.name, props.tz]);
  const onMsg = (raw: unknown) => { try { const m = typeof raw === "string" ? JSON.parse(raw) : raw; if ((m as { type?: string })?.type === "openChat") props.onOpenChat(); } catch { /* ignore */ } };
  React.useEffect(() => {
    if (Platform.OS !== "web") return;
    const f = (e: MessageEvent) => onMsg(e.data); window.addEventListener("message", f); return () => window.removeEventListener("message", f);
  }, []);
  if (!props.baseUrl || failed) return <Room appearance={props.appearance} name={props.name} tz={props.tz} onOpenChat={props.onOpenChat} />;
  if (Platform.OS === "web") {
    return <View style={styles.fill} testID="world-view">{React.createElement("iframe", { src: uri, title: "雾里集", onLoad: () => setTimeout(() => setLoaded(true), 250), style: { border: 0, width: "100%", height: "100%", display: "block" }, "data-testid": "world-frame" })}{loader}</View>;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebView } = require("react-native-webview");
  return (
    <View style={styles.fill} testID="world-view">
      <WebView source={{ uri }} style={styles.fill} originWhitelist={["*"]} onMessage={(e: { nativeEvent: { data: string } }) => onMsg(e.nativeEvent.data)} onError={() => setFailed(true)} onHttpError={() => setFailed(true)} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} bounces={false} scrollEnabled={false} onLoadEnd={() => setLoaded(true)} />
      {loader}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#1a1024" },
  loader: { backgroundColor: "#1a1024", alignItems: "center", justifyContent: "center", gap: 12 },
  loadText: { color: "#FFD98A", fontSize: 13 },
});
