/**
 * Generates the PWA icons as real PNG files, with no image library.
 *
 * Why not just ship an SVG: iOS ignores SVG for `apple-touch-icon`, and the
 * Android install prompt requires a 192px and a 512px PNG in the manifest.
 * Adding `sharp` or `canvas` to a project that otherwise has no native
 * dependencies is not worth it for four static images, so this writes the
 * PNG byte stream directly — zlib is already in Node.
 *
 * Run: npm run icons
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { Buffer } from 'node:buffer'

const OUT = new URL('../public/icons/', import.meta.url)

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n += 1) {
    c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** `pixel(x, y)` returns [r, g, b, a]; writes a truecolour+alpha PNG. */
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let p = 0
  for (let y = 0; y < size; y += 1) {
    raw[p] = 0 // filter type 0 (None) for this scanline
    p += 1
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y)
      raw[p] = r
      raw[p + 1] = g
      raw[p + 2] = b
      raw[p + 3] = a
      p += 4
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const TEAL = [45, 212, 191]
const TEAL_DEEP = [13, 148, 136]
const NAVY = [11, 17, 32]

/**
 * The mark: a circle cut by a diagonal into two halves in different shades —
 * one bill, two ways. The two tones matter: a single-colour circle with a
 * slash through it reads as a "no entry" sign instead of a split.
 *
 * Drawn analytically with a one-pixel soft edge, so it stays clean at 192px
 * without any anti-aliasing library.
 */
function draw(size, { maskable }) {
  // A maskable icon may be cropped to a circle by the launcher, so its art
  // must sit inside the inner 80% "safe zone".
  const scale = maskable ? 0.62 : 0.78
  const c = size / 2
  const r = (size * scale) / 2
  const gap = Math.max(size * 0.045, 2)

  return (x, y) => {
    const dx = x + 0.5 - c
    const dy = y + 0.5 - c
    const dist = Math.hypot(dx, dy)

    // Distance to the diagonal split line (y = x), used to cut the gap.
    const toLine = Math.abs(dx - dy) / Math.SQRT2

    // Soft coverage: 1 inside, 0 outside, blended over one pixel.
    const inCircle = clamp(r - dist + 0.5)
    const inGap = clamp(gap / 2 - toLine + 0.5)
    const coverage = inCircle * (1 - inGap)

    const [r0, g0, b0] = NAVY
    // Above the y = x diagonal gets the bright half, below gets the deep one.
    const [r1, g1, b1] = dx - dy > 0 ? TEAL : TEAL_DEEP
    return [
      Math.round(r0 + (r1 - r0) * coverage),
      Math.round(g0 + (g1 - g0) * coverage),
      Math.round(b0 + (b1 - b0) * coverage),
      255,
    ]
  }
}

function clamp(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

mkdirSync(OUT, { recursive: true })
const files = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: false }],
  ['favicon.png', 64, { maskable: false }],
]

for (const [name, size, opts] of files) {
  writeFileSync(new URL(name, OUT), png(size, draw(size, opts)))
  console.log(`wrote ${name} (${size}x${size})`)
}
