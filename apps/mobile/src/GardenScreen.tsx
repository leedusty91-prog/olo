import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Appearance, GardenState, Settings, fetchGarden, fetchPersona } from "./api";
import { Character } from "./Character";

const BG = { day: require("../assets/hd/bg-day.jpg"), night: require("../assets/hd/bg-night.jpg") };
import { colors, fonts, radii, shadows, spacing } from "../theme/illustration";


// 夜间是深棕底，卡片要用半透明暖光而不是浅色 cardGlass，否则浅字压在浅底上读不出来
const NIGHT_GLASS = "rgba(255,246,232,0.14)";
const NIGHT_GLASS_LINE = "rgba(255,246,232,0.55)";

type Mode = "auto" | "day" | "night";

const MODES: { id: Mode; label: string }[] = [
  { id: "auto", label: "自动" },
  { id: "day", label: "白天" },
  { id: "night", label: "夜晚" },
];

export function GardenScreen({
  settings,
  onOpenSettings,
  active = true,
}: {
  settings: Settings;
  onOpenSettings: () => void;
  active?: boolean;
}) {
  const [state, setState] = useState<GardenState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<Mode>("auto");
  const [appearance, setAppearance] = useState<Appearance>();
  const [oloName, setOloName] = useState("olo");

  async function load() {
    setError(undefined);
    try {
      setState(await fetchGarden(settings));
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取花园失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    fetchPersona(settings).then((p) => { setAppearance(p.appearance); if (p.name?.trim()) setOloName(p.name.trim()); }).catch(() => undefined);
  }, [active, settings]);

  useEffect(() => {
    if (active) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, settings]);

  const hour = new Date().getHours();
  const night = mode === "night" || (mode === "auto" && (hour < 6 || hour >= 18));
  const level = state?.level ?? 1;

  const fg = night ? colors.onDark : colors.ink;
  const muted = night ? colors.onDark : colors.muted;
  const ringColor = night ? NIGHT_GLASS_LINE : colors.bgDeep;
  const cardBg = night ? NIGHT_GLASS : colors.card;
  const trackBg = night ? NIGHT_GLASS : colors.bgDeep;

  return (
    <ScrollView
      style={[styles.wrap, night && { backgroundColor: colors.night }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: fg }]}>花园</Text>
          <Text style={[styles.subtle, { color: muted }]}>
            {night ? "夜晚" : "白天"}的花园 · 它记得你们一起过的时间
          </Text>
        </View>
        <Pressable onPress={onOpenSettings} hitSlop={8}>
          <Text style={[styles.settings, night && { color: colors.lantern }]}>设置</Text>
        </Pressable>
      </View>

      <View style={styles.modeRow}>
        {MODES.map((item) => {
          const activeMode = item.id === mode;
          return (
            <Pressable
              key={item.id}
              onPress={() => setMode(item.id)}
              style={[
                styles.modeChip,
                { borderColor: ringColor },
                activeMode && { backgroundColor: night ? colors.ink : colors.accentSoft },
                activeMode && { borderColor: night ? colors.lantern : colors.accent },
              ]}
            >
              <Text
                style={[
                  styles.modeText,
                  { color: activeMode ? (night ? colors.onDark : colors.accent) : muted },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading || !state ? (
        <ActivityIndicator color={night ? colors.lantern : colors.accent} style={styles.loading} />
      ) : (
        <>
          <ImageBackground
            source={night ? BG.night : BG.day}
            style={styles.stage}
            imageStyle={styles.stageImg}
            resizeMode="cover"
            testID="garden-stage"
          >
            <Character size={150} mood={level >= 3 ? "happy" : night ? "sleep" : "idle"} appearance={appearance} />
            <View style={[styles.namePill, { backgroundColor: night ? colors.nightCard : colors.cardGlass }]}>
              <Text style={[styles.namePillT, { color: night ? colors.onDark : colors.ink }]}>{oloName}的花园</Text>
            </View>
          </ImageBackground>

          <Text style={[styles.level, { color: fg }]}>第 {state.level} 级</Text>
          <Text style={[styles.levelHint, { color: muted }]}>
            {state.next_level_score === null
              ? "已经是一座很热闹的花园了"
              : `再攒 ${Math.max(0, state.next_level_score - state.score)} 分升级`}
          </Text>

          <View style={[styles.progressTrack, { backgroundColor: trackBg }]}>
            <View
              style={[
                styles.progressFill,
                night && { backgroundColor: colors.lantern },
                { width: `${state.growth}%` },
              ]}
            />
          </View>
          <Text style={[styles.progressLabel, { color: muted }]}>{state.growth}%</Text>

          <View style={[styles.stats, { backgroundColor: cardBg }]}>
            <Stat label="对话" value={state.messages} fg={fg} muted={muted} />
            <Stat label="日记" value={state.entries} fg={fg} muted={muted} />
            <Stat label="洞察" value={state.insights} fg={fg} muted={muted} />
            <Stat label="来过" value={state.days} fg={fg} muted={muted} />
          </View>

          <Text style={[styles.sectionTitle, { color: fg }]}>里程碑</Text>
          {state.milestones.map((item) => (
            <View key={item.key} style={styles.milestone}>
              <View
                style={[
                  styles.check,
                  { borderColor: ringColor },
                  item.reached && styles.checkDone,
                ]}
              >
                <Text style={styles.checkText}>{item.reached ? "✓" : ""}</Text>
              </View>
              <Text
                style={[
                  styles.milestoneText,
                  { color: item.reached ? fg : muted },
                ]}
              >
                {item.label}
              </Text>
            </View>
          ))}

          <Pressable
            onPress={() => {
              Alert.alert("花园是怎么长的", "对话、日记、洞察都会让它长一点。");
            }}
            style={styles.help}
          >
            <Text style={[styles.helpText, night && { color: colors.lantern }]}>它是怎么长的？</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function Stat({
  label,
  value,
  fg,
  muted,
}: {
  label: string;
  value: number;
  fg: string;
  muted: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: fg }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  title: { fontSize: 26, fontWeight: "700", color: colors.ink },
  subtle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  settings: { color: colors.accent, fontSize: 14 },
  modeRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  modeChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  modeText: { fontSize: 12 },
  error: { color: colors.error, marginTop: spacing.sm, fontSize: 12 },
  loading: { marginTop: spacing.xl },
  stage: {
    height: 280,
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radii.lg,
    overflow: "hidden",
    paddingBottom: spacing.md,
    ...shadows.soft,
  },
  stageImg: { borderRadius: radii.lg },
  namePill: { marginTop: spacing.xs, borderRadius: radii.pill, paddingHorizontal: 16, paddingVertical: 4 },
  namePillT: { fontSize: 13 },
  level: { textAlign: "center", fontSize: 22, fontWeight: "700", color: colors.ink },
  levelHint: { textAlign: "center", color: colors.muted, fontSize: 12, marginTop: 4 },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.bgDeep,
    marginTop: spacing.md,
    overflow: "hidden",
  },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  progressLabel: { textAlign: "right", color: colors.muted, fontSize: 11, marginTop: 4 },
  stats: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: 18,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  stat: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 20, fontWeight: "700", color: colors.ink },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  milestone: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.bgDeep,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  checkDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkText: { color: colors.card, fontSize: 12, fontWeight: "700" },
  milestoneText: { color: colors.muted, fontSize: 14 },
  help: { alignSelf: "center", marginTop: spacing.lg, padding: spacing.sm },
  helpText: { color: colors.accent, fontSize: 12 },
});
