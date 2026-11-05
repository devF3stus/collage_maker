import { store, bus } from './store.js';
import { history } from './history.js';
import { canvasEditor, bgStyle } from './canvas.js';
import { pasteFromClipboard, addFiles } from './clipboard.js';
import { openExportModal } from './export.js';
import { openProjectFile, saveProjectFile } from './project.js';
import { TEMPLATE_CATALOG, layoutBoxes, templateSlots, applyLayoutToLayers, convertSlotsToZones, arrangeIntoZones, reflowZones, randomBoxes, randomizeZones, createZone, saveCurrentAsTemplate } from './layout.js';
import { el, toast, clamp, uid } from './util.js';
import { openModal, closeModal, confirmModal, promptModal, modalButtons } from './modal.js';

const CANVAS_PRESETS = [
  { name: 'Square 1080', w: 1080, h: 1080 },
  { name: 'Portrait 1080', w: 1080, h: 1350 },
  { name: 'Landscape 1920', w: 1920, h: 1080 },
  { name: 'Story 1080', w: 1080, h: 1920 },
  { name: 'Landscape 1280', w: 1280, h: 720 },
  { name: 'Square 1200', w: 1200, h: 1200 },
];

let builderToolbar = null;
let pendingBg = null;

export function initUi() {
  const id = (s) => document.getElementById(s);
  const toolbar = {
    new: id('btn-new'), open: id('btn-open'), save: id('btn-save'),
    undo: id('btn-undo'), redo: id('btn-redo'),
    paste: id('btn-paste'), add: id('btn-add-image'),
    layout: id('btn-layout'), bg: id('btn-background'), export: id('btn-export'),
  };
  toolbar.new.addEventListener('click', () => newCollage());
  toolbar.open.addEventListener('click', () => openProjectFile());
  toolbar.save.addEventListener('click', () => saveProjectFile());
  toolbar.undo.addEventListener('click', () => history.undo());
  toolbar.redo.addEventListener('click', () => history.redo());
  toolbar.paste.addEventListener('click', () => pasteFromClipboard());
  toolbar.add.addEventListener('click', () => id('file-input').click());
  toolbar.export.addEventListener('click', () => openExportModal());
  toolbar.layout.addEventListener('click', () => scrollToSection('layout-mode-seg'));
  toolbar.bg.addEventListener('click', () => scrollToSection('bg-section'));

  id('btn-empty-browse').addEventListener('click', () => id('file-input').click());
  id('file-input').addEventListener('change', async () => {
    const files = [...id('file-input').files];
    if (files.length) await addFiles(files);
    id('file-input').value = '';
  });

  initDragDrop();
  initLayoutPanel();
  initCanvasPresets();
  initBuilderToolbar();
  initBackgroundUI();
  initZoomControls();
  initLayersButtons();

  bus.on('action', (a) => handleAction(a));
  bus.on('rename-layer', (layerId) => {
    const l = store.getLayer(layerId);
    if (!l) return;
    promptModal('Rename Layer', 'Layer name:', l.name, (v) => {
      if (!v) return;
      history.commit(() => { l.name = v; });
    });
  });
  bus.on('dblclick-layer', (layerId) => {
    const l = store.getLayer(layerId);
    if (l && store.selection.length === 1) {
      promptModal('Rename Layer', 'Layer name:', l.name, (v) => {
        if (!v) return;
        history.commit(() => { l.name = v; });
      });
    }
  });
  bus.on('history', ({ canUndo, canRedo }) => {
    toolbar.undo.disabled = !canUndo;
    toolbar.redo.disabled = !canRedo;
  });
  bus.on('doc', () => {
    const status = document.getElementById('status-proj');
    status.textContent = store.doc.filePath ? store.doc.name + ' — saved' : store.doc.name;
    refreshTemplateList();
    refreshLayoutModeUI();
    const m = document.getElementById('sp-margin');
    const g = document.getElementById('sp-gap');
    if (document.activeElement !== m) m.value = store.doc.spacing.margin;
    if (document.activeElement !== g) g.value = store.doc.spacing.gap;
  });
  bus.emit('history', { canUndo: history.undoStack.length > 0, canRedo: history.redoStack.length > 0 });

  loadTemplates().then(() => refreshTemplateList());
}

