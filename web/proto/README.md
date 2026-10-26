# olo 视觉原型（倒影国 v3 重做候选）

独立静态页面，不接后端、不改现有 `web/`。本地预览：`cd web/proto && python3 -m http.server 8765`，打开 `http://127.0.0.1:8765/`。
每个方向三页：`*-home.html`（`?demo=1` 自动打字演示、`?form=peach` 选颜色）、`*-character.html`（十种颜色）、`*-intro.html`（30 秒开场，点一下快进 6 秒，`?t=17` 直接跳到某秒）。

| 方向 | 一句话 | 依赖 | 无头 Chromium (SwiftShader 纯 CPU, 390×844) |
| --- | --- | --- | --- |
| A 真 3D 镜池 | Three.js 透射材质水滴 + 实时镜面水，olo 只活在倒影层，镜头翻滚后进入倒影国 | three r170 (MIT, 已放 `vendor/`) | 首页 5 fps / 形态 4 fps / 开场 7–15 fps |
| B 液光镜面 | 一个全屏 WebGL2 着色器画出天空、倒影小镇、涟漪水面和 2.5D 折射水滴，整屏 180° 翻滚揭示 olo | 零依赖，~10 KB | 首页 33 fps / 形态 30 fps / 开场 27–37 fps |
| C 像素 × 着色器 | B 的同一套着色器，以 1/3 分辨率渲染 + Bayer 抖动 + 调色板量化，延续原像素风 | 零依赖 | 60 fps 封顶 |

SwiftShader 是纯 CPU 软件渲染，数字只用于相对比较，不代表手机 GPU。

## 移动端 / WebView
- 全部走 **WebGL2**（iOS 15+ WKWebView、Android WebView 都支持）。未使用 WebGPU：iOS 26 Safari 已有 WebGPU，但 WKWebView 中的可用性和稳定性不保证；RedGPU 只支持 WebGPU，因此只作为参考，不引入。
- B/C 每帧只有一次全屏绘制，`dprCap` 默认 2（C 实际分辨率是屏幕的 1/3）；A 的透射 (transmission) 每帧多一次场景渲染 + Reflector 再一次，最重。
- 待做：真机 iPhone Safari / WKWebView 帧率（box 上没有真 GPU）。

## 参考与许可
- 庄周梦蝶池塘 <https://zhuangzi-dream.vercel.app/>（@justkarangupta）：未找到公开仓库和许可证，**只借鉴“倒影里角色互换”的叙事点子，没有复制任何代码或素材**。
- Abstract Chrome Liquid（@sabosugi, CodePen）：CodePen 公开 pen 默认 MIT；本原型的液体着色器是自写的，未复制。
- RedGPU（MIT, WebGPU only）、倒开 F1（Three.js, 仅视频/demo）：只借鉴“整个世界翻转”的镜头。
- 代码动效工作室 20 个仓库：Remotion 用于商用需付费许可（公司规模 >3 人），不引入；如需离线出片，用本目录 `shots/cap.py`（Playwright 录屏 + ffmpeg）即可。

## 约束检查
olo 无手脚、无蝴蝶结；世界里无人（只有方块剪影小镇、双月、倒雨）；无外部模型/音频文件；无付费依赖。
