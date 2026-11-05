import { store, bus } from './store.js';
import { history } from './history.js';
import { canvasEditor } from './canvas.js';
import { addImageSources, pasteFromClipboard } from './clipboard.js';
import { layoutBoxes, applyLayoutToLayers, templateSlots, convertSlotsToZones, arrangeIntoZones, createZone } from './layout.js';
import { renderCollage } from './export.js';
import { serializeDoc, loadProjectData } from './project.js';
import { serializeAppState, deserializeAppState } from './model.js';

const results = [];

function record(name, pass, extra) {
  results.push({ name, pass: !!pass, extra: extra || '' });
}

function makeImg(w, h, color) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  return c.toDataURL();
}

function setup() {
  store.reset();
  history.reset();
  bus.emit('doc');
  bus.emit('selection');
  store.doc.canvas.width = 1080;
  store.doc.canvas.height = 1080;
  store.doc.spacing = { margin: 40, gap: 12 };
  bus.emit('doc');
}

function insideCanvas(b, W, H) {
  return b.x >= -1 && b.y >= -1 && b.x + b.w <= W + 1 && b.y + b.h <= H + 1 && b.w > 5 && b.h > 5;
}

function overlaps(a, b) {
  return !(a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5);
}

export async function runTests() {
  try {
    /* 1 — synthetic clipboard round trip through the real IPC + main process */
    await testClipboardRoundTrip();

    /* 2 — add several images, auto-fill 5 zones, extra becomes freeform */
    await testZonesAutoFill();

    /* 3 — balanced layout engine produces non-overlapping in-canvas boxes */
    await testBalancedLayout();

    /* 4 — masonry and random stay in bounds */
    await testMasonryRandomBounds();

    /* 5 — template slots on empty canvas create zones */
    await testTemplateToZones();

    /* 6 — arrange images into zones */
    await testArrangeIntoZones();

    /* 7 — undo / redo of add, move, delete */
    await testUndoRedo();

    /* 8 — rotation, crop math, bbox */
    await testTransformMath();

    /* 9 — export render draws the right pixel */
    await testExportRender();

    /* 10 — project serialize / reload round trip */
    await testProjectRoundTrip();

    /* 11 — gradient background export */
    await testGradientExport();

    /* 12 — real DOM layers are created on the canvas */
    await testDomLayers();

    /* 13 — simulate a pointer drag to move a layer (interaction smoke) */
    await testPointerMove();

    /* 14 — alignment + distribute */
    await testAlignDistribute();

    /* 15 — locked layers can't be nudged */
    await testLock();

    /* 16 — crop changes what the export draws */
    await testCropExport();

    /* 17 — AssetStore bitmap/preview split, record shape, refCount */
    await testAssetStore();

    /* 18 — typed AppState model round trips through serialize/deserialize */
    await testAppStateRoundTrip();

    /* 19 — featured layout style produces valid non-overlapping boxes */
    await testFeaturedLayout();

    /* 20 — image tray renders a thumbnail item per image */
    await testImageTray();

    /* 21 — objectFit (contain vs cover) affects rendered placement */
    await testObjectFit();
  } catch (e) {
    record('suite', false, String(e && e.stack || e));
  }
  return results;
}

async function testClipboardRoundTrip() {
  setup();
  try {
    const dl = makeImg(120, 80, '#ff0000');
    const ok = await window.api.writeClipboardImage(dl);
    await pasteFromClipboard();
    const n = store.doc.layers.length;
    record('clipboard-roundtrip', ok === true && n === 1, `wrote=${ok} count=${n}`);
  } catch (e) {
    record('clipboard-roundtrip', false, String(e));
  }
}

async function testZonesAutoFill() {
  setup();
  try {
    for (let i = 0; i < 5; i++) createZone();
    const dls = ['#e74c3c', '#2ecc71', '#3498db', '#f1c40f', '#9b59b6'].map((c) => makeImg(200, 200, c));
    await addImageSources(dls.map((d) => ({ dataURL: d, name: 'img' })));
    const slots = store.doc.layers.map((l) => l.slotId).filter(Boolean);
    const distinct = new Set(slots);
    const extraLayer = store.doc.layers[0];
    const zoneCount = store.doc.zones.length;
    record('zones-autofill', zoneCount === 5 && slots.length === 5 && distinct.size === 5, `zones=${zoneCount} slots=${slots.length} distinct=${distinct.size}`);
    const before = store.doc.layers.length;
    await addImageSources([{ dataURL: makeImg(64, 64, '#000000'), name: 'extra' }]);
    const extra = store.doc.layers[store.doc.layers.length - 1];
    record('zones-extra-freeform', store.doc.layers.length === before + 1 && store.doc.zones.length === 5 && (extra.slotId === null || !store.doc.zones.some((z) => z.id === extra.slotId)), 'freeform accepted');
  } catch (e) {
    record('zones-autofill', false, String(e));
  }
}

