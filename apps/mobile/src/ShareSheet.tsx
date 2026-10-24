// 分享卡片（手机）：底图来自和网页同一份的 shareCard.js，字和 olo 小人用 Text / Character 按同一套 layout 叠上去，
// 再用 react-native-view-shot 拍成 PNG：「存到相册」走 expo-media-library，「分享」走系统分享面板（expo-sharing）。
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";
import { Appearance, Settings, fetchPersona } from "./api";
import { Character } from "./Character";
import { paintChatScene } from "./chatBg";
import { skyAt } from "./daytime";
import { GLYPH, SHARE_ACCENT, SHARE_INK, SHARE_MUTED, SHARE_SIZES, ShareSize, paintShareCard, wrapShareText } from "./shareCard";
import { paintScene } from "./skyScene";
import { layerPng } from "./skyPng";
import { FONT, colors, pixelBox, spacing, type } from "./theme";

export type ShareItem = { kind: "postcard" | "diary"; title: string; text: string; when: string };
const LABEL: Record<ShareSize, string> = { "1x1": "1:1", "4x5": "4:5", "9x16": "9:16", "16x9": "16:9" };
const toDate = (w: string) => new Date(w.length <= 10 ? `${w}T12:00:00` : w);
const cnDate = (w: string) => { const d = toDate(w); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };

export function ShareSheet({ item, settings, onClose }: { item: ShareItem | null; settings: Settings; onClose: () => void }) {
  const [size, setSize] = useState<ShareSize>("1x1");
  const [msg, setMsg] = useState("");
  const [appearance, setAppearance] = useState<Appearance>();
  const shot = useRef<View>(null);
  const win = useWindowDimensions();
  useEffect(() => { if (item) fetchPersona(settings).then((p) => setAppearance(p.appearance)).catch(() => undefined); }, [item, settings]);
  useEffect(() => setMsg(""), [item, size]);

  const card = useMemo(() => {
    if (!item) return null;
    const d = toDate(item.when), hour = item.kind === "postcard" ? d.getHours() + d.getMinutes() / 60 : 17.6;
    const r = paintShareCard(skyAt(hour), { kind: item.kind, size, date: d, seed: 5 }, { paintChatScene, paintScene });
    return { uri: layerPng(r, 2), L: r.layout, lines: wrapShareText(item.text, r.layout.body.cols, r.layout.body.maxLines), title: wrapShareText(item.title, r.layout.body.cols - 5, 1)[0] ?? "" };
  }, [item, size]);
  if (!item || !card) return null;
  const { L } = card, S = SHARE_SIZES[size];
  const u = Math.min((win.width - 48) / S.W, (win.height * 0.55) / S.H); // 预览里一个低分辨率像素 = u dp
  const fs = GLYPH * u;

  const capture = () => captureRef(shot, { format: "png", width: S.W * S.K, height: S.H * S.K, result: "tmpfile" });
  const share = async () => {
    try {
      if (Platform.OS === "web" || !(await Sharing.isAvailableAsync())) { setMsg("这台设备不支持系统分享"); return; }
      await Sharing.shareAsync(await capture(), { mimeType: "image/png", dialogTitle: "分享 olo 的卡片" });
    } catch { setMsg("没分享出去，再试一次？"); }
  };
  const save = async () => {
    try {
      if (Platform.OS === "web") { setMsg("网页版请在电脑端下载"); return; }
      const p = await MediaLibrary.requestPermissionsAsync(true);
      if (!p.granted) { setMsg("需要相册权限才能存"); return; }
      await MediaLibrary.saveToLibraryAsync(await capture()); setMsg("存好啦 ✓");
    } catch { setMsg("没存上，再试一次？"); }
  };
  const T = (x: number, y: number) => ({ position: "absolute" as const, left: x * u, top: y * u, fontSize: fs, lineHeight: fs * 1.15, fontFamily: FONT });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.back} testID="share-sheet">
        <View style={[styles.box, pixelBox]}>
          <View style={styles.row}>
            {(Object.keys(LABEL) as ShareSize[]).map((k) => (
              <Pressable key={k} onPress={() => setSize(k)} style={[styles.chip, k === size && styles.on]} testID={`share-size-${k}`}><Text style={styles.chipT}>{LABEL[k]}</Text></Pressable>
            ))}
          </View>
          <View ref={shot} collapsable={false} style={{ width: S.W * u, height: S.H * u, overflow: "hidden" }} testID="share-card">
            <View style={StyleSheet.absoluteFill}><ImageFill uri={card.uri} /></View>
            <View style={{ position: "absolute", left: L.sprite.x * u, top: L.sprite.y * u }}><Character size={32 * L.sprite.s * u} mood="happy" appearance={appearance} /></View>
            <Text style={[T(L.title.x, L.title.y), { color: SHARE_ACCENT }]} numberOfLines={1}>{card.title}</Text>
            <Text style={[T(L.date.x - 60, L.date.y), { color: SHARE_MUTED, width: 60 * u, textAlign: "right" }]}>{cnDate(item.when)}</Text>
            {card.lines.map((ln, i) => <Text key={i} style={[T(L.body.x, L.body.y + i * L.body.lineH), { color: SHARE_INK }]}>{ln}</Text>)}
          </View>
          {msg ? <Text style={styles.msg}>{msg}</Text> : null}
          <View style={styles.row}>
            <Pressable onPress={save} style={styles.btn} testID="share-save"><Text style={styles.btnT}>⤓ 存到相册</Text></Pressable>
            <Pressable onPress={share} style={styles.btn} testID="share-send"><Text style={styles.btnT}>⇪ 分享</Text></Pressable>
            <Pressable onPress={onClose} style={styles.btn}><Text style={styles.btnT}>关掉</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// 底图是低分辨率像素图：按最近邻放大（web 上加 pixelated）
function ImageFill({ uri }: { uri: string }) {
  return <Image source={{ uri }} style={[StyleSheet.absoluteFill, Platform.OS === "web" ? ({ imageRendering: "pixelated" } as object) : null]} resizeMode="stretch" fadeDuration={0} />;
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(30,14,10,.6)", alignItems: "center", justifyContent: "center" },
  box: { backgroundColor: "#FFF4DC", padding: spacing.sm, gap: spacing.sm, alignItems: "center" },
  row: { flexDirection: "row", gap: spacing.xs },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 2, borderColor: "#7a4026", backgroundColor: "#fffaf0" },
  on: { backgroundColor: "#ffd98a" },
  chipT: { fontFamily: FONT, fontSize: type.xs, color: colors.ink },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 2, borderColor: "#7a4026", backgroundColor: "#fffaf0" },
  btnT: { fontFamily: FONT, fontSize: type.sm, color: colors.ink },
  msg: { fontFamily: FONT, fontSize: type.xs, color: colors.muted },
});
