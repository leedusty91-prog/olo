import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Insight, Settings, fetchInsights, generateInsight } from "./api";
import { colors, fonts, radii, shadows, spacing } from "../theme/illustration";

const CATEGORY_LABEL: Record<string, string> = {
  wellbeing: "身心",
  boundaries: "边界",
  growth: "成长",
  connection: "连接",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function isToday(value: string): boolean {
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function Stars({ count, color }: { count: number; color: string }) {
  return (
    <Text style={[styles.stars, { color }]}>
      {"✦".repeat(Math.max(0, Math.min(5, count)))}
    </Text>
  );
}

async function shareInsight(insight: Insight) {
  try {
    await Share.share({
      message: `${insight.body}\n\n—— 来自 olo 的洞察`,
    });
  } catch {
    // 用户取消分享
  }
}

export function InsightsScreen({
  settings,
  sessionId,
  onOpenSettings,
  active = true,
}: {
  settings: Settings;
  sessionId: string;
  onOpenSettings: () => void;
  active?: boolean;
}) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        setInsights(await fetchInsights(settings));
        setError(undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : "读取洞察失败");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [settings],
  );

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const insight = await generateInsight(settings, sessionId);
      setInsights((current) => [insight, ...current]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成洞察失败");
    } finally {
      setBusy(false);
    }
  }

  const [latest, ...rest] = insights;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>洞察</Text>
          <Text style={styles.subtle}>从对话里长出来的观察</Text>
        </View>
        <Pressable onPress={generate} disabled={busy} style={styles.generate}>
          <Text style={styles.generateText}>{busy ? "想着…" : "来一条"}</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator style={styles.loading} color={colors.accent} />
      ) : insights.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyStar}>✦</Text>
          <Text style={styles.emptyTitle}>还没有洞察</Text>
          <Text style={styles.emptyBody}>先聊几轮，再让 olo 说说它看见了你什么。</Text>
        </View>
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load(true);
          }}
          ListHeaderComponent={
            <View style={styles.hero}>
              <View style={styles.heroGlow} />
              <View style={styles.heroStars}>
                <View style={[styles.star, styles.starA]} />
                <View style={[styles.star, styles.starB]} />
                <View style={[styles.star, styles.starC]} />
                <View style={[styles.star, styles.starD]} />
              </View>
              {latest && isToday(latest.created_at) ? (
                <Text style={styles.heroBadge}>新洞察已解锁</Text>
              ) : (
                <Text style={styles.heroBadge}>最近的洞察</Text>
              )}
              <View style={styles.heroBubble}>
                <Text style={styles.heroBody}>{latest?.body}</Text>
              </View>
              <View style={styles.heroMetaRow}>
                <Text style={styles.heroCategory}>
                  {CATEGORY_LABEL[latest?.category ?? ""] ?? latest?.category}
                </Text>
                <Stars count={latest?.stars ?? 3} color={colors.lantern} />
              </View>
              <Pressable style={styles.shareButton} onPress={() => latest && shareInsight(latest)}>
                <Text style={styles.shareText}>分享这条洞察</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => shareInsight(item)}>
              <View style={styles.cardTop}>
                <Text style={styles.category}>
                  {CATEGORY_LABEL[item.category] || item.category}
                </Text>
                <Text style={styles.date}>{formatDate(item.created_at)}</Text>
              </View>
              <Text style={styles.body}>{item.body}</Text>
              <View style={styles.cardBottom}>
                <Stars count={item.stars} color={colors.lantern} />
                <Text style={styles.shareHint}>点按分享</Text>
              </View>
            </Pressable>
          )}
        />
      )}

      <Pressable onPress={onOpenSettings} style={styles.settingsLink}>
        <Text style={styles.settingsText}>设置</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.md },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  title: { fontSize: 26, fontWeight: "700", color: colors.ink },
  subtle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  generate: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  generateText: { color: colors.card, fontSize: 13, fontWeight: "600" },
  error: { color: colors.error, marginTop: spacing.sm, fontSize: 12 },
  loading: { marginTop: spacing.xl },
  empty: { marginTop: spacing.xl * 2, alignItems: "center", paddingHorizontal: spacing.lg },
  emptyStar: { fontSize: 40, color: colors.lantern, marginBottom: spacing.md },
  emptyTitle: { fontSize: 16, color: colors.ink, fontWeight: "600" },
  emptyBody: { marginTop: spacing.sm, color: colors.muted, textAlign: "center", lineHeight: 20 },
  list: { paddingBottom: spacing.md, gap: spacing.md, paddingTop: spacing.md },
  hero: {
    backgroundColor: colors.dusk,
    borderRadius: radii.md,
    padding: spacing.lg,
    overflow: "hidden",
  },
  heroGlow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.lantern,
    opacity: 0.18,
    top: -80,
    right: -50,
  },
  heroStars: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  star: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: radii.md,
    backgroundColor: colors.dusk,
  },
  starA: { top: 22, left: 32 },
  starB: { top: 48, right: 40 },
  starC: { bottom: 36, left: 54 },
  starD: { bottom: 64, right: 24 },
  heroBadge: {
    color: colors.ink,
    fontSize: 10,
    letterSpacing: 1.6,
    marginBottom: spacing.sm,
  },
  heroBubble: {
    backgroundColor: colors.cardGlass,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  heroBody: {
    color: colors.ink,
    fontSize: 19,
    lineHeight: 30,
    fontFamily: fonts.body,
  },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  heroCategory: {
    color: colors.ink,
    fontSize: 11,
    backgroundColor: colors.cardGlass,
    borderRadius: radii.md,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  stars: { fontSize: 14, letterSpacing: 2 },
  shareButton: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardGlass,
    borderRadius: radii.md,
    paddingVertical: 10,
    alignItems: "center",
  },
  shareText: { color: colors.ink, fontSize: 13 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  category: {
    color: colors.accent,
    fontSize: 11,
    backgroundColor: colors.accentSoft,
    borderRadius: radii.md,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  date: { color: colors.muted, fontSize: 11 },
  body: { color: colors.ink, fontSize: 15, lineHeight: 22, marginTop: spacing.sm },
  cardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  shareHint: { color: colors.muted, fontSize: 11 },
  settingsLink: { alignSelf: "center", paddingVertical: spacing.sm },
  settingsText: { color: colors.muted, fontSize: 12 },
});
