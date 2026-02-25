// ──────────────────────────────────────────────────────────────
// Ummon Glyph UI — server-side PNG/JPEG renderer (Sharp)
// Renders a glyph data object into a PNG or JPEG buffer.
// Matches the web view: rounded cells, empty cell backgrounds,
// per-cell glow, global radial glow, and animation support.
// Supports configurable grid sizes via glyphData.gridSize.
// ──────────────────────────────────────────────────────────────

const sharp  = require('sharp');
const config = require('./config.js');

const BG_COLOR      = [10, 10, 18];       // #0a0a12
const CELL_BG_COLOR = [20, 20, 30];       // #14141e
const CORNER_RADIUS = 4;

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** RGB → HSL (h: 0-360, s: 0-1, l: 0-1) */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    h *= 360;
  }
  return { h, s, l };
}

/** HSL → [r, g, b] array */
function hslToRgbArr(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1, g1, b1;
  if      (h < 60)  { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else              { r1 = c; g1 = 0; b1 = x; }
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

/** Apply theme HSL transforms to an [r,g,b] array, returning a new [r,g,b] */
function applyThemeRgb(rgb, theme) {
  if (!theme) return rgb;
  const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  hsl.h = (hsl.h + theme.hueShift) % 360;
  hsl.s = Math.min(1, hsl.s * theme.saturationMul);
  hsl.l = Math.min(1, hsl.l * theme.brightnessMul);
  return hslToRgbArr(hsl.h, hsl.s, hsl.l);
}

/** Parse a hex colour string like "#0a1b2c" to [r,g,b] */
function hexStrToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Check if a pixel (px, py) relative to cell origin is inside a rounded rect. */
function insideRoundedRect(px, py, w, h, r) {
  if (px < 0 || py < 0 || px >= w || py >= h) return false;
  // Centre of the rect — no rounding needed for most of the area
  if (px >= r && px < w - r) return true;
  if (py >= r && py < h - r) return true;
  // Check corners with circle test
  let cx, cy;
  if (px < r && py < r) { cx = r; cy = r; }              // top-left
  else if (px >= w - r && py < r) { cx = w - r; cy = r; } // top-right
  else if (px < r && py >= h - r) { cx = r; cy = h - r; } // bottom-left
  else if (px >= w - r && py >= h - r) { cx = w - r; cy = h - r; } // bottom-right
  else return true; // not in any corner region
  const dx = px - cx;
  const dy = py - cy;
  return (dx * dx + dy * dy) <= (r * r);
}

/** Blend a colour into the buffer at index with given alpha (0-1). */
function blendPixel(buf, idx, r, g, b, a) {
  const inv = 1 - a;
  buf[idx]     = Math.min(255, Math.round(buf[idx]     * inv + r * a));
  buf[idx + 1] = Math.min(255, Math.round(buf[idx + 1] * inv + g * a));
  buf[idx + 2] = Math.min(255, Math.round(buf[idx + 2] * inv + b * a));
  buf[idx + 3] = 255;
}

/** Draw a filled rounded rectangle into the RGBA buffer. */
function drawRoundedRect(buf, imgSize, x, y, w, h, r, rgb, alpha) {
  const channels = 4;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (!insideRoundedRect(dx, dy, w, h, r)) continue;
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= imgSize || py >= imgSize) continue;
      const idx = (py * imgSize + px) * channels;
      if (alpha >= 1) {
        buf[idx]     = rgb[0];
        buf[idx + 1] = rgb[1];
        buf[idx + 2] = rgb[2];
        buf[idx + 3] = 255;
      } else {
        blendPixel(buf, idx, rgb[0], rgb[1], rgb[2], alpha);
      }
    }
  }
}

/**
 * Compute the animation alpha for a cell.
 * @param {string} animation - 'blink', 'pulse', 'wave', or 'none'
 * @param {number} animPhase - 0–1 phase of the animation cycle
 * @param {number} gx - grid x position (for wave)
 * @param {number} gy - grid y position (for wave)
 * @returns {number} alpha value 0–1
 */
