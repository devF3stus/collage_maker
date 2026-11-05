import { store } from './store.js';
import { history } from './history.js';
import { uid, clamp } from './util.js';

/* Normalized templates are arrays of [x, y, w, h] in 0..100 space. */

export const TEMPLATE_CATALOG = [
  { id: 't2-side', name: '2 · Side by side', slots: [[0, 0, 50, 100], [50, 0, 50, 100]] },
  { id: 't2-stack', name: '2 · Top & bottom', slots: [[0, 0, 100, 50], [0, 50, 100, 50]] },
  { id: 't2-big', name: '2 · One large + small', slots: [[0, 0, 66, 100], [66, 0, 34, 100]] },
  { id: 't3-row', name: '3 · Horizontal', slots: [[0, 0, 33.3, 100], [33.3, 0, 33.3, 100], [66.6, 0, 33.4, 100]] },
  { id: 't3-col', name: '3 · Vertical', slots: [[0, 0, 100, 33.3], [0, 33.3, 100, 33.3], [0, 66.6, 100, 33.4]] },
  { id: 't3-big', name: '3 · One large + two small', slots: [[0, 0, 100, 60], [0, 60, 50, 40], [50, 60, 50, 40]] },
  { id: 't3-2top', name: '3 · Two top + one bottom', slots: [[0, 0, 50, 50], [50, 0, 50, 50], [0, 50, 100, 50]] },
  { id: 't3-sm', name: '3 · Two bottom + one top', slots: [[0, 0, 100, 50], [0, 50, 50, 50], [50, 50, 50, 50]] },
  { id: 't4-grid', name: '4 · 2 × 2 grid', slots: [[0, 0, 50, 50], [50, 0, 50, 50], [0, 50, 50, 50], [50, 50, 50, 50]] },
  { id: 't4-row', name: '4 · Horizontal', slots: [[0, 0, 25, 100], [25, 0, 25, 100], [50, 0, 25, 100], [75, 0, 25, 100]] },
  { id: 't4-col', name: '4 · Vertical', slots: [[0, 0, 100, 25], [0, 25, 100, 25], [0, 50, 100, 25], [0, 75, 100, 25]] },
  { id: 't4-big', name: '4 · One large + three small', slots: [[0, 0, 50, 100], [50, 0, 50, 33.3], [50, 33.3, 50, 33.3], [50, 66.6, 50, 33.4]] },
  { id: 't5-big', name: '5 · One large + four', slots: [[0, 0, 40, 100], [40, 0, 30, 50], [40, 50, 30, 50], [70, 0, 30, 50], [70, 50, 30, 50]] },
  { id: 't5-row', name: '5 · Horizontal', slots: [[0, 0, 20, 100], [20, 0, 20, 100], [40, 0, 20, 100], [60, 0, 20, 100], [80, 0, 20, 100]] },
  { id: 't5-hero', name: '5 · Hero + grid', slots: [[0, 0, 100, 50], [0, 50, 33.3, 50], [33.3, 50, 33.3, 50], [66.6, 50, 33.4, 50]] },
  { id: 't6-grid', name: '6 · 3 × 2 grid', slots: [[0, 0, 33.3, 50], [33.3, 0, 33.3, 50], [66.6, 0, 33.4, 50], [0, 50, 33.3, 50], [33.3, 50, 33.3, 50], [66.6, 50, 33.4, 50]] },
  { id: 't6-2x3', name: '6 · 2 × 3 grid', slots: [[0, 0, 50, 33.3], [50, 0, 50, 33.3], [0, 33.3, 50, 33.3], [50, 33.3, 50, 33.3], [0, 66.6, 50, 33.4], [50, 66.6, 50, 33.4]] },
  { id: 't6-mix', name: '6 · Mixed sizes', slots: [[0, 0, 33.3, 67], [33.3, 0, 33.3, 33.3], [66.6, 0, 33.4, 33.3], [33.3, 33.3, 33.3, 33.7], [66.6, 33.3, 33.4, 33.7], [0, 67, 100, 33]] },
  { id: 't9-grid', name: '9 · 3 × 3 grid', slots: [[0, 0, 33.3, 33.3], [33.3, 0, 33.3, 33.3], [66.6, 0, 33.4, 33.3], [0, 33.3, 33.3, 33.3], [33.3, 33.3, 33.3, 33.3], [66.6, 33.3, 33.4, 33.3], [0, 66.6, 33.3, 33.4], [33.3, 66.6, 33.3, 33.4], [66.6, 66.6, 33.4, 33.4]] },
  { id: 't9-mix', name: '9 · Mixed sizes', slots: [[0, 0, 40, 67], [40, 0, 30, 33.3], [70, 0, 30, 33.3], [40, 33.3, 30, 33.7], [70, 33.3, 30, 33.7], [0, 67, 33.3, 33], [33.3, 67, 33.3, 33], [66.6, 67, 33.4, 33]] },
];

