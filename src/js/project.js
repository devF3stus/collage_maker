import { store, bus } from './store.js';
import { history } from './history.js';
import { toast } from './util.js';
import { downscale } from './clipboard.js';
import { canvasEditor } from './canvas.js';

function serializeAssets() {
  const out = {};
  store.assets.forEach((a, key) => {
    if (a.type === 'file') {
      out[key] = { type: 'file', path: a.path, natW: a.natW, natH: a.natH };
    } else {
      out[key] = { type: 'data', dataURL: a.dataURL, natW: a.natW, natH: a.natH };
    }
  });
  return out;
}

export function serializeDoc() {
  return {
    version: 1,
    name: store.doc.name,
    canvas: store.doc.canvas,
    spacing: store.doc.spacing,
    zones: store.doc.zones,
    layers: store.doc.layers,
    layout: store.doc.layout,
    templates: store.doc.templates,
    assets: serializeAssets(),
  };
}

export async function saveProjectFile() {
  const json = JSON.stringify(serializeDoc());
  const res = await window.api.saveProject({ defaultName: store.doc.name || 'My Collage', json }).catch(() => ({ ok: false }));
  if (res && res.ok) {
    store.doc.filePath = res.filePath;
    store.doc.name = baseName(res.filePath);
    toast('Project saved.', 'ok');
    bus.emit('doc');
  } else if (!res || !res.canceled) {
    toast("We couldn't save the project. Please try again.", 'error');
  }
}

function baseName(p) {
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1].replace(/\.collage$/i, '');
}

export async function openProjectFile() {
  const res = await window.api.openProject().catch(() => ({ ok: false }));
  if (!res || !res.ok) {
    if (res && res.canceled) return;
    toast("We couldn't open that project.", 'error');
    return;
  }
  try {
    const data = JSON.parse(res.json);
    if (data.version !== 1) throw new Error('bad version');
    await loadProjectData(data);
    store.doc.filePath = res.filePath;
    store.doc.name = baseName(res.filePath);
    toast('Project opened.', 'ok');
  } catch (e) {
    console.error(e);
    toast("We couldn't open that project. It may be corrupted.", 'error');
  }
}

export async function loadProjectData(data) {
  store.doc = {
    version: 1,
    name: data.name || 'Untitled',
    filePath: null,
    canvas: data.canvas || { width: 1080, height: 1080, background: { type: 'color', color: '#ffffff' } },
    spacing: data.spacing || { margin: 40, gap: 12 },
    zones: data.zones || [],
    layers: data.layers || [],
    layout: data.layout || { mode: 'auto', style: 'balanced', templateId: null },
    templates: data.templates || [],
  };
  store.assets.clear();
  const assets = data.assets || {};
  await Promise.all(Object.entries(assets).map(async ([key, a]) => {
    if (a.type === 'file') {
      const preview = await window.api.readPreviewFile(a.path).catch(() => null);
      store.assets.set(key, {
        type: 'file', path: a.path, preview: preview || null,
        natW: a.natW, natH: a.natH, dataURL: null,
      });
    } else {
      const preview = a.dataURL ? await downscale(a.dataURL).catch(() => a.dataURL) : null;
      store.assets.set(key, {
        type: 'data', dataURL: a.dataURL || null, preview: preview || (a.dataURL || null),
        natW: a.natW, natH: a.natH,
      });
    }
  }));
  store.selection = [];
  history.reset();
  bus.emit('doc');
  requestAnimationFrame(() => canvasEditor.fit());
}