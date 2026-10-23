// 日记页顶上的「明信片相册」：olo 每次出门带回来的那张，横着翻。
import { useEffect, useMemo, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { Postcard, Settings, fetchPostcards } from "./api";
import { skyAt } from "./daytime";
import { paintPostcard } from "./nookScene";
import { paintScene } from "./skyScene";
import { layerPng } from "./skyPng";
import { FONT, colors, pixelBox, spacing, type } from "./theme";

function Card({ card }: { card: Postcard }) {
  const uri = useMemo(() => { const h = new Date(card.created_at).getHours() + new Date(card.created_at).getMinutes() / 60; return layerPng(paintPostcard(skyAt(h), card.place, paintScene), 3); }, [card.id]);
  const d = new Date(card.created_at);
  return (
    <View style={[styles.card, pixelBox]} testID="album-card">
      <Image source={{ uri }} style={styles.pic} fadeDuration={0} />
      <Text style={styles.title}>{card.title}<Text style={styles.date}>{`  ${d.getMonth() + 1}月${d.getDate()}日`}</Text></Text>
      <Text style={styles.story}>{card.story}</Text>
    </View>
  );
}

export function Album({ settings, active }: { settings: Settings; active: boolean }) {
  const [cards, setCards] = useState<Postcard[]>([]);
  useEffect(() => { if (active) fetchPostcards(settings).then((r) => setCards(r.postcards)).catch(() => undefined); }, [active, settings]);
  if (!cards.length) return null;
  return (
    <View style={styles.wrap} testID="album">
      <Text style={styles.head}>明信片 · olo 出门带回来的</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.md }}>
        {cards.map((c) => <Card key={c.id} card={c} />)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  head: { color: colors.muted, fontSize: type.xs, marginBottom: spacing.xs, fontFamily: FONT },
  card: { width: 220, backgroundColor: "#FFFAF0", padding: 8 },
  pic: { width: "100%", aspectRatio: 64 / 40, borderWidth: 2, borderColor: colors.ink },
  title: { color: colors.ink, fontSize: type.sm, marginTop: 6, fontFamily: FONT },
  date: { color: "#A05A3A", fontSize: 11 },
  story: { color: colors.ink, fontSize: type.xs, lineHeight: 18, marginTop: 2, fontFamily: FONT },
});
