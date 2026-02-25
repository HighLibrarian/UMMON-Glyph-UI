// ──────────────────────────────────────────────────────────────
// Ummon Glyph UI — client-side canvas renderer
// Renders a glyph data object onto an HTML5 Canvas with
// rounded cells, glow effects, and animations.
// ──────────────────────────────────────────────────────────────

const GlyphRenderer = (() => {
  const BG_COLOR       = '#0a0a12';
  const CELL_BG_COLOR  = '#14141e';
  const CORNER_RADIUS  = 4;

  function hexToRgba(hex, alpha = 1) {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  /** Parse hex to {r,g,b} */
  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  /** Convert RGB to HSL (h:0-360, s:0-1, l:0-1) */
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

  /** Convert HSL to hex */
  function hslToHex(h, s, l) {
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
    const r = Math.round((r1 + m) * 255);
    const g = Math.round((g1 + m) * 255);
    const b = Math.round((b1 + m) * 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /** Apply theme transforms (hue shift, sat, brightness) to a hex colour */
  function applyThemeColor(hex, theme) {
    if (!theme) return hex;
    const rgb = hexToRgb(hex);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    hsl.h = (hsl.h + theme.hueShift) % 360;
    hsl.s = Math.min(1, hsl.s * theme.saturationMul);
    hsl.l = Math.min(1, hsl.l * theme.brightnessMul);
    return hslToHex(hsl.h, hsl.s, hsl.l);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /**
   * Render a glyph onto a canvas.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} glyphData — output of GlyphEngine.generateGlyph()
   * @param {number} canvasSize — pixel width/height of the canvas
   * @param {object} [opts] — { animPhase: 0-1, showGlow: true, theme: null }
   */
  function render(ctx, glyphData, canvasSize, opts = {}) {
    const { animPhase = 0, showGlow = true, theme = null } = opts;
    const gs   = (glyphData && glyphData.gridSize) || GlyphEngine.getGridSize();
    const pad  = Math.round(canvasSize * 0.04);
    const inner = canvasSize - pad * 2;
    const cell = Math.floor(inner / gs);
    const baseGap = Math.max(2, Math.round(cell * 0.08));
    const gap  = theme ? Math.max(1, Math.round(baseGap * theme.cellGapMul)) : baseGap;
    const fill = cell - gap * 2;
    const cr   = theme ? Math.max(0, Math.round(theme.cornerRadius)) : CORNER_RADIUS;

    // Background
    const bgColor = theme ? theme.bgTint : BG_COLOR;
    const cellBg  = theme ? theme.cellBgTint : CELL_BG_COLOR;
    const glowMul = theme ? theme.glowIntensity : 1;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    if (!glyphData || !glyphData.grid || !glyphData.color) return;

    const { grid, color, animation, blinkCells } = glyphData;

    // Resolve themed colours
    const primary   = theme ? applyThemeColor(color.primary, theme)   : color.primary;
    const secondary = theme ? applyThemeColor(color.secondary, theme) : color.secondary;
    const accent    = theme ? applyThemeColor(color.accent, theme)    : color.accent;

    // Animation modifiers
    let globalAlpha = 1;
    if (animation === 'blink' && !blinkCells) {
      // Legacy fallback: blink all cells
      globalAlpha = Math.sin(animPhase * Math.PI * 2) > 0 ? 1 : 0.15;
    } else if (animation === 'pulse') {
      globalAlpha = 0.55 + 0.45 * Math.sin(animPhase * Math.PI * 2);
    } else if (animation === 'breathe') {
      // Very gentle slow pulse — gives a subtle "alive" feel
      globalAlpha = 0.75 + 0.25 * Math.sin(animPhase * Math.PI * 2);
    }

    // Outer glow
    if (showGlow && color.glow) {
      const cx = canvasSize / 2;
      const cy = canvasSize / 2;
      const glowR = canvasSize * 0.45;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      grad.addColorStop(0, hexToRgba(primary, 0.12 * globalAlpha * glowMul));
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvasSize, canvasSize);
    }

    // Blink phase for per-cell blinking
    const blinkOn = (animation === 'blink')
      ? Math.sin(animPhase * Math.PI * 2) > 0 ? 1 : 0.15
      : 1;

    // Draw cells
    for (let gy = 0; gy < gs; gy++) {
      for (let gx = 0; gx < gs; gx++) {
        const v = grid[gy][gx];
        const sx = pad + gx * cell + gap;
        const sy = pad + gy * cell + gap;

        // Empty cell background
        ctx.fillStyle = cellBg;
        roundRect(ctx, sx, sy, fill, fill, cr);
        ctx.fill();

        if (!v) continue;

        const cellColor = v === 1 ? primary
                        : v === 2 ? secondary
                        :           accent;

        // Per-cell animation offset for wave, or per-cell blink
        let cellAlpha = globalAlpha;
        if (animation === 'blink' && blinkCells) {
          cellAlpha = (blinkCells[gy] && blinkCells[gy][gx]) ? blinkOn : 1;
        } else if (animation === 'wave') {
          const wave = Math.sin(animPhase * Math.PI * 2 - (gx + gy) * 0.5);
          cellAlpha = 0.45 + 0.55 * ((wave + 1) / 2);
        }

        ctx.globalAlpha = cellAlpha;

        // Glow per cell
        if (showGlow && v >= 1) {
          const glowSize = fill * 0.6;
          const grad = ctx.createRadialGradient(
            sx + fill / 2, sy + fill / 2, 0,
            sx + fill / 2, sy + fill / 2, glowSize
          );
          grad.addColorStop(0, hexToRgba(cellColor, 0.25 * glowMul));
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.fillRect(sx - glowSize / 2, sy - glowSize / 2, fill + glowSize, fill + glowSize);
        }

        // The cell itself
        ctx.fillStyle = cellColor;
        roundRect(ctx, sx, sy, fill, fill, cr);
        ctx.fill();

        ctx.globalAlpha = 1;
      }
    }
  }

  return { render };
})();