function scrollToSection(sel) {
  const node = document.getElementById(sel);
  if (node) node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function handleAction(a) {
  switch (a) {
    case 'new': newCollage(); break;
    case 'open': openProjectFile(); break;
    case 'save': saveProjectFile(); break;
    case 'export': openExportModal(); break;
    case 'delete': canvasEditor.deleteSelection(); break;
    case 'front': layersPanelMove('front'); break;
    case 'forward': layersPanelMove('forward'); break;
    case 'backward': layersPanelMove('backward'); break;
    case 'back': layersPanelMove('back'); break;
    case 'lock': layersPanelToggleLock(); break;
  }
}

function layersPanelMove(d) {
  import('./layers.js').then(({ layersPanel }) => layersPanel.moveSelection(d));
}

function layersPanelToggleLock() {
  import('./layers.js').then(({ layersPanel }) => layersPanel.toggleLock());
}

function newCollage() {
  if (store.doc.layers.length) {
    confirmModal('Start a new collage? Your current collage will be lost unless you save it first.', () => doNew(), { confirmLabel: 'New Collage' });
  } else {
    doNew();
  }
}

function doNew() {
  store.reset();
  history.reset();
  canvasEditor.fit();
  loadTemplates().then(() => {
    bus.emit('doc');
    bus.emit('selection');
    toast('New collage created. Paste an image to start!', 'ok');
  });
}

async function loadTemplates() {
  try {
    const raw = await window.api.storageRead('templates');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) store.doc.templates = arr;
    }
  } catch (e) { /* ignore */ }
}

/* ---------------- Drag & drop ---------------- */
function initDragDrop() {
  const vp = document.getElementById('viewport');
  const onOver = (e) => { e.preventDefault(); };
  const onDrop = (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name));
    if (files.length) addFiles(files);
    else if (e.dataTransfer.files.length) toast('This image format isn\'t supported.', 'error');
  };
  vp.addEventListener('dragover', onOver);
  vp.addEventListener('drop', onDrop);
  document.addEventListener('dragenter', (e) => e.preventDefault());
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    if (e.target !== vp) e.preventDefault();
  });
  document.addEventListener('paste', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    e.preventDefault();
    pasteFromClipboard();
  });
}

/* ---------------- Layout panel ---------------- */
function initLayoutPanel() {
  const modeSeg = document.getElementById('layout-mode-seg');
  modeSeg.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      modeSeg.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      setLayoutMode(b.dataset.v);
    });
  });
  const styleSeg = document.getElementById('auto-style-seg');
  styleSeg.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      styleSeg.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      history.commit(() => { store.doc.layout.style = b.dataset.v; });
    });
  });
  document.getElementById('btn-auto-layout').addEventListener('click', () => autoArrange());
  document.getElementById('btn-randomize').addEventListener('click', () => randomizeArrangement());
  document.getElementById('btn-apply-spacing').addEventListener('click', () => applySpacing());
  document.getElementById('btn-manage-templates').addEventListener('click', () => saveCustomTemplate());
  document.getElementById('btn-custom-size').addEventListener('click', () => openCustomSizeDialog());
  document.getElementById('align-seg').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => canvasEditor.alignSelection(b.dataset.a));
  });
  document.getElementById('btn-distribute-h').addEventListener('click', () => canvasEditor.distributeSelection('h'));
  document.getElementById('btn-distribute-v').addEventListener('click', () => canvasEditor.distributeSelection('v'));

  const orientSeg = document.getElementById('auto-orient-seg');
  if (orientSeg) {
    const savedOrient = store.doc.layout.orientation || 'auto';
    orientSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === savedOrient));
    orientSeg.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        orientSeg.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        setOrientation(b.dataset.v);
      });
    });
  }
  const fitSeg = document.getElementById('auto-fit-seg');
  if (fitSeg) {
    fitSeg.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        fitSeg.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        applyFit(b.dataset.v);
      });
    });
  }
  refreshLayoutModeUI();
}