function balancedFor(count) {
  if (count <= 0) return [];
  if (count <= 9) {
    const cand = TEMPLATE_CATALOG.filter((t) => t.slots.length === count);
    if (cand.length) return cand[0].slots;
  }
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const slots = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    slots.push([(c / cols) * 100, (r / rows) * 100, (100 / cols), (100 / rows)]);
  }
  return slots;
}

function insetRect(r, inset) {
  return { x: r.x + inset, y: r.y + inset, w: Math.max(8, r.w - inset * 2), h: Math.max(8, r.h - inset * 2) };
}

function scaleSlots(slots, W, H, margin, gap) {
  const contentW = W - margin * 2;
  const contentH = H - margin * 2;
  const inset = gap / 2;
  return slots.map((r) => {
    const box = {
      x: margin + (r[0] / 100) * contentW,
      y: margin + (r[1] / 100) * contentH,
      w: (r[2] / 100) * contentW,
      h: (r[3] / 100) * contentH,
    };
    return insetRect(box, inset);
  });
}

function gridBoxes(count, W, H, margin, gap, cols) {
  const contentW = W - margin * 2, contentH = H - margin * 2;
  const c = cols || Math.ceil(Math.sqrt(count));
  const r = Math.ceil(count / c);
  const cw = (contentW - gap * (c - 1)) / c;
  const ch = (contentH - gap * (r - 1)) / r;
  const boxes = [];
  for (let i = 0; i < count; i++) {
    const col = i % c, row = Math.floor(i / c);
    boxes.push({ x: margin + col * (cw + gap), y: margin + row * (ch + gap), w: cw, h: ch });
  }
  return boxes;
}

function masonryBoxes(count, W, H, margin, gap, aspects) {
  const cols = clamp(Math.round(Math.sqrt(count) * 1.1 + 0.5), 1, 4);
  const contentW = W - margin * 2;
  const contentH = H - margin * 2;
  const colW = (contentW - gap * (cols - 1)) / cols;
  const colHeights = new Array(cols).fill(0);
  const boxes = [];
  for (let i = 0; i < count; i++) {
    let c = 0;
    for (let j = 1; j < cols; j++) if (colHeights[j] < colHeights[c]) c = j;
    const a = aspects && aspects[i] ? aspects[i] : 1;
    const h = Math.max(40, colW / a);
    let y = margin + colHeights[c];
    if (colHeights[c] > 0) y += gap;
    boxes.push({ x: margin + c * (colW + gap), y, w: colW, h });
    colHeights[c] = y + h - margin;
  }
  return boxes;
}

function featuredBoxes(count, W, H, margin, gap) {
  const contentW = W - margin * 2, contentH = H - margin * 2;
  if (count <= 1) return [{ x: margin, y: margin, w: contentW, h: contentH }];
  const rest = count - 1;
  const c = Math.ceil(Math.sqrt(rest));
  const r = Math.ceil(rest / c);
  const featW = contentW * 0.6;
  const sideW = contentW - featW - gap;
  const cw = (sideW - gap * (c - 1)) / c;
  const ch = (contentH - gap * (r - 1)) / r;
  const boxes = [{ x: margin, y: margin, w: featW, h: contentH }];
  for (let i = 0; i < rest; i++) {
    const col = i % c, row = Math.floor(i / c);
    boxes.push({
      x: margin + featW + gap + col * (cw + gap),
      y: margin + row * (ch + gap),
      w: cw, h: ch,
    });
  }
  return boxes;
}

export function randomBoxes(count, W, H, margin, gap) {
  const contentW = W - margin * 2, contentH = H - margin * 2;
  let blocks = [{ x: 0, y: 0, w: contentW, h: contentH }];
  while (blocks.length < count) {
    const idx = Math.floor(Math.random() * blocks.length);
    const b = blocks[idx];
    const vertical = Math.random() < 0.5;
    const canSplitW = b.w >= 200 && Math.random() < 0.9;
    const canSplitH = b.h >= 200 && Math.random() < 0.9;
    if (canSplitW || canSplitH) {
      const wx = vertical && canSplitW;
      if (wx) {
        const cut = clamp(b.w * (0.3 + Math.random() * 0.4), 80, b.w - 80);
        blocks.splice(idx, 1,
          { x: b.x, y: b.y, w: cut, h: b.h },
          { x: b.x + cut, y: b.y, w: b.w - cut, h: b.h });
      } else {
        const cut = clamp(b.h * (0.3 + Math.random() * 0.4), 80, b.h - 80);
        blocks.splice(idx, 1,
          { x: b.x, y: b.y, w: b.w, h: cut },
          { x: b.x, y: b.y + cut, w: b.w, h: b.h - cut });
      }
    } else {
      if (b.w > b.h * 1.4) {
        const cut = clamp(b.w * (0.3 + Math.random() * 0.4), 80, b.w - 80);
        blocks.splice(idx, 1,
          { x: b.x, y: b.y, w: cut, h: b.h },
          { x: b.x + cut, y: b.y, w: b.w - cut, h: b.h });
      } else {
        const cut = clamp(b.h * (0.3 + Math.random() * 0.4), 80, b.h - 80);
        blocks.splice(idx, 1,
          { x: b.x, y: b.y, w: b.w, h: cut },
          { x: b.x, y: b.y + cut, w: b.w, h: b.h - cut });
      }
    }
  }
  const inset = gap / 2;
  const boxes = blocks.map((b) => ({
    x: margin + b.x + inset,
    y: margin + b.y + inset,
    w: b.w - inset * 2,
    h: b.h - inset * 2,
  }));
  // keep within canvas
  return boxes.map((b) => ({ ...b, w: clamp(b.w, 8, W - b.x - margin), h: clamp(b.h, 8, H - b.y - margin) }));
}

