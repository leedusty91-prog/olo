// olo 角色：与网页同一套像素形态（小团子 / 云朵 / 微光），帧图由 scripts/gen_mobile_sprites.py 从 web/pixel.js 渲染。
import { useEffect, useState } from "react";
import { AccessibilityInfo, Image, ImageSourcePropType, StyleSheet, View } from "react-native";

type Mood = "idle" | "listening" | "thinking" | "speaking";

export type CharacterAppearance = {
  color?: string;
  eyes?: string;
  cheeks?: string;
  hair?: string;
  voice?: string;
  form?: string;
};

type Props = {
  size?: number;
  mood?: Mood;
  appearance?: CharacterAppearance;
};

const FRAMES = 12;
const FRAME_MS = 220;

/* eslint-disable @typescript-eslint/no-require-imports */
const SHEETS: Record<string, Record<string, ImageSourcePropType>> = {
  buddy: {
    idle: require("../assets/olo/buddy-idle.png"),
    happy: require("../assets/olo/buddy-happy.png"),
    talking: require("../assets/olo/buddy-talking.png"),
    sad: require("../assets/olo/buddy-sad.png"),
    thinking: require("../assets/olo/buddy-thinking.png"),
  },
  cloud: {
    idle: require("../assets/olo/cloud-idle.png"),
    happy: require("../assets/olo/cloud-happy.png"),
    talking: require("../assets/olo/cloud-talking.png"),
    sad: require("../assets/olo/cloud-sad.png"),
    thinking: require("../assets/olo/cloud-thinking.png"),
  },
  glow: {
    idle: require("../assets/olo/glow-idle.png"),
    happy: require("../assets/olo/glow-happy.png"),
    talking: require("../assets/olo/glow-talking.png"),
    sad: require("../assets/olo/glow-sad.png"),
    thinking: require("../assets/olo/glow-thinking.png"),
  },
};

const STATE_FOR: Record<Mood, string> = {
  idle: "idle",
  listening: "happy",
  thinking: "thinking",
  speaking: "talking",
};

export function Character({ size = 220, mood = "idle", appearance }: Props) {
  const form = appearance?.form && SHEETS[appearance.form] ? appearance.form : "buddy";
  const sheet = SHEETS[form][STATE_FOR[mood] ?? "idle"];
  const [frame, setFrame] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduced).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (reduced) {
      setFrame(0);
      return;
    }
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES), FRAME_MS);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <View
      style={[styles.box, { width: size, height: size }]}
      accessibilityRole="image"
      accessibilityLabel="olo"
      testID={`olo-${form}`}
    >
      <Image
        source={sheet}
        resizeMode="stretch"
        fadeDuration={0}
        style={[styles.sheet, { width: size * FRAMES, height: size, transform: [{ translateX: -frame * size }] }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: "hidden" },
  sheet: { position: "absolute", left: 0, top: 0 },
});
