// 本地时区 + 背景天色：与网页 web/skytime.js 同一套关键帧（skyKeys.ts）、同一种平滑插值。
// 时区优先用服务器存的用户时区，其次设备时区。调试/截图固定时刻：网页导出用 ?bg_hour=5.5，原生用 EXPO_PUBLIC_BG_HOUR。
import { useEffect, useMemo, useState } from "react";
import { AppState, Platform } from "react-native";
import { SKY_KEYS } from "./skyKeys";

export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

const norm = (n: number) => ((n % 24) + 24) % 24;
export const HOUR_OVERRIDE: number | null = (() => {
  let v: string | null | undefined = process.env.EXPO_PUBLIC_BG_HOUR;
  if (Platform.OS === "web" && typeof location !== "undefined") v = new URLSearchParams(location.search).get("bg_hour") ?? v;
  const n = v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? norm(n) : null;
})();

export function localHour(tz?: string, date = new Date()): number {
  if (HOUR_OVERRIDE !== null) return HOUR_OVERRIDE;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz || deviceTimeZone(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
    return get("hour") + get("minute") / 60;
  } catch {
    return date.getHours() + date.getMinutes() / 60;
  }
}

type RGB = [number, number, number];
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
export type Sky = { sky: RGB[]; star: number; lamp: number; sun: number; phase: string; hour: number };

export function skyAt(hour: number): Sky {
  let i = 0;
  while (i < SKY_KEYS.length - 2 && hour >= SKY_KEYS[i + 1][0]) i++;
  const [h0, a] = SKY_KEYS[i];
  const [h1, b] = SKY_KEYS[i + 1];
  const f = h1 === h0 ? 0 : Math.min(1, Math.max(0, (hour - h0) / (h1 - h0)));
  const s = f * f * (3 - 2 * f);
  return {
    sky: a.sky.map((c, k) => c.map((v, j) => Math.round(lerp(v, b.sky[k][j], s))) as RGB),
    star: lerp(a.star, b.star, s),
    lamp: lerp(a.lamp, b.lamp, s),
    sun: lerp(a.sun, b.sun, s),
    phase: s < 0.5 ? a.name : b.name,
    hour,
  };
}

/** 4 个色标 → n 条横带（和网页 bands() 一样），用层叠 View 画，不需要渐变库。 */
export function bands(sky: RGB[], n = 14): string[] {
  return Array.from({ length: n }, (_, i) => {
    const k = (i / (n - 1)) * (sky.length - 1), a = sky[Math.floor(k)], b = sky[Math.min(sky.length - 1, Math.floor(k) + 1)], f = k % 1;
    return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * f)).join(",")})`;
  });
}

export function sunProgress(hour: number): number | null {
  return hour >= 5.5 && hour <= 19 ? (hour - 5.5) / 13.5 : null;
}

/** 天色底下文字要不要换浅色：最下面色标的亮度。 */
export function isDarkSky(s: Sky): boolean {
  const c = s.sky[2];
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] < 140;
}
export function isNight(hour: number): boolean {
  return hour >= 19.5 || hour < 5.5;
}
/** 兼容旧调用：单一底色取中间色标。 */
export function skyColor(hour: number): string {
  return `rgb(${skyAt(hour).sky[2].join(",")})`;
}

/** 每分钟、以及 App 回到前台时重新取一次时间；只在分钟变了才触发重渲染。 */
export function useSky(tz?: string): Sky & { color: string; night: boolean; dark: boolean; sunP: number | null } {
  const [hour, setHour] = useState(() => localHour(tz));
  useEffect(() => {
    const upd = () => setHour((h) => { const n = localHour(tz); return Math.abs(n - h) < 1 / 120 ? h : n; });
    upd();
    const id = setInterval(upd, 60_000);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") upd(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [tz]);
  return useMemo(() => {
  const s = skyAt(hour);
  const sunP = sunProgress(hour);
  return { ...s, color: `rgb(${s.sky[3].join(",")})`, night: isNight(hour), dark: isDarkSky(s), sunP: s.sun > 0.15 ? sunP : null };
  }, [hour]);
}
