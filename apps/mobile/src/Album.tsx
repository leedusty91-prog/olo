// 日记页顶上的「明信片相册」：olo 每次出门带回来的那张，横着翻。
import { getOloName } from "./oloName";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ShareItem, ShareSheet } from "./ShareSheet";
import { Postcard, Settings, fetchPostcards } from "./api";
import { postcardBg } from "./postcardBg";
import { colors, fonts, radii, shadows, spacing } from "../theme/illustration";
/** 卡片：大圆角 + 柔和投影（全部取自 theme/illustration）。 */
const hdCard = { borderRadius: radii.lg, ...shadows.soft } as const;

function Card({ card, onShare }: { card: Postcard; onShare: (i: ShareItem) => void }) {
  const pic = postcardBg(new Date(card.created_at).getHours());
  const d = new Date(card.created_at);
  return (
    <View style={[styles.card, hdCard]} testID="album-card">
      <Image source={pic} style={styles.pic} resizeMode="cover" fadeDuration={0} />
      <Text style={styles.title}>{card.title}<Text style={styles.date}>{`  ${d.getMonth() + 1}月${d.getDate()}日`}</Text></Text>
      <Text style={styles.story}>{card.story}</Text>
      <Pressable onPress={() => onShare({ kind: "postcard", title: card.title, text: card.story, when: card.created_at })} hitSlop={8} testID="share-postcard"><Text style={styles.share}>⇪ 分享</Text></Pressable>
    </View>
  );
}

export function Album({ settings, active }: { settings: Settings; active: boolean }) {
  const [cards, setCards] = useState<Postcard[]>([]);
  const [sharing, setSharing] = useState<ShareItem | null>(null);
  useEffect(() => { if (active) fetchPostcards(settings).then((r) => setCards(r.postcards)).catch(() => undefined); }, [active, settings]);
  if (!cards.length) return null;
  return (
    <View style={styles.wrap} testID="album">
      <Text style={styles.head}>明信片 · {getOloName()} 出门带回来的</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.md }}>
        {cards.map((c) => <Card key={c.id} card={c} onShare={setSharing} />)}
      </ScrollView>
      <ShareSheet item={sharing} settings={settings} onClose={() => setSharing(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  share: { color: colors.muted, fontSize: fonts.size.caption, fontFamily: fonts.body, marginTop: 6 },
  head: { color: colors.muted, fontSize: fonts.size.caption, marginBottom: spacing.xs, fontFamily: fonts.body },
  card: { width: 220, backgroundColor: colors.card, padding: 8 },
  // 明确宽高：网页端 width:100% + aspectRatio 会被图片原始尺寸撑成竖长条
  pic: { width: 204, height: 128, borderWidth: 1.5, borderColor: colors.bgDeep },
  title: { color: colors.ink, fontSize: fonts.size.caption, marginTop: 6, fontFamily: fonts.body },
  date: { color: colors.muted, fontSize: 11 },
  story: { color: colors.ink, fontSize: fonts.size.caption, lineHeight: 18, marginTop: 2, fontFamily: fonts.body },
});
