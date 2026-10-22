// 本地时区 + 背景天色（网页 skytime.js 的同一时间轴，换成浅色调）。
import { useEffect, useState } from "react";

export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function localHour(tz?: string, date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
    return get("hour") + get("minute") / 60;
  } catch {
    return date.getHours() + date.getMinutes() / 60;
  }
}

type RGB = [number, number, number];
// 移动端是浅色主题（深色文字），所以只用浅色调：夜里淡紫灰、黎明淡粉、白天米白、黄昏淡杏
const KEYS: [number, RGB][] = [
  [0, [222, 214, 230]],
  [4.5, [224, 216, 232]],
  [6, [248, 226, 214]],
  [8, [246, 240, 231]],
  [16, [246, 240, 231]],
  [18.5, [246, 218, 198]],
  [20, [226, 216, 230]],
  [24, [222, 214, 230]],
];

export function skyColor(hour: number): string {
  let i = 0;
  while (i < KEYS.length - 2 && hour >= KEYS[i + 1][0]) i++;
  const [h0, a] = KEYS[i];
  const [h1, b] = KEYS[i + 1];
  const f = Math.min(1, Math.max(0, (hour - h0) / (h1 - h0)));
  const s = f * f * (3 - 2 * f);
  const c = a.map((v, j) => Math.round(v + (b[j] - v) * s));
  return `rgb(${c.join(",")})`;
}

export function isNight(hour: number): boolean {
  return hour >= 19.5 || hour < 5.5;
}

/** Re-evaluates once a minute. */
export function useSky(tz?: string): { color: string; night: boolean } {
  const [hour, setHour] = useState(() => localHour(tz));
  useEffect(() => {
    setHour(localHour(tz));
    const id = setInterval(() => setHour(localHour(tz)), 60_000);
    return () => clearInterval(id);
  }, [tz]);
  return { color: skyColor(hour), night: isNight(hour) };
}
