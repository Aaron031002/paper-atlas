// Force-directed graph on a canvas: layout, drawing, and pointer interaction.
// No dependencies. The view (views/graph.js) decides what the nodes mean;
// this file only knows about circles, lines, and how they move.
//
// Node:  { id, label, kind: 'paper' | 'tag' | 'ref', color?, weight? }
// Edge:  { source, target, kind: 'relation' | 'cites' | 'tag' | 'ref', label?, directed? }

const LINK_LENGTH = { relation: 130, cites: 130, tag: 80, ref: 95 };
const CHARGE = { paper: -900, tag: -260, ref: -220 };
const ALPHA_MIN = 0.003;
const STEP_MS = 1000 / 60; // the simulation runs in fixed 60 Hz steps
const MAX_FLING = 36; // px per 60 Hz frame; keeps a flick from throwing the graph off screen

export class ForceGraph {
  constructor(canvas, { onSelect = () => {}, onHover = () => {} } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.nodes = [];
    this.edges = [];
    this.byId = new Map();
    this.neighbors = new Map();
    this.cam = { x: 0, y: 0, k: 1 };
    this.camTarget = { x: 0, y: 0, k: 1 };
    this.alpha = 0;
    this.alphaTarget = 0;
    this.hovered = null;
    this.selected = null;
    this.pinOnDrop = false;
    this.insets = { left: 0, right: 0, bottom: 0 }; // screen space covered by panels
    this.pointers = new Map();
    this.drag = null;
    this.inertia = null;
    this.running = false;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.readTheme();
    this.bind();
    this.resize();
  }

  readTheme() {
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    this.theme = {
      sheet: v('--sheet', '#eff2f5'),
      surface: v('--surface', '#fff'),
      ink: v('--ink', '#16202f'),
      ink2: v('--ink-2', '#4a5668'),
      ink3: v('--ink-3', '#7a8596'),
      line: v('--line', '#d6dce4'),
      accent: v('--accent', '#2147c7'),
      font: v('--font-ui', 'sans-serif'),
    };
  }

  // ---------- data ----------

  /** Replace the graph. Nodes that already exist keep their position. */
  setData(nodes, edges) {
    const previous = this.byId;
    this.byId = new Map();
    this.nodes = nodes.map((n, i) => {
      const old = previous.get(n.id);
      const node = { ...n, x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null, fade: 1, isNew: !old };
      if (old) Object.assign(node, { x: old.x, y: old.y, fx: old.fx, fy: old.fy });
      else {
        // Sunflower spiral: an even, deterministic starting spread.
        const angle = i * 2.39996;
        const radius = 34 * Math.sqrt(i + 1);
        node.x = Math.cos(angle) * radius;
        node.y = Math.sin(angle) * radius;
      }
      this.byId.set(node.id, node);
      return node;
    });

    this.edges = edges
      .filter((e) => this.byId.has(e.source) && this.byId.has(e.target))
      .map((e) => ({ ...e, s: this.byId.get(e.source), t: this.byId.get(e.target), fade: 1 }));

    this.neighbors = new Map(this.nodes.map((n) => [n.id, new Set()]));
    for (const n of this.nodes) n.degree = 0;
    for (const e of this.edges) {
      this.neighbors.get(e.s.id).add(e.t.id);
      this.neighbors.get(e.t.id).add(e.s.id);
      e.s.degree += 1;
      e.t.degree += 1;
    }
    for (const n of this.nodes) {
      n.r = n.kind === 'paper' ? 9 + 2.4 * Math.sqrt(n.weight || 0) : n.kind === 'tag' ? 5 : 5.5;
    }

    // A node added to an existing layout starts beside what it connects to.
    if (previous.size) {
      for (const n of this.nodes.filter((m) => m.isNew)) {
        const placed = [...this.neighbors.get(n.id)].map((id) => this.byId.get(id)).filter((m) => !m.isNew);
        if (placed.length) {
          n.x = placed.reduce((s, m) => s + m.x, 0) / placed.length + (Math.random() - 0.5) * 40;
          n.y = placed.reduce((s, m) => s + m.y, 0) / placed.length + (Math.random() - 0.5) * 40;
        }
      }
    }

    if (this.selected && !this.byId.has(this.selected)) this.selected = null;
    if (this.hovered && !this.byId.has(this.hovered)) this.hovered = null;

    if (!previous.size) {
      // First layout is computed before anything is drawn, so the graph appears settled.
      this.alpha = 1;
      for (let i = 0; i < 320; i += 1) this.tick();
      this.alpha = 0;
      this.fit(false);
    } else {
      this.alpha = Math.max(this.alpha, 0.5);
    }
    this.wake();
  }

