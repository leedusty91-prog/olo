import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

import { colors } from "./theme";

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

const BODY_COLORS: Record<string, string> = {
  mint: "#6FC3B2",
  sky: "#7EC8E3",
  sun: "#F2C94C",
  blush: "#F2A6A6",
  lavender: "#B7A6E3",
};

function Hair({ style, color }: { style?: string; color: string }) {
  switch (style) {
    case "bow":
      return (
        <>
          <View style={[styles.hairBun, { left: 78, backgroundColor: color }]} />
          <View style={[styles.hairBun, { right: 78, backgroundColor: color }]} />
        </>
      );
    case "leaf":
      return <View style={[styles.hairSpike, { borderBottomColor: color }]} />;
    case "spikes":
      return (
        <>
          <View style={[styles.hairFin, styles.hairFinLeft, { backgroundColor: color }]} />
          <View style={[styles.hairFin, styles.hairFinRight, { backgroundColor: color }]} />
        </>
      );
    case "curl":
      return (
        <>
          <View style={[styles.hairCurl, { backgroundColor: color }]} />
          <View style={[styles.hairCurlDot, { backgroundColor: color }]} />
        </>
      );
    case "crest":
      return <View style={[styles.hairCap, { backgroundColor: color }]} />;
    case "bun":
      return (
        <>
          <View style={[styles.hairDot, { left: 90, backgroundColor: color }]} />
          <View style={[styles.hairDot, { left: 106, backgroundColor: color }]} />
          <View style={[styles.hairDot, { left: 122, backgroundColor: color }]} />
        </>
      );
    case "sun":
      return (
        <>
          <View style={[styles.hairRay, styles.rayOne, { backgroundColor: color }]} />
          <View style={[styles.hairRay, styles.rayTwo, { backgroundColor: color }]} />
          <View style={[styles.hairRay, styles.rayThree, { backgroundColor: color }]} />
          <View style={[styles.hairRay, styles.rayFour, { backgroundColor: color }]} />
          <View style={[styles.hairRay, styles.rayFive, { backgroundColor: color }]} />
        </>
      );
    case "halo":
      return (
        <>
          <View style={[styles.hairWing, styles.hairWingLeft, { backgroundColor: color }]} />
          <View style={[styles.hairWing, styles.hairWingRight, { backgroundColor: color }]} />
        </>
      );
    default:
      return null;
  }
}

function Cheeks({ style }: { style?: string }) {
  if (style === "none") return null;
  if (style === "dots") {
    return (
      <>
        <View style={[styles.cheekDot, { left: 26 }]} />
        <View style={[styles.cheekDot, { right: 26 }]} />
      </>
    );
  }
  if (style === "triangle") {
    return (
      <>
        <View style={[styles.cheekTriangle, { left: 16 }]} />
        <View style={[styles.cheekTriangle, { right: 16 }]} />
      </>
    );
  }
  if (style === "warpaint") {
    return (
      <>
        <View style={[styles.warpaint, styles.warpaintLeft, { left: 12 }]} />
        <View style={[styles.warpaint, styles.warpaintRight, { left: 12 }]} />
        <View style={[styles.warpaint, styles.warpaintLeft, { right: 12 }]} />
        <View style={[styles.warpaint, styles.warpaintRight, { right: 12 }]} />
      </>
    );
  }
  return (
    <>
      <View style={[styles.cheek, styles.cheekLeft]} />
      <View style={[styles.cheek, styles.cheekRight]} />
    </>
  );
}

/**
 * 原创的小团子形象：团子身体 + 两根触角 + 大眼睛。
 * 外观（颜色 / 眼型 / 腮红 / 发型）按人设里的 appearance 渲染。
 */