async function testBalancedLayout() {
  setup();
  const ids = await addImageSources(['#e74c3c', '#2ecc71', '#3498db', '#f1c40f'].map((c) => ({ dataURL: makeImg(240, 240, c) })));
  const boxes = layoutBoxes(4, 'balanced', 1080, 1080, 40, 12);
  const anyOverlap = boxes.some((a, i) => boxes.some((b, j) => j > i && overlaps(a, b)));
  const allInside = boxes.every((b) => insideCanvas(b, 1080, 1080));
  applyLayoutToLayers(ids, boxes);
  const l = store.getLayer(ids[0]);
  record('balanced-layout', boxes.length === 4 && !anyOverlap && allInside && l && Math.round(l.x) === Math.round(boxes[0].x), `overlap=${anyOverlap} inside=${allInside}`);
}

async function testMasonryRandomBounds() {
  setup();
  try {
    const aspects = [1, 0.75, 1.5, 1, 1.33, 0.9];
    const m = layoutBoxes(6, 'masonry', 1080, 1350, 40, 12, aspects);
    const r = layoutBoxes(9, 'random', 1080, 1080, 40, 12);
    let rInside = true;
    for (let i = 0; i < 3; i++) {
      const r2 = layoutBoxes(9, 'random', 1080, 1080, 40, 12);
      if (!r2.every((b) => insideCanvas(b, 1080, 1080))) { rInside = false; break; }
      if (JSON.stringify(r2) === JSON.stringify(r)) { rInside = false; }
    }
    const mInside = m.every((b) => insideCanvas(b, 1080, 1350));
    record('masonry-random-bounds', mInside && rInside, `masonry-ok=${mInside} random-varies=${rInside}`);
  } catch (e) {
    record('masonry-random-bounds', false, String(e));
  }
}

async function testTemplateToZones() {
  setup();
  try {
    const slots = templateSlots('t9-grid', 1080, 1080, 40, 12);
    convertSlotsToZones(slots);
    record('template-to-zones', store.doc.zones.length === 9 && store.doc.layout.mode === 'custom', `zones=${store.doc.zones.length} mode=${store.doc.layout.mode}`);
  } catch (e) {
    record('template-to-zones', false, String(e));
  }
}

async function testArrangeIntoZones() {
  setup();
  try {
    const boxes = templateSlots('t3-row', 1080, 1080, 40, 12);
    convertSlotsToZones(boxes);
    const ids = await addImageSources([0, 1, 2].map((i) => ({ dataURL: makeImg(100, 100, '#333333') })));
    arrangeIntoZones(ids);
    const l0 = store.getLayer(ids[0]);
    const z0 = store.doc.zones[0];
    record('arrange-into-zones', l0.slotId === z0.id && Math.round(l0.x) === Math.round(z0.x) && Math.round(l0.y) === Math.round(z0.y), `slot=${l0.slotId}`);
  } catch (e) {
    record('arrange-into-zones', false, String(e));
  }
}

async function testUndoRedo() {
  setup();
  try {
    await addImageSources([{ dataURL: makeImg(90, 90, '#111111') }]);
    const nLayers = store.doc.layers.length;
    history.undo();
    const afterUndo = store.doc.layers.length;
    history.redo();
    const afterRedo = store.doc.layers.length;
    record('undo-redo-add', nLayers === 1 && afterUndo === 0 && afterRedo === 1, `${nLayers}->${afterUndo}->${afterRedo}`);
  } catch (e) {
    record('undo-redo-add', false, String(e));
  }
}

