import { registerRootComponent } from "expo";
import App from "./App";

// 网页版宽屏时，public/index.html 会把页面换成一个手机大小的 iframe，外层就不再启动 App。
const framing = typeof window !== "undefined" && (window as unknown as { __OLO_FRAME__?: boolean }).__OLO_FRAME__;
if (!framing) registerRootComponent(App);
