// 全局像素字体：字体加载好后，给所有 <Text>/<TextInput> 默认加上 fontFamily（各处自己的 style 仍可覆盖字号颜色）。
// 像素字不需要粗体：fontWeight 会让系统合成假粗体而糊边，所以统一去掉。
import { Platform, StyleSheet, Text, TextInput } from "react-native";
import { FONT } from "./theme";

let done = false;
export function applyPixelFont(): void {
  if (done) return;
  done = true;
  for (const C of [Text, TextInput] as unknown as { render?: (p: { style?: unknown }, r: unknown) => unknown }[]) {
    const orig = C.render;
    if (!orig) continue;
    C.render = function (props, ref) {
      const flat = (StyleSheet.flatten(props.style as never) || {}) as Record<string, unknown>;
      const style = [{ fontFamily: FONT }, flat, { fontWeight: "normal" }];
      return orig.call(this, { ...props, style }, ref);
    };
  }
  if (Platform.OS === "web" && typeof document !== "undefined") {
    const s = document.createElement("style");
    s.textContent = "img{image-rendering:pixelated;image-rendering:crisp-edges}*{-webkit-tap-highlight-color:transparent}";
    document.head.appendChild(s);
  }
}