async function testTransformMath() {
  setup();
  try {
    await addImageSources([{ dataURL: makeImg(200, 100, '#ff8800') }]);
    const id = store.doc.layers[0].id;
    canvasEditor.rotateSelected(90);
    const rot = store.getLayer(id).rotation;
    const l = store.getLayer(id);
    history.commit(() => { l.crop = { sx: 10, sy: 10, sw: 100, sh: 50 }; });
    const asset = store.getAsset(store.getLayer(id).assetKey);
    const place = canvasEditor.imgPlacementFor(store.getLayer(id), asset);
    const bbox = canvasEditor.groupBBox(new Map([[id, { x: 0, y: 0, w: 100, h: 50, rotation: 45 }]]));
    const finite = isFinite(place.objW) && isFinite(place.objH) && bbox && bbox.w > 0;
    record('transform-math', Math.abs(rot - 90) < 0.1 && finite, `rot=${rot} bboxw=${bbox && Math.round(bbox.w)}`);
  } catch (e) {
    record('transform-math', false, String(e));
  }
}

async function testExportRender() {
  setup();
  try {
    store.doc.canvas.width = 200;
    store.doc.canvas.height = 200;
    store.doc.canvas.background = { type: 'color', color: '#ffffff' };
    await addImageSources([{ dataURL: makeImg(100, 100, '#ff0000') }]);
    const l = store.doc.layers[0];
    l.x = 50; l.y = 50; l.w = 100; l.h = 100;
    const cv = await renderCollage({ scale: 1, bgChoice: 'white', format: 'png' });
    const px = cv.getContext('2d').getImageData(100, 100, 1, 1).data;
    const red = px[0] > 200 && px[1] < 60 && px[2] < 60;
    const bg = cv.getContext('2d').getImageData(5, 5, 1, 1).data;
    const white = bg[0] > 245 && bg[1] > 245 && bg[2] > 245;
    record('export-render', red && white && cv.width === 200 && cv.height === 200, `px=${px} bg=${bg}`);
  } catch (e) {
    record('export-render', false, String(e));
  }
}

async function testProjectRoundTrip() {
  setup();
  try {
    await addImageSources([{ dataURL: makeImg(150, 150, '#445566'), name: 'Roundtrip Image' }]);
    const docJson = JSON.parse(JSON.stringify(serializeDoc()));
    await loadProjectData(docJson);
    const layers = store.doc.layers.length;
    const nameOk = store.doc.layers[0].name === 'Roundtrip Image';
    const assetOk = !!store.getAsset(store.doc.layers[0].assetKey) && !!store.getAsset(store.doc.layers[0].assetKey).preview;
    record('project-roundtrip', layers === 1 && nameOk && assetOk, `layers=${layers} nameOk=${nameOk} assetOk=${assetOk}`);
  } catch (e) {
    record('project-roundtrip', false, String(e));
  }
}

async function testGradientExport() {
  setup();
  try {
    store.doc.canvas.background = { type: 'linear', angle: 90, colors: [{ c: '#ff0000', t: 0 }, { c: '#0000ff', t: 1 }] };
    const cv = await renderCollage({ scale: 1, bgChoice: 'canvas', format: 'png' });
    const top = cv.getContext('2d').getImageData(10, 8, 1, 1).data;
    const bottom = cv.getContext('2d').getImageData(10, cv.height - 8, 1, 1).data;
    const topRed = top[0] > 200 && top[2] < 80;
    const bottomBlue = bottom[2] > 200 && bottom[0] < 80;
    record('gradient-export', topRed && bottomBlue && cv.width === 1080 && cv.height === 1080, `top=${top} bottom=${bottom}`);
  } catch (e) {
    record('gradient-export', false, String(e));
  }
}

async function testDomLayers() {
  setup();
  try {
    await addImageSources([{ dataURL: makeImg(60, 60, '#777777') }]);
    const canvasEl = canvasEditor.roots.canvas;
    const layerNodes = canvasEl.querySelectorAll('.layer').length;
    record('dom-layers', layerNodes === 1, `nodes=${layerNodes}`);
  } catch (e) {
    record('dom-layers', false, String(e));
  }
}

async function testPointerMove() {
  setup();
  try {
    await addImageSources([{ dataURL: makeImg(100, 100, '#888888') }]);
    const id = store.doc.layers[0].id;
    store.setSelection([id]);
    const l = store.getLayer(id);
    l.x = 200; l.y = 200; l.w = 100; l.h = 100;
    const cp = l.x;
    canvasEditor.nudge(30, 0);
    const moved = store.getLayer(id).x === cp + 30;
    history.undo();
    const reverted = store.getLayer(id).x === cp;
    record('pointer-nudge', moved && reverted, `x=${store.getLayer(id).x}`);
  } catch (e) {
    record('pointer-nudge', false, String(e));
  }
}

