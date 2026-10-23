import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  NotebookEntry,
  Settings,
  fetchNotebook,
  generateNotebook,
  notebookImageSource,
} from "./api";
import { colors, spacing } from "./theme";

const SERIF = Platform.select({ ios: "Georgia", android: "serif", default: "serif" });

const MOOD_COLORS: Record<string, string> = {
  tender: "#F2C9C0",
  soft: "#F3E3C3",
  calm: "#CFE3DA",
  hopeful: "#DDE8C8",
  heavy: "#D9D2E3",
  quiet: "#D8E2EA",
};

function coverColor(entry: NotebookEntry): string {
  if (entry.mood && MOOD_COLORS[entry.mood]) return MOOD_COLORS[entry.mood];
  let hash = 0;
  for (const char of entry.title) hash = (hash + char.charCodeAt(0)) % 997;
  const palette = Object.values(MOOD_COLORS);
  return palette[hash % palette.length];
}

function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${week}`;
}

function Cover({
  entry,
  settings,
  height,
}: {
  entry: NotebookEntry;
  settings: Settings;
  height: number;
}) {
  if (entry.image_relpath) {
    return (
      <Image
        source={notebookImageSource(settings, entry.id)}
        style={[styles.cover, { height }]}
        resizeMode="cover"
      />
    );
  }
  return (
    <View style={[styles.cover, { height, backgroundColor: coverColor(entry) }]}>
      <View style={[styles.blob, styles.blobOne]} />
      <View style={[styles.blob, styles.blobTwo]} />
      <View style={[styles.blob, styles.blobThree]} />
      <Text style={styles.coverKicker}>OLO&apos;S NOTEBOOK</Text>
      <Text style={styles.coverMood}>{entry.mood ?? "note"}</Text>
    </View>
  );
}

export function NotebookScreen({
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
  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<NotebookEntry | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        setEntries(await fetchNotebook(settings));
        setError(undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : "读取日记失败");
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
      const entry = await generateNotebook(settings, sessionId);
      setEntries((current) => [entry, ...current.filter((item) => item.id !== entry.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "写日记失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>日记</Text>
          <Text style={styles.subtle}>olo 替你记下的那些天</Text>
        </View>
        <Pressable onPress={generate} disabled={busy} style={styles.generate}>
          <Text style={styles.generateText}>{busy ? "写着…" : "写今天的"}</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator style={styles.loading} color={colors.accent} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load(true);
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>还没有日记</Text>
              <Text style={styles.emptyBody}>聊过几轮之后，点「写今天的」生成第一篇。</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => setSelected(item)}>
              <Cover entry={item} settings={settings} height={186} />
              <View style={styles.cardInner}>
                <Text style={styles.kicker}>{formatDay(item.entry_date)}</Text>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardBody} numberOfLines={4}>
                  {item.body}
                </Text>
                <Text style={styles.readMore}>展开这一页 →</Text>
              </View>
            </Pressable>
          )}
        />
      )}

      <Pressable onPress={onOpenSettings} style={styles.settingsLink}>
        <Text style={styles.settingsText}>设置</Text>
      </Pressable>

      <Modal visible={selected !== null} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {selected ? <Cover entry={selected} settings={settings} height={220} /> : null}
            <View style={styles.modalInner}>
              <View style={styles.modalTop}>
                <Text style={styles.kicker}>
                  {selected ? formatDay(selected.entry_date) : ""}
                </Text>
                <Pressable onPress={() => setSelected(null)} hitSlop={10}>
                  <Text style={styles.close}>关闭</Text>
                </Pressable>
              </View>
              <Text style={styles.modalTitle}>{selected?.title}</Text>
              {(selected?.body ?? "")
                .split(/\n\s*\n/)
                .map((p) => p.trim())
                .filter(Boolean)
                .map((p, i) =>
                  /^「[^」]+」$/.test(p) ? (
                    <View key={i} style={styles.quoteBox}>
                      <Text style={styles.quoteText}>{p}</Text>
                    </View>
                  ) : (
                    <Text key={i} style={[styles.modalBody, i > 0 && { marginTop: spacing.sm }]}>
                      {p}
                    </Text>
                  ),
                )}
              {selected?.image_prompt ? (
                <View style={styles.promptBox}>
                  <Text style={styles.promptLabel}>这一页的画面</Text>
                  <Text style={styles.promptText}>{selected.image_prompt}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
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
    borderRadius: 0,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  generateText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  error: { color: colors.error, marginTop: spacing.sm, fontSize: 12 },
  loading: { marginTop: spacing.xl },
  list: { paddingBottom: spacing.md, gap: spacing.lg, marginTop: spacing.md },
  empty: { marginTop: spacing.xl, alignItems: "center", paddingHorizontal: spacing.lg },
  emptyTitle: { fontSize: 16, color: colors.ink, fontWeight: "600" },
  emptyBody: { marginTop: spacing.sm, color: colors.muted, textAlign: "center", lineHeight: 20 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 0,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cover: { width: "100%", justifyContent: "flex-end" },
  blob: { position: "absolute", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.28)" },
  blobOne: { width: 160, height: 160, top: -60, right: -30 },
  blobTwo: { width: 90, height: 90, bottom: 18, left: 24 },
  blobThree: { width: 46, height: 46, top: 34, left: 120 },
  coverKicker: {
    color: "rgba(36,48,44,0.55)",
    fontSize: 10,
    letterSpacing: 2,
    marginHorizontal: spacing.md,
  },
  coverMood: {
    color: "rgba(36,48,44,0.7)",
    fontSize: 22,
    fontFamily: SERIF,
    fontStyle: "italic",
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  cardInner: { padding: spacing.md },
  kicker: { color: colors.muted, fontSize: 11, letterSpacing: 1.2 },
  cardTitle: {
    color: colors.ink,
    fontSize: 21,
    fontFamily: SERIF,
    fontWeight: "700",
    marginTop: spacing.sm,
    lineHeight: 28,
  },
  cardBody: {
    color: colors.ink,
    fontSize: 14,
    fontFamily: SERIF,
    lineHeight: 23,
    marginTop: spacing.sm,
  },
  readMore: { color: colors.accent, fontSize: 12, marginTop: spacing.sm },
  settingsLink: { alignSelf: "center", paddingVertical: spacing.sm },
  settingsText: { color: colors.muted, fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(24,32,28,0.45)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
    maxHeight: "92%",
  },
  modalInner: { padding: spacing.lg },
  modalTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  close: { color: colors.accent, fontSize: 14 },
  modalTitle: {
    color: colors.ink,
    fontSize: 26,
    fontFamily: SERIF,
    fontWeight: "700",
    marginTop: spacing.sm,
    lineHeight: 34,
  },
  quoteBox: {
    marginVertical: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  quoteText: { color: colors.ink, fontSize: 16, lineHeight: 24 },
  modalBody: {
    color: colors.ink,
    fontSize: 16,
    fontFamily: SERIF,
    lineHeight: 27,
    marginTop: spacing.md,
  },
  promptBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.bgDeep,
    borderRadius: 0,
    padding: spacing.md,
  },
  promptLabel: { color: colors.muted, fontSize: 11, letterSpacing: 0.5 },
  promptText: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 4 },
});
