// Typed AppState model per docs/CollageMaker-SPEC.md §6. Pure mapping helpers —
// the renderer stays JS, these typedefs + mappers give an explicit typed shape.

/**
 * @typedef {'color'|'linear'|'radial'|'transparent'} BackgroundSpec
 * @typedef {'freeform'|'grid'|'template'|'auto'|'custom'} LayoutEngine
 * @typedef {'cover'|'contain'} ObjectFit
 * @typedef {{ sx:number; sy:number; sw:number; sh:number }} CropRegion
 * @typedef {{ id:string; x:number; y:number; w:number; h:number; radius:number; occupiedBy:string|null }} Slot
 * @typedef {{ id:string; name:string; source:'builtin'|'user'; slots:Array<Omit<Slot,'id'|'occupiedBy'>>; canvasRatio:{ w:number; h:number } }} Template
 * @typedef {{ id:string; width:number; height:number; background:BackgroundSpec & { color?:string; colors?:Array<{c:string;t:number}>; angle?:number }; cornerRadius:number; gap:number; padding:number; engine:LayoutEngine; templateId:string|null; slotCount?:number }} CanvasSettings
 * @typedef {{ id:string; name:string; assetKey:string; slotId:string|null; x:number; y:number; w:number; h:number; rotation:number; objectFit:ObjectFit; crop:CropRegion|null; border:any|null; shadow:any|null; visible:boolean; locked:boolean; createdAt:number; stale?:boolean; natW?:number|null; natH?:number|null }} ImageObject
 * @typedef {{ zoom:number; tx:number; ty:number }} ViewportState
 * @typedef {{ version:number; title:string; canvas:CanvasSettings; slots:Slot[]; objects:ImageObject[]; selection:string[]; viewport:ViewportState; lastSavedPath:string|null }} AppState
 * @typedef {{ undo:any[]; redo:any[]; limit:number; inFlight:any|null }} HistoryStack
 * @typedef {{ key:string; source:{type:'file';path:string}|{type:'data';dataUrl:string}|{type:'blob';blob:any}; bitmap:any|null; naturalW:number|null; naturalH:number|null; previewBitmap:any|null; refCount:number }} AssetRecord
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

export function createAppState(store) {
  const doc = store.doc || {};
  const canvas = doc.canvas || {};
  const spacing = doc.spacing || {};
  const layout = doc.layout || {};
  const layers = doc.layers || [];
  const zones = doc.zones || [];
  const occupied = new Map();
  for (const l of layers) if (l.slotId) occupied.set(l.slotId, l.id);
  return {
    version: 1,
    title: doc.name || 'Untitled',
    canvas: {
      id: 'canvas',
      width: clamp(canvas.width ?? 1080, 2, 10000),
      height: clamp(canvas.height ?? 1080, 2, 10000),
      background: clone(canvas.background) || { type: 'color', color: '#ffffff' },
      cornerRadius: 0,
      gap: spacing.gap ?? 12,
      padding: spacing.margin ?? 40,
      engine: layout.mode || 'auto',
      templateId: layout.templateId || null,
    },
    slots: zones.map((z) => ({
      id: z.id,
      x: z.x, y: z.y, w: z.w, h: z.h,
      radius: z.radius || 0,
      occupiedBy: occupied.get(z.id) || null,
    })),
    objects: layers.map((l) => ({
      id: l.id,
      name: l.name || 'Image',
      assetKey: l.assetKey,
      slotId: l.slotId || null,
      x: l.x, y: l.y, w: l.w, h: l.h,
      rotation: l.rotation || 0,
      objectFit: l.objectFit || 'cover',
      crop: l.crop ? { ...l.crop } : null,
      border: null,
      shadow: null,
      visible: l.visible !== false,
      locked: !!l.locked,
      createdAt: 0,
      natW: l.natW ?? null,
      natH: l.natH ?? null,
    })),
    selection: [...(store.selection || [])],
    viewport: { zoom: store.view.zoom || 1, tx: store.view.tx || 0, ty: store.view.ty || 0 },
    lastSavedPath: doc.filePath || null,
  };
}

export function serializeAppState(state) {
  const { viewport, lastSavedPath, ...persistable } = state;
  return JSON.parse(JSON.stringify(persistable));
}

export function deserializeAppState(json) {
  return JSON.parse(json);
}

export function toLegacyDoc(state, { templates = [] } = {}) {
  const c = state.canvas || {};
  const slots = state.slots || [];
  const objects = state.objects || [];
  return {
    version: 1,
    name: state.title || 'Untitled',
    filePath: state.lastSavedPath || null,
    canvas: {
      width: clamp(c.width ?? 1080, 2, 10000),
      height: clamp(c.height ?? 1080, 2, 10000),
      background: clone(c.background) || { type: 'color', color: '#ffffff' },
    },
    spacing: { margin: c.padding ?? 40, gap: c.gap ?? 12 },
    zones: slots.map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h })),
    layers: objects.map((o) => ({
      id: o.id,
      name: o.name || 'Image',
      assetKey: o.assetKey || null,
      x: o.x, y: o.y, w: o.w, h: o.h,
      rotation: o.rotation || 0,
      crop: o.crop ? { ...o.crop } : null,
      objectFit: o.objectFit || 'cover',
      visible: o.visible !== false,
      locked: !!o.locked,
      slotId: o.slotId || null,
      natW: o.natW ?? null,
      natH: o.natH ?? null,
    })),
    layout: { mode: c.engine || 'auto', style: 'balanced', templateId: c.templateId || null },
    templates: templates || [],
  };
}
