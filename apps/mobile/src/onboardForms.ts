// 相遇仪式里可选的 10 种灯籽（与 server/olo/forms.py FORMS 一致）。基础款都没有饰品。
export const DENGZI_FORMS = [
  { id: "buddy", label: "麻薯", desc: "软团子 · 爱蹦跶", img: require("../assets/forms/buddy.png") },
  { id: "cloud", label: "云朵", desc: "软软的 · 慢悠悠", img: require("../assets/forms/cloud.png") },
  { id: "glow", label: "微光", desc: "小火苗 · 话很少", img: require("../assets/forms/glow.png") },
  { id: "bud", label: "芽苞", desc: "有朝气 · 爱晒太阳", img: require("../assets/forms/bud.png") },
  { id: "dew", label: "露珠", desc: "心软 · 会共情", img: require("../assets/forms/dew.png") },
  { id: "star", label: "星星", desc: "爱夸人 · 夜里最亮", img: require("../assets/forms/star.png") },
  { id: "peach", label: "桃花", desc: "害羞 · 很细腻", img: require("../assets/forms/peach.png") },
  { id: "acorn", label: "橡果", desc: "个子小 · 很靠谱", img: require("../assets/forms/acorn.png") },
  { id: "moon", label: "月牙", desc: "安静 · 陪你熬夜", img: require("../assets/forms/moon.png") },
  { id: "amber", label: "琥珀", desc: "沉稳 · 不急不慢", img: require("../assets/forms/amber.png") },
] as const;
export type DengziForm = (typeof DENGZI_FORMS)[number]["id"];
