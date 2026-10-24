// 活的雾里集（唯一来源）：网页 world.js 和手机端 apps/mobile/src/worldLiving.js 共用（手机端原样拷贝，server 测试核对一致）。
// 纯函数：把 GET /v1/world/state 的数据摘要确定性地映射成街景参数——同样的数据永远是同一条街。
//   聊天天数/连续天数 → 亮着的窗户；最近心情 → 灯笼颜色和街上的气氛；明信片 → 开张的小摊；日记 → 路上的行人。
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

// 灯笼配色：开心偏金粉、平静偏琥珀、低落时换成柔和的暖紫（「有人陪着」的灯，不用冷色）
export const LANTERNS = {
  bright: ["#ffb34d", "#ff8ab0", "#ffd36b"],
  calm: ["#e8a35a", "#c8463a", "#ffc98a"],
  soft: ["#c88ad8", "#e8a0b8", "#ffc98a"],
};
export const MOOD_LINE = {
  bright: "街上暖洋洋的，摊主们在哼歌。",
  calm: "雾里集慢悠悠的，灯笼一盏一盏亮着。",
  soft: "今天街上很安静，灯笼换成了软软的颜色，陪着你。",
  quiet: "雾里集还很安静，等你来把灯点亮。",
};
export const STALLS = ["包子摊", "花摊", "明信片摊", "糖画摊", "旧书摊", "灯笼铺"];

/** summary: { chat_days, streak, mood, mood_days, postcards, places, diary } */
export function livingScene(summary) {
  const s = summary || {};
  const days = Math.max(0, s.chat_days | 0), streak = Math.max(0, s.streak | 0);
  const cards = Math.max(0, s.postcards | 0), diary = Math.max(0, s.diary | 0);
  // 窗户：总窗数 24，聊天天数平方根增长（第 1 天就亮 2 盏，约 60 天点满），连续天数再加一点
  const lit = Math.min(24, Math.round(Math.sqrt(days) * 3) + Math.min(6, streak));
  const mood = typeof s.mood === "number" && (s.mood_days | 0) > 0 ? clamp(s.mood, -1, 1) : null;
  const tone = mood === null ? (days ? "calm" : "quiet") : mood > 0.25 ? "bright" : mood < -0.2 ? "soft" : "calm";
  const stalls = Math.min(STALLS.length, cards === 0 ? 0 : 1 + Math.floor(Math.log2(cards)));
  const walkers = Math.min(8, Math.round(Math.sqrt(diary) * 2));
  return {
    lit, litRatio: lit / 24, tone,
    lanterns: LANTERNS[tone === "quiet" ? "calm" : tone],
    lanternGlow: tone === "quiet" ? 0.5 : tone === "bright" ? 1 : 0.85,
    stalls, stallNames: STALLS.slice(0, stalls),
    walkers,
    bunting: streak >= 7, // 连续 7 天：广场挂起彩旗
    line: MOOD_LINE[tone],
  };
}

/** 第 i 扇窗是否亮着：按固定顺序点亮（散开分布，不是从左到右），同样 lit 数永远同一批窗 */
export function windowLit(i, lit) {
  const order = (i * 7 + 3) % 24; // 24 与 7 互质 → 0..23 的一个排列
  return order < lit;
}
