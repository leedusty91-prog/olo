// 明信片 / 相册 / 分享卡的插画底图：跟 shareCard.js 的 shareBg 同一条规则（19 点到 5 点用夜晚，其余用黄昏）。
import { shareBg } from "./shareCard";
const BG = { "bg-dusk": require("../assets/hd/bg-dusk.jpg"), "bg-night": require("../assets/hd/bg-night.jpg") };
export const postcardBg = (hour: number) => BG[shareBg(hour)];