function setOrientation(v) {
  const ratio = v === 'landscape' ? 16 / 9 : v === 'portrait' ? 9 / 16 : v === 'square' ? 1 : null;
  history.commit(() => {
    store.doc.layout.orientation = v;
    if (ratio) {
      const W = store.canvasWidth(), H = store.canvasHeight();
      if (Math.abs(W / H - ratio) > 0.02) {
        const area = W * H;
        const nw = Math.max(2, Math.round(Math.sqrt(area * ratio)));
        const nh = Math.max(2, Math.round(nw / ratio));
        store.doc.canvas.width = nw;
        store.doc.canvas.height = nh;
      }
    }
  });
  canvasEditor.fit();
  autoArrange();
}

function applyFit(fit) {
  const ids = targetLayerIds();
  if (!ids.length) {
    toast('Add some images first.', 'error');
    return;
  }
  history.commit(() => {
    ids.forEach((id) => {
      const l = store.getLayer(id);
      if (l) l.objectFit = fit;
    });
  });
  toast(fit === 'contain' ? 'Images fit inside their frames.' : 'Images fill their frames.', 'ok');
}

function setLayoutMode(mode) {
  history.commit(() => { store.doc.layout.mode = mode; });
  canvasEditor.activeZone = null;
  refreshLayoutModeUI();
}

function refreshLayoutModeUI() {
  const mode = store.doc.layout.mode || 'auto';
  const seg = document.getElementById('layout-mode-seg');
  seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === mode));
  document.getElementById('layout-auto-section').classList.toggle('hidden', mode !== 'auto');
  document.getElementById('layout-templates-section').classList.toggle('hidden', mode !== 'templates');
  document.getElementById('layout-custom-section').classList.toggle('hidden', !(mode === 'custom' && !store.doc.zones.length));
  const builderToolbar = document.getElementById('builder-toolbar');
  if (builderToolbar) builderToolbar.classList.toggle('hidden', mode !== 'custom');
  refreshTemplateList();
}

export function targetLayerIds() {
  if (store.selection.length) return store.selection.slice();
  return store.doc.layers.map((l) => l.id);
}

function aspectsFor(ids) {
  return ids.map((i) => {
    const l = store.getLayer(i);
    const a = store.getAsset(l.assetKey);
    if (a && a.natW && a.natH) return a.natW / a.natH;
    return l.w / (l.h || 1);
  });
}

export function autoArrange() {
  const ids = targetLayerIds();
  if (!ids.length) {
    toast('Add some images first.', 'error');
    return;
  }
  if (store.doc.zones.length && !store.selection.length) {
    arrangeIntoZones(ids);
    toast('Images arranged into layout slots.', 'ok');
    return;
  }
  const boxes = layoutBoxes(ids.length, store.doc.layout.style, store.canvasWidth(), store.canvasHeight(), store.doc.spacing.margin, store.doc.spacing.gap, aspectsFor(ids));
  applyLayoutToLayers(ids, boxes);
  toast(`Arranged ${ids.length} images.`, 'ok');
}

export function randomizeArrangement() {
  const ids = targetLayerIds();
  if (!ids.length) {
    toast('Add some images first.', 'error');
    return;
  }
  if (store.doc.zones.length && !store.selection.length) {
    randomizeZones();
    return;
  }
  const boxes = randomBoxes(ids.length, store.canvasWidth(), store.canvasHeight(), store.doc.spacing.margin, store.doc.spacing.gap);
  applyLayoutToLayers(ids, boxes);
  toast('New random layout applied.', 'ok');
}

function applySpacing() {
  const margin = clamp(Number(document.getElementById('sp-margin').value) || 0, 0, 400);
  const gap = clamp(Number(document.getElementById('sp-gap').value) || 0, 0, 400);
  history.commit(() => {
    store.doc.spacing.margin = margin;
    store.doc.spacing.gap = gap;
  });
  if (store.doc.zones.length) {
    reflowZones();
    return;
  }
  if (store.doc.layout.mode === 'auto') {
    autoArrange();
  }
  toast('Spacing updated.', 'ok');
}

/* ---------------- Templates ---------------- */
function buildTemplateThumb(t, container) {
  const cv = document.createElement('canvas');
  cv.width = 96; cv.height = 96;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1b1f27';
  ctx.fillRect(0, 0, 96, 96);
  const s = t.slots.map((r) => [r[0] / 100, r[1] / 100, r[2] / 100, r[3] / 100]);
  const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#ef4444', '#10b981', '#ec4899', '#6366f1', '#14b8a6'];
  s.forEach((r, i) => {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(r[0] * 96, r[1] * 96, r[2] * 96, r[3] * 96);
  });
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.lineWidth = 1;
  s.forEach((r) => ctx.strokeRect(r[0] * 96, r[1] * 96, r[2] * 96, r[3] * 96));
  container.appendChild(cv);
}

