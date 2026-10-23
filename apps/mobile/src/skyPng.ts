// 把像素层编码成 PNG data URI：先按整数倍最近邻放大（原生 Image 缩放会糊），再用 Up 滤波 + fflate 压缩。
import { zlibSync } from "fflate";

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc(b: Uint8Array, s = 0, e = b.length) { let c = ~0; for (let i = s; i < e; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; }
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64(u: Uint8Array) {
  let o = ""; let i = 0;
  for (; i + 2 < u.length; i += 3) { const n = (u[i] << 16) | (u[i + 1] << 8) | u[i + 2]; o += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]; }
  if (i < u.length) { const n = (u[i] << 16) | ((u[i + 1] ?? 0) << 8); o += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < u.length ? B64[(n >> 6) & 63] : "=") + "="; }
  return o;
}

export function layerPng(L: { W: number; H: number; data: Uint8ClampedArray }, k = 3, repeatX = 1): string {
  const W = L.W * k * repeatX, H = L.H * k, stride = W * 4 + 1, raw = new Uint8Array(stride * H), row = new Uint8Array(W * 4);
  for (let y = 0; y < L.H; y++) {
    for (let x = 0; x < L.W * repeatX; x++) { const s = (y * L.W + (x % L.W)) * 4; for (let j = 0; j < k; j++) row.set(L.data.subarray(s, s + 4), (x * k + j) * 4); }
    for (let j = 0; j < k; j++) { const o = (y * k + j) * stride; raw[o] = j === 0 ? 0 : 2; if (j === 0) raw.set(row, o + 1); }
  }
  const idat = zlibSync(raw, { level: 6 });
  const chunks: [string, Uint8Array][] = [["IHDR", new Uint8Array([W >>> 24, (W >>> 16) & 255, (W >>> 8) & 255, W & 255, H >>> 24, (H >>> 16) & 255, (H >>> 8) & 255, H & 255, 8, 6, 0, 0, 0])], ["IDAT", idat], ["IEND", new Uint8Array(0)]];
  const size = 8 + chunks.reduce((n, [, d]) => n + 12 + d.length, 0), out = new Uint8Array(size);
  out.set([137, 80, 78, 71, 13, 10, 26, 10]); let p = 8;
  for (const [t, d] of chunks) {
    out[p] = d.length >>> 24; out[p + 1] = (d.length >>> 16) & 255; out[p + 2] = (d.length >>> 8) & 255; out[p + 3] = d.length & 255;
    for (let i = 0; i < 4; i++) out[p + 4 + i] = t.charCodeAt(i);
    out.set(d, p + 8); const c = crc(out, p + 4, p + 8 + d.length);
    out[p + 8 + d.length] = c >>> 24; out[p + 9 + d.length] = (c >>> 16) & 255; out[p + 10 + d.length] = (c >>> 8) & 255; out[p + 11 + d.length] = c & 255;
    p += 12 + d.length;
  }
  return "data:image/png;base64," + b64(out);
}