export function Character({ size = 220, mood = "idle", appearance }: Props) {
  const float = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const talk = useRef(new Animated.Value(0)).current;
  const morph = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    const blinkLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(2600),
        Animated.timing(blink, {
          toValue: 0.12,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.timing(blink, {
          toValue: 1,
          duration: 110,
          useNativeDriver: true,
        }),
      ]),
    );
    floatLoop.start();
    blinkLoop.start();
    return () => {
      floatLoop.stop();
      blinkLoop.stop();
    };
  }, [blink, float]);

  useEffect(() => {
    const talkLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(talk, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(talk, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
      ]),
    );
    if (mood === "speaking") {
      talkLoop.start();
    } else {
      talk.setValue(0);
    }
    return () => talkLoop.stop();
  }, [mood, talk]);

  const form = appearance?.form ?? "buddy";
  useEffect(() => {
    morph.setValue(0.9);
    Animated.spring(morph, {
      toValue: 1,
      friction: 6,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [form, morph]);

  const scale = size / 220;
  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -7] });
  const haloOpacity =
    mood === "listening" ? 0.85 : mood === "speaking" ? 0.9 : mood === "thinking" ? 0.7 : 0.55;
  const haloColor = mood === "thinking" || mood === "speaking" ? colors.sun : colors.mint;
  const mouthOpen = talk.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });

  const bodyColor =
    BODY_COLORS[appearance?.color ?? "mint"] ?? BODY_COLORS.mint;
  const almond = appearance?.eyes === "almond";
  const isGlow = form === "glow";
  const isCloud = form === "cloud";
  const bodyExtra = isGlow
    ? { width: 112, height: 112, borderRadius: 56, marginBottom: 44 }
    : isCloud
      ? { width: 138, height: 168, borderRadius: 69 }
      : {};
  const eyeRowExtra = isGlow ? { marginTop: 26 } : isCloud ? { marginTop: 52 } : {};
  const eyeExtra = isGlow ? { width: 30, height: 32, borderRadius: 15 } : isCloud ? { width: 34, height: 36, borderRadius: 17 } : {};
  const cheekExtra = isGlow ? { top: 66 } : isCloud ? { top: 112 } : {};
  const mouthExtra = isGlow ? { top: 74 } : isCloud ? { top: 124 } : {};
  const morphScale = Animated.multiply(morph, scale);

  return (
    <View style={{ width: size, height: size * 1.1 }}>
      <Animated.View
        style={[
          styles.stage,
          {
            transform: [{ translateY }, { scale: morphScale }],
            width: 220,
            height: 242,
            opacity: morph,
          },
        ]}
      >
        <View style={[styles.halo, { opacity: haloOpacity, backgroundColor: haloColor }]} />

        {isGlow ? (
          <>
            <View style={[styles.orbRing, styles.orbRingOuter, { borderColor: bodyColor }]} />
            <View style={[styles.orbRing, styles.orbRingInner, { borderColor: bodyColor }]} />
          </>
        ) : null}

        {form === "buddy" ? (
          <>
            <View style={[styles.antenna, styles.antennaLeft, { backgroundColor: bodyColor }]} />
            <View style={[styles.antennaTip, styles.antennaTipLeft]} />
            <View style={[styles.antenna, styles.antennaRight, { backgroundColor: bodyColor }]} />
            <View style={[styles.antennaTip, styles.antennaTipRight]} />
          </>
        ) : null}

        {isGlow ? null : <Hair style={appearance?.hair} color={bodyColor} />}

        <View style={[styles.body, { backgroundColor: bodyColor }, bodyExtra]}>
          <View style={styles.belly} />

          <View style={[styles.eyeRow, eyeRowExtra]}>
            <View style={[styles.eye, almond && styles.eyeAlmond, eyeExtra]}>
              <Animated.View style={[styles.pupil, { transform: [{ scaleY: blink }] }]} />
            </View>
            <View style={[styles.eye, almond && styles.eyeAlmond, eyeExtra]}>
              <Animated.View style={[styles.pupil, { transform: [{ scaleY: blink }] }]} />
            </View>
          </View>

          <Cheeks style={appearance?.cheeks} />

          {mood === "thinking" ? (
            <View style={[styles.mouthThinking, mouthExtra]} />
          ) : (
            <Animated.View
              style={[
                styles.mouth,
                mouthExtra,
                mood === "speaking" && { transform: [{ scaleY: mouthOpen }] },
              ]}
            />
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: "center",
    justifyContent: "flex-end",
  },
  halo: {
    position: "absolute",
    top: 26,
    width: 196,
    height: 196,
    borderRadius: 98,
  },
  antenna: {
    position: "absolute",
    top: 34,
    width: 6,
    height: 44,
    borderRadius: 3,
  },
  antennaLeft: {
    left: 74,
    transform: [{ rotate: "-18deg" }],
  },
  antennaRight: {
    left: 140,
    transform: [{ rotate: "18deg" }],
  },
  antennaTip: {
    position: "absolute",
    top: 24,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.blush,
  },
  antennaTipLeft: { left: 64 },
  antennaTipRight: { left: 142 },
  body: {
    width: 132,
    height: 146,
    borderRadius: 66,
    marginBottom: 8,
    alignItems: "center",
  },
  belly: {
    position: "absolute",
    top: 82,
    width: 70,
    height: 54,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  eyeRow: {
    flexDirection: "row",
    gap: 14,
    marginTop: 42,
  },
  eye: {
    width: 36,
    height: 38,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  eyeAlmond: {
    width: 44,
    height: 28,
    borderRadius: 14,
  },
  pupil: {
    width: 14,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.ink,
  },
  cheek: {
    position: "absolute",
    top: 98,
    width: 18,
    height: 12,
    borderRadius: 9,
    backgroundColor: colors.blush,
    opacity: 0.75,
  },
  cheekLeft: { left: 14 },
  cheekRight: { right: 14 },
  cheekDot: {
    position: "absolute",
    top: 104,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.blush,
  },
  cheekTriangle: {
    position: "absolute",
    top: 100,
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 12,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: colors.blush,
  },
  warpaint: {
    position: "absolute",
    top: 100,
    width: 16,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.blush,
  },
  warpaintLeft: { transform: [{ rotate: "14deg" }] },
  warpaintRight: { top: 108, transform: [{ rotate: "-14deg" }] },
  mouth: {
    position: "absolute",
    top: 104,
    width: 22,
    height: 9,
    borderBottomLeftRadius: 11,
    borderBottomRightRadius: 11,
    backgroundColor: "#2A3A34",
  },
  mouthThinking: {
    position: "absolute",
    top: 106,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#2A3A34",
  },
  hairBun: {
    position: "absolute",
    top: 68,
    width: 26,
    height: 26,
    borderRadius: 13,
    opacity: 0.9,
  },
  hairSpike: {
    position: "absolute",
    top: 56,
    left: 99,
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderBottomWidth: 24,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  hairFin: {
    position: "absolute",
    top: 84,
    width: 10,
    height: 36,
    borderRadius: 5,
    opacity: 0.9,
  },
  hairFinLeft: { left: 56, transform: [{ rotate: "-22deg" }] },
  hairFinRight: { right: 56, transform: [{ rotate: "22deg" }] },
  hairCurl: {
    position: "absolute",
    top: 62,
    left: 100,
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  hairCurlDot: {
    position: "absolute",
    top: 58,
    left: 116,
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  hairCap: {
    position: "absolute",
    top: 74,
    left: 58,
    width: 104,
    height: 20,
    borderRadius: 10,
    opacity: 0.92,
  },
  hairDot: {
    position: "absolute",
    top: 64,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  hairRay: {
    position: "absolute",
    width: 4,
    height: 16,
    borderRadius: 2,
    opacity: 0.9,
  },
  rayOne: { top: 56, left: 108 },
  rayTwo: { top: 62, left: 88, transform: [{ rotate: "-28deg" }] },
  rayThree: { top: 62, left: 128, transform: [{ rotate: "28deg" }] },
  rayFour: { top: 80, left: 76, transform: [{ rotate: "-52deg" }] },
  rayFive: { top: 80, left: 140, transform: [{ rotate: "52deg" }] },
  hairWing: {
    position: "absolute",
    top: 96,
    width: 34,
    height: 18,
    borderRadius: 17,
    opacity: 0.9,
  },
  orbRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 1,
    opacity: 0.4,
  },
  orbRingOuter: { width: 172, height: 172, top: 36 },
  orbRingInner: { width: 136, height: 136, top: 54 },
  hairWingLeft: { left: 48, transform: [{ rotate: "-24deg" }] },
  hairWingRight: { right: 48, transform: [{ rotate: "24deg" }] },
});