function computeAnimAlpha(animation, animPhase, gx, gy) {
  if (!animation || animation === 'none' || animPhase == null) return 1;
  const phase = animPhase * Math.PI * 2;
  if (animation === 'blink') {
    return Math.sin(phase) > 0 ? 1 : 0.15;
  }
  if (animation === 'pulse') {
    return 0.55 + 0.45 * Math.sin(phase);
  }
  if (animation === 'breathe') {
    return 0.75 + 0.25 * Math.sin(phase);
  }
  if (animation === 'wave') {
    return 0.45 + 0.55 * ((Math.sin(phase - (gx + gy) * 0.5) + 1) / 2);
  }
  return 1;
}

/**
 * Core rendering function for both PNG and JPEG.
 * @param {object} glyphData - glyph data from engine
 * @param {number} size - output pixel size
 * @param {object} theme - style theme (or null)
 * @param {number|null} animPhase - animation phase 0–1 (null = static)
 * @returns {Buffer} raw RGBA pixel buffer
 */
function renderToBuffer(glyphData, size, theme, animPhase) {
  size = size || config.grid.pngSize;
  const gs   = (glyphData && glyphData.gridSize) || config.grid.size;
  const pad  = Math.round(size * 0.04);
  const inner = size - pad * 2;
  const cell = Math.floor(inner / gs);
  const baseGap = Math.max(2, Math.round(cell * 0.08));
  const gapPx = theme ? Math.max(1, Math.round(baseGap * theme.cellGapMul)) : baseGap;
  const fill = cell - gapPx * 2;
  const baseCr = Math.min(CORNER_RADIUS, Math.floor(fill / 4));
  const cr   = theme ? Math.max(0, Math.round(theme.cornerRadius * (fill / 28))) : baseCr;
  const glowMul = theme ? theme.glowIntensity : 1;

  // Resolve background colours
  const bgRgb     = theme && theme.bgTint     ? hexStrToRgb(theme.bgTint)     : BG_COLOR;
  const cellBgRgb = theme && theme.cellBgTint  ? hexStrToRgb(theme.cellBgTint) : CELL_BG_COLOR;

  const channels = 4;
  const buf = Buffer.alloc(size * size * channels);

  // Fill background
  for (let i = 0; i < size * size; i++) {
    buf[i * 4]     = bgRgb[0];
    buf[i * 4 + 1] = bgRgb[1];
    buf[i * 4 + 2] = bgRgb[2];
    buf[i * 4 + 3] = 255;
  }

  if (!glyphData || !glyphData.grid || !glyphData.color) {
    // Still draw empty cell backgrounds
    for (let gy = 0; gy < gs; gy++) {
      for (let gx = 0; gx < gs; gx++) {
        drawRoundedRect(buf, size, pad + gx * cell + gapPx, pad + gy * cell + gapPx, fill, fill, cr, cellBgRgb, 1);
      }
    }
    return { buf, size, channels };
  }

  const { grid, color, animation, blinkCells } = glyphData;

  const colorMap = {
    1: applyThemeRgb(hexToRgb(color.primary), theme),
    2: applyThemeRgb(hexToRgb(color.secondary), theme),
    3: applyThemeRgb(hexToRgb(color.accent), theme),
  };

  // Blink phase (used for per-cell and/or global blink)
  const blinkAlpha = (animation === 'blink' && animPhase != null)
    ? computeAnimAlpha('blink', animPhase, 0, 0)
    : 1;

  // Compute global animation alpha (pulse/breathe = global, blink without mask = global)
  const globalAnimAlpha = (animation === 'blink' && !blinkCells)
    ? blinkAlpha
    : (animation === 'pulse' || animation === 'breathe')
      ? computeAnimAlpha(animation, animPhase, 0, 0)
      : 1;

  // Global radial glow behind the glyph
  if (color.glow) {
    const glowRgb = colorMap[1]; // primary (already themed)
    const cx = size / 2;
    const cy = size / 2;
    const glowR = size * 0.45;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const dx = px - cx;
        const dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < glowR) {
          const a = 0.12 * glowMul * globalAnimAlpha * (1 - dist / glowR);
          if (a > 0.005) {
            const idx = (py * size + px) * channels;
            blendPixel(buf, idx, glowRgb[0], glowRgb[1], glowRgb[2], a);
          }
        }
      }
    }
  }

  // Draw cells
  for (let gy = 0; gy < gs; gy++) {
    for (let gx = 0; gx < gs; gx++) {
      const sx = pad + gx * cell + gapPx;
      const sy = pad + gy * cell + gapPx;
      const v  = grid[gy]?.[gx];

      // Always draw cell background (empty cell bg)
      drawRoundedRect(buf, size, sx, sy, fill, fill, cr, cellBgRgb, 1);

      if (!v) continue;
      const rgb = colorMap[v];
      if (!rgb) continue;

      // Compute per-cell alpha (wave uses position, blink with mask uses per-cell)
      let cellAlpha;
      if (animation === 'blink' && blinkCells) {
        cellAlpha = (blinkCells[gy] && blinkCells[gy][gx]) ? blinkAlpha : 1;
      } else if (animation === 'wave') {
        cellAlpha = computeAnimAlpha('wave', animPhase, gx, gy);
      } else {
        cellAlpha = globalAnimAlpha;
      }

      // Blend cell color with background based on animation alpha
      const blendedRgb = cellAlpha < 1
        ? [
            Math.round(cellBgRgb[0] * (1 - cellAlpha) + rgb[0] * cellAlpha),
            Math.round(cellBgRgb[1] * (1 - cellAlpha) + rgb[1] * cellAlpha),
            Math.round(cellBgRgb[2] * (1 - cellAlpha) + rgb[2] * cellAlpha),
          ]
        : rgb;

      // Per-cell glow
      const glowSize = Math.round(fill * 0.6);
      const gcx = sx + fill / 2;
      const gcy = sy + fill / 2;
      for (let py = Math.max(0, sy - glowSize); py < Math.min(size, sy + fill + glowSize); py++) {
        for (let px = Math.max(0, sx - glowSize); px < Math.min(size, sx + fill + glowSize); px++) {
          const dx = px - gcx;
          const dy = py - gcy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < glowSize) {
            const a = 0.25 * cellAlpha * (1 - dist / glowSize);
            if (a > 0.005) {
              const idx = (py * size + px) * channels;
              blendPixel(buf, idx, rgb[0], rgb[1], rgb[2], a);
            }
          }
        }
      }

      // The cell itself (rounded rect)
      drawRoundedRect(buf, size, sx, sy, fill, fill, cr, blendedRgb, 1);
    }
  }

  return { buf, size, channels };
}

/**
 * Render glyph as PNG buffer.
 * @param {object} glyphData
 * @param {number} [size]
 * @param {object} [theme]
 * @param {number} [animPhase] - animation phase 0–1 (omit for static)
 */
async function renderPng(glyphData, size, theme, animPhase) {
  const { buf, size: sz, channels } = renderToBuffer(glyphData, size, theme, animPhase);
  return sharp(buf, { raw: { width: sz, height: sz, channels } }).png().toBuffer();
}

/**
 * Render glyph as JPEG buffer.
 * @param {object} glyphData
 * @param {number} [size]
 * @param {object} [theme]
 * @param {number} [quality]
 * @param {number} [animPhase] - animation phase 0–1 (omit for static)
 */
async function renderJpeg(glyphData, size, theme, quality, animPhase) {
  quality = quality || 80;
  const { buf, size: sz, channels } = renderToBuffer(glyphData, size, theme, animPhase);
  return sharp(buf, { raw: { width: sz, height: sz, channels } }).jpeg({ quality }).toBuffer();
}

module.exports = { renderPng, renderJpeg };
