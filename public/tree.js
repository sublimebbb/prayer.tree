// Deterministic ASCII tree. Every visitor builds the identical tree from the
// same seed, so a prayer's slot always lands on the same leaf for everyone.
(function (root) {
  const W = 84;
  const H = 45;
  const SEED = 20261023;

  // kinds
  const EMPTY = 0, LEAF_DARK = 1, LEAF_LIGHT = 2, BARK = 3, GROUND = 4;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(rnd, weighted) {
    let total = 0;
    for (const [, w] of weighted) total += w;
    let r = rnd() * total;
    for (const [c, w] of weighted) { if ((r -= w) <= 0) return c; }
    return weighted[weighted.length - 1][0];
  }

  const HEAVY = [["&", 34], ["%", 22], ["@", 12], ["#", 8], ["$", 4], ["8", 6], ["*", 14]];
  const LIGHT = [["*", 30], ["'", 14], [",", 14], [".", 12], ["`", 8], ["%", 10], ["&", 12]];

  function build() {
    const rnd = mulberry32(SEED);
    const kind = new Uint8Array(W * H);
    const ch = new Array(W * H).fill(" ");
    const dens = new Float32Array(W * H);
    const groundY = H - 3;
    const cx = W / 2;

    // smooth value noise for organic edges
    const GW = 14, GH = 9, grid = [];
    for (let i = 0; i < (GW + 1) * (GH + 1); i++) grid.push(rnd());
    const sm = (t) => t * t * (3 - 2 * t);
    function noise(x, y) {
      const fx = (x / W) * GW, fy = (y / H) * GH;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = sm(fx - ix), ty = sm(fy - iy);
      const a = grid[iy * (GW + 1) + ix], b = grid[iy * (GW + 1) + ix + 1];
      const c = grid[(iy + 1) * (GW + 1) + ix], d = grid[(iy + 1) * (GW + 1) + ix + 1];
      const top = a + (b - a) * tx, bot = c + (d - c) * tx;
      return top + (bot - top) * ty;
    }

    // canopy: overlapping blobs (x radius ~2x y radius because cells are tall)
    const blobs = [
      [cx, 15, 24, 10],
      [cx - 2, 5, 10, 4],
      [cx - 12, 7, 12, 5],
      [cx + 11, 6.5, 12, 5],
      [cx - 23, 12, 11, 6],
      [cx + 23, 11.5, 12, 6],
      [cx - 30, 19, 10, 5.5],
      [cx + 31, 18.5, 9, 5.5],
      [cx - 19, 23, 13, 5],
      [cx + 19, 23, 14, 5],
      [cx - 36, 24, 6, 2.6],
      [cx + 37, 23.5, 5, 2.6],
      [cx, 23, 12, 4],
    ];

    for (let y = 0; y < groundY; y++) {
      for (let x = 0; x < W; x++) {
        let v = -Infinity;
        for (const [bx, by, rx, ry] of blobs) {
          const dx = (x - bx) / rx, dy = (y - by) / ry;
          v = Math.max(v, 1 - dx * dx - dy * dy);
        }
        v += (noise(x, y) - 0.5) * 0.6;
        if (v <= 0) continue;
        const p = Math.min(0.9, 0.2 + v * 1.9);
        if (rnd() > p) continue;
        const i = y * W + x;
        dens[i] = v;
        // light catches the upper-left; edges read lighter and airier
        const lit = (cx - x) * 0.012 + (16 - y) * 0.03 + (0.35 - v) * 1.4 + (rnd() - 0.5) * 0.6;
        if (v < 0.18) {
          kind[i] = LEAF_LIGHT; ch[i] = pick(rnd, LIGHT);
        } else {
          kind[i] = lit > 0.12 ? LEAF_LIGHT : LEAF_DARK;
          ch[i] = pick(rnd, HEAVY);
        }
      }
    }

    function setBark(x, y, c, chance) {
      x = Math.round(x);
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      if (chance !== undefined && rnd() > chance) return;
      const i = y * W + x;
      kind[i] = BARK; ch[i] = c; dens[i] = 0;
    }

    // trunk
    const trunkTop = 28;
    for (let y = groundY; y >= trunkTop; y--) {
      const t = (groundY - y) / (groundY - trunkTop);
      let half = 5.2 - t * 2.4;
      const flare = groundY - y;
      if (flare < 3) half += (3 - flare) * 1.5;
      const c = cx + Math.sin(t * 2.4) * 1.1;
      const xl = Math.round(c - half), xr = Math.round(c + half);
      for (let x = xl; x <= xr; x++) {
        let g = " ";
        if (x === xl) g = flare < 2 ? "/" : rnd() < 0.88 ? "|" : "(";
        else if (x === xr) g = flare < 2 ? "\\" : rnd() < 0.88 ? "|" : ")";
        else {
          const r = rnd();
          g = r < 0.16 ? "|" : r < 0.22 ? ":" : r < 0.25 ? "." : r < 0.27 ? "'" : " ";
        }
        setBark(x, y, g);
      }
    }

    // branches: [startX, startY, dxPerRow, rows, startChance]
    function branch(x, y, dx, rows, chance0) {
      for (let k = 0; k < rows; k++) {
        const nx = x + dx;
        const ny = y - 1;
        const chance = chance0 * (1 - (k / rows) * 0.55);
        const glyph = dx < -0.35 ? "\\" : dx > 0.35 ? "/" : "|";
        // shallow branches get underscores between steps
        if (Math.abs(dx) >= 1.6) {
          const from = Math.round(x), to = Math.round(nx);
          const step = to > from ? 1 : -1;
          for (let xx = from + step; xx !== to; xx += step) setBark(xx, y, "_", chance);
        }
        setBark(nx, ny, glyph, chance);
        x = nx; y = ny;
      }
      return [x, y];
    }
    const tc = cx + Math.sin(2.4) * 1.1;
    const [lx, ly] = branch(tc - 2, trunkTop, -1.25, 7, 0.95);
    const [rx, ry] = branch(tc + 2, trunkTop, 1.25, 7, 0.95);
    branch(tc, trunkTop, 0.12, 13, 0.9);
    branch(lx, ly, -2.2, 4, 0.8);
    branch(lx, ly, -0.4, 6, 0.75);
    branch(rx, ry, 2.2, 4, 0.8);
    branch(rx, ry, 0.45, 6, 0.75);
    branch(tc - 1, trunkTop - 5, -0.8, 7, 0.7);
    branch(tc + 1, trunkTop - 6, 0.85, 7, 0.7);

    // roots spreading from the flare
    for (const side of [-1, 1]) {
      let x = Math.round(tc + side * 8);
      for (let k = 0; k < 4; k++) setBark(x + side * k, groundY, "_");
      setBark(x - side, groundY, side < 0 ? "/" : "\\");
    }

    // ground line, roots, and a little loose soil
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x - cx) / (W * 0.46);
      if (d > 1) continue;
      const i = groundY * W + x;
      if (kind[i] === BARK) continue;
      if (rnd() > 1.05 - d * d) continue;
      kind[i] = GROUND;
      ch[i] = pick(rnd, [["_", 46], [",", 12], [".", 10], ["'", 8], ['"', 6], ["~", 4]]);
    }
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x - cx) / (W * 0.3);
      if (d > 1 || rnd() > (1 - d) * 0.35) continue;
      const i = (groundY + 1) * W + x;
      kind[i] = GROUND;
      ch[i] = pick(rnd, [[".", 4], ["`", 2], [",", 3], ["'", 2]]);
    }

    // prayer slots: every leaf cell, in reading order
    const slots = [];
    for (let i = 0; i < W * H; i++) {
      if (kind[i] === LEAF_DARK || kind[i] === LEAF_LIGHT) slots.push(i);
    }

    return { W, H, groundY, kind, ch, dens, slots, HEAVY, LIGHT, KINDS: { EMPTY, LEAF_DARK, LEAF_LIGHT, BARK, GROUND } };
  }

  const api = { build, pick, mulberry32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PrayerTree = api;
})(typeof window !== "undefined" ? window : globalThis);
