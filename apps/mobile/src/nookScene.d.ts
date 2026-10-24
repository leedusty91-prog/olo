import type { Sky } from "./daytime";
import type { paintScene } from "./skyScene";

export type Px = { W: number; H: number; data: Uint8ClampedArray };
type Rect = { x: number; y: number; w: number; h: number };
export type NookGeom = {
  W: number; H: number; BACK: number; L: number; R: number; F: number; sill: number;
  win: Rect; pot: Rect; item: Rect; shelf: Rect; book: Rect; bowl: Rect;
  door: { x0: number; x1: number; h: number; yb0: number; yb1: number; box: Rect };
  lamp: Rect & { cx: number; cy: number };
  rug: { x: number; y: number }; olo: { x: number; y: number }; ball: { x: number; y: number; r: number };
};
export type DailyItem = { id: string; name: string; line: string };
export const DAILY_ITEMS: DailyItem[];
export const PLANT_NAMES: string[];
export function dailyItem(dayIndex: number): DailyItem;
export function weatherFor(dayIndex: number): "rain" | "cloudy" | "clear";
export function nookGeometry(W: number, H: number, dock?: number): NookGeom;
export function paintNook(
  sky: Sky,
  opts: { W: number; H: number; dock?: number; date?: Date; plant?: number; item?: string; weather?: string; away?: boolean; lamp?: boolean; seed?: number; lit?: number; lanterns?: string[] },
  paint: typeof paintScene,
): { room: Px; glow: Px; geom: NookGeom; night: number };
export function paintBall(night?: number): Px;
export function paintPostcard(sky: Sky, place: string, paint: typeof paintScene, seed?: number): Px;
