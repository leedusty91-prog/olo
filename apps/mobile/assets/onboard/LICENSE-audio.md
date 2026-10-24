# 开场音视频素材来源与授权

- `music.m4a`、intro/outro 中的配乐：由 `scripts/gen_music.py` 纯代码合成（numpy，无采样），作者自制，以 **CC0 1.0** 发布。
- 环境声（雨、风铃、pad）：ffmpeg lavfi 合成（pink noise / sine），自制，CC0 1.0。
- 旁白（`vo_*.m4a` 及 intro/outro 内）：本地离线 TTS **Piper**（MIT）+ 声音模型 `zh_CN-huayan-medium`（rhasspy/piper-voices；模型卡写明训练数据集 HuaYan_TTS 的授权为 “Unknown”——**上架商用前需确认或换成授权明确的声音**；无真人声音克隆）。
- 画面：项目自生成插画/视频片段，不含真人、无第三方版权素材。
