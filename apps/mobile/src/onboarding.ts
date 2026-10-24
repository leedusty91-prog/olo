import { getItem, setItem } from "./storage";

const KEY = "olo.onboarded";

export async function loadOnboarded(): Promise<boolean> {
  try {
    return (await getItem(KEY)) === "1";
  } catch {
    return false;
  }
}

export async function saveOnboarded(): Promise<void> {
  try {
    await setItem(KEY, "1");
  } catch {
    // 存不了就下次再问一遍，不阻塞使用
  }
}

// 离线时先把相遇结果存在本机，连上后再补交（不阻塞进入 App）。
const PENDING = "olo.onboard.pending";

export async function savePendingOnboarding(body: object): Promise<void> {
  try {
    await setItem(PENDING, JSON.stringify(body));
  } catch {
    // ignore
  }
}

export async function takePendingOnboarding(): Promise<Record<string, unknown> | null> {
  try {
    const raw = await getItem(PENDING);
    if (!raw) return null;
    await setItem(PENDING, "");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
