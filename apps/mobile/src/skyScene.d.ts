// 类型声明：skyScene.js 是 web/sky-scene.js 的原样拷贝（Metro 不读项目外的文件）。
export type RGB = number[];
export type Layer = { W: number; H: number; data: Uint8ClampedArray };
export type Scene = {
  W: number; H: number; back: Layer; front: Layer; lights: Layer; cloudsFar: Layer; cloudsNear: Layer;
  twinkles: { x: number; y: number; c: RGB; a: number }[]; phase: number; hasLights: boolean;
  geometry: { horizon: number; sun: { x: number; y: number; r: number; low: boolean } | null; moon: { x: number; y: number; r: number } };
};
export function paintScene(sky: { sky: RGB[]; star: number; lamp: number; sun: number; hour: number }, opts: { W: number; H: number; date?: Date; seed?: number }): Scene;
export function moonPhase(date?: Date): number;
