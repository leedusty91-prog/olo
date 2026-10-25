import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { GardenState, Settings, fetchGarden } from "./api";
import { colors, spacing } from "./theme";

const DAY_COLORS = ["#6FC3B2", "#6FC3B2", "#7EC8E3", "#F2C94C", "#F29F6C"];
const NIGHT_COLORS = ["#4E9C8C", "#4E9C8C", "#5B86A8", "#D9AE43", "#D2814F"];

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
    if (active) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, settings]);

  const hour = new Date().getHours();
  const night = mode === "night" || (mode === "auto" && (hour < 6 || hour >= 18));
  const level = state?.level ?? 1;
  const palette = night ? NIGHT_COLORS : DAY_COLORS;
  const gardenColor = palette[Math.min(level, palette.length) - 1];

  const fg = night ? "#EFEAE0" : colors.ink;
  const muted = night ? "#AEB6D4" : colors.muted;
  const ringColor = night ? "rgba(255,255,255,0.16)" : colors.line;
  const cardBg = night ? "rgba(255,255,255,0.07)" : colors.card;
  const trackBg = night ? "rgba(255,255,255,0.14)" : colors.bgDeep;

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
          <Text style={[styles.settings, night && { color: "#8FD3C7" }]}>设置</Text>
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
                activeMode && { backgroundColor: night ? "#2E3B63" : colors.accentSoft },
                activeMode && { borderColor: night ? "#8FD3C7" : colors.accent },
              ]}
            >
              <Text
                style={[
                  styles.modeText,
                  { color: activeMode ? (night ? "#DCEAE3" : colors.accent) : muted },
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
        <ActivityIndicator color={night ? "#8FD3C7" : colors.accent} style={styles.loading} />
      ) : (
        <>
          <View style={styles.stage}>
            <View style={[styles.ringOuter, { borderColor: ringColor }]} />
            <View style={[styles.ringInner, { borderColor: ringColor }]} />
            <View style={[styles.garden, { backgroundColor: gardenColor }]}>
              <View style={styles.gardenShade} />
              <View style={[styles.sprout, styles.sproutOne]} />
              <View style={[styles.sprout, styles.sproutTwo]} />
              <View style={[styles.sprout, styles.sproutThree]} />
            </View>
            {night ? (
              <>
                <View style={styles.moon} />
                <View style={[styles.star, styles.starOne]} />
                <View style={[styles.star, styles.starTwo]} />
                <View style={[styles.star, styles.starThree]} />
              </>
            ) : (
              <View style={styles.sun} />
            )}
          </View>

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
                night && { backgroundColor: "#8FD3C7" },
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
            <Text style={[styles.helpText, night && { color: "#8FD3C7" }]}>它是怎么长的？</Text>
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
    height: 260,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  ringOuter: {
    position: "absolute",
    width: 236,
    height: 236,
    borderRadius: 118,
    borderWidth: 1,
    borderColor: colors.line,
  },
  ringInner: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 1,
    borderColor: colors.line,
  },
  garden: {
    width: 132,
    height: 132,
    borderRadius: 66,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  gardenShade: {
    position: "absolute",
    bottom: -34,
    width: 132,
    height: 80,
    borderRadius: 66,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  sprout: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "rgba(47,93,80,0.55)",
  },
  sproutOne: { top: 34, left: 38 },
  sproutTwo: { top: 58, left: 74 },
  sproutThree: { top: 30, left: 92 },
  moon: {
    position: "absolute",
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#DCE3F5",
    top: 18,
    right: 54,
  },
  sun: {
    position: "absolute",
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.sun,
    top: 14,
    right: 52,
  },
  star: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#C9D2EE",
  },
  starOne: { top: 60, left: 40 },
  starTwo: { bottom: 44, right: 66 },
  starThree: { top: 32, left: 128 },
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
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  checkDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  milestoneText: { color: colors.muted, fontSize: 14 },
  help: { alignSelf: "center", marginTop: spacing.lg, padding: spacing.sm },
  helpText: { color: colors.accent, fontSize: 12 },
});