function refreshTemplateList() {
  const list = document.getElementById('template-list');
  if (!list) return;
  list.innerHTML = '';
  const builtIn = [...TEMPLATE_CATALOG];
  builtIn.forEach((t) => list.appendChild(templateItem(t)));
  if (store.doc.templates.length) {
    const label = el('div', 'tpl-name');
    label.textContent = '— My Templates —';
    label.style.gridColumn = '1 / span 2';
    label.style.color = 'var(--accent-2)';
    label.style.fontSize = '10px';
    list.appendChild(label);
    store.doc.templates.forEach((t) => list.appendChild(templateItem(t)));
  }
}

function templateItem(t) {
  const item = el('div', 'tpl-item');
  const thumb = el('div', 'tpl-thumb');
  buildTemplateThumb(t, thumb);
  const name = el('div', 'tpl-name', t.name);
  item.append(thumb, name);
  item.title = 'Apply "' + t.name + '"';
  item.addEventListener('click', () => applyTemplate(t.id));
  return item;
}

function applyTemplate(templateId) {
  const all = [...TEMPLATE_CATALOG, ...store.doc.templates.map((t) => ({ id: t.id, slots: t.slots }))];
  const t = all.find((x) => x.id === templateId);
  if (!t) return;
  const boxes = templateSlots(templateId, store.canvasWidth(), store.canvasHeight(), store.doc.spacing.margin, store.doc.spacing.gap);
  const ids = targetLayerIds();
  if (ids.length) {
    applyLayoutToLayers(ids, boxes);
    toast(`Applied "${t.name}" to ${ids.length} images.`, 'ok');
  } else {
    convertSlotsToZones(boxes);
    refreshBuilderToolbar();
    toast(`Created "${t.name}" template with ${boxes.length} empty slots.`, 'ok');
  }
}

function saveCustomTemplate() {
  if (!store.doc.zones.length) {
    toast('Create some zones first (use Custom mode → Add Slot).', 'error');
    return;
  }
  promptModal('Save Layout as Template', 'Template name:', '', (v) => {
    if (!v) return;
    const t = saveCurrentAsTemplate(v);
    if (t) {
      toast(`Saved "${t.name}" under My Templates.`, 'ok');
      refreshTemplateList();
    }
  });
}

/* ---------------- Canvas size ---------------- */
function initCanvasPresets() {
  const wrap = document.getElementById('canvas-presets');
  wrap.innerHTML = '';
  CANVAS_PRESETS.forEach((p) => {
    const b = el('button', 'preset-btn', p.name);
    b.addEventListener('click', () => {
      history.commit(() => {
        store.doc.canvas.width = p.w;
        store.doc.canvas.height = p.h;
      });
      canvasEditor.fit();
      toast(`Canvas set to ${p.w} × ${p.h}.`, 'ok');
    });
    wrap.appendChild(b);
  });
}

function openCustomSizeDialog() {
  const body = el('div', 'modal-body');
  const row = el('div', 'modal-row');
  const colW = el('div', 'modal-col');
  const colH = el('div', 'modal-col');
  colW.appendChild(el('label', 'hint', 'Width (px)'));
  const wInput = el('input', 'grow-input');
  wInput.type = 'number';
  wInput.min = 1;
  wInput.max = 8000;
  wInput.value = store.canvasWidth();
  colW.appendChild(wInput);
  colH.appendChild(el('label', 'hint', 'Height (px)'));
  const hInput = el('input', 'grow-input');
  hInput.type = 'number';
  hInput.min = 1;
  hInput.max = 8000;
  hInput.value = store.canvasHeight();
  colH.appendChild(hInput);
  row.append(colW, colH);
  body.appendChild(row);
  const orient = el('div', 'seg');
  orient.style.marginTop = '12px';
  [
    ['Square', '1:1'], ['Portrait', '9:16'], ['Landscape', '16:9'],
  ].forEach(([label, ratio]) => {
    const b = el('button', '', label);
    b.addEventListener('click', () => {
      orient.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const [a, bb] = ratio.split(':').map(Number);
      const w = store.canvasWidth(), h = store.canvasHeight();
      if (w / h > a / bb) hInput.value = Math.round(w * bb / a);
      else wInput.value = Math.round(h * a / bb);
    });
    orient.appendChild(b);
  });
  body.appendChild(orient);
  const foot = modalButtons([
    { label: 'Cancel' },
    {
      label: 'Apply', primary: true, onClick: () => {
        const w = clamp(Math.round(Number(wInput.value) || 1), 1, 8000);
        const h = clamp(Math.round(Number(hInput.value) || 1), 1, 8000);
        closeModal();
        history.commit(() => {
          store.doc.canvas.width = w;
          store.doc.canvas.height = h;
        });
        canvasEditor.fit();
        toast(`Canvas set to ${w} × ${h}.`, 'ok');
      },
    },
  ]);
  openModal({ title: 'Custom Canvas Size', body, footer: foot, width: '380px' });
}

