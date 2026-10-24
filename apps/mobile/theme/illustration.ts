// olo 高清插画主题（灯籽世界 · 软胶果冻风），取代旧的像素主题 src/theme.ts。
// 配色取自开场片：粉金黄昏天空、薰衣草雾、暖橘麻薯、蘑菇灯屋的暖光。
// 所有新/重做的页面都从这里取样式；旧 theme.ts 暂留，等全部页面迁完再删。

export const colors = {
  // 背景与纸面
  bg: "#FBEFE6",          // 奶油桃色底（设定稿底色）
  bgDeep: "#F4DCD0",
  card: "#FFF8F1",        // 气泡 / 卡片
  cardGlass: "rgba(255,250,244,0.88)",
  scrim: "rgba(40,22,30,0.47)",   // 字幕底衬、遮罩
  // 文字
  ink: "#50301E",         // 主文字：暖深棕（不用纯黑）
  muted: "#8C6450",
  onDark: "#FFF6E8",
  // 品牌与灯籽配色
  accent: "#FF9A4D",      // 麻薯橘（按钮、选中）
  accentDeep: "#E6823C",
  accentSoft: "#FFD9A8",
  blush: "#F7A1A0",
  sky: "#F5C6C9",         // 黄昏粉
  dusk: "#C9B3E6",        // 薰衣草雾
  lantern: "#FFD27A",     // 灯笼暖光
  mint: "#BFEBD6",
  // 灯籽种类主色（与 FORMS 对应）
  dengzi: {
    buddy: "#FF9A4D", cloud: "#FFFDF8", glow: "#D9C6F2", bud: "#B8E0A0", dew: "#A8D8F0",
    star: "#FFE27A", peach: "#F9B8C4", acorn: "#B07A50", moon: "#D8DCE4", elder: "#E8C890",
  },
  error: "#C2505A",
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

/** 圆角：插画风一律大圆角，胶囊按钮用 pill。 */
export const radii = { sm: 12, md: 20, lg: 28, xl: 36, pill: 999 } as const;

/** 柔和投影（不再是像素硬投影）。 */
export const shadows = {
  soft: {
    shadowColor: "#7A4A3A", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.16, shadowRadius: 16, elevation: 4,
  },
  glow: {
    shadowColor: "#FFB86B", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.55, shadowRadius: 18, elevation: 6,
  },
} as const;

/** 字体：霞鹜文楷（OFL）。未加载完成时退回系统字体。 */
export const fonts = {
  body: "LXGWWenKai",
  fallback: undefined as string | undefined,
  size: { caption: 13, body: 16, title: 20, h1: 28, hero: 44 },
  lineHeight: 1.5,
} as const;

/** 常用组件片段 */
export const bubble = {
  backgroundColor: colors.card, borderRadius: radii.xl, paddingHorizontal: 20, paddingVertical: 12, ...shadows.soft,
} as const;
export const bubbleMine = { ...bubble, backgroundColor: colors.accentSoft } as const;
export const chip = {
  backgroundColor: colors.cardGlass, borderRadius: radii.pill, paddingHorizontal: 22, paddingVertical: 10,
  borderWidth: 1.5, borderColor: "rgba(255,255,255,0.8)",
} as const;
export const chipOn = { ...chip, backgroundColor: colors.accent } as const;
export const caption = {
  color: colors.onDark, backgroundColor: colors.scrim, borderRadius: radii.md,
  paddingHorizontal: 18, paddingVertical: 8, textAlign: "center" as const,
} as const;

/** 插画处理规范（给设计/生成用，不是样式） */
export const illustration = {
  style: "软胶果冻 3D 插画，粉金黄昏 + 薰衣草雾，暖光，柔焦",
  character: "灯籽：圆团子大头身，无手无脚，基础款只有一撮卷毛，不戴配饰；大圆棕眼 + 一个圆高光 + 腮红",
  noHumans: true,
  motion: { durationMs: 320, easing: "ease-in-out", respectReducedMotion: true },
} as const;

export default { colors, spacing, radii, shadows, fonts, bubble, bubbleMine, chip, chipOn, caption, illustration };
