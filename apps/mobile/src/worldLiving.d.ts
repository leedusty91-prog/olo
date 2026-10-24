export const LANTERNS: Record<string, string[]>;
export const MOOD_LINE: Record<string, string>;
export const STALLS: string[];
export type Living = { lit: number; litRatio: number; tone: "bright" | "calm" | "soft" | "quiet"; lanterns: string[]; lanternGlow: number; stalls: number; stallNames: string[]; walkers: number; bunting: boolean; line: string };
export function livingScene(summary: Record<string, unknown> | null | undefined): Living;
export function windowLit(i: number, lit: number): boolean;