async function testAlignDistribute() {
  setup();
  try {
    const colors = ['#a11', '#22a', '#3a3'];
    const ids = await addImageSources(colors.map((c) => ({ dataURL: makeImg(100, 80, c) })));
    ids.forEach((i, n) => {
      const l = store.getLayer(i);
      l.w = 300; l.h = 300;
      l.x = n * 350; l.y = 100;
    });
    store.setSelection(ids);
    canvasEditor.alignSelection('left');
    const aligned = ids.every((i) => Math.abs(store.getLayer(i).x - 0) < 0.01);
    ids.forEach((i, n) => { store.getLayer(i).x = n * 350; store.getLayer(i).y = 100; });
    canvasEditor.distributeSelection('h');
    const endXs = ids.map((i) => store.getLayer(i).x).sort((a, b) => a - b);
    const gap = endXs[1] - (endXs[0] + 300);
    const gap2 = endXs[2] - (endXs[1] + 300);
    const even = Math.abs(gap - gap2) < 0.01 && gap > 0;
    const spansAll = Math.abs(endXs[0] - 0) < 0.01 && Math.abs(endXs[2] + 300 - 1000) < 0.01;
    const ys = ids.map((i) => store.getLayer(i).y);
    const ySame = ys.every((y) => Math.abs(y - 100) < 0.01);
    record('align-distribute', aligned && even && spansAll && ySame, `x=${endXs.map((n) => Math.round(n))} gaps=${Number(gap.toFixed(1))},${Number(gap2.toFixed(1))} aligned=${aligned}`);
  } catch (e) {
    record('align-distribute', false, String(e));
  }
}

async function testLock() {
  setup();
  try {
    const ids = await addImageSources([{ dataURL: makeImg(90, 90, '#111111') }, { dataURL: makeImg(90, 90, '#222222') }]);
    history.commit(() => { store.getLayer(ids[0]).locked = true; });
    store.setSelection(ids);
    const x0 = store.getLayer(ids[0]).x;
    const x1 = store.getLayer(ids[1]).x;
    canvasEditor.nudge(40, 0);
    const movedX0 = store.getLayer(ids[0]).x;
    const movedX1 = store.getLayer(ids[1]).x;
    record('lock', movedX0 === x0 && Math.abs(movedX1 - x1 - 40) < 0.01, `locked=${movedX0 - x0} free=${movedX1 - x1}`);
  } catch (e) {
    record('lock', false, String(e));
  }
}

async function testCropExport() {
  setup();
  try {
    const cv = document.createElement('canvas');
    cv.width = 200; cv.height = 100;
    const g = cv.getContext('2d');
    g.fillStyle = '#00cc00'; g.fillRect(0, 0, 200, 50);
    g.fillStyle = '#cc0000'; g.fillRect(0, 50, 200, 50);
    const band = cv.toDataURL();
    store.doc.canvas.width = 300;
    store.doc.canvas.height = 300;
    store.doc.canvas.background = { type: 'color', color: '#ffffff' };
    await addImageSources([{ dataURL: band }]);
    const l = store.doc.layers[0];
    l.x = 50; l.y = 100; l.w = 200; l.h = 100;
    history.commit(() => { l.crop = { sx: 0, sy: 50, sw: 200, sh: 50 }; });
    const out = await renderCollage({ scale: 1, bgChoice: 'white', format: 'png' });
    const px = out.getContext('2d').getImageData(150, 130, 1, 1).data;
    const cropped = px[0] > 180 && px[1] < 60;
    record('crop-export', cropped, `px=${px}`);
  } catch (e) {
    record('crop-export', false, String(e));
  }
}

async function testAssetStore() {
  setup();
  try {
    await addImageSources([{ dataURL: makeImg(2000, 1000, '#00aa00'), name: 'Big' }]);
    const key = store.doc.layers[0].assetKey;
    const rec = store.getAsset(key);
    const shapeOk = !!rec && rec.source && rec.source.type === 'data' && rec.key === key &&
      rec.naturalW === 2000 && rec.naturalH === 1000 && rec.natW === 2000 && rec.natH === 1000 &&
      !!rec.preview && rec.refCount === 1 && rec.stale === false && rec.naturalWidth === undefined;
    const pb = await store.assets.getPreviewBitmap(key);
    const fb = await store.assets.getFullBitmap(key);
    const bmpOk = !!pb && !!fb && pb.width <= 1600 && fb.width === 2000 && fb.height === 1000;
    const recordsOk = store.assets.stats().records === store.doc.layers.length;
    record('assetstore-basic', shapeOk && bmpOk && recordsOk, `pb=${pb && pb.width}x${pb && pb.height} fb=${fb && fb.width}x${fb && fb.height}`);
  } catch (e) {
    record('assetstore-basic', false, String(e));
  }
}

