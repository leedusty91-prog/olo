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
