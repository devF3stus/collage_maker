import { store, bus } from './store.js';
import { history } from './history.js';
import { uid, toast, loadImage, shortName } from './util.js';

const PREVIEW_MAX = 1600;

export function downscale(dataURL, max = PREVIEW_MAX) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const m = Math.max(img.width, img.height);
      if (m <= max) return resolve(dataURL);
      const k = max / m;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL());
    };
    img.onerror = () => resolve(dataURL);
    img.src = dataURL;
  });
}

export function naturalSize(dataURL) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: null, h: null });
    img.src = dataURL;
  });
}

function makeLayerData({ name }) {
  const count = store.doc.layers.length;
  return {
    id: uid(),
    name: name || 'Image ' + (count + 1),
    assetKey: null,
    x: 0, y: 0, w: 300, h: 300,
    rotation: 0,
    crop: null,
    objectFit: 'cover',
    visible: true,
    locked: false,
    slotId: null,
  };
}

function placementFor(index) {
  const W = store.canvasWidth(), H = store.canvasHeight();
  const m = store.doc.spacing.margin;
  const bw = 300, bh = 300;
  const cascade = (index * 22) % 200;
  return {
    x: clampTo(W, (W - bw) / 2 + cascade),
    y: clampTo(H, (H - bh) / 2 + cascade),
    w: Math.min(bw, W - m * 2),
    h: Math.min(bh, H - m * 2),
  };
}

function clampTo(limit, v) {
  return Math.max(0, Math.min(Math.max(0, v), Math.max(0, limit - 80)));
}

export async function addImageSources(sources) {
  const added = [];

  for (const src of sources) {
    const layer = await buildLayer(src);
    if (!layer) continue;
    added.push(layer);
  }
  if (!added.length) return [];

  history.commit(() => {
    added.forEach((layer) => {
      store.doc.layers.push(layer);
      if (allZoneIds().length && tryAssignZone(layer.id)) return;
      const p = placementFor(store.doc.layers.length);
      layer.x = p.x; layer.y = p.y; layer.w = p.w; layer.h = p.h;
    });
  });
  store.setSelection(added.map((l) => l.id));
  return added.map((l) => l.id);
}

function allZoneIds() {
  return store.doc.zones.map((z) => z.id);
}

function tryAssignZone(layerId) {
  const all = store.doc.zones;
  if (!all.length) return false;
  const used = new Set(store.doc.layers.map((l) => l.slotId).filter(Boolean));
  const free = all.filter((z) => !used.has(z.id));
  if (!free.length) return false;
  store.assignToZone(layerId, free[0].id);
  return true;
}

async function buildLayer(src) {
  const dataURL = src.dataURL;
  const path = src.path || null;
  if (!dataURL) return null;
  let nat = await naturalSize(dataURL).catch(() => ({ w: null, h: null }));
  if (!nat.w) nat = { w: 300, h: 300 };
  const preview = await downscale(dataURL).catch(() => dataURL);
  const assetKey = store.registerAsset({
    type: path ? 'file' : 'data',
    path,
    dataURL: path ? null : dataURL,
    preview,
    natW: nat.w,
    natH: nat.h,
  });
  const layer = makeLayerData({ name: src.name });
  layer.assetKey = assetKey;
  layer.natW = nat.w;
  layer.natH = nat.h;
  return layer;
}

export async function pasteFromClipboard() {
  let result;
  try {
    result = await window.api.readClipboardImage();
  } catch (e) {
    toast('Could not read the clipboard.', 'error');
    return;
  }
  if (!result || !result.ok) {
    toast('No image found in clipboard.', 'error');
    return;
  }
  const sources = [];
  if (result.dataURL) {
    sources.push({ dataURL: result.dataURL, name: 'Pasted image' });
  }
  if (result.filePaths && result.filePaths.length) {
    for (const p of result.filePaths) {
      const full = await window.api.readFullFile(p).catch(() => null);
      if (full) sources.push({ dataURL: full, name: shortName(p), path: p });
    }
  }
  if (!sources.length) {
    toast('No image found in clipboard.', 'error');
    return;
  }
  const ids = await addImageSources(sources);
  toast(ids.length > 1 ? `Added ${ids.length} images.` : 'Image added from clipboard.', 'ok');
}

export async function addFiles(files) {
  const sources = [];
  for (const f of files) {
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name) && !f.type.startsWith('image/')) {
      toast(`This image format isn't supported: ${shortName(f.name)}`, 'error');
      continue;
    }
    const dataURL = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(f);
    });
    if (dataURL) sources.push({ dataURL, name: f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) });
  }
  if (!sources.length) return false;
  await addImageSources(sources);
  return true;
}

export async function readPastedFiles(files) {
  return addFiles(files);
}