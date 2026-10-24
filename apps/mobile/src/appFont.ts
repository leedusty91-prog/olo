// 全局默认字体：字体加载好后，给所有 <Text>/<TextInput> 默认加上 fontFamily（各处自己的 style 仍可覆盖）。
// 高清插画风默认用 theme/illustration 的 fonts.body（霞鹜文楷）。
import { Platform, StyleSheet, Text, TextInput } from "react-native";
import { fonts } from "../theme/illustration";

let done = false;
export function applyAppFont(family: string = fonts.body): void {
  if (done) return;
  done = true;
  for (const C of [Text, TextInput] as unknown as { render?: (p: { style?: unknown }, r: unknown) => unknown }[]) {
    const orig = C.render;
    if (!orig) continue;
    C.render = function (props, ref) {
      const flat = (StyleSheet.flatten(props.style as never) || {}) as Record<string, unknown>;
      return orig.call(this, { ...props, style: [{ fontFamily: family }, flat] }, ref);
    };
  }
  if (Platform.OS === "web" && typeof document !== "undefined") {
    const s = document.createElement("style");
    // 高清插画按平滑缩放；仍是像素画的运行时生成图（data: URI，如小屋/明信片/分享卡）保持锐利
    s.textContent = 'img[src^="data:"],[style*="data:image"]{image-rendering:pixelated;image-rendering:crisp-edges}*{-webkit-tap-highlight-color:transparent}';
    document.head.appendChild(s);
  }
}