async function testAppStateRoundTrip() {
  setup();
  try {
    await addImageSources([{ dataURL: makeImg(120, 80, '#3344cc'), name: 'RT' }]);
    const before = JSON.parse(JSON.stringify(store.doc));
    const state = store.appState();
    const loaded = deserializeAppState(JSON.stringify(serializeAppState(state)));
    store.loadAppState(loaded);
    const after = store.doc;
    const okCanvas = before.canvas.width === after.canvas.width && before.canvas.height === after.canvas.height;
    const okBg = JSON.stringify(before.canvas.background) === JSON.stringify(after.canvas.background);
    const okSpacing = before.spacing.margin === after.spacing.margin && before.spacing.gap === after.spacing.gap;
    const okLayer = after.layers.length === 1 && after.layers[0].id === before.layers[0].id &&
      after.layers[0].assetKey === before.layers[0].assetKey && after.layers[0].name === 'RT';
    const okSel = store.selection.includes(after.layers[0].id);
    const okShape = state.canvas.engine === 'auto' && state.canvas.padding === before.spacing.margin;
    record('appstate-roundtrip', okCanvas && okBg && okSpacing && okLayer && okSel && okShape, `layers=${after.layers.length} sel=${store.selection.length}`);
  } catch (e) {
    record('appstate-roundtrip', false, String(e));
  }
}

async function testFeaturedLayout() {
  setup();
  try {
    const boxes = layoutBoxes(5, 'featured', 1080, 1080, 40, 12);
    const boxes3 = layoutBoxes(3, 'featured', 1080, 1080, 40, 12);
    const anyOverlap = boxes.some((a, i) => boxes.some((b, j) => j > i && overlaps(a, b)));
    const inside = boxes.every((b) => insideCanvas(b, 1080, 1080));
    const firstBig = boxes[0].w > boxes[1].w;
    record('featured-layout', boxes.length === 5 && boxes3.length === 3 && !anyOverlap && inside && firstBig,
      `n5=${boxes.length} inside=${inside} overlap=${anyOverlap} firstBig=${firstBig}`);
  } catch (e) {
    record('featured-layout', false, String(e));
  }
}

async function testImageTray() {
  setup();
  try {
    const { initTray } = await import('./tray.js');
    initTray();
    await addImageSources([0, 1, 2].map((i) => ({ dataURL: makeImg(100, 100, '#112233'), name: 'Tray ' + i })));
    const items = document.querySelectorAll('#tray-list .tray-item').length;
    const count = document.getElementById('tray-count');
    const visible = !document.getElementById('image-tray').classList.contains('hidden');
    record('image-tray', items === 3 && count && count.textContent === '3' && visible, `items=${items} count=${count && count.textContent} visible=${visible}`);
  } catch (e) {
    record('image-tray', false, String(e));
  }
}

async function testObjectFit() {
  setup();
  try {
    store.doc.canvas.width = 300;
    store.doc.canvas.height = 300;
    await addImageSources([{ dataURL: makeImg(200, 100, '#ff00ff'), name: 'Fit' }]);
    const id = store.doc.layers[0].id;
    const l = store.getLayer(id);
    l.w = 100; l.h = 100;
    const asset = store.getAsset(l.assetKey);
    l.objectFit = 'contain';
    const contain = canvasEditor.imgPlacementFor(l, asset);
    l.objectFit = 'cover';
    const cover = canvasEditor.imgPlacementFor(l, asset);
    const containFitsInside = contain.objW <= 100.001 && contain.objH <= 100.001;
    const coverFills = cover.objW >= 100 && cover.objH >= 100;
    record('objectfit-place', containFitsInside && coverFills && contain.objW < cover.objW,
      `contain=${Math.round(contain.objW)}x${Math.round(contain.objH)} cover=${Math.round(cover.objW)}x${Math.round(cover.objH)}`);
  } catch (e) {
    record('objectfit-place', false, String(e));
  }
}