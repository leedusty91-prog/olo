import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/** 原生用 Keychain，Web 用 localStorage（Expo Web 不支持 SecureStore）。 */
export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // localStorage 不可用时忽略
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}
