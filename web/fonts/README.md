# 字体

`fusion-pixel-12px-zh_hans.woff2` 来自 [Fusion Pixel Font（缝合像素字体）](https://github.com/TakWolf/fusion-pixel-font) v2026.10.16，
以 SIL Open Font License 1.1 授权，见 `OFL.txt` 与 `LICENSES/`。未做任何修改。

`LXGWWenKaiLite-Regular.subset.woff2` 来自 [霞鹜文楷 Lite（LXGW WenKai Lite）](https://github.com/lxgw/LxgwWenKai-Lite) v1.530，
以 SIL Open Font License 1.1 授权，见 `OFL-LXGWWenKai.txt`。它是 `apps/mobile/assets/fonts/LXGWWenKai.ttf`（官方原版，未修改）
用 fonttools `pyftsubset` 生成的 WOFF2 子集（GB2312 全部字符 + 网页/服务端出现过的字），
**仅用于网页字体投放**——OFL 1.1 第 3 条附加许可允许这种情形保留保留字体名。
应用内（手机 App）使用的是未经子集化的原版 TTF。重新生成：

    pyftsubset apps/mobile/assets/fonts/LXGWWenKai.ttf --text-file=chars.txt --flavor=woff2 --layout-features='*' \
      --output-file=web/fonts/LXGWWenKaiLite-Regular.subset.woff2
