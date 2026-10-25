#!/usr/bin/env node
/* The alternate home-screen icons (Settings → Look & Home → App icon), drawn from
 * src/lib/app-icon-variants.js and the dumbbell in resources/icon.svg.
 *
 * The glyph is five rectangles, so this draws them itself (4x4 to 8x8 samples per pixel for the
 * edges) and writes the PNGs with node:zlib: no sharp or resvg to install, and the same bytes on
 * every machine, which the test checks. Written per variant:
 *   resources/icons/<id>.svg                                  the source, one per icon
 *   public/app-icons/<id>.png                                 112 px preview for the settings row
 *   ios/App/App/Assets.xcassets/AppIcon-<Name>.appiconset/    1024 px, opaque (Apple refuses alpha)
 *   android/app/src/main/res/mipmap-<dpi>/ic_launcher_<id>{,_round,_foreground}.png
 *   android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_<id>{,_round}.xml
 *   android/app/src/main/res/values/app_icons.xml             the adaptive icons' background colours
 * The default icon keeps the files @capacitor/assets made for it (docs/MOBILE.md); only its
 * preview comes from here.
 *
 * Usage: node scripts/app-icons.mjs            write everything
 *        node scripts/app-icons.mjs --check    exit 1 when a committed file differs from a fresh draw */
import { deflateSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_ICON_VARIANTS } from '../src/lib/app-icon-variants.js'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RES = 'android/app/src/main/res'

// Launcher icon in px per density (48 dp), and the adaptive layer (108 dp) beside it.
export const DENSITIES = { ldpi: 0.75, mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
export const PREVIEW = 112
export const IOS_SIZE = 1024

/** The glyph's rectangles, in the 512 grid of resources/icon.svg: one source for every icon. */
export function glyph(svg = readFileSync(join(ROOT, 'resources/icon.svg'), 'utf8')) {
  const g = svg.match(/<g[^>]*>([\s\S]*?)<\/g>/)?.[1] || ''
  return [...g.matchAll(/<rect\s+x="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="(\d+)"/g)]
    .map(m => m.slice(1, 5).map(Number))
}

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))

/** One icon `size` px square: the background, the glyph on it, optionally cut to a circle. */
export function draw(v, size, { round = false, rects = glyph() } = {}) {
  const k = size <= 256 ? 8 : 4
  const bg = rgb(v.bg), fg = rgb(v.fg)
  const ch = round ? 4 : 3
  const out = Buffer.alloc(size * size * ch)
  const scale = 512 / size
  // Per sample row, the glyph's spans across it: the inner loop then only compares numbers.
  const spans = []
  for (let s = 0; s < size * k; s++) {
    const gy = (s + 0.5) / k * scale
    spans.push(rects.filter(([, ry, , rh]) => gy >= ry && gy < ry + rh).map(([rx, , rw]) => [rx, rx + rw]))
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let inside = 0, on = 0
    for (let sy = 0; sy < k; sy++) {
      const py = y + (sy + 0.5) / k
      const row = spans[y * k + sy]
      for (let sx = 0; sx < k; sx++) {
        const px = x + (sx + 0.5) / k
        if (round) {
          const dx = px - size / 2, dy = py - size / 2
          if (dx * dx + dy * dy > (size / 2) * (size / 2)) continue
        }
        inside++
        const gx = px * scale
        for (const [a, b] of row) if (gx >= a && gx < b) { on++; break }
      }
    }
    const o = (y * size + x) * ch
    const a = inside ? on / inside : 0
    for (let c = 0; c < 3; c++) out[o + c] = Math.round(bg[c] + (fg[c] - bg[c]) * a)
    if (round) out[o + 3] = Math.round(255 * inside / (k * k))
  }
  return png(size, size, out, ch)
}

// --- PNG, the bare minimum: IHDR, one IDAT, IEND; filter 0 on every row ---
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(w, h, pixels, ch) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2   // 8 bit, RGBA or RGB
  const raw = Buffer.alloc(h * (w * ch + 1))
  for (let y = 0; y < h; y++) pixels.copy(raw, y * (w * ch + 1) + 1, y * w * ch, (y + 1) * w * ch)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** Width, height and whether the PNG has an alpha channel, read from its header. */
export function pngInfo(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha: buf[25] === 6 || buf[25] === 4 }
}

const svgOf = (v, rects) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512">
  <!-- openGym app icon "${v.id}", written by scripts/app-icons.mjs (the glyph of resources/icon.svg). -->
  <rect width="512" height="512" fill="${v.bg}"/>
  <g fill="${v.fg}">
${rects.map(([x, y, w, h]) => `    <rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('\n')}
  </g>
</svg>
`

// The same layers as the default icon's (mipmap-anydpi-v26/ic_launcher.xml): the whole square icon
// as the foreground, inset to the 72 dp the launcher's mask shows, so every variant sits exactly
// where the original does. The colour behind it only shows where a launcher moves the layers.
const adaptive = id => `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by scripts/app-icons.mjs. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_${id}_background" />
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_${id}_foreground" android:inset="16.7%" />
    </foreground>
</adaptive-icon>
`

const iosContents = `{
  "images" : [
    {
      "filename" : "icon-1024.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
`

/** Every file this script owns, as [path relative to frontend/, contents]. */
export function files(rects = glyph()) {
  const out = []
  const colors = []
  for (const v of APP_ICON_VARIANTS) {
    out.push([`public/app-icons/${v.id}.png`, draw(v, PREVIEW, { rects })])
    if (v.id === 'default') continue
    out.push([`resources/icons/${v.id}.svg`, svgOf(v, rects)])
    const set = `ios/App/App/Assets.xcassets/${v.ios}.appiconset`
    out.push([`${set}/Contents.json`, iosContents])
    out.push([`${set}/icon-1024.png`, draw(v, IOS_SIZE, { rects })])
    for (const [dpi, f] of Object.entries(DENSITIES)) {
      out.push([`${RES}/mipmap-${dpi}/ic_launcher_${v.id}.png`, draw(v, Math.round(48 * f), { rects })])
      out.push([`${RES}/mipmap-${dpi}/ic_launcher_${v.id}_round.png`, draw(v, Math.round(48 * f), { rects, round: true })])
      out.push([`${RES}/mipmap-${dpi}/ic_launcher_${v.id}_foreground.png`, draw(v, Math.round(108 * f), { rects })])
    }
    out.push([`${RES}/mipmap-anydpi-v26/ic_launcher_${v.id}.xml`, adaptive(v.id)])
    out.push([`${RES}/mipmap-anydpi-v26/ic_launcher_${v.id}_round.xml`, adaptive(v.id)])
    colors.push(`    <color name="ic_launcher_${v.id}_background">${v.bg}</color>`)
  }
  out.push([`${RES}/values/app_icons.xml`, `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by scripts/app-icons.mjs: behind each alternate launcher icon. -->
<resources>
${colors.join('\n')}
</resources>
`])
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check')
  const bad = []
  for (const [rel, body] of files()) {
    const p = join(ROOT, rel)
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
    if (check) {
      if (!existsSync(p) || !readFileSync(p).equals(buf)) bad.push(rel)
      continue
    }
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, buf)
  }
  if (bad.length) { console.error('app icons out of date (run node scripts/app-icons.mjs):\n  ' + bad.join('\n  ')); process.exit(1) }
  console.log(check ? 'app icons up to date' : 'app icons written')
}
