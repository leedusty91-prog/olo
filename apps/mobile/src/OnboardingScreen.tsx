import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Character } from "./Character";
import { Settings, ToneOption, fetchPersona, updatePersonaTone } from "./api";
import { saveOnboarded } from "./onboarding";
import { colors, spacing } from "./theme";

const FALLBACK_TONES: ToneOption[] = [
  { id: "curious", label: "好奇", description: "爱追问细节，对你今天发生的事有兴趣。" },
  { id: "calm", label: "安静", description: "句子短一点，先陪着，不急着给建议。" },
  { id: "playful", label: "损友", description: "会轻轻开个玩笑，再认真接住你。" },
];

type Question = {
  id: string;
  prompt: string;
  options: { label: string; tone: "curious" | "calm" | "playful" }[];
};

const QUESTIONS: Question[] = [
  {
    id: "q1",
    prompt: "今天要是有点撑不住，你最想被怎么接住？",
    options: [
      { label: "被认真追问细节", tone: "curious" },
      { label: "先安静陪一会儿", tone: "calm" },
      { label: "被轻轻损一句再认真", tone: "playful" },
    ],
  },
  {
    id: "q2",
    prompt: "你希望你的 olo 更像哪一种存在？",
    options: [
      { label: "一起往前走的同行者", tone: "curious" },
      { label: "一个稳定的锚", tone: "calm" },
      { label: "嘴上不饶人的朋友", tone: "playful" },
    ],
  },
  {
    id: "q3",
    prompt: "聊天时你更舒服的节奏是？",
    options: [
      { label: "多问、多聊、多展开", tone: "curious" },
      { label: "慢一点，句子短一点", tone: "calm" },
      { label: "有点玩笑，别太正经", tone: "playful" },
    ],
  },
];

function Guide() {
  return (
    <View style={styles.guideStage}>
      <View style={styles.guideGlow} />
      <View style={styles.guideRing} />
      <View style={styles.guideCore}>
        <View style={styles.guideEye} />
        <View style={styles.guideEye} />
      </View>
    </View>
  );
}

export function OnboardingScreen({
  settings,
  onDone,
}: {
  settings: Settings;
  onDone: () => void;
}) {
  const [step, setStep] = useState(-1); // -1 介绍；0..2 问题；3 结果
  const [answers, setAnswers] = useState<string[]>([]);
  const [tones, setTones] = useState<ToneOption[]>(FALLBACK_TONES);
  const [override, setOverride] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    fetchPersona(settings)
      .then((state) => {
        if (alive && state.options?.length) setTones(state.options);
      })
      .catch(() => {
        // 离线时用内置选项
      });
    return () => {
      alive = false;
    };
  }, [settings]);

  const recommended = useMemo(() => {
    const score: Record<string, number> = { curious: 0, calm: 0, playful: 0 };
    for (const answer of answers) {
      if (answer in score) score[answer] += 1;
    }
    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    return ranked[0][1] === 0 ? "curious" : ranked[0][0];
  }, [answers]);

  const chosen = override ?? recommended;

  function answer(tone: string) {
    const next = [...answers, tone];
    setAnswers(next);
    setStep(next.length);
  }

  function restart() {
    setAnswers([]);
    setOverride(null);
    setStep(-1);
  }

  async function finish() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await updatePersonaTone(settings, chosen);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，稍后再试");
      setBusy(false);
      return;
    }
    await saveOnboarded();
    setBusy(false);
    onDone();
  }

  if (step === -1) {
    return (
      <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Guide />
        </View>
        <Text style={styles.title}>我是引路小灯</Text>
        <Text style={styles.subtitle}>
          我会问你三个小问题，帮你找到合适的 olo。之后你可以随时在「我的」里换。
        </Text>
        <Pressable style={styles.primary} onPress={() => setStep(0)}>
          <Text style={styles.primaryText}>开始</Text>
        </Pressable>
        <Pressable style={styles.skip} onPress={() => setStep(3)}>
          <Text style={styles.skipText}>我自己挑</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (step < QUESTIONS.length) {
    const question = QUESTIONS[step];
    return (
      <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
        <Text style={styles.progress}>问题 {step + 1} / {QUESTIONS.length}</Text>
        <Text style={styles.question}>{question.prompt}</Text>
        {question.options.map((option) => (
          <Pressable
            key={option.label}
            style={styles.option}
            onPress={() => answer(option.tone)}
          >
            <Text style={styles.optionText}>{option.label}</Text>
          </Pressable>
        ))}
        <Pressable onPress={restart} style={styles.skip}>
          <Text style={styles.skipText}>重来</Text>
        </Pressable>
      </ScrollView>
    );
  }

  const recommendedOption = tones.find((item) => item.id === recommended);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Character size={170} mood="listening" />
      </View>
      <Text style={styles.title}>你的 olo 是「{recommendedOption?.label ?? recommended}」型</Text>
      <Text style={styles.subtitle}>
        {recommendedOption?.description ?? "先按这个节奏相处，不合适随时换。"}
      </Text>

      <Text style={styles.sectionTitle}>想调整的话</Text>
      <View style={styles.chipRow}>
        {tones.map((tone) => {
          const active = tone.id === chosen;
          return (
            <Pressable
              key={tone.id}
              onPress={() => setOverride(tone.id)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{tone.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.primary} onPress={finish} disabled={busy}>
        <Text style={styles.primaryText}>{busy ? "记住了…" : "就是它了"}</Text>
      </Pressable>
      <Pressable onPress={restart} style={styles.skip}>
        <Text style={styles.skipText}>再答一次</Text>
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
