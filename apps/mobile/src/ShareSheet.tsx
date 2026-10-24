// 分享卡片（手机，插画风）：排版来自和网页同一份的 shareCard.js；高清背景 + 奶油圆角纸片 + 文楷字 + 灯籽立绘，
// 再用 react-native-view-shot 拍成 PNG：「存到相册」走 expo-media-library，「分享」走系统分享面板（expo-sharing）。
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";
import { Appearance, Settings, fetchPersona } from "./api";
import { Character } from "./Character";
import { SHARE_ACCENT, SHARE_INK, SHARE_MUTED, SHARE_PAPER, SHARE_PAPER_LINE, SHARE_SIZES, ShareSize, shareBg, shareLayout, wrapShareText } from "./shareCard";
import { colors, fonts, radii, shadows, spacing } from "../theme/illustration";
/** 卡片：大圆角 + 柔和投影（全部取自 theme/illustration）。 */
const hdCard = { borderRadius: radii.lg, ...shadows.soft } as const;

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
    const L = shareLayout(size);
    return { bg: BG[shareBg(hour)], L, lines: wrapShareText(item.text, L.body.cols, L.body.maxLines), title: wrapShareText(item.title, L.body.cols - 5, 1)[0] ?? "" };
  }, [item, size]);
  if (!item || !card) return null;
  const { L } = card, S = SHARE_SIZES[size];
  const u = Math.min((win.width - 48) / S.W, (win.height * 0.55) / S.H); // 预览缩放：1 导出像素 = u dp

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
  const T = (x: number, y: number, f: number) => ({ position: "absolute" as const, left: x * u, top: y * u, fontSize: f * u, lineHeight: f * u * 1.3, fontFamily: fonts.body });
  const P = L.panel;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.back} testID="share-sheet">
        <View style={[styles.box, hdCard]}>
          <View style={styles.row}>
            {(Object.keys(LABEL) as ShareSize[]).map((k) => (
              <Pressable key={k} onPress={() => setSize(k)} style={[styles.chip, k === size && styles.on]} testID={`share-size-${k}`}><Text style={styles.chipT}>{LABEL[k]}</Text></Pressable>
            ))}
          </View>
          <View ref={shot} collapsable={false} style={{ width: S.W * u, height: S.H * u, overflow: "hidden" }} testID="share-card">
            <Image source={card.bg} style={StyleSheet.absoluteFill} resizeMode="cover" />
            <View style={{ position: "absolute", left: P.x * u, top: P.y * u, width: P.w * u, height: P.h * u, borderRadius: P.r * u, backgroundColor: SHARE_PAPER, ...shadows.soft }}>
              {card.lines.map((_, i) => <View key={i} style={{ position: "absolute", left: (L.body.x - P.x) * u, right: (L.body.x - P.x) * u, top: (L.body.y - P.y + (i + 1) * L.body.lineH - 6) * u, height: Math.max(1, 2 * u), backgroundColor: SHARE_PAPER_LINE }} />)}
            </View>
            <View style={{ position: "absolute", left: L.sprite.x * u, top: L.sprite.y * u }}><Character size={L.sprite.size * u} mood="happy" appearance={appearance} /></View>
            <Text style={[T(L.title.x, L.title.y, L.title.fs), { color: SHARE_ACCENT }]} numberOfLines={1}>{card.title}</Text>
            <Text style={[T(L.date.x - 300, L.date.y, L.date.fs), { color: SHARE_MUTED, width: 300 * u, textAlign: "right" }]}>{cnDate(item.when)}</Text>
            {card.lines.map((ln, i) => <Text key={i} style={[T(L.body.x, L.body.y + i * L.body.lineH, L.body.fs), { color: SHARE_INK }]}>{ln}</Text>)}
            <Text style={[T(L.mark.x - 200, L.mark.y, L.mark.fs), { color: SHARE_MUTED, width: 200 * u, textAlign: "right", opacity: 0.7 }]}>olo</Text>
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

const BG = { "bg-dusk": require("../assets/hd/bg-dusk.jpg"), "bg-night": require("../assets/hd/bg-night.jpg") };

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: colors.scrim, alignItems: "center", justifyContent: "center" },
  box: { backgroundColor: colors.card, padding: spacing.sm, gap: spacing.sm, alignItems: "center" },
  row: { flexDirection: "row", gap: spacing.xs },
  chip: { paddingHorizontal: 14, minHeight: 36, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.bgDeep, backgroundColor: colors.card },
  on: { backgroundColor: colors.accentSoft },
  chipT: { fontFamily: fonts.body, fontSize: fonts.size.caption, color: colors.ink },
  btn: { paddingHorizontal: 16, minHeight: 44, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.bgDeep, backgroundColor: colors.card },
  btnT: { fontFamily: fonts.body, fontSize: fonts.size.caption, color: colors.ink },
  msg: { fontFamily: fonts.body, fontSize: fonts.size.caption, color: colors.muted },
});
