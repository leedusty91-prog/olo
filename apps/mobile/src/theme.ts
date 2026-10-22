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
