// Image tray — a live preview strip of every image in the collage.
// Thumbnails, filenames and dimensions, per-image remove, add-more,
// Clear All, and the Automatic / Manual / Regenerate workflow shortcuts.
import { store, bus } from './store.js';
import { history } from './history.js';
import { canvasEditor } from './canvas.js';
import { autoArrange, randomizeArrangement } from './ui.js';
import { el, toast } from './util.js';
import { confirmModal } from './modal.js';

let initialized = false;
let root = null;
let listEl = null;
let countEl = null;
const items = new Map();
const thumbCache = new Map();
const observer = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    const key = en.target.dataset.key;
    if (!key) return;
    observer.unobserve(en.target);
    thumbFor(key).then((url) => {
      if (url) en.target.style.backgroundImage = `url("${url}")`;
    });
  });
}, { rootMargin: '120px' });

export function initTray() {
  if (initialized) return;
  root = document.getElementById('image-tray');
  if (!root) return;
  listEl = document.getElementById('tray-list');
  countEl = document.getElementById('tray-count');
  initialized = true;

  document.getElementById('btn-tray-add').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('btn-tray-auto').addEventListener('click', () => {
    store.doc.layout.mode = 'auto';
    store.doc.zones = [];
    canvasEditor.activeZone = null;
    autoArrange();
  });
  document.getElementById('btn-tray-manual').addEventListener('click', () => {
    history.commit(() => {
      store.doc.layout.mode = 'custom';
      store.doc.zones = [];
    });
    canvasEditor.activeZone = null;
    toast('Manual mode — drag, resize and layer images freely.', 'ok');
  });
  document.getElementById('btn-tray-regenerate').addEventListener('click', () => randomizeArrangement());
  document.getElementById('btn-tray-clear').addEventListener('click', clearAll);

  bus.on('doc', render);
  bus.on('selection', render);
  render();
}

function clearAll() {
  if (!store.doc.layers.length) return;
  confirmModal('Remove all images from the collage?', () => {
    history.commit(() => {
      store.doc.layers = [];
      store.selection = [];
    });
    toast('All images removed.', 'ok');
  }, { confirmLabel: 'Remove All' });
}

function removeLayer(id) {
  history.commit(() => {
    store.doc.layers = store.doc.layers.filter((l) => l.id !== id);
    store.selection = store.selection.filter((s) => s !== id);
  });
}

function render() {
  if (!root || !listEl || !countEl) return;
  const layers = store.doc.layers;
  root.classList.toggle('hidden', layers.length === 0);
  countEl.textContent = layers.length;
  const wanted = new Map(layers.map((l) => [l.id, l]));
  for (const [id, node] of items) {
    if (!wanted.has(id)) {
      node.remove();
      items.delete(id);
    }
  }
  layers.forEach((layer) => {
    let node = items.get(layer.id);
    if (!node) {
      node = buildItem(layer);
      items.set(layer.id, node);
      listEl.appendChild(node);
    }
    updateItem(node, layer);
  });
}

function buildItem(layer) {
  const item = el('div', 'tray-item');
  item.dataset.id = layer.id;
  const thumb = el('div', 'tray-thumb');
  thumb.dataset.key = layer.assetKey || '';
  const meta = el('div', 'tray-meta');
  meta.appendChild(el('div', 'tray-name'));
  meta.appendChild(el('div', 'tray-dims'));
  const rm = el('button', 'tray-remove', '✕');
  rm.title = 'Remove image';
  rm.addEventListener('click', (e) => {
    e.stopPropagation();
    removeLayer(layer.id);
  });
  item.append(thumb, meta, rm);
  item.addEventListener('click', (e) => {
    if (e.target === rm) return;
    if (e.ctrlKey || e.metaKey) store.toggleSelection(layer.id);
    else store.setSelection([layer.id]);
  });
  observer.observe(thumb);
  return item;
}

function updateItem(node, layer) {
  const asset = store.getAsset(layer.assetKey);
  const natW = layer.natW || (asset && (asset.natW || asset.naturalWidth)) || Math.round(layer.w);
  const natH = layer.natH || (asset && (asset.natH || asset.naturalHeight)) || Math.round(layer.h);
  node.querySelector('.tray-name').textContent = layer.name || 'Image';
  node.querySelector('.tray-dims').textContent = `${Math.round(natW)} × ${Math.round(natH)}`;
  node.dataset.key = layer.assetKey || '';
  node.querySelector('.tray-thumb').dataset.key = layer.assetKey || '';
  node.classList.toggle('sel', store.selection.includes(layer.id));
}

function thumbFor(assetKey) {
  if (thumbCache.has(assetKey)) return Promise.resolve(thumbCache.get(assetKey));
  const asset = store.getAsset(assetKey);
  if (!asset) return Promise.resolve(null);
  const src = asset.preview || asset.dataURL;
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const m = Math.max(img.width, img.height);
      if (m <= 120) {
        thumbCache.set(assetKey, src);
        return resolve(src);
      }
      const k = 120 / m;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL();
      thumbCache.set(assetKey, url);
      resolve(url);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
