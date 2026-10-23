import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/** 轻触感：抓起 / 松手 / 发送 / 菜单。Web 上没有就算了。 */
export function tap(kind: "light" | "medium" | "select" = "light"): void {
  if (Platform.OS === "web") return;
  const p = kind === "select" ? Haptics.selectionAsync() : Haptics.impactAsync(kind === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  p.catch(() => undefined);
}