export function layoutBoxes(count, style, W, H, margin, gap, aspects) {
  switch (style) {
    case 'compact': {
      const cols = Math.ceil(Math.sqrt(count));
      return gridBoxes(count, W, H, Math.max(0, margin - 16), gap, cols);
    }
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(count));
      return gridBoxes(count, W, H, margin, gap, cols);
    }
    case 'masonry':
      return masonryBoxes(count, W, H, margin, gap, aspects);
    case 'featured':
      return featuredBoxes(count, W, H, margin, gap);
    case 'random':
      return randomBoxes(count, W, H, margin, gap);
    default:
      return scaleSlots(balancedFor(count), W, H, margin, gap);
  }
}

export function templateSlots(catalogId, W, H, margin, gap) {
  const all = [...TEMPLATE_CATALOG, ...store.doc.templates.map((t) => ({ id: t.id, slots: t.slots }))];
  const t = all.find((t) => t.id === catalogId);
  if (!t) return [];
  return scaleSlots(t.slots, W, H, margin, gap);
}

export function applyLayoutToLayers(layerIds, boxes) {
  const layers = layerIds.map((id) => store.getLayer(id)).filter(Boolean);
  history.commit(() => {
    layers.forEach((layer, i) => {
      const b = boxes[i] || boxes[boxes.length - 1];
      if (!b) return;
      layer.x = b.x; layer.y = b.y; layer.w = b.w; layer.h = b.h;
      layer.rotation = 0; layer.slotId = null;
    });
  });
}

export function convertSlotsToZones(slots) {
  history.commit(() => {
    store.doc.zones = slots.map((b) => ({ id: uid(), x: b.x, y: b.y, w: b.w, h: b.h }));
    store.doc.layout.mode = 'custom';
  });
}

export function arrangeIntoZones(layerIds) {
  const layers = layerIds.map((id) => store.getLayer(id)).filter(Boolean);
  const zones = store.doc.zones.slice();
  history.commit(() => {
    layers.forEach((layer, i) => {
      const z = zones[i];
      if (!z) { layer.slotId = null; return; }
      layer.slotId = z.id;
      layer.x = z.x; layer.y = z.y; layer.w = z.w; layer.h = z.h;
      layer.rotation = 0;
    });
  });
}

export function reflowZones() {
  const zones = store.doc.zones;
  if (zones.length) {
    history.commit(() => {
      zones.forEach((z) => {
        store.doc.layers.filter((l) => l.slotId === z.id).forEach((l) => {
          l.x = z.x; l.y = z.y; l.w = z.w; l.h = z.h;
        });
      });
    });
  }
}

export function randomizeZones() {
  if (!store.doc.zones.length) return;
  const boxes = randomBoxes(store.doc.zones.length, store.canvasWidth(), store.canvasHeight(), store.doc.spacing.margin, store.doc.spacing.gap);
  history.commit(() => {
    store.doc.zones.forEach((z, i) => {
      const b = boxes[i];
      z.x = b.x; z.y = b.y; z.w = b.w; z.h = b.h;
    });
  });
  reflowZones();
}

export function createZone() {
  const W = store.canvasWidth(), H = store.canvasHeight();
  const m = store.doc.spacing.margin;
  history.commit(() => {
    const w = clamp(W * 0.35, 80, 800);
    const h = clamp(H * 0.3, 60, 600);
    const x = m + ((store.doc.zones.length * 37) % Math.max(1, W - m * 2 - w));
    const y = m + ((store.doc.zones.length * 29) % Math.max(1, H - m * 2 - h));
    store.doc.zones.push({ id: uid(), x, y, w, h });
    store.doc.layout.mode = 'custom';
  });
}

export function saveCurrentAsTemplate(name) {
  if (!store.doc.zones.length || !name.trim()) return;
  const W = store.canvasWidth(), H = store.canvasHeight();
  const t = {
    id: uid(),
    name: name.trim(),
    slots: store.doc.zones.map((z) => [
      (z.x / W) * 100,
      (z.y / H) * 100,
      (z.w / W) * 100,
      (z.h / H) * 100,
    ]),
  };
  history.commit(() => {
    store.doc.templates.push(t);
  });
  try {
    window.api.storageWrite('templates', JSON.stringify(store.doc.templates));
  } catch (err) { /* ignore */ }
  return t;
}