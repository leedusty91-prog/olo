// 雾里集的四个地方：小广场（集市）、olo 的小屋、林间湖、屋顶。每个场景：地面、场外延伸（铺满整个屏幕）、道具、出口、小动物。
import { hash2 } from "./world-art.js";

const inRect = (i, j, a, b, c, d) => i >= a && i <= c && j >= b && j <= d;

export const LORE = [
  "雾里集的雾，是夜里没说出口的话变的。早上太阳一晒，就散成露水。",
  "井是集上最老的东西。传说往里说一句真心话，回声会晚一天才回来。",
  "芦婆婆的船只在起雾的日子出来。她说雾里的人，划船更不容易迷路。",
  "蘑菇婶的包子馅每天都不一样。她说要看今天集上的人，心里缺点什么。",
  "小屋的窗台朝东，第一缕光会先落在最左边那盆花上。",
  "林间湖底沉着一盏灯。湖面最平静的晚上，能看见它在下面眨眼。",
  "屋顶上的风铃是用雨滴做的。下雨天它最安静，因为它在听同伴说话。",
  "流星落进雾里集，会变成一颗小石子，摸起来是温的。",
  "olo 是从一颗灯籽里长出来的。灯籽要听很多很多话，才会发芽。",
  "集上的鸽子认得每一个人的脚步声，但它们从来不说。",
  "蘑菇圈里的蘑菇，晚上会悄悄交换位置。谁也没看见过，但大家都知道。",
  "雾里集没有地图。路是被走出来的，你走过的地方，就会多一条小路。",
];