  // ---------- simulation ----------

  tick() {
    const { nodes, edges } = this;
    const alpha = this.alpha;
    const n = nodes.length;

    // Repulsion between every pair, plus a hard minimum spacing.
    // O(n²): fine for several hundred nodes. Past ~1500, switch to Barnes–Hut.
    for (let i = 0; i < n; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j += 1) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 === 0) { dx = (Math.random() - 0.5) * 0.1; dy = (Math.random() - 0.5) * 0.1; d2 = dx * dx + dy * dy; }
        if (d2 > 640000) continue;
        const d = Math.sqrt(d2);
        const charge = (CHARGE[a.kind] + CHARGE[b.kind]) / 2;
        let f = (charge * alpha) / d2;
        // Overlap is resolved regardless of alpha, so nodes never sit on top of each other.
        const minGap = a.r + b.r + 16;
        if (d < minGap) f -= ((minGap - d) / d) * 0.35;
        a.vx += dx * f; a.vy += dy * f;
        b.vx -= dx * f; b.vy -= dy * f;
      }
    }

    // Springs along edges.
    for (const e of edges) {
      const dx = e.t.x + e.t.vx - e.s.x - e.s.vx;
      const dy = e.t.y + e.t.vy - e.s.y - e.s.vy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const strength = 0.7 / Math.min(e.s.degree, e.t.degree);
      const f = ((d - LINK_LENGTH[e.kind]) / d) * alpha * strength;
      const bias = e.s.degree / (e.s.degree + e.t.degree);
      e.t.vx -= dx * f * bias; e.t.vy -= dy * f * bias;
      e.s.vx += dx * f * (1 - bias); e.s.vy += dy * f * (1 - bias);
    }

    for (const node of nodes) {
      // Gentle pull to the origin keeps disconnected pieces from drifting away.
      node.vx -= node.x * 0.035 * alpha;
      node.vy -= node.y * 0.035 * alpha;
      if (node.fx !== null) { node.x = node.fx; node.y = node.fy; node.vx = 0; node.vy = 0; continue; }
      node.vx *= 0.58; node.vy *= 0.58;
      node.x += node.vx; node.y += node.vy;
    }

    this.alpha += (this.alphaTarget - this.alpha) * 0.028;
  }

  // ---------- frame loop ----------

  wake() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(() => this.frame());
  }

  frame() {
    // Everything advances by elapsed time, not by frame count, so the graph
    // moves at the same speed on a 60 Hz laptop and a 240 Hz monitor.
    const now = performance.now();
    const dt = Math.min(50, this.lastFrame ? now - this.lastFrame : STEP_MS);
    this.lastFrame = now;
    const frames = dt / STEP_MS; // elapsed time in 60 Hz frames
    let busy = false;

    if (this.alpha > ALPHA_MIN || this.alphaTarget > 0) {
      this.pendingMs = Math.min((this.pendingMs || 0) + dt, STEP_MS * 3);
      while (this.pendingMs >= STEP_MS) { this.tick(); this.pendingMs -= STEP_MS; }
      busy = true;
    } else {
      this.pendingMs = 0;
    }

    if (this.inertia) {
      const v = this.inertia;
      this.cam.x += v.x * frames; this.cam.y += v.y * frames;
      this.camTarget.x = this.cam.x; this.camTarget.y = this.cam.y;
      const friction = 0.9 ** frames;
      v.x *= friction; v.y *= friction;
      if (Math.abs(v.x) + Math.abs(v.y) < 0.15) this.inertia = null; else busy = true;
    }

    const ease = this.reducedMotion ? 1 : 1 - 0.78 ** frames;
    for (const key of ['x', 'y', 'k']) {
      const diff = this.camTarget[key] - this.cam[key];
      if (Math.abs(diff) > (key === 'k' ? 0.0005 : 0.05)) { this.cam[key] += diff * ease; busy = true; }
      else this.cam[key] = this.camTarget[key];
    }

    // Fade nodes and edges toward their highlight state.
    const fadeEase = this.reducedMotion ? 1 : 1 - 0.8 ** frames;
    const focus = this.hovered || this.selected;
    const near = focus ? this.neighbors.get(focus) : null;
    for (const node of this.nodes) {
      const target = !focus || node.id === focus || near.has(node.id) ? 1 : 0.14;
      if (Math.abs(target - node.fade) > 0.01) { node.fade += (target - node.fade) * fadeEase; busy = true; }
      else node.fade = target;
    }
    for (const edge of this.edges) {
      const target = !focus || edge.s.id === focus || edge.t.id === focus ? 1 : 0.1;
      if (Math.abs(target - edge.fade) > 0.01) { edge.fade += (target - edge.fade) * fadeEase; busy = true; }
      else edge.fade = target;
    }

    this.draw();
    if (busy) requestAnimationFrame(() => this.frame());
    else { this.running = false; this.lastFrame = 0; }
  }

  // ---------- drawing ----------

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.dpr = dpr;
    this.wake();
  }

  toScreen(node) {
    return { x: node.x * this.cam.k + this.cam.x, y: node.y * this.cam.k + this.cam.y };
  }

  draw() {
    const { ctx, theme, cam } = this;
    const W = this.width;
    const H = this.height;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = theme.sheet;
    ctx.fillRect(0, 0, W, H);

    // Dot grid that moves with the camera: gives panning something to hold on to.
    let step = 32 * cam.k;
    while (step < 22) step *= 2;
    ctx.fillStyle = theme.line;
    for (let x = ((cam.x % step) + step) % step; x < W; x += step) {
      for (let y = ((cam.y % step) + step) % step; y < H; y += step) ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    }

    const focus = this.hovered || this.selected;
    const scale = Math.max(0.55, Math.min(1.35, cam.k));

    // Edges.
    for (const e of this.edges) {
      const a = this.toScreen(e.s);
      const b = this.toScreen(e.t);
      if (Math.max(a.x, b.x) < -40 || Math.min(a.x, b.x) > W + 40 || Math.max(a.y, b.y) < -40 || Math.min(a.y, b.y) > H + 40) continue;
      const strong = e.kind === 'relation';
      const touched = focus && (e.s.id === focus || e.t.id === focus);
      ctx.globalAlpha = e.fade * (touched ? 1 : strong ? 0.7 : e.kind === 'cites' ? 0.42 : 0.3);
      ctx.strokeStyle = touched && (strong || e.kind === 'cites') ? theme.accent : strong ? theme.ink : theme.ink3;
      ctx.lineWidth = strong ? 1.7 : 1;
      ctx.setLineDash(e.kind === 'tag' ? [2, 4] : e.kind === 'ref' ? [5, 4] : []);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const sr = e.s.r * scale + 2;
      const tr = e.t.r * scale + (e.directed ? 5 : 2);
      if (len <= sr + tr) continue;
      const x1 = a.x + ux * sr; const y1 = a.y + uy * sr;
      const x2 = b.x - ux * tr; const y2 = b.y - uy * tr;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (e.directed) {
        ctx.setLineDash([]);
        const size = strong ? 7 : 5.5;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(x2 + ux * 3, y2 + uy * 3);
        ctx.lineTo(x2 - ux * size - uy * size * 0.5, y2 - uy * size + ux * size * 0.5);
        ctx.lineTo(x2 - ux * size + uy * size * 0.5, y2 - uy * size - ux * size * 0.5);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.setLineDash([]);

    // Nodes.
    for (const n of this.nodes) {
      const p = this.toScreen(n);
      const r = n.r * scale;
      if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) continue;
      ctx.globalAlpha = n.fade;
      if (n.kind === 'paper') {
        if (n.id === this.selected) {
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
          ctx.strokeStyle = n.color; ctx.lineWidth = 2; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.color; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = theme.surface; ctx.stroke();
      } else if (n.kind === 'tag') {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y);
        ctx.closePath();
        ctx.fillStyle = n.id === this.selected ? theme.ink : theme.surface; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = theme.ink2; ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = theme.sheet; ctx.fill();
        ctx.setLineDash([3, 2.5]); ctx.lineWidth = 1.4; ctx.strokeStyle = theme.ink2; ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Labels: drawn last so they sit above every node.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    for (const n of this.nodes) {
      const emphasised = n.id === focus || (focus && this.neighbors.get(focus).has(n.id));
      const visible = emphasised || (n.kind === 'paper' ? cam.k > 0.5 : n.kind === 'tag' ? cam.k > 0.75 : cam.k > 1.15);
      if (!visible) continue;
      const p = this.toScreen(n);
      if (p.x < -120 || p.x > W + 120 || p.y < -40 || p.y > H + 40) continue;
      const size = n.kind === 'paper' ? 12.5 : 11.5;
      ctx.font = `${n.kind === 'paper' ? 600 : 400} ${size}px ${theme.font}`;
      ctx.globalAlpha = n.fade;
      const text = n.shortLabel || n.label;
      const y = p.y + n.r * scale + 5;
      ctx.lineWidth = 3.5; ctx.strokeStyle = theme.sheet; ctx.strokeText(text, p.x, y);
      ctx.fillStyle = n.kind === 'paper' ? theme.ink : theme.ink2; ctx.fillText(text, p.x, y);
    }

    // Relation labels on the edges of the focused node.
    if (focus) {
      ctx.font = `500 11px ${theme.font}`;
      ctx.textBaseline = 'middle';
      for (const e of this.edges) {
        if (!e.label || (e.s.id !== focus && e.t.id !== focus)) continue;
        const a = this.toScreen(e.s);
        const b = this.toScreen(e.t);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const w = ctx.measureText(e.label).width + 12;
        ctx.globalAlpha = e.fade;
        ctx.fillStyle = theme.surface;
        ctx.strokeStyle = theme.accent; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(mx - w / 2, my - 9, w, 18, 9); ctx.fill(); ctx.stroke();
        ctx.fillStyle = theme.accent; ctx.fillText(e.label, mx, my);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- camera ----------

  fit(animate = true) {
    if (!this.nodes.length) return;
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const n of this.nodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
    const pad = 80;
    const availW = Math.max(200, this.width - this.insets.left - this.insets.right);
    const k = Math.min(1.5, Math.max(0.2, Math.min((availW - pad * 2) / (maxX - minX || 1), ((this.height - this.insets.bottom) - pad * 2) / (maxY - minY || 1))));
    const cx = this.insets.left + availW / 2;
    this.camTarget = { k, x: cx - ((minX + maxX) / 2) * k, y: (this.height - this.insets.bottom) / 2 - ((minY + maxY) / 2) * k };
    if (!animate) this.cam = { ...this.camTarget };
    this.inertia = null;
    this.wake();
  }

  zoomAt(factor, sx = this.width / 2, sy = this.height / 2) {
    const t = this.camTarget;
    const k = Math.min(4, Math.max(0.15, t.k * factor));
    const wx = (sx - t.x) / t.k;
    const wy = (sy - t.y) / t.k;
    this.camTarget = { k, x: sx - wx * k, y: sy - wy * k };
    this.inertia = null;
    this.wake();
  }

  panBy(dx, dy) {
    this.camTarget.x += dx; this.camTarget.y += dy;
    this.wake();
  }

  /** Select a node and bring it to the middle of the view. */
  focus(id) {
    const node = this.byId.get(id);
    if (!node) return false;
    this.select(id); // first: opening the detail panel changes the insets
    const k = Math.max(this.camTarget.k, 0.9);
    const cx = this.insets.left + (this.width - this.insets.left - this.insets.right) / 2;
    this.camTarget = { k, x: cx - node.x * k, y: (this.height - this.insets.bottom) / 2 - node.y * k };
    this.inertia = null;
    this.wake();
    return true;
  }

  select(id) {
    if (this.selected === id) return;
    this.selected = id;
    this.onSelect(id ? this.byId.get(id) : null);
    this.wake();
  }

  releaseAll() {
    for (const n of this.nodes) { n.fx = null; n.fy = null; }
    this.alpha = Math.max(this.alpha, 0.6);
    this.wake();
  }

  // ---------- pointer and keyboard ----------

  nodeAt(sx, sy, slack = 5) {
    const scale = Math.max(0.55, Math.min(1.35, this.cam.k));
    let best = null;
    let bestD = Infinity;
    for (const n of this.nodes) {
      const p = this.toScreen(n);
      const d = Math.hypot(p.x - sx, p.y - sy) - n.r * scale;
      if (d < slack && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  localPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  bind() {
    const c = this.canvas;
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      (this.unbinders ||= []).push(() => target.removeEventListener(type, fn, opts));
    };

    on(c, 'pointerdown', (ev) => {
      c.setPointerCapture(ev.pointerId);
      const p = this.localPoint(ev);
      this.pointers.set(ev.pointerId, p);
      this.inertia = null;
      if (this.pointers.size === 2) {
        // Second finger down: whatever the first was doing becomes a pinch.
        if (this.drag?.node && !this.pinOnDrop) { this.drag.node.fx = null; this.drag.node.fy = null; }
        this.alphaTarget = 0;
        const [a, b] = [...this.pointers.values()];
        this.drag = { pinch: true, dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        return;
      }
      const node = this.nodeAt(p.x, p.y, ev.pointerType === 'touch' ? 14 : 5);
      this.drag = { node, start: p, last: p, moved: false, velocity: { x: 0, y: 0 } };
      if (node) {
        this.drag.offset = { x: (p.x - this.cam.x) / this.cam.k - node.x, y: (p.y - this.cam.y) / this.cam.k - node.y };
        node.fx = node.x; node.fy = node.y;
      }
      c.classList.add('is-dragging');
    });

    on(c, 'pointermove', (ev) => {
      const p = this.localPoint(ev);
      if (!this.pointers.has(ev.pointerId)) {
        // Plain hover.
        const node = this.nodeAt(p.x, p.y);
        const id = node ? node.id : null;
        if (id !== this.hovered) {
          this.hovered = id;
          c.style.cursor = node ? 'pointer' : '';
          this.onHover(node);
          this.wake();
        }
        return;
      }
      this.pointers.set(ev.pointerId, p);
      const drag = this.drag;
      if (!drag) return;

      if (drag.pinch) {
        if (this.pointers.size < 2) return;
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const k = Math.min(4, Math.max(0.15, this.cam.k * (dist / drag.dist)));
        const wx = (drag.mid.x - this.cam.x) / this.cam.k;
        const wy = (drag.mid.y - this.cam.y) / this.cam.k;
        this.cam = { k, x: mid.x - wx * k, y: mid.y - wy * k };
        this.camTarget = { ...this.cam };
        drag.dist = dist; drag.mid = mid;
        this.wake();
        return;
      }

      const dx = p.x - drag.last.x;
      const dy = p.y - drag.last.y;
      if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 4) {
        drag.moved = true;
        if (drag.node) this.alphaTarget = 0.3; // keep the layout live while a node is being dragged
      }
      if (drag.moved) {
        if (drag.node) {
          drag.node.fx = (p.x - this.cam.x) / this.cam.k - drag.offset.x;
          drag.node.fy = (p.y - this.cam.y) / this.cam.k - drag.offset.y;
        } else {
          this.cam.x += dx; this.cam.y += dy;
          this.camTarget.x = this.cam.x; this.camTarget.y = this.cam.y;
          // Pointer speed in px per 60 Hz frame, smoothed over recent moves.
          const t = performance.now();
          const elapsed = Math.max(4, t - (drag.lastMove || t - STEP_MS));
          const scale = STEP_MS / elapsed;
          drag.velocity = { x: drag.velocity.x * 0.4 + dx * scale * 0.6, y: drag.velocity.y * 0.4 + dy * scale * 0.6 };
          drag.lastMove = t;
        }
        this.wake();
      }
      drag.last = p;
    });

    const end = (ev) => {
      if (!this.pointers.has(ev.pointerId)) return;
      this.pointers.delete(ev.pointerId);
      const drag = this.drag;
      if (!drag) return;
      if (drag.pinch) { if (this.pointers.size === 0) this.drag = null; return; }
      this.drag = null;
      c.classList.remove('is-dragging');
      this.alphaTarget = 0;
      if (drag.node) {
        if (drag.moved && ev.type === 'pointerup') {
          // Drop exactly where the pointer was released, even if the last move event was skipped.
          const p = this.localPoint(ev);
          drag.node.x = drag.node.fx = (p.x - this.cam.x) / this.cam.k - drag.offset.x;
          drag.node.y = drag.node.fy = (p.y - this.cam.y) / this.cam.k - drag.offset.y;
        }
        if (!(this.pinOnDrop && drag.moved)) { drag.node.fx = null; drag.node.fy = null; }
        if (!drag.moved) this.select(drag.node.id);
      } else if (!drag.moved) {
        this.select(null);
      } else if (!this.reducedMotion && drag.lastMove && performance.now() - drag.lastMove < 60) {
        const speed = Math.hypot(drag.velocity.x, drag.velocity.y);
        const cap = speed > MAX_FLING ? MAX_FLING / speed : 1;
        if (speed > 1.5) this.inertia = { x: drag.velocity.x * cap, y: drag.velocity.y * cap };
      }
      this.wake();
    };
    on(c, 'pointerup', end);
    on(c, 'pointercancel', end);
    on(c, 'pointerleave', () => {
      if (this.hovered && !this.drag) { this.hovered = null; this.onHover(null); this.wake(); }
    });

    on(c, 'wheel', (ev) => {
      ev.preventDefault();
      const p = this.localPoint(ev);
      // Pinch on a trackpad arrives as ctrl+wheel with small deltas; a mouse wheel as large steps.
      const intensity = ev.ctrlKey ? 0.012 : ev.deltaMode === 1 ? 0.06 : 0.0022;
      this.zoomAt(Math.exp(-ev.deltaY * intensity), p.x, p.y);
    }, { passive: false });

    on(c, 'dblclick', (ev) => {
      const p = this.localPoint(ev);
      const node = this.nodeAt(p.x, p.y);
      if (node) { node.fx = null; node.fy = null; this.alpha = Math.max(this.alpha, 0.3); this.wake(); }
      else this.zoomAt(1.6, p.x, p.y);
    });

    on(c, 'keydown', (ev) => {
      const step = 60;
      const actions = {
        '+': () => this.zoomAt(1.3), '=': () => this.zoomAt(1.3), '-': () => this.zoomAt(1 / 1.3),
        0: () => this.fit(), Escape: () => this.select(null),
        ArrowLeft: () => this.panBy(step, 0), ArrowRight: () => this.panBy(-step, 0),
        ArrowUp: () => this.panBy(0, step), ArrowDown: () => this.panBy(0, -step),
      };
      if (actions[ev.key]) { ev.preventDefault(); actions[ev.key](); }
    });

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(c);
  }

  destroy() {
    this.observer.disconnect();
    (this.unbinders || []).forEach((off) => off());
    this.nodes = [];
    this.edges = [];
  }
}
