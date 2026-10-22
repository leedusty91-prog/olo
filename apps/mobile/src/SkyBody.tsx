// 角色身后的太阳 / 月亮：太阳沿弧线走，夜里月牙加几颗星。
import { StyleSheet, View } from "react-native";

const STARS: [number, number][] = [[8, 18], [22, 8], [70, 14], [86, 30], [40, 4], [58, 26]];

export function SkyBody({ sun, height = 190 }: { sun: number | null; height?: number }) {
  if (sun !== null) {
    const left = `${6 + sun * 80}%` as const;
    const top = Math.round(height * (0.55 - 0.45 * Math.sin(Math.PI * sun)));
    const low = 1 - Math.sin(Math.PI * sun) > 0.6;
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill]} testID="sky-sun">
        <View style={[styles.glow, { left, top: top - 8, backgroundColor: low ? "rgba(255,158,90,0.25)" : "rgba(255,217,138,0.3)" }]} />
        <View style={[styles.sun, { left, top, backgroundColor: low ? "#FFB066" : "#FFD98A" }]} />
      </View>
    );
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="sky-moon">
      {STARS.map(([x, y]) => (
        <View key={`${x}-${y}`} style={[styles.star, { left: `${x}%`, top: `${y}%` }]} />
      ))}
      <View style={[styles.moon, { right: "12%", top: 10 }]}>
        <View style={styles.moonCut} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sun: { position: "absolute", width: 28, height: 28, borderRadius: 4, marginLeft: -14 },
  glow: { position: "absolute", width: 44, height: 44, borderRadius: 8, marginLeft: -22 },
  moon: { position: "absolute", width: 26, height: 26, borderRadius: 13, backgroundColor: "#8A7A9A", overflow: "hidden" },
  moonCut: { position: "absolute", width: 26, height: 26, borderRadius: 13, left: 8, top: -5, backgroundColor: "rgba(222,214,230,1)" },
  star: { position: "absolute", width: 3, height: 3, backgroundColor: "#8A7A9A" },
});
