// 天色关键帧（唯一来源在 web/sky-keys.js）：网页 skytime.js 和手机端 apps/mobile/src/skyKeys.ts 共用这张表。
// 每行 [小时, { sky: 上→下 4 个色标 RGB, star/lamp/sun 强度 0..1, name 时段 }]。
// 手机端的 skyKeys.ts 是这一段 JSON 的原样拷贝（Metro 不读项目外的文件），server 测试会核对两边一致。
export type SkyKey = [number, { sky: [number, number, number][]; star: number; lamp: number; sun: number; name: string }];
export const SKY_KEYS: SkyKey[] = /*json*/[
  [0, {"sky": [[22, 14, 38], [34, 20, 50], [56, 30, 60], [78, 40, 64]], "star": 1, "lamp": 1, "sun": 0, "name": "night"}],
  [4.5, {"sky": [[24, 16, 42], [38, 24, 56], [62, 34, 66], [86, 46, 70]], "star": 1, "lamp": 1, "sun": 0, "name": "night"}],
  [6, {"sky": [[74, 52, 96], [150, 88, 112], [226, 136, 118], [255, 196, 140]], "star": 0.25, "lamp": 0.4, "sun": 0.6, "name": "dawn"}],
  [8, {"sky": [[120, 168, 196], [168, 196, 204], [236, 214, 178], [252, 226, 176]], "star": 0, "lamp": 0, "sun": 1, "name": "day"}],
  [16, {"sky": [[112, 160, 194], [170, 192, 198], [238, 208, 168], [250, 214, 158]], "star": 0, "lamp": 0, "sun": 1, "name": "day"}],
  [18.5, {"sky": [[64, 32, 62], [130, 58, 78], [214, 104, 82], [250, 168, 98]], "star": 0.3, "lamp": 0.6, "sun": 0.5, "name": "dusk"}],
  [20, {"sky": [[30, 18, 44], [48, 26, 58], [80, 40, 66], [108, 54, 66]], "star": 0.9, "lamp": 1, "sun": 0, "name": "night"}],
  [24, {"sky": [[22, 14, 38], [34, 20, 50], [56, 30, 60], [78, 40, 64]], "star": 1, "lamp": 1, "sun": 0, "name": "night"}]
]/*end*/;