/* ---------------- Builder toolbar ---------------- */
function initBuilderToolbar() {
  builderToolbar = el('div', 'builder-toolbar hidden');
  builderToolbar.id = 'builder-toolbar';
  const label = el('span', 'hint', 'Layout Builder');
  const addSlot = el('button', 'primary', '+ Add Slot');
  const arrange = el('button', '', 'Arrange in Slots');
  const rnd = el('button', '', 'Randomize Slots');
  const saveTpl = el('button', '', 'Save as Template');
  const clearSlots = el('button', '', 'Clear Slots');
  addSlot.addEventListener('click', () => createZone());
  arrange.addEventListener('click', () => {
    const ids = targetLayerIds();
    if (ids.length) {
      arrangeIntoZones(ids);
      toast('Images placed into slots.', 'ok');
    } else toast('Add some images first.', 'error');
  });
  rnd.addEventListener('click', () => randomizeZones());
  saveTpl.addEventListener('click', () => saveCustomTemplate());
  clearSlots.addEventListener('click', () => {
    confirmModal('Remove all layout slots?', () => {
      history.commit(() => {
        store.doc.zones = [];
        store.doc.layers.forEach((l) => { l.slotId = null; });
        canvasEditor.activeZone = null;
      });
      refreshBuilderToolbar();
    }, { confirmLabel: 'Remove' });
  });
  builderToolbar.append(label, addSlot, arrange, rnd, saveTpl, clearSlots);
  document.getElementById('viewport').appendChild(builderToolbar);
}

function refreshBuilderToolbar() {
  if (builderToolbar) {
    builderToolbar.classList.toggle('hidden', store.doc.layout.mode !== 'custom');
  }
}

/* ---------------- Background ---------------- */
function initBackgroundUI() {
  const seg = document.getElementById('bg-type-seg');
  seg.innerHTML = '';
  [
    ['color', 'Solid'], ['linear', 'Linear'], ['radial', 'Radial'], ['transparent', 'None'],
  ].forEach(([type, label]) => {
    const b = el('button', '', label);
    b.dataset.type = type;
    b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      pendingBg = {
        type,
        color: '#ffffff',
        colors: pendingBg && pendingBg.colors && pendingBg.colors.length ? pendingBg.colors : cloneBg(store.doc.canvas.background).colors || [{ c: '#ffffff', t: 0 }, { c: '#4f8cff', t: 1 }],
        angle: pendingBg ? pendingBg.angle : 90,
      };
      renderBgControls();
    });
    seg.appendChild(b);
  });
  seg.querySelector('[data-type="color"]').classList.add('active');
  pendingBg = cloneBg(store.doc.canvas.background);
  renderBgControls();
  document.getElementById('btn-apply-bg').addEventListener('click', () => {
    history.commit(() => {
      store.doc.canvas.background = JSON.parse(JSON.stringify(pendingBg));
    });
    toast('Background updated.', 'ok');
  });
}

function cloneBg(bg) {
  if (bg.type === 'transparent') return { type: 'transparent' };
  if (bg.type === 'linear' || bg.type === 'radial') {
    return {
      type: bg.type,
      angle: bg.angle || 90,
      colors: (bg.colors || [{ c: '#ffffff', t: 0 }, { c: '#4f8cff', t: 1 }]).map((s) => ({ ...s })),
    };
  }
  return { type: 'color', color: bg.color || '#ffffff' };
}

