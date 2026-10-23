// 暖色像素风，与网页 web/styles.css 同一套色：奶油纸 / 暖木 / 琥珀 / 深墨描边
export const colors = {
  bg: "#F3DCB4",
  bgDeep: "#E8C99A",
  ink: "#2A140C",
  muted: "#7A4A3A",
  accent: "#6B3A2E",
  accentSoft: "#FFD98A",
  card: "#FFF3DC",
  line: "#2A140C",
  mint: "#4FA89A",
  mintDark: "#3A8478",
  blush: "#F08A80",
  sun: "#FFB347",
  night: "#2A1422",
  error: "#A8323E",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

/** 像素框：直角 + 深色描边 + 硬投影（对应网页 .px-box）。 */
export const pixelBox = {
  borderRadius: 0,
  borderWidth: 3,
  borderColor: "#2A140C",
  shadowColor: "#2A140C",
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 4,
} as const;

/** 像素字体（Fusion Pixel，OFL）；字号按 12px 像素格的整数倍取，避免糊边。 */
export const FONT = "FusionPixel";
export const type = { xs: 12, sm: 13, md: 15, lg: 18, xl: 24 } as const;

/** 细一点的像素框（气泡用）：2px 描边 + 3px 硬投影。 */
export const pixelBubble = {
  borderRadius: 0,
  borderWidth: 2,
  borderColor: "#2A140C",
  shadowColor: "#2A140C",
  shadowOffset: { width: 3, height: 3 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 3,
} as const;

/** 最小触控尺寸（iOS HIG 44pt）。 */
export const TOUCH = 44;
