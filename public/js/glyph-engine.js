// ──────────────────────────────────────────────────────────────
// Ummon Glyph Engine — deterministic glyph generation
// Shared between Node.js server and browser client (UMD).
// Supports configurable grid sizes: 8, 16.
// ──────────────────────────────────────────────────────────────

const GlyphEngine = (() => {
  const DEFAULT_GRID_SIZE = 8;
  const VALID_GRID_SIZES = [8, 16];

  // Configurable grid size — can be changed at runtime
  var _gridSize = DEFAULT_GRID_SIZE;

  function setGridSize(gs) {
    if (VALID_GRID_SIZES.includes(gs)) _gridSize = gs;
  }
  function getGridSize() { return _gridSize; }

  // ── Seeded PRNG (LCG) ──────────────────────────────────────
  class SeededRandom {
    constructor(seed) {
      this.state = seed & 0xffffffff;
      for (let i = 0; i < 10; i++) this.next(); // warm-up
    }
    next() {
      this.state = (this.state * 1664525 + 1013904223) & 0xffffffff;
      return (this.state >>> 0) / 0xffffffff;
    }
    nextInt(min, max) {
      return min + Math.floor(this.next() * (max - min + 1));
    }
    nextBool(p = 0.5) {
      return this.next() < p;
    }
    pick(arr) {
      return arr[this.nextInt(0, arr.length - 1)];
    }
  }

  // ── Hash ────────────────────────────────────────────────────
  function hashCode(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) & 0xffffffff;
    }
    return h >>> 0;
  }

  // ── Status → colour mapping ────────────────────────────────
  const STATUS_COLORS = {
    // green — success/done/completed
    done:       { primary: '#22c55e', secondary: '#166534', accent: '#4ade80', glow: 'rgba(34,197,94,0.35)', name: 'green' },
    success:    { primary: '#22c55e', secondary: '#166534', accent: '#4ade80', glow: 'rgba(34,197,94,0.35)', name: 'green' },
    completed:  { primary: '#22c55e', secondary: '#166534', accent: '#4ade80', glow: 'rgba(34,197,94,0.35)', name: 'green' },
    on:         { primary: '#22c55e', secondary: '#166534', accent: '#4ade80', glow: 'rgba(34,197,94,0.35)', name: 'green' },

    // blue — informational/neutral
    idle:       { primary: '#3b82f6', secondary: '#1e3a5f', accent: '#60a5fa', glow: 'rgba(59,130,246,0.30)', name: 'blue' },
    info:       { primary: '#3b82f6', secondary: '#1e3a5f', accent: '#60a5fa', glow: 'rgba(59,130,246,0.30)', name: 'blue' },
    neutral:    { primary: '#3b82f6', secondary: '#1e3a5f', accent: '#60a5fa', glow: 'rgba(59,130,246,0.30)', name: 'blue' },
    off:        { primary: '#3b82f6', secondary: '#1e3a5f', accent: '#60a5fa', glow: 'rgba(59,130,246,0.30)', name: 'blue' },

    // yellow — warning
    warning:    { primary: '#eab308', secondary: '#854d0e', accent: '#facc15', glow: 'rgba(234,179,8,0.35)', name: 'yellow' },
    attention:  { primary: '#eab308', secondary: '#854d0e', accent: '#facc15', glow: 'rgba(234,179,8,0.35)', name: 'yellow' },
    low:        { primary: '#eab308', secondary: '#854d0e', accent: '#facc15', glow: 'rgba(234,179,8,0.35)', name: 'yellow' },

    // red — error/failure
    error:      { primary: '#ef4444', secondary: '#991b1b', accent: '#f87171', glow: 'rgba(239,68,68,0.40)', name: 'red' },
    failure:    { primary: '#ef4444', secondary: '#991b1b', accent: '#f87171', glow: 'rgba(239,68,68,0.40)', name: 'red' },
    critical:   { primary: '#ef4444', secondary: '#991b1b', accent: '#f87171', glow: 'rgba(239,68,68,0.40)', name: 'red' },

    // purple — automation/background
    running:    { primary: '#a855f7', secondary: '#581c87', accent: '#c084fc', glow: 'rgba(168,85,247,0.30)', name: 'purple' },
    automation: { primary: '#a855f7', secondary: '#581c87', accent: '#c084fc', glow: 'rgba(168,85,247,0.30)', name: 'purple' },
    background: { primary: '#a855f7', secondary: '#581c87', accent: '#c084fc', glow: 'rgba(168,85,247,0.30)', name: 'purple' },

    // cyan — listening
    listening:  { primary: '#06b6d4', secondary: '#164e63', accent: '#22d3ee', glow: 'rgba(6,182,212,0.35)', name: 'cyan' },

    // violet — responding
    responding: { primary: '#8b5cf6', secondary: '#4c1d95', accent: '#a78bfa', glow: 'rgba(139,92,246,0.35)', name: 'violet' },
  };

  const DEFAULT_COLOR = { primary: '#6366f1', secondary: '#312e81', accent: '#818cf8', glow: 'rgba(99,102,241,0.30)', name: 'indigo' };

  function getStatusColor(status) {
    return STATUS_COLORS[status] || DEFAULT_COLOR;
  }

  // ── Helpers (grid-size aware) ──────────────────────────────
  /** Scale a coordinate from 8×8 base to the target grid size. */
  function s(val, gs) {
    if (gs === 8) return val;
    return Math.round(val * gs / 8);
  }

  function emptyGrid(gs) {
    gs = gs || _gridSize;
    return Array.from({ length: gs }, () => Array(gs).fill(0));
  }

  /** Make the grid horizontally symmetric (left → right). */
  function mirrorH(grid) {
    var gs = grid.length;
    for (let y = 0; y < gs; y++) {
      for (let x = 0; x < Math.floor(gs / 2); x++) {
        const mx = gs - 1 - x;
        if (grid[y][x] && !grid[y][mx]) grid[y][mx] = grid[y][x];
        else if (grid[y][mx] && !grid[y][x]) grid[y][x] = grid[y][mx];
      }
    }
    return grid;
  }

  /** Make the grid vertically symmetric (top → bottom). */
  function mirrorV(grid) {
    var gs = grid.length;
    for (let y = 0; y < Math.floor(gs / 2); y++) {
      var my = gs - 1 - y;
      for (let x = 0; x < gs; x++) {
        if (grid[y][x] && !grid[my][x]) grid[my][x] = grid[y][x];
        else if (grid[my][x] && !grid[y][x]) grid[y][x] = grid[my][x];
      }
    }
    return grid;
  }

  /** Rotate grid 90° clockwise. Returns a new grid. */
  function rotateGrid90(grid) {
    var gs = grid.length;
    var g = emptyGrid(gs);
    for (var y = 0; y < gs; y++)
      for (var x = 0; x < gs; x++)
        g[x][gs - 1 - y] = grid[y][x];
    return g;
  }

  /** Flip grid horizontally (left ↔ right). Returns a new grid. */
  function flipGridH(grid) {
    var gs = grid.length;
    var g = emptyGrid(gs);
    for (var y = 0; y < gs; y++)
      for (var x = 0; x < gs; x++)
        g[y][gs - 1 - x] = grid[y][x];
    return g;
  }

  /** Flip grid vertically (top ↔ bottom). Returns a new grid. */
  function flipGridV(grid) {
    var gs = grid.length;
    var g = emptyGrid(gs);
    for (var y = 0; y < gs; y++)
      for (var x = 0; x < gs; x++)
        g[gs - 1 - y][x] = grid[y][x];
    return g;
  }

  /**
   * Apply layout transforms from theme to a glyph grid.
   * Transforms: rotation, flip, additional symmetry, scatter cells.
   * Uses combined theme + metadata seed for per-glyph scatter variation.
   */
  function applyLayoutTheme(grid, theme, metadataSeed) {
    if (!theme || !theme.seed) return grid;

    var gs = grid.length;
    var g = grid;

    // 1. Rotation (0-3 × 90° clockwise)
    var rotations = theme.gridRotation || 0;
    for (var r = 0; r < rotations; r++) {
      g = rotateGrid90(g);
    }

    // 2. Flip
    if (theme.flipH) g = flipGridH(g);
    if (theme.flipV) g = flipGridV(g);

    // 3. Additional symmetry enforcement
    //    0 = no extra, 1 = force H mirror, 2 = force V mirror, 3 = force both
    var sym = theme.symmetryMode || 0;
    if (sym === 1 || sym === 3) g = mirrorH(g);
    if (sym === 2 || sym === 3) g = mirrorV(g);

    // 4. Scatter extra cells (uses combined seed for per-glyph variation)
    var scatter = theme.scatterCount || 0;
    if (scatter > 0) {
      // Scale scatter count for larger grids
      var scaledScatter = scatter * Math.round(gs / 8);
      var combinedSeed = ((theme.seed ^ (metadataSeed || 0)) >>> 0);
      var srng = new SeededRandom(combinedSeed);
      for (var i = 0; i < scaledScatter; i++) {
        var sx = srng.nextInt(0, gs - 1);
        var sy = srng.nextInt(0, gs - 1);
        if (g[sy][sx] === 0) g[sy][sx] = srng.pick([2, 3]);
      }
    }

    return g;
  }

  // ── Domain pattern generators ──────────────────────────────
  // Cell values: 0 = empty, 1 = primary, 2 = secondary, 3 = accent
  // All generators accept (rng, gs) where gs = grid size.
  // They scale proportionally from the base 8×8 design.

  function patternAppliance(rng, gs) {
    const g = emptyGrid(gs);
    // Solid centre block — half the grid, centred
    const cStart = s(2, gs);
    const cEnd   = s(5, gs);
    for (let y = cStart; y <= cEnd; y++)
      for (let x = cStart; x <= cEnd; x++)
        g[y][x] = 1;

    // Seed-based edge bumps
    const bumpEdge = cStart - 1;
    const bumpOuter = cEnd + 1;
    const bumps = rng.nextInt(2, Math.max(6, s(6, gs)));
    for (let i = 0; i < bumps; i++) {
      const side = rng.nextInt(0, 3);
      const pos  = rng.nextInt(cStart, cEnd);
      if (side === 0 && bumpEdge >= 0 && g[bumpEdge])   g[bumpEdge][pos] = 2;
      else if (side === 1 && bumpOuter < gs && g[pos])  g[pos][bumpOuter] = 2;
      else if (side === 2 && bumpOuter < gs && g[bumpOuter]) g[bumpOuter][pos] = 2;
      else if (side === 3 && bumpEdge >= 0 && g[pos])   g[pos][bumpEdge] = 2;
    }

    // Inner accent detail
    const aStart = s(3, gs);
    const aEnd   = s(4, gs);
    for (let y = aStart; y <= aEnd; y++)
      for (let x = aStart; x <= aEnd; x++)
        if (rng.nextBool(0.45)) g[y][x] = 3;

    // Extra detail for larger grids
    if (gs > 8) {
      const extra = rng.nextInt(2, gs >> 2);
      for (let i = 0; i < extra; i++) {
        const ex = rng.nextInt(cStart, cEnd);
        const ey = rng.nextInt(cStart, cEnd);
        if (g[ey][ex] === 1) g[ey][ex] = rng.pick([2, 3]);
      }
    }

    return mirrorH(g);
  }

  function patternSystem(rng, gs) {
    const g = emptyGrid(gs);
    // Hollow centre — border of a square
    const cStart = s(2, gs);
    const cEnd   = s(5, gs);
    for (let i = cStart; i <= cEnd; i++) {
      g[cStart][i] = 1;
      g[cEnd][i] = 1;
      g[i][cStart] = 1;
      g[i][cEnd] = 1;
    }
    // Inner dots
    const d1 = s(3, gs), d2 = s(4, gs);
    if (rng.nextBool(0.5)) g[d1][d1] = 2;
    if (rng.nextBool(0.5)) g[d2][d2] = 2;
    // Outer decorations
    for (let i = 0; i < rng.nextInt(1, Math.max(4, gs >> 1)); i++) {
      const x = rng.nextInt(0, gs - 1);
      const y = rng.nextInt(0, gs - 1);
      if (g[y][x] === 0) g[y][x] = 2;
    }
    // Extra ring for larger grids
    if (gs >= 16) {
      const oStart = Math.max(0, cStart - s(2, gs));
      const oEnd   = Math.min(gs - 1, cEnd + s(2, gs));
      for (let i = oStart; i <= oEnd; i++) {
        if (g[oStart][i] === 0) g[oStart][i] = 2;
        if (g[oEnd][i] === 0)   g[oEnd][i] = 2;
        if (g[i][oStart] === 0) g[i][oStart] = 2;
        if (g[i][oEnd] === 0)   g[i][oEnd] = 2;
      }
    }
    return mirrorH(g);
  }

  // ── Idle Mood Patterns ─────────────────────────────────────
  // A set of subtle, organic, minimalist patterns that convey
  // UMMON is "alive" — breathing, contemplating, drifting.
  // Each mood is deterministic from its index. They are visually
  // distinct from active domain patterns (no borders, no mirroring).

  var MOOD_GENERATORS = [
    // Mood 0: "Heartbeat" — single pulsing dot at centre
    function moodHeartbeat(rng, gs) {
      var g = emptyGrid(gs);
      var cx = Math.floor(gs / 2);
      var cy = Math.floor(gs / 2);
      g[cy][cx] = 1;
      if (gs >= 8) { g[cy - 1][cx] = 2; g[cy + 1][cx] = 2; }
      return g;
    },
    // Mood 1: "Drift" — a few cells scattered asymmetrically, like floating particles
    function moodDrift(rng, gs) {
      var g = emptyGrid(gs);
      var n = Math.max(3, Math.round(gs * 0.6));
      for (var i = 0; i < n; i++) {
        var x = rng.nextInt(1, gs - 2);
        var y = rng.nextInt(1, gs - 2);
        g[y][x] = (i < 2) ? 1 : 2;
      }
      return g;
    },
    // Mood 2: "Constellation" — small triangle/cluster of dots
    function moodConstellation(rng, gs) {
      var g = emptyGrid(gs);
      var ox = rng.nextInt(s(1, gs), s(5, gs));
      var oy = rng.nextInt(s(1, gs), s(5, gs));
      g[oy][ox] = 1;
      if (ox + 1 < gs) g[oy][ox + 1] = 2;
      if (oy + 1 < gs) g[oy + 1][ox] = 2;
      if (ox + 1 < gs && oy + 1 < gs) g[oy + 1][ox + 1] = 1;
      // A distant echo dot
      var dx = rng.nextInt(0, gs - 1);
      var dy = rng.nextInt(0, gs - 1);
      g[dy][dx] = 2;
      return g;
    },
    // Mood 3: "Ripple" — concentric diamond expanding from centre
    function moodRipple(rng, gs) {
      var g = emptyGrid(gs);
      var cx = Math.floor(gs / 2);
      var cy = Math.floor(gs / 2);
      var r = rng.nextInt(1, Math.max(2, Math.floor(gs / 3)));
      for (var d = 0; d <= r; d++) {
        if (cy - d >= 0)  g[cy - d][cx] = d === r ? 2 : 1;
        if (cy + d < gs)  g[cy + d][cx] = d === r ? 2 : 1;
        if (cx - d >= 0)  g[cy][cx - d] = d === r ? 2 : 1;
        if (cx + d < gs)  g[cy][cx + d] = d === r ? 2 : 1;
      }
      return g;
    },
    // Mood 4: "Wanderer" — a short path/trail
    function moodWanderer(rng, gs) {
      var g = emptyGrid(gs);
      var x = rng.nextInt(s(2, gs), s(5, gs));
      var y = rng.nextInt(s(2, gs), s(5, gs));
      var steps = rng.nextInt(3, Math.max(4, Math.round(gs * 0.75)));
      for (var i = 0; i < steps; i++) {
        if (x >= 0 && x < gs && y >= 0 && y < gs) {
          g[y][x] = (i === 0) ? 1 : 2;
        }
        var dir = rng.nextInt(0, 3);
        if (dir === 0) x++;
        else if (dir === 1) x--;
        else if (dir === 2) y++;
        else y--;
      }
      return g;
    },
    // Mood 5: "Ember" — small warm cluster at a random corner
    function moodEmber(rng, gs) {
      var g = emptyGrid(gs);
      var corners = [[1, 1], [1, gs - 3], [gs - 3, 1], [gs - 3, gs - 3]];
      var c = corners[rng.nextInt(0, 3)];
      g[c[0]][c[1]] = 1;
      g[c[0] + 1][c[1]] = 2;
      g[c[0]][c[1] + 1] = 2;
      // Faint tail
      var tx = Math.min(gs - 1, c[1] + rng.nextInt(2, 3));
      var ty = Math.min(gs - 1, c[0] + rng.nextInt(2, 3));
      g[ty][tx] = 2;
      return g;
    },
    // Mood 6: "Sigh" — diagonal sparse line
    function moodSigh(rng, gs) {
      var g = emptyGrid(gs);
      var flip = rng.nextBool(0.5);
      for (var i = 0; i < gs; i += 2) {
        var x = flip ? (gs - 1 - i) : i;
        if (x >= 0 && x < gs && i < gs) {
          g[i][x] = (i === 0 || i === gs - 1) ? 1 : 2;
        }
      }
      return g;
    },
    // Mood 7: "Orbit" — two dots circling centre (fixed positions)
    function moodOrbit(rng, gs) {
      var g = emptyGrid(gs);
      var cx = Math.floor(gs / 2);
      var cy = Math.floor(gs / 2);
      g[cy][cx] = 2; // dim centre
      var r = rng.nextInt(s(2, gs), Math.max(s(2, gs), s(3, gs)));
      var a1 = rng.next() * Math.PI * 2;
      var a2 = a1 + Math.PI; // opposite side
      var x1 = cx + Math.round(Math.cos(a1) * r);
      var y1 = cy + Math.round(Math.sin(a1) * r);
      var x2 = cx + Math.round(Math.cos(a2) * r);
      var y2 = cy + Math.round(Math.sin(a2) * r);
      if (x1 >= 0 && x1 < gs && y1 >= 0 && y1 < gs) g[y1][x1] = 1;
      if (x2 >= 0 && x2 < gs && y2 >= 0 && y2 < gs) g[y2][x2] = 1;
      return g;
    },
  ];

  /**
   * Generate an idle mood glyph.
   * @param {number} moodIndex — 0-based mood index (wrapped to available mood count)
   * @param {number} gs — grid size
   * @param {number|null} totalMoods — total mood count (if > generators, extra moods use generator with tweaked seed)
   * @returns {Array} grid
   */
  function patternIdleMood(moodIndex, gs, totalMoods) {
    var genCount = MOOD_GENERATORS.length;
    var genIdx = moodIndex % genCount;
    // Each mood gets a unique deterministic seed from its index
    var rng = new SeededRandom(hashCode('idle-mood-' + moodIndex));
    return MOOD_GENERATORS[genIdx](rng, gs);
  }

  function patternSecurity(rng, gs) {
    const g = emptyGrid(gs);
    // Symmetric vertical bars
    const maxHalf = Math.max(2, s(3, gs));
    const halfBars = rng.nextInt(1, Math.min(maxHalf, Math.floor(gs / 4)));
    const positions = [];
    for (let i = 0; i < halfBars; i++) {
      let pos;
      do { pos = rng.nextInt(1, Math.floor(gs / 2) - 1); } while (positions.includes(pos));
      positions.push(pos);
    }
    const barStart = s(1, gs);
    const barEnd   = gs - 1 - barStart;
    for (const x of positions) {
      const mx = gs - 1 - x;
      for (let y = barStart; y <= barEnd; y++) {
        const v = rng.nextBool(0.85) ? 1 : 2;
        g[y][x] = v;
        g[y][mx] = v;
      }
    }
    // Horizontal cross-bar
    if (rng.nextBool(0.6)) {
      const cy = rng.nextInt(s(3, gs), s(4, gs));
      for (let x = barStart; x <= barEnd; x++) if (g[cy][x] === 0) g[cy][x] = 2;
    }
    // Extra horizontal bars for larger grids
    if (gs >= 16 && rng.nextBool(0.5)) {
      const ey = rng.nextInt(s(2, gs), s(5, gs));
      for (let x = barStart; x <= barEnd; x++) if (g[ey][x] === 0) g[ey][x] = 3;
    }
    return g;
  }

  function patternClimate(rng, gs) {
    const g = emptyGrid(gs);
    const thick = rng.nextBool(0.5);
    const armOff = rng.nextInt(0, Math.max(1, s(1, gs)));
    const armStart = armOff;
    const armEnd = gs - 1 - armOff;
    const mid1 = s(3, gs), mid2 = s(4, gs);
    // Horizontal bar
    for (let x = armStart; x <= armEnd; x++) {
      g[mid1][x] = 1;
      g[mid2][x] = 1;
    }
    // Vertical bar
    for (let y = armStart; y <= armEnd; y++) {
      g[y][mid1] = 1;
      g[y][mid2] = 1;
    }
    if (thick) {
      const t1 = mid1 - 1, t2 = mid2 + 1;
      if (t1 >= 0) for (let x = armStart; x <= armEnd; x++) g[t1][x] = 2;
      if (t2 < gs) for (let x = armStart; x <= armEnd; x++) g[t2][x] = 2;
    }
    // Centre accent
    g[mid1][mid1] = 3; g[mid1][mid2] = 3;
    g[mid2][mid1] = 3; g[mid2][mid2] = 3;

    // Extra thickness for larger grids
    if (gs >= 16) {
      const et = Math.floor(gs / 16);
      for (let d = 1; d <= et; d++) {
        for (let x = armStart; x <= armEnd; x++) {
          if (mid1 - d >= 0 && g[mid1 - d][x] === 0) g[mid1 - d][x] = 2;
          if (mid2 + d < gs && g[mid2 + d][x] === 0) g[mid2 + d][x] = 2;
        }
        for (let y = armStart; y <= armEnd; y++) {
          if (mid1 - d >= 0 && g[y][mid1 - d] === 0) g[y][mid1 - d] = 2;
          if (mid2 + d < gs && g[y][mid2 + d] === 0) g[y][mid2 + d] = 2;
        }
      }
    }
    return g;
  }

  function patternMedia(rng, gs) {
    const g = emptyGrid(gs);
    const dir = rng.nextBool(0.5) ? 1 : -1;
    // Main diagonal
    for (let i = 0; i < gs; i++) {
      const y = dir === 1 ? i : gs - 1 - i;
      g[y][i] = 1;
    }
    // Parallel secondary diagonal(s)
    const baseOffset = rng.pick([1, 2, -1, -2]);
    const offset = s(baseOffset, gs);
    for (let i = 0; i < gs; i++) {
      const y = dir === 1 ? i : gs - 1 - i;
      const x2 = i + offset;
      if (x2 >= 0 && x2 < gs) g[y][x2] = 2;
    }
    // Thicken diagonals for larger grids
    if (gs >= 16) {
      for (let i = 0; i < gs; i++) {
        const y = dir === 1 ? i : gs - 1 - i;
        if (i + 1 < gs && y + dir >= 0 && y + dir < gs) g[y][i + 1] = g[y][i + 1] || 2;
        if (y + 1 < gs && y + 1 >= 0) g[y + 1][i] = g[y + 1][i] || 2;
      }
    }
    // Accent dots at corners
    if (rng.nextBool(0.5)) { g[0][0] = 3; g[gs - 1][gs - 1] = 3; }
    if (rng.nextBool(0.5)) { g[0][gs - 1] = 3; g[gs - 1][0] = 3; }
    return g;
  }

  function patternVoice(rng, gs) {
    const g = emptyGrid(gs);
    const scale = gs / 8;
    const cx = Math.round(1 * scale);
    const cy = (gs - 1) / 2;
    const numArcs = rng.nextInt(2, Math.max(3, Math.round(3 * scale)));
    for (let arc = 1; arc <= numArcs; arc++) {
      const r = (arc * 1.8 + rng.next() * 0.4) * scale;
      const step = gs >= 16 ? 4 : 8;
      for (let a = -55; a <= 55; a += step) {
        const rad = (a * Math.PI) / 180;
        const x = Math.round(cx + r * Math.cos(rad));
        const y = Math.round(cy + r * Math.sin(rad));
        if (x >= 0 && x < gs && y >= 0 && y < gs) {
          g[y][x] = arc <= 2 ? 1 : 2;
        }
      }
    }
    // Source dot (scaled)
    const sd = s(3, gs), sd2 = s(4, gs), ss = s(1, gs), ss0 = s(0, gs);
    for (let y = sd; y <= sd2; y++) {
      for (let x = ss; x <= ss; x++) {
        if (y < gs && x < gs) g[y][x] = 3;
      }
    }
    if (rng.nextBool(0.5)) {
      for (let y = sd; y <= sd2; y++) {
        if (y < gs && ss0 < gs) g[y][ss0] = 2;
      }
    }
    return g;
  }

  function patternError(gs) {
    gs = gs || _gridSize;
    const g = emptyGrid(gs);
    // Big X
    for (let i = 0; i < gs; i++) {
      g[i][i] = 1;
      g[i][gs - 1 - i] = 1;
    }
    const c1 = s(3, gs), c2 = s(4, gs);
    for (let y = c1; y <= c2; y++)
      for (let x = c1; x <= c2; x++)
        if (y < gs && x < gs) g[y][x] = 3;
    return g;
  }

  // ── Urgency corners ────────────────────────────────────────
  function applyUrgency(grid, urgency) {
    if (!urgency || urgency <= 0) return grid;
    var gs = grid.length;
    const cs = Math.max(2, s(2, gs)); // corner block size scales with grid
    const corners = [
      [0, 0], [0, gs - cs],
      [gs - cs, 0], [gs - cs, gs - cs],
    ];
    let n = 0;
    if (urgency >= 1) n = 1;
    if (urgency >= 2) n = 2;
    if (urgency >= 3) n = 4;
    for (let c = 0; c < n; c++) {
      const [cy, cx] = corners[c];
      for (let dy = 0; dy < cs; dy++)
        for (let dx = 0; dx < cs; dx++)
          if (cy + dy < gs && cx + dx < gs && grid[cy + dy][cx + dx] === 0)
            grid[cy + dy][cx + dx] = 3;
    }
    return grid;
  }

  // ── Main generation entry point ────────────────────────────
  // Optional second argument: theme (from deriveTheme) to apply
  // layout-level transforms (rotation, flip, symmetry, scatter).
  // Optional third argument: gridSize override (8 or 16).
  function generateGlyph(metadata, theme, gridSize) {
    const gs = (gridSize && VALID_GRID_SIZES.includes(gridSize)) ? gridSize : _gridSize;
    const { domain, device, status, intent, urgency = 0, variant, mood, moodCount } = metadata || {};

    // Validate required fields
    if (!domain || !status || !intent) {
      return {
        grid: patternError(gs),
        gridSize: gs,
        color: STATUS_COLORS.error,
        isError: true,
        errorMessage: 'Missing required fields: domain, status, intent',
        animation: 'none',
        metadata,
      };
    }

    // ── Idle mood path ────────────────────────────────────────
    // If this is an idle glyph (system/idle/idle) with a mood index, use mood patterns
    if (domain === 'system' && status === 'idle' && intent === 'idle' && mood != null) {
      const totalMoods = moodCount || 8;
      const moodIdx = Math.abs(Number(mood)) % totalMoods;
      const moodGrid = patternIdleMood(moodIdx, gs, totalMoods);
      const color = getStatusColor('idle');
      return {
        grid: moodGrid,
        gridSize: gs,
        color: color,
        isError: false,
        animation: 'breathe',
        seed: hashCode('idle-mood-' + moodIdx),
        metadata,
      };
    }

    // device required for certain domains
    const deviceRequired = ['appliance', 'security', 'climate', 'media'];
    if (deviceRequired.includes(domain) && !device) {
      return {
        grid: patternError(gs),
        gridSize: gs,
        color: STATUS_COLORS.error,
        isError: true,
        errorMessage: `Missing required 'device' for domain '${domain}'`,
        animation: 'none',
        metadata,
      };
    }

    // Seed — include idle variation counter when present
    const idleVar = metadata._idleVariation || 0;
    const seedStr = domain + (device || '') + status + intent + (idleVar > 0 ? ':v' + idleVar : '');
    let seed = hashCode(seedStr);
    if (variant === 'random') seed = hashCode(seedStr + Date.now().toString());

    const rng = new SeededRandom(seed);
    const color = getStatusColor(status);

    // Pattern
    let grid;
    switch (domain) {
      case 'appliance': grid = patternAppliance(rng, gs); break;
      case 'system':    grid = patternSystem(rng, gs); break;
      case 'security':  grid = patternSecurity(rng, gs); break;
      case 'climate':   grid = patternClimate(rng, gs); break;
      case 'media':     grid = patternMedia(rng, gs); break;
      case 'voice':     grid = patternVoice(rng, gs); break;
      default:          grid = patternSystem(rng, gs); break;
    }

    applyUrgency(grid, urgency);

    // Apply layout transforms from theme (rotation, flip, symmetry, scatter)
    grid = applyLayoutTheme(grid, theme, seed);

    // Animation
    let animation = 'none';
    let blinkCells = null;  // 2D mask: true = this cell blinks
    if (status === 'listening')   animation = 'pulse';
    else if (status === 'responding')  animation = 'wave';
    else if (urgency >= 2) {
      animation = 'blink';
      blinkCells = buildBlinkMask(grid, urgency, seed);
    }

    return { grid, gridSize: gs, color, isError: false, animation, blinkCells, seed, metadata };
  }

  // ── Blink mask — deterministically select which cells blink ─
  // urgency 5 → all filled cells,  4 → ~75%,  3 → ~50%,  2 → ~25%
  function buildBlinkMask(grid, urgency, seed) {
    var gs = grid.length;
    var mask = [];
    var filledCoords = [];
    for (var y = 0; y < gs; y++) {
      mask[y] = [];
      for (var x = 0; x < gs; x++) {
        mask[y][x] = false;
        if (grid[y][x] > 0) filledCoords.push({ x: x, y: y });
      }
    }
    if (urgency >= 5) {
      // All filled cells blink
      for (var i = 0; i < filledCoords.length; i++) {
        mask[filledCoords[i].y][filledCoords[i].x] = true;
      }
      return mask;
    }
    // Fraction of filled cells that blink
    var frac = urgency === 4 ? 0.75
             : urgency === 3 ? 0.50
             :                 0.25; // urgency 2
    var count = Math.max(1, Math.round(filledCoords.length * frac));
    // Deterministic shuffle using seed
    var rng = new SeededRandom(seed ^ 0xB11C);
    for (var j = filledCoords.length - 1; j > 0; j--) {
      var k = rng.nextInt(0, j);
      var tmp = filledCoords[j];
      filledCoords[j] = filledCoords[k];
      filledCoords[k] = tmp;
    }
    // Pick the first `count` cells
    for (var m = 0; m < count; m++) {
      mask[filledCoords[m].y][filledCoords[m].x] = true;
    }
    return mask;
  }

  // ── Seed-based theme derivation ────────────────────────────
  // Takes an arbitrary string and deterministically derives
  // visual parameters that change the look/feel of all rendered
  // glyphs. The same seed always produces the same theme.

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var r1, g1, b1;
    if      (h < 60)  { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else              { r1 = c; g1 = 0; b1 = x; }
    var r = Math.round((r1 + m) * 255);
    var g = Math.round((g1 + m) * 255);
    var b = Math.round((b1 + m) * 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function deriveTheme(seedStr) {
    if (!seedStr || seedStr.trim() === '') return null;
    var seed = hashCode(seedStr);
    var rng  = new SeededRandom(seed);

    // Hue shift: 0-360 degrees applied to all glyph colours
    var hueShift = Math.round(rng.next() * 360);

    // Saturation multiplier: 0.5 – 1.5
    var saturationMul = 0.5 + rng.next();

    // Brightness multiplier: 0.7 – 1.3
    var brightnessMul = 0.7 + rng.next() * 0.6;

    // Glow intensity: 0.2 – 1.0
    var glowIntensity = 0.2 + rng.next() * 0.8;

    // Corner radius: 0 – 8px
    var cornerRadius = rng.next() * 8;

    // Cell gap multiplier: 0.5 – 2.0
    var cellGapMul = 0.5 + rng.next() * 1.5;

    // Background tint colour (dark, low saturation)
    var bgHue = rng.next() * 360;
    var bgTint = hslToHex(bgHue, 0.3, 0.06);

    // Cell background tint
    var cellBgTint = hslToHex(bgHue, 0.2, 0.10);

    // ── Layout transforms ───────────────────────────────────
    // Grid rotation: 0, 1, 2, or 3 (×90° clockwise)
    var gridRotation = rng.nextInt(0, 3);

    // Horizontal / vertical flip
    var flipH = rng.nextBool(0.4);
    var flipV = rng.nextBool(0.4);

    // Additional symmetry: 0=none, 1=force H, 2=force V, 3=force both
    var symmetryMode = rng.nextInt(0, 3);

    // Extra scatter cells: 0–5 random accent/secondary cells added
    var scatterCount = rng.nextInt(0, 5);

    return {
      hueShift: hueShift,
      saturationMul: saturationMul,
      brightnessMul: brightnessMul,
      glowIntensity: glowIntensity,
      cornerRadius: cornerRadius,
      cellGapMul: cellGapMul,
      bgTint: bgTint,
      cellBgTint: cellBgTint,
      // Layout params
      gridRotation: gridRotation,
      flipH: flipH,
      flipV: flipV,
      symmetryMode: symmetryMode,
      scatterCount: scatterCount,
      seed: seed,
    };
  }

  // ── Public API ─────────────────────────────────────────────
  return {
    GRID_SIZE: DEFAULT_GRID_SIZE,
    DEFAULT_GRID_SIZE,
    VALID_GRID_SIZES,
    setGridSize,
    getGridSize,
    generateGlyph,
    getStatusColor,
    hashCode,
    deriveTheme,
    STATUS_COLORS,
    DEFAULT_COLOR,
  };
})();

// UMD export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GlyphEngine;
}
