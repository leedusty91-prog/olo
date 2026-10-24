export const OB_SIZES: { titleScale: number; hatchScale: number; formScale: number; panelMax: number };
export const OB_BEATS: { who: string; text: string; hour: number; amb: string }[];
export const OB_WORDS: string[];
export const OB_FORMS: [string, string, string, string][];
export const OB_GENDERS: [string, string, string][];
export type Mote = { x: number; y: number; vx: number; vy: number; r: number; ph: number; warm: boolean };
export function seedMotes(n: number, W: number, H: number, night?: boolean): Mote[];
export function stepMotes(motes: Mote[], W: number, H: number, dt?: number, reduced?: boolean): Mote[];
export function hatchScale(t: number): number;
