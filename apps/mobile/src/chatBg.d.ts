export type ChatBgKey = "dawn" | "day" | "dusk" | "night";
export const CHAT_BG_KEYS: ChatBgKey[];
export function bgFor(hour: number): ChatBgKey;
export const CHAT_BG: Record<ChatBgKey, { base: number[]; scrim: number[]; dark: boolean }>;
export function chatDark(key: ChatBgKey): boolean;
export function chatInk(dark: boolean): number[];
export function scrimCss(key: ChatBgKey): string;
export function chatSurface(key: ChatBgKey): number[];
export function contrast(a: number[], b: number[]): number;
