import type { Sky } from "./daytime";
export function chatDarkness(sky: Sky): number;
export function chatInk(dark: boolean): number[];
export function contrast(a: number[], b: number[]): number;
export function landPalette(hour: number): Record<string, any>;
export function paintChatScene(sky: Sky, opts: { W: number; H: number; paintScene: (sky: Sky, o: { W: number; H: number; date?: Date; seed?: number }) => any; date?: Date; seed?: number; col?: [number, number] | null; scrim?: number }): {
  W: number; H: number; data: Uint8ClampedArray; dark: boolean; base: number[]; motes: { x: number; y: number; c: number[]; a: number }[];
};
