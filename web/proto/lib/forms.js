// olo 的十种颜色（id 与 server/olo/forms.py 一致）。[亮色, 暗色]
export const FORMS = [
  { id: 'buddy', name: '月光薄荷', a: '#a9d8ff', b: '#9ff0cf' },
  { id: 'cloud', name: '雾蓝', a: '#c7d6ee', b: '#8fa7cf' },
  { id: 'glow',  name: '薰衣草', a: '#e2d2ff', b: '#a98ee6' },
  { id: 'bud',   name: '薄荷', a: '#c9f7df', b: '#6fd6a6' },
  { id: 'dew',   name: '浅水蓝', a: '#d2f3ff', b: '#7cc8ef' },
  { id: 'star',  name: '晨光', a: '#fff1c9', b: '#ffbf8a' },
  { id: 'peach', name: '桃粉', a: '#ffdbe4', b: '#f59ab4' },
  { id: 'acorn', name: '青柠', a: '#effbb8', b: '#b5dc5a' },
  { id: 'moon',  name: '银月', a: '#f2f4fb', b: '#aab2c8' },
  { id: 'amber', name: '蜜金', a: '#ffe6a8', b: '#e6a845' },
];
export const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
