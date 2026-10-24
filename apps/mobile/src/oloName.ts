// 用户给灯籽起的名字：HomeScreen / ProfileScreen 读到 persona 后写进来，其它界面用 useOloName() 读。
import { useEffect, useState } from "react";

let current = "olo";
const subs = new Set<(n: string) => void>();

export function setOloName(name: string | null | undefined): void {
  const n = (name ?? "").trim() || "olo";
  if (n === current) return;
  current = n;
  subs.forEach((f) => f(n));
}

export function getOloName(): string {
  return current;
}

export function useOloName(): string {
  const [n, setN] = useState(current);
  useEffect(() => {
    subs.add(setN);
    setN(current);
    return () => { subs.delete(setN); };
  }, []);
  return n;
}
