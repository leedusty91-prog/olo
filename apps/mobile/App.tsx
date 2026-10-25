import { Platform } from "react-native";

import NativeApp from "./src/NativeApp";
import { WebShell } from "./src/WebShell";

// 单一界面来源：手机端用全屏 WebView 打开服务器上的像素网页（/app），和网页端一模一样。
// 旧的原生界面保留：网页导出（/app-mobile）或设 EXPO_PUBLIC_OLO_NATIVE=1 时使用。
const USE_NATIVE = Platform.OS === "web" || process.env.EXPO_PUBLIC_OLO_NATIVE === "1";

export default function App() {
  return USE_NATIVE ? <NativeApp /> : <WebShell />;
}
