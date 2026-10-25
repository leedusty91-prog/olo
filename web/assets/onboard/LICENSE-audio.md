# 开场音视频素材来源与授权

- `music.m4a`、intro/outro 中的配乐：由 `scripts/gen_music.py` 纯代码合成（numpy，无采样），作者自制，以 **CC0 1.0** 发布。
- 环境声（雨、风铃、pad）：ffmpeg lavfi 合成（pink noise / sine），自制，CC0 1.0。
- 旁白（`vo_*.m4a` 及 intro/outro 内）：本地离线 TTS **Kokoro-82M v1.0**（hexgrad/Kokoro-82M，权重 **Apache-2.0**，可商用；模型卡说明训练数据只用公有领域 / 宽松授权 / 闭源大厂合成音频，并列出 CC BY 数据集 Koniwa、SIWIS 的署名），ONNX 版来自 thewh1teagle/kokoro-onnx（MIT），中文 G2P 用 misaki[zh]（Apache-2.0）。声音：旁白 `zf_xiaoxiao`、渡灯翁 `zm_yunjian`（降调 5%）、olo `zf_xiaoyi`。生成脚本：`scripts/tts_kokoro.py`。无真人声音克隆。
  - 署名（Apache-2.0 NOTICE 要求随附）：Kokoro-82M © hexgrad, Apache License 2.0 — https://huggingface.co/hexgrad/Kokoro-82M
  - 已弃用：Piper `zh_CN-huayan-medium`（数据集授权 Unknown），2026-10-25 起不再使用。
- `intro-vo.m4a`：原开场片的音轨（上面的配乐 + 旁白），原样抽出，授权同上。
- 画面：像素开场动画由 `web/onboard-film.js` 实时绘制（纯代码，项目原创），不含真人、无第三方版权素材；不再使用视频。