// 每个可互动物件：type（美术）、位置、碰撞半径 r、点击框 hit[w,h]、动作 act
const PLAZA_OBJS = [
  { id: "well", type: "well", x: 7, y: 5, r: 0.9, hit: [30, 36], act: "well", label: "水井" },
  { id: "tree", type: "tree", x: 2.6, y: 8.2, r: 0.6, hit: [28, 48], act: "tree", label: "小树", o: { fruit: "#ff8ab0" } },
  { id: "lamp", type: "lamp", x: 10.5, y: 3, r: 0.3, hit: [12, 42], act: "lamp", label: "路灯", light: [0, -36, 26, "#ffd98a"] },
  { id: "bench", type: "bench", x: 3.2, y: 3.6, r: 0.7, hit: [30, 18], act: "bench", label: "长椅" },
  { id: "crates", type: "crates", x: 11.6, y: 8.4, r: 0.7, hit: [26, 22], act: "crates", label: "木箱" },
  { id: "pot", type: "pot", x: 5.2, y: 9.3, r: 0.35, hit: [12, 22], act: "water", label: "花盆", plant: "plaza-pot", o: { flower: "#ff8ab0" } },
  { id: "stall", type: "stall", x: 9.4, y: 7.6, r: 1.1, hit: [44, 36], act: "stall", label: "包子摊", o: { steam: true, col: "#d84a4a" } },
  { id: "board", type: "board", x: 6, y: 1.8, r: 0.4, hit: [20, 28], act: "lore", label: "告示板" },
  { id: "door", type: "door", x: 3.4, y: 0.4, r: 0, hit: [52, 58], act: "door", label: "小屋的门", to: "house", at: [4.5, 6.6], o: { lit: true } },
  { id: "ladder", type: "ladder", x: 12.4, y: 0.5, r: 0, hit: [14, 48], act: "door", label: "梯子（去屋顶）", to: "roof", at: [1.6, 6.2] },
  { id: "sign", type: "sign", x: 13.2, y: 5.6, r: 0.2, hit: [20, 20], act: "door", label: "路牌（去林间湖）", to: "lake", at: [1.2, 6], o: { dir: 1 } },
  { id: "boat", type: "boat", x: 8, y: 12.6, r: 0, hit: [34, 24], act: "boat", label: "芦婆婆的船", moving: true },
  { id: "flowers1", type: "flowers", x: 1, y: 5, r: 0, deco: true },
  { id: "flowers2", type: "flowers", x: 12.6, y: 10.2, r: 0, deco: true, o: { cols: ["#8ab0ff", "#fff4e0"] } },
];
const HOUSE_OBJS = [
  { id: "bed", type: "bed", x: 1.3, y: 5.6, r: 1, hit: [30, 24], act: "bed", label: "小床" },
  { id: "shelf", type: "shelf", x: 0.4, y: 2.6, r: 0.6, hit: [24, 40], act: "lore", label: "书架" },
  { id: "stove", type: "stove", x: 6.6, y: 0.6, r: 0.6, hit: [22, 40], act: "stove", label: "小炉子", light: [0, -6, 14, "#ff9a4a"] },
  { id: "window", type: "window", x: 3.8, y: 0, r: 0, hit: [22, 18], hitY: 24, act: "window", label: "窗户" },
  { id: "frame", type: "frame", x: 0, y: 4.6, r: 0, hit: [14, 12], hitY: 30, act: "frame", label: "相框" },
  { id: "musicbox", type: "musicbox", x: 7.3, y: 4.2, r: 0.5, hit: [18, 16], act: "music", label: "八音盒" },
  { id: "table", type: "table", x: 4.4, y: 4.4, r: 0.6, hit: [24, 20], act: "table", label: "小桌" },
  { id: "pot1", type: "pot", x: 2.4, y: 0.7, r: 0.3, hit: [12, 22], act: "water", label: "左边的花", plant: "pot1", o: { flower: "#ff8ab0" } },
  { id: "pot2", type: "pot", x: 3.4, y: 0.7, r: 0.3, hit: [12, 22], act: "water", label: "中间的花", plant: "pot2", o: { flower: "#ffd36b" } },
  { id: "pot3", type: "pot", x: 4.6, y: 0.7, r: 0.3, hit: [12, 22], act: "water", label: "右边的花", plant: "pot3", o: { flower: "#8ab0ff" } },
  { id: "cushion", type: "cushion", x: 6, y: 6.2, r: 0, hit: [18, 10], act: "bench", label: "坐垫" },
  { id: "exit", type: "void", x: 4.5, y: 7.8, r: 0, hit: [30, 14], act: "door", label: "出门（去小广场）", to: "plaza", at: [3.6, 1.6] },
];
const LAKE_OBJS = [
  { id: "swing", type: "swing", x: 3.4, y: 3, r: 0.6, hit: [36, 50], act: "swing", label: "树下的秋千" },
  { id: "dock", type: "dock", x: 7.8, y: 6.7, r: 0, hit: [30, 14], act: "fish", label: "小码头（钓鱼）" },
  { id: "rock1", type: "rock", x: 6.4, y: 9.2, r: 0.4, hit: [14, 10], act: "rock", label: "石头", o: { s: 1 } },
  { id: "rock2", type: "rock", x: 12.6, y: 2.6, r: 0.5, hit: [16, 12], act: "rock", label: "大石头", o: { s: 1.4 } },
  { id: "reeds1", type: "reeds", x: 7.2, y: 4.4, r: 0, deco: true },
  { id: "reeds2", type: "reeds", x: 5.6, y: 10.6, r: 0, deco: true },
  { id: "ring", type: "void", x: 2, y: 9.4, r: 0, hit: [26, 14], act: "ring", label: "蘑菇圈" },
  { id: "flowersL", type: "flowers", x: 1.6, y: 1.4, r: 0, deco: true, o: { cols: ["#ffd36b", "#fff4e0", "#ff8ab0"] } },
  { id: "pine1", type: "pine", x: 0.6, y: 7.4, r: 0.4, deco: true },
  { id: "pine2", type: "pine", x: 5.4, y: 0.6, r: 0.4, deco: true, o: { s: 1.2 } },
  { id: "west", type: "sign", x: 0.5, y: 5.2, r: 0.2, hit: [20, 20], act: "door", label: "路牌（回小广场）", to: "plaza", at: [12.4, 5.8], o: { dir: -1 } },
];
const ROOF_OBJS = [
  { id: "telescope", type: "telescope", x: 5.2, y: 3, r: 0.5, hit: [22, 26], act: "telescope", label: "望远镜" },
  { id: "chimney", type: "chimney", x: 2.2, y: 2, r: 0.5, hit: [18, 30], act: "chimney", label: "烟囱", smoke: true },
  { id: "chime", type: "chime", x: 8.4, y: 1.4, r: 0.3, hit: [14, 32], act: "chime", label: "风铃" },
  { id: "cushion", type: "cushion", x: 4.4, y: 5.4, r: 0, hit: [18, 10], act: "stargaze", label: "坐垫（看星星）" },
  { id: "ladder", type: "ladder", x: 1, y: 7.4, r: 0, hit: [14, 30], act: "door", label: "梯子（下去）", to: "plaza", at: [11.8, 1.4] },
  { id: "tile1", type: "rooftile", x: 8.6, y: 6.6, r: 0.5, deco: true },
];

