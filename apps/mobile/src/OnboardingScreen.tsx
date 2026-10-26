import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Character } from "./Character";
import { Settings, updatePersona } from "./api";
import { deviceTimeZone } from "./daytime";
import { saveOnboarded } from "./onboarding";
import { colors, spacing } from "./theme";

// 不再让用户选性格：olo 只有一个默认人设。这里只打个招呼、记下时区。
export function OnboardingScreen({
  settings,
  onDone,
}: {
  settings: Settings;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [nickname, setNickname] = useState("");

  async function finish() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const timezone = deviceTimeZone();
      const user_nickname = nickname.trim() || undefined;
      if (timezone || user_nickname) await updatePersona(settings, { timezone, user_nickname });
    } catch (err) {
      setError(err instanceof Error ? err.message : "连不上，稍后再试");
      setBusy(false);
      return;
    }
    await saveOnboarded();
    setBusy(false);
    onDone();
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Character size={170} mood="listening" />
      </View>
      <Text style={styles.title}>嗨，我是 olo</Text>
      <Text style={styles.subtitle}>镜子那边，倒影国的一只小涟漪兽。你说的每一句话，都会变成一圈涟漪漂到它那边。</Text>
      <Text style={styles.question}>你想让 olo 怎么称呼你？</Text>
      <TextInput
        style={styles.input}
        value={nickname}
        onChangeText={setNickname}
        maxLength={12}
        placeholder="可以不填，之后在「我的」里改"
        placeholderTextColor={colors.muted}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.primary} onPress={finish} disabled={busy}>
        <Text style={styles.primaryText}>{busy ? "点灯中…" : "开始聊天"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  hero: { alignItems: "center", marginTop: spacing.lg },
  title: {
    fontSize: 25,
    fontWeight: "700",
    color: colors.ink,
    textAlign: "center",
    marginTop: spacing.md,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  input: {
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.ink,
  },
  progress: { color: colors.muted, fontSize: 12, marginTop: spacing.lg },
  question: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 31,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  option: {
    backgroundColor: colors.card,
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  optionText: { color: colors.ink, fontSize: 15 },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  chipRow: { flexDirection: "row", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { color: colors.muted, fontSize: 13 },
  chipTextActive: { color: colors.accent, fontWeight: "600" },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  primaryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  skip: { alignSelf: "center", marginTop: spacing.md, padding: spacing.sm },
  skipText: { color: colors.muted, fontSize: 13 },
  error: { color: colors.error, fontSize: 12, marginTop: spacing.md },
  guideStage: {
    width: 170,
    height: 170,
    alignItems: "center",
    justifyContent: "center",
  },
  guideGlow: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: colors.sun,
    opacity: 0.18,
  },
  guideRing: {
    position: "absolute",
    width: 138,
    height: 138,
    borderRadius: 69,
    borderWidth: 1,
    borderColor: colors.line,
  },
  guideCore: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: colors.night,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  guideEye: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.sun,
  },
});
