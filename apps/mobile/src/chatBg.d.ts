import type { Sky } from "./daytime";
export const PAPER: number[];
export const DUSK_PAPER: number[];
export function chatDarkness(sky: Sky): number;
export function chatInk(dark: boolean): number[];
export function contrast(a: number[], b: number[]): number;
export function paintChatBg(sky: Sky, opts: { W: number; H: number; seed?: number; alpha?: number; fade?: number }): {
  W: number; H: number; data: Uint8ClampedArray; dark: boolean; base: number[]; motes: { x: number; y: number; c: number[]; a: number }[];
};