const lakeWater = (i, j) => Math.hypot((i - 11) / 1.15, j - 8.6) < 4.2 || (i >= 9 && j >= 11) || i > 13.2 && j > 5;
export const SCENES = {
  plaza: {
    id: "plaza", name: "小广场", W: 14, H: 12, horizon: 0.18, spawn: [7, 7.2], amb: "city",
    floor: (i, j) => (j >= 11 ? (j >= 12 ? "deep" : "water") : inRect(i, j, 2, 2, 11, 9) ? "plaza" : (i >= 12 && j >= 4 && j <= 7) || (j <= 1 && i >= 2 && i <= 5) ? "path" : "grass"),
    fill: (i, j) => (j >= 11 ? "deep" : i >= 14 && j >= 4 && j <= 7 ? "path" : "grass"),
    walk: (t) => t !== "water" && t !== "deep",
    deco: (i, j, h) => (j >= 11 ? (h < 0.05 ? { type: "reeds" } : null) : h < 0.14 ? { type: "pine", o: { s: 0.8 + h * 2 } } : h < 0.19 ? { type: "rock", o: { s: 0.8 } } : h < 0.26 ? { type: "flowers" } : null),
    objs: PLAZA_OBJS,
    exits: [{ x0: 13.6, y0: 4, x1: 15, y1: 7.6, to: "lake", at: [1.2, 6] }],
    critters: [["pigeon", 6, 6], ["pigeon", 8, 3.5], ["pigeon", 5, 7], ["pigeon", 9.5, 5], ["cat", 4, 6, { col: "#e8a35a" }], ["npc", 9.4, 6.6, { col: "#c0504e", fixed: true }]],
    items: [["ball", 8.4, 6.2]],
  },
  house: {
    id: "house", name: "olo 的小屋", W: 9, H: 8, indoor: true, spawn: [4.5, 6.6], amb: "room",
    floor: (i, j) => (inRect(i, j, 2, 3, 6, 6) ? "rug" : "wood"),
    fill: () => "wood",
    walk: () => true,
    objs: HOUSE_OBJS,
    exits: [{ x0: 3, y0: 7.6, x1: 6, y1: 9, to: "plaza", at: [3.6, 1.6] }],
    critters: [],
    items: [["ball", 5.6, 3.4]],
  },
  lake: {
    id: "lake", name: "林间湖", W: 14, H: 12, horizon: 0.16, spawn: [1.2, 6], amb: "river",
    floor: (i, j) => (inRect(i, j, 7, 6, 9, 7) ? "wood" : lakeWater(i, j) ? (Math.hypot((i - 11) / 1.15, j - 8.6) < 2.6 ? "deep" : "water") : (Math.hypot((i - 11) / 1.15, j - 8.6) < 5.4 ? "sand" : "forest")),
    fill: (i, j) => (i > 13 && j > 3 ? "deep" : j >= 12 && i > 7 ? "deep" : "forest"),
    walk: (t) => t !== "water" && t !== "deep",
    deco: (i, j, h) => (i > 13 && j > 3) || (j >= 12 && i > 7) ? (h < 0.04 ? { type: "reeds" } : null) : h < 0.2 ? { type: "pine", o: { s: 0.8 + h * 2 } } : h < 0.25 ? { type: "mushroom" } : h < 0.3 ? { type: "flowers" } : null,
    objs: LAKE_OBJS,
    exits: [{ x0: -1, y0: 4, x1: 0.35, y1: 7.5, to: "plaza", at: [12.4, 5.8] }],
    critters: [["duck", 11, 8], ["duck", 12, 9.5], ["frog", 6.8, 8.4], ["butterfly", 3, 5, { col: "#ffd36b" }], ["butterfly", 5, 2, { col: "#ff8ab0" }], ["firefly", 2, 8], ["firefly", 4, 7], ["firefly", 6, 3], ["firefly", 3, 2], ["firefly", 8, 4], ["firefly", 1.5, 10]],
    items: [["pinecone", 4.6, 5.2]],
  },
  roof: {
    id: "roof", name: "屋顶", W: 10, H: 8, horizon: 0.46, spawn: [2, 6], amb: "boat",
    floor: () => "roof",
    fill: () => "roof2",
    walk: () => true,
    deco: (i, j, h) => (h < 0.025 ? { type: "chimney" } : null),
    objs: ROOF_OBJS,
    exits: [],
    critters: [["cat", 7, 5, { col: "#6a6a7a", sleeper: true }]],
    items: [],
  },
};
export const SCENE_ORDER = ["plaza", "house", "lake", "roof"];

// 每天的收集物（按日期播种，位置固定在可走的地方）
export function dailyFinds(day) {
  const seed = [...day].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const r = (k) => hash2(seed % 9973, k, 3);
  const pick = (sc, k, kind, n) => {
    const S = SCENES[sc], out = [];
    for (let t = 0, m = 0; m < n && t < 80; t++) {
      const x = 0.8 + r(k * 100 + t) * (S.W - 1.6), y = 0.8 + r(k * 100 + t + 50) * (S.H - 1.6);
      const ft = S.floor(Math.floor(x), Math.floor(y));
      if (!S.walk(ft) || S.objs.some((o) => o.r && Math.hypot(o.x - x, o.y - y) < o.r + 0.5)) continue;
      if (kind === "shell" && ft !== "sand") continue;
      out.push({ id: `${day}:${sc}:${kind}-${m}`, kind, scene: sc, x, y }); m++;
    }
    return out;
  };
  return [...pick("lake", 1, "shell", 3), ...pick("lake", 2, "mushroom", 2), ...pick("plaza", 3, "leaf", 1), ...pick("house", 4, "leaf", 1)];
}