function renderBgControls() {
  const colorsWrap = document.getElementById('bg-colors');
  const angleRow = document.getElementById('bg-angle-row');
  colorsWrap.innerHTML = '';
  angleRow.classList.toggle('hidden', pendingBg.type !== 'linear');
  if (pendingBg.type === 'transparent') {
    applyLiveBg();
    return;
  }
  if (pendingBg.type === 'color') {
    const row = el('div', 'swatches');
    ['#ffffff', '#000000', '#f5f5f5', '#e74c3c', '#2ecc71', '#3498db', '#9b59b6', '#f1c40f'].forEach((c) => {
      const sw = el('div', 'swatch' + (pendingBg.color === c ? ' active' : ''));
      sw.style.background = c;
      sw.style.borderColor = c;
      sw.addEventListener('click', () => {
        pendingBg.color = c;
        renderBgControls();
      });
      row.appendChild(sw);
    });
    const custom = el('input', null);
    custom.type = 'color';
    custom.value = pendingBg.color;
    custom.title = 'Custom color';
    custom.style.margin = '8px 0 0';
    custom.addEventListener('input', () => {
      pendingBg.color = custom.value;
      applyLiveBg();
    });
    colorsWrap.append(row, custom);
    applyLiveBg();
    return;
  }
  const colorRows = el('div', 'color-tokens');
  pendingBg.colors.forEach((s, i) => {
    const r = el('div', 'color-row');
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = s.c;
    picker.addEventListener('input', () => { s.c = picker.value; r.style.background = ''; applyLiveBg(); });
    const stop = document.createElement('input');
    stop.type = 'range';
    stop.min = 0; stop.max = 100; stop.value = Math.round(s.t * 100);
    stop.style.flex = '1';
    stop.addEventListener('input', () => { s.t = Number(stop.value) / 100; applyLiveBg(); });
    const remove = el('button', 'trash', '✕');
    remove.addEventListener('click', () => {
      if (pendingBg.colors.length <= 2) return;
      pendingBg.colors.splice(i, 1);
      renderBgControls();
    });
    r.append(el('span', 'grab', '▦'), picker, stop, remove);
    colorRows.appendChild(r);
  });
  const addBtn = el('button', 'wbtn', '+ Add Color');
  addBtn.style.marginTop = '8px';
  addBtn.addEventListener('click', () => {
    const t = 1;
    pendingBg.colors.push({ c: '#ffffff', t });
    renderBgControls();
  });
  const angle = document.getElementById('bg-angle');
  angle.value = pendingBg.angle || 90;
  angle.addEventListener('input', () => { pendingBg.angle = Number(angle.value) || 90; applyLiveBg(); });
  colorsWrap.append(colorRows, addBtn);
  applyLiveBg();
}

function applyLiveBg() {
  const node = canvasEditor.roots.canvas;
  if (pendingBg && node) node.style.background = bgStyle(pendingBg);
}

/* ---------------- Zoom & layers buttons ---------------- */
function initZoomControls() {
  document.getElementById('zoom-in').addEventListener('click', () => canvasEditor.setZoom(store.view.zoom * 1.2));
  document.getElementById('zoom-out').addEventListener('click', () => canvasEditor.setZoom(store.view.zoom / 1.2));
  document.getElementById('zoom-fit').addEventListener('click', () => canvasEditor.fit());
  document.getElementById('zoom-100').addEventListener('click', () => canvasEditor.setZoom(1));
}

function initLayersButtons() {
  document.getElementById('btn-bring-front').addEventListener('click', () => layersPanelMove('front'));
  document.getElementById('btn-bring-forward').addEventListener('click', () => layersPanelMove('forward'));
  document.getElementById('btn-send-backward').addEventListener('click', () => layersPanelMove('backward'));
  document.getElementById('btn-send-back').addEventListener('click', () => layersPanelMove('back'));
  document.getElementById('btn-lock-toggle').addEventListener('click', () => layersPanelToggleLock());
  document.getElementById('btn-delete-layer').addEventListener('click', () => canvasEditor.deleteSelection());
}