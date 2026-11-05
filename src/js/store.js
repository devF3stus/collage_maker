import { bus } from './bus.js';
import { AssetStore } from './assets.js';
import { createAppState, serializeAppState as serializeState, deserializeAppState as deserializeState, toLegacyDoc } from './model.js';

const DEFAULT_BG = { type: 'color', color: '#ffffff', colors: [{ c: '#ffffff', t: 0 }, { c: '#3b82f6', t: 1 }], angle: 90 };

export function defaultDoc() {
  return {
    canvas: { width: 1080, height: 1080, background: { ...DEFAULT_BG } },
    spacing: { margin: 40, gap: 12 },
    zones: [],
    layers: [],
    layout: { mode: 'auto', style: 'balanced', templateId: null },
    templates: [],
    version: 1,
    name: 'Untitled',
    filePath: null,
  };
}

class Store {
  constructor() {
    this.doc = defaultDoc();
    this.assets = new AssetStore();
    this.selection = [];
    this.view = { zoom: 1, tx: 0, ty: 0 };
    bus.on('doc', () => this.assets.recomputeRefs(this.assets.activeKeysFrom(this.doc)));
  }

  reset() {
    this.doc = defaultDoc();
    this.assets.clear();
    this.assets.recomputeRefs([]);
    this.selection = [];
  }

  getLayer(id) {
    return this.doc.layers.find((l) => l.id === id);
  }

  getAsset(key) {
    return this.assets.get(key);
  }

  registerAsset(source) {
    return this.assets.register(source);
  }

  appState() {
    return createAppState(this);
  }

  serializeAppState() {
    return serializeState(this.appState());
  }

  loadAppState(stateOrJson) {
    const state = typeof stateOrJson === 'string' ? deserializeState(stateOrJson) : stateOrJson;
    if (!state || !state.canvas) return;
    this.doc = toLegacyDoc(state, { templates: this.doc.templates });
    this.view = {
      zoom: (state.viewport && state.viewport.zoom) || 1,
      tx: (state.viewport && state.viewport.tx) || 0,
      ty: (state.viewport && state.viewport.ty) || 0,
    };
    this.selection = (state.selection || []).filter((id) => this.getLayer(id));
    this.assets.recomputeRefs(this.assets.activeKeysFrom(this.doc));
    bus.emit('doc');
    bus.emit('selection');
  }

  selectedLayers() {
    return this.selection.map((id) => this.getLayer(id)).filter(Boolean);
  }

  hasSelection() {
    return this.selection.length > 0;
  }

  setSelection(ids, { keep = false } = {}) {
    const next = keep ? Array.from(new Set([...this.selection, ...ids])) : [...ids];
    this.selection = next.filter((id) => this.getLayer(id));
    bus.emit('selection');
  }

  toggleSelection(id) {
    const set = new Set(this.selection);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.selection = Array.from(set);
    bus.emit('selection');
  }

  isValidBackground(bg) {
    return bg && (bg.type === 'color' || bg.type === 'linear' || bg.type === 'radial' || bg.type === 'transparent');
  }

  canvasWidth() {
    return Math.max(2, this.doc.canvas.width);
  }

  canvasHeight() {
    return Math.max(2, this.doc.canvas.height);
  }

  countByZone() {
    const used = new Set(this.doc.layers.filter((l) => l.slotId).map((l) => l.slotId));
    return used;
  }

  freeZone() {
    const used = this.countByZone();
    return this.doc.zones.find((z) => !used.has(z.id)) || null;
  }

  assignToZone(layerId, zoneId) {
    const layer = this.getLayer(layerId);
    const zone = this.doc.zones.find((z) => z.id === zoneId);
    if (!layer || !zone) return;
    layer.slotId = zoneId;
    layer.x = zone.x;
    layer.y = zone.y;
    layer.w = zone.w;
    layer.h = zone.h;
    layer.rotation = 0;
  }
}

export const store = new Store();
export { bus };

let modified = true;
export function markDirty() {
  modified = true;
}

export function isDirty() {
  return modified;
}

export function clearDirty() {
  modified = false;
}

export function backgroundStyle(bg) {
  if (bg.type === 'transparent') {
    return 'repeating-conic-gradient(#2a2f39 0% 25%, #22262e 0% 50%) 0 0 / 20px 20px';
  }
  if (bg.type === 'color') {
    return bg.color;
  }
  let token = '';
  if (bg.type === 'linear') {
    token = `linear-gradient(${bg.angle || 90}deg`;
  } else {
    token = `radial-gradient(circle at 50% 50%`;
  }
  const stops = (bg.colors || []).map((s) => `${s.c} ${(s.t * 100).toFixed(0)}%`).join(', ');
  return `${token}, ${stops})`;
}