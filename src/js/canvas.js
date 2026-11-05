import { store, bus } from './store.js';
import { history } from './history.js';
import { uid, clamp, degToRad, radToDeg, TOLERANCE, bboxOfLayer, compoundBBox, el } from './util.js';

const MAX_ZOOM = 6;
const MIN_ZOOM = 0.05;

function normalizeRot(r) {
  let v = r % 360;
  if (v < 0) v += 360;
  return Math.round(v * 10) / 10;
}

function eventInInput() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

class Canvas {
  constructor() {
    this.roots = null;
    this.layerEls = new Map();
    this.zoneEls = new Map();
    this.cropping = false;
    this.dragging = null;
    this.activeZone = null;
  }

  init() {
    this.roots = {
      viewport: document.getElementById('viewport'),
      world: document.getElementById('world'),
      canvasWrap: document.getElementById('canvas-wrap'),
      canvas: document.getElementById('canvas'),
      guides: document.getElementById('guides'),
      marquee: document.getElementById('marquee'),
      empty: document.getElementById('empty-state'),
      zoomLabel: document.getElementById('zoom-label'),
      statusZoom: document.getElementById('status-zoom-val'),
      statusCanvas: document.getElementById('status-canvas-val'),
      statusCount: document.getElementById('status-count-val'),
    };
    this.viewport = this.roots.viewport;
    this.world = this.roots.world;

    const ac = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f8cff';
    this.handles = {
      wrap: el('div'),
      bbox: el('div'),
      nw: this.makeHandle('nw', ac),
      ne: this.makeHandle('ne', ac),
      sw: this.makeHandle('sw', ac),
      se: this.makeHandle('se', ac),
      rotate: el('div', 'rotate-handle', '↻'),
    };
    this.handles.rotate.style.pointerEvents = 'auto';
    this.handles.wrap.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:60;';
    this.handles.bbox.style.cssText = 'position:absolute;border:1px solid ' + ac + ';display:none;';
    [this.handles.bbox, this.handles.nw, this.handles.ne, this.handles.sw, this.handles.se, this.handles.rotate].forEach((h) => this.handles.wrap.appendChild(h));
    this.roots.canvas.appendChild(this.handles.wrap);

    bus.on('doc', () => this.refresh());
    bus.on('selection', () => this.updateSelectionUI());
    bus.on('zoom', () => this.syncView());

    this.bindEvents();
    this.refresh();
    requestAnimationFrame(() => this.fit());
  }

  makeHandle(cls) {
    const h = document.createElement('div');
    h.className = 'handle ' + cls;
    h.setAttribute('data-handle', cls);
    h.style.pointerEvents = 'auto';
    return h;
  }

  /* ---------------- Camera ---------------- */
  screenToModel(cx, cy) {
    const v = store.view;
    return { x: (cx - v.tx) / v.zoom, y: (cy - v.ty) / v.zoom };
  }

  syncView() {
    const v = store.view;
    this.world.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.zoom})`;
    this.roots.zoomLabel.textContent = Math.round(v.zoom * 100) + '%';
    this.roots.statusZoom.textContent = Math.round(v.zoom * 100) + '%';
  }

  setZoom(z, cx, cy) {
    const v = store.view;
    z = clamp(z, MIN_ZOOM, MAX_ZOOM);
    if (cx === undefined) {
      cx = this.viewport.clientWidth / 2;
      cy = this.viewport.clientHeight / 2;
    }
    const m = this.screenToModel(cx, cy);
    v.zoom = z;
    v.tx = cx - m.x * z;
    v.ty = cy - m.y * z;
    bus.emit('zoom');
  }

  zoomAt(cx, cy, factor) {
    this.setZoom(store.view.zoom * factor, cx, cy);
  }

  fit() {
    const v = store.view;
    const pad = 70;
    const W = store.canvasWidth(), H = store.canvasHeight();
    const zoom = clamp(Math.min((this.viewport.clientWidth - pad) / W, (this.viewport.clientHeight - pad) / H), MIN_ZOOM, 1.5);
    v.zoom = zoom;
    v.tx = (this.viewport.clientWidth - W * zoom) / 2;
    v.ty = (this.viewport.clientHeight - H * zoom) / 2;
    bus.emit('zoom');
  }

  updateStatusOthers() {
    this.roots.statusCount.textContent = store.doc.layers.length;
    this.roots.statusCanvas.textContent = `${store.canvasWidth()} × ${store.canvasHeight()}`;
  }

  /* ---------------- Render ---------------- */
  refresh() {
    const W = store.canvasWidth(), H = store.canvasHeight();
    this.roots.canvas.style.width = W + 'px';
    this.roots.canvas.style.height = H + 'px';
    this.roots.canvasWrap.style.width = W + 'px';
    this.roots.canvasWrap.style.height = H + 'px';
    const bg = store.doc.canvas.background;
    this.roots.canvas.style.background = bg ? bgStyle(bg) : '#fff';
    this.syncZones();
    this.syncLayers();
    this.updateSelectionUI();
    this.updateEmptyState();
    this.updateStatusOthers();
  }

  bgStyle(bg) {
    if (bg.type === 'transparent') return 'repeating-conic-gradient(#2a2f39 0% 25%, #22262e 0% 50%) 0 0 / 20px 20px';
    if (bg.type === 'color') return bg.color;
    if (bg.type === 'linear') {
      const stops = (bg.colors || []).map((s) => `${s.c} ${Math.round(s.t * 100)}%`).join(', ');
      return `linear-gradient(${bg.angle || 90}deg, ${stops})`;
    }
    const stops = (bg.colors || []).map((s) => `${s.c} ${Math.round(s.t * 100)}%`).join(', ');
    return `radial-gradient(circle at 50% 50%, ${stops})`;
  }

  updateEmptyState() {
    const has = store.doc.layers.length > 0 || store.doc.zones.length > 0;
    this.roots.empty.classList.toggle('hidden', has);
  }

  syncZones() {
    const canvas = this.roots.canvas;
    const zones = store.doc.zones;
    const used = new Set(store.doc.layers.map((l) => l.slotId).filter(Boolean));
    const wanted = new Set(zones.map((z) => z.id));
    for (const [id, node] of this.zoneEls) {
      if (!wanted.has(id)) node.remove();
    }
    const keep = new Map();
    for (const z of zones) {
      let node = this.zoneEls.get(z.id);
      if (!node) {
        node = el('div', 'zone');
        node.setAttribute('data-zone', z.id);
        canvas.insertBefore(node, this.handles.wrap);
        const hd = (c) => {
          const h = document.createElement('div');
          h.className = 'zone-handle ' + c;
          h.setAttribute('data-zh', c);
          node.appendChild(h);
        };
        hd('nw'); hd('ne'); hd('sw'); hd('se');
      }
      node.style.left = z.x + 'px';
      node.style.top = z.y + 'px';
      node.style.width = z.w + 'px';
      node.style.height = z.h + 'px';
      node.classList.toggle('sel', this.activeZone === z.id);
      keep.set(z.id, node);
      if (!node.querySelector('.zone-label')) node.appendChild(el('div', 'zone-label', 'Zone'));
      const isFree = !used.has(z.id);
      let ph = node.querySelector('.zone-placeholder');
      if (isFree) {
        if (!ph) {
          ph = el('div', 'zone-placeholder');
          ph.style.cssText = 'position:absolute;inset:6px;border:2px dashed rgba(120,150,255,.6);border-radius:6px;pointer-events:none;display:flex;align-items:center;justify-content:center;font-size:11px;color:rgba(160,185,255,.8);letter-spacing:.5px;';
          ph.textContent = 'Paste to fill';
          node.appendChild(ph);
        }
      } else if (ph) {
        ph.remove();
      }
    }
    this.zoneEls = keep;
  }

  syncLayers() {
    const canvas = this.roots.canvas;
    const layers = store.doc.layers;
    const wanted = new Set(layers.map((l) => l.id));
    for (const [id, node] of this.layerEls) {
      if (!wanted.has(id)) node.remove();
    }
    const keep = new Map();
    layers.forEach((layer, idx) => {
      let node = this.layerEls.get(layer.id);
      if (!node) {
        node = el('div', 'layer');
        node.appendChild(document.createElement('img'));
        canvas.appendChild(node);
      }
      const img = node.querySelector('img');
      const asset = store.getAsset(layer.assetKey);
      if (asset && asset.preview && node.__src !== asset.preview) {
        node.__src = asset.preview;
        img.onload = () => this.placeImgInNode(node, layer, asset);
        img.src = asset.preview;
      }
      node.style.left = layer.x + 'px';
      node.style.top = layer.y + 'px';
      node.style.width = layer.w + 'px';
      node.style.height = layer.h + 'px';
      node.style.transform = layer.rotation ? `rotate(${layer.rotation}deg)` : '';
      node.style.zIndex = idx + 10;
      node.style.display = layer.visible === false ? 'none' : '';
      node.dataset.id = layer.id;
      node.classList.toggle('locked', !!layer.locked);
      node.classList.toggle('sel', store.selection.includes(layer.id));
      if (asset) this.placeImgInNode(node, layer, asset);
      keep.set(layer.id, node);
    });
    this.layerEls = keep;
  }

  imgPlacementFor(layer, asset) {
    const srcW = asset.naturalW || asset.naturalWidth || layer.w;
    const srcH = asset.naturalH || asset.naturalHeight || layer.h;
    const boxW = layer.w, boxH = layer.h;
    if (layer.crop) {
      const c = layer.crop;
      const scale = Math.max(boxW / c.sw, boxH / c.sh);
      return { left: (boxW - srcW * scale) / 2 - c.sx * scale, top: (boxH - srcH * scale) / 2 - c.sy * scale, objW: srcW * scale, objH: srcH * scale };
    }
    const fit = layer.objectFit || 'cover';
    const scale = fit === 'contain' ? Math.min(boxW / srcW, boxH / srcH) : Math.max(boxW / srcW, boxH / srcH);
    return { left: (boxW - srcW * scale) / 2, top: (boxH - srcH * scale) / 2, objW: srcW * scale, objH: srcH * scale };
  }

  placeImgInNode(node, layer, asset) {
    const img = node.querySelector('img');
    if (!img || !img.width) return;
    const p = this.imgPlacementFor(layer, asset);
    img.style.width = Math.max(1, p.objW) + 'px';
    img.style.height = Math.max(1, p.objH) + 'px';
    img.style.left = p.left + 'px';
    img.style.top = p.top + 'px';
  }

  /* ---------------- Selection UI ---------------- */
  updateSelectionUI() {
    const sel = store.selection.filter((id) => store.getLayer(id));
    this.layerEls.forEach((node, id) => node.classList.toggle('sel', sel.includes(id)));
    this.zoneEls.forEach((node, id) => node.classList.toggle('sel', id === this.activeZone));
    if (!sel.length) {
      this.hideHandles();
      return;
    }
    const bb = sel.length === 1
      ? (() => { const l = store.getLayer(sel[0]); return { x: l.x, y: l.y, w: l.w, h: l.h }; })()
      : compoundBBox(sel, (id) => store.getLayer(id));
    this.showHandles(bb, sel.length > 1);
  }

  showHandles(bb, showBBox) {
    const pad = 7;
    const set = (h, x, y) => {
      h.style.left = x + 'px';
      h.style.top = y + 'px';
      h.style.transform = 'translate(-50%,-50%)';
    };
    set(this.handles.nw, bb.x - pad, bb.y - pad);
    set(this.handles.ne, bb.x + bb.w + pad, bb.y - pad);
    set(this.handles.sw, bb.x - pad, bb.y + bb.h + pad);
    set(this.handles.se, bb.x + bb.w + pad, bb.y + bb.h + pad);
    const b = this.handles.bbox;
    b.style.left = (bb.x - pad) + 'px';
    b.style.top = (bb.y - pad) + 'px';
    b.style.width = (bb.w + pad * 2) + 'px';
    b.style.height = (bb.h + pad * 2) + 'px';
    b.style.display = showBBox ? '' : 'none';
    set(this.handles.rotate, bb.x + bb.w / 2, bb.y - 36);
    this.handles.wrap.style.display = 'block';
  }

  hideHandles() {
    this.handles.wrap.style.display = 'none';
  }

  /* ---------------- Hit testing ---------------- */
  hitLayerUnder(e) {
    const els = [...this.layerEls.values()].reverse().filter((n) => n.style.display !== 'none');
    for (const n of els) {
      const r = n.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        return store.getLayer(n.dataset.id);
      }
    }
    return null;
  }

  hitZoneUnder(e) {
    const els = [...this.zoneEls.values()].reverse();
    for (const n of els) {
      const r = n.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        return n.dataset.zone;
      }
    }
    return null;
  }

  hitHandle(e) {
    if (!store.selection.length) return null;
    for (const c of ['nw', 'ne', 'sw', 'se']) {
      const r = this.handles[c].getBoundingClientRect();
      if (Math.abs(e.clientX - (r.left + r.width / 2)) <= r.width && Math.abs(e.clientY - (r.top + r.height / 2)) <= r.height) return c;
    }
    const r = this.handles.rotate.getBoundingClientRect();
    if (Math.abs(e.clientX - (r.left + r.width / 2)) <= r.width + 10 && Math.abs(e.clientY - (r.top + r.height / 2)) <= r.height + 10) return 'rotate';
    return null;
  }

  /* ---------------- Events ---------------- */
  bindEvents() {
    const vp = this.viewport;
    vp.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    vp.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    vp.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    vp.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const layer = this.hitLayerUnder(e);
      bus.emit('contextmenu', { x: e.clientX, y: e.clientY, layer, zone: this.hitZoneUnder(e) });
    });
    vp.addEventListener('dblclick', (e) => {
      const layer = this.hitLayerUnder(e);
      if (layer) bus.emit('dblclick-layer', layer.id);
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') this.spaceKey = true;
      if ((e.code === 'Space' || e.code === 'Escape') && this.dragging) {
        e.preventDefault();
        this.cancelDrag();
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceKey = false;
    });
    window.addEventListener('blur', () => { this.spaceKey = false; });
  }

  onPointerDown(e) {
    if (this.cropping) return;
    if (e.button === 1 || (e.button === 0 && this.spaceKey)) {
      this.startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const handle = this.hitHandle(e);
    if (handle) {
      this.startHandleDrag(e, handle);
      return;
    }
    const zone = this.hitZoneUnder(e);
    if (zone) {
      if (e.target.closest('.zone-handle')) {
        this.selectZone(zone);
        this.startZoneDrag(e, zone);
      } else {
        this.selectZone(zone);
        this.startZoneDrag(e, zone);
      }
      return;
    }
    const layer = this.hitLayerUnder(e);
    if (layer) {
      this.activeZone = null;
      if (e.ctrlKey) {
        this.startMoveDrag(e, layer);
      } else if (!store.selection.includes(layer.id)) {
        store.setSelection([layer.id]);
        this.startMoveDrag(e, layer);
      } else {
        this.startMoveDrag(e, layer);
      }
      return;
    }
    this.activeZone = null;
    this.syncZones();
    this.startMarquee(e);
  }

  startPan(e) {
    this.dragging = { kind: 'pan', sx: e.clientX, sy: e.clientY, tx0: store.view.tx, ty0: store.view.ty };
    this.viewport.style.cursor = 'grabbing';
  }

  startMoveDrag(e, layer) {
    const sel = store.selection.filter((id) => store.getLayer(id) && !store.getLayer(id).locked);
    if (!sel.length) return;
    const orig = new Map(sel.map((id) => {
      const l = store.getLayer(id);
      return [id, { x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation }];
    }));
    this.dragging = {
      kind: 'move', sel, orig,
      startPoint: this.screenToModel(e.clientX, e.clientY),
      primaryBB: { ...orig.get(layer ? layer.id : sel[0]) },
      moved: false,
    };
    history.begin();
    this.capture(e);
    e.preventDefault();
  }

  startHandleDrag(e, handle) {
    const sel = store.selection.filter((id) => store.getLayer(id));
    if (!sel.length) return;
    const orig = new Map(sel.map((id) => {
      const l = store.getLayer(id);
      return [id, { x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation }];
    }));
    const bb = this.groupBBox(orig);
    const d = {
      kind: handle === 'rotate' ? 'rotate' : 'resize',
      handle, sel, orig,
      groupBB: bb,
      changed: false,
    };
    if (handle !== 'rotate') {
      d.anchor = this.anchorFor(handle, bb);
      d.aspect = sel.length === 1 ? this.aspectOf(store.getLayer(sel[0])) : bb.w / (bb.h || 1);
    } else {
      d.center = { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 };
      d.rotStart = new Map(sel.map((id) => [id, orig.get(id).rotation]));
      d.startPoint = this.screenToModel(e.clientX, e.clientY);
      const m0 = this.screenToModel(e.clientX, e.clientY);
      d.startAngle = Math.atan2(-(m0.y - d.center.y), (m0.x - d.center.x));
    }
    this.dragging = d;
    history.begin();
    this.capture(e);
    e.preventDefault();
  }

  startMarquee(e) {
    const mp = this.screenToModel(e.clientX, e.clientY);
    if (mp.x < 0 || mp.y < 0 || mp.x > store.canvasWidth() || mp.y > store.canvasHeight()) {
      store.setSelection([]);
      return;
    }
    store.setSelection([]);
    this.dragging = { kind: 'marquee', startPoint: mp, current: mp, moved: false };
    this.capture(e);
    e.preventDefault();
  }

  startZoneDrag(e, zoneId) {
    const z = store.doc.zones.find((z) => z.id === zoneId);
    if (!z) return;
    const zh = e.target.closest('.zone-handle');
    this.dragging = {
      kind: 'zone', zoneId,
      handle: zh ? zh.dataset.zh : null,
      origZ: { ...z },
      startPoint: this.screenToModel(e.clientX, e.clientY),
      moved: false,
    };
    history.begin();
    this.capture(e);
    e.preventDefault();
  }

  capture(e) {
    try {
      this.viewport.setPointerCapture(e.pointerId);
    } catch (err) { /* ignore */ }
  }

  onPointerMove(e) {
    const d = this.dragging;
    if (!d) return;
    if (d.kind === 'pan') {
      const v = store.view;
      v.tx = d.tx0 + (e.clientX - d.sx);
      v.ty = d.ty0 + (e.clientY - d.sy);
      this.world.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.zoom})`;
      return;
    }
    const mp = this.screenToModel(e.clientX, e.clientY);
    this.__lastEvent = e;
    switch (d.kind) {
      case 'move': this.doMove(d, mp, e); break;
      case 'resize': this.doResize(d, mp, e); break;
      case 'rotate': this.doRotate(d, e); break;
      case 'zone': this.doZoneDrag(d, mp); break;
      case 'marquee': d.current = mp; d.moved = true; this.drawMarquee(d.startPoint, mp); break;
    }
  }

  onPointerUp(e) {
    const d = this.dragging;
    if (!d) return;
    this.clearGuides();
    this.roots.marquee.style.display = 'none';
    if (d.kind === 'pan') {
      this.viewport.style.cursor = '';
    } else if (d.kind === 'marquee') {
      if (d.moved) this.applyMarquee(d.startPoint, d.current);
    } else if (d.kind === 'move') {
      if (d.moved) history.finish();
      else history.cancelGesture();
    } else if (d.kind === 'zone') {
      if (d.moved) history.finish();
      else history.cancelGesture();
    } else {
      if (d.changed) history.finish();
      else history.cancelGesture();
    }
    this.dragging = null;
  }

  cancelDrag() {
    const d = this.dragging;
    if (!d) return;
    if (d.kind === 'move') {
      d.sel.forEach((id) => {
        const l = store.getLayer(id);
        const o = d.orig.get(id);
        if (l && o) { l.x = o.x; l.y = o.y; l.w = o.w; l.h = o.h; l.rotation = o.rotation; }
      });
      history.cancelGesture();
    } else if (d.kind === 'resize') {
      d.sel.forEach((id) => {
        const l = store.getLayer(id);
        const o = d.orig.get(id);
        if (l && o) { l.x = o.x; l.y = o.y; l.w = o.w; l.h = o.h; }
      });
      history.cancelGesture();
    } else if (d.kind === 'rotate') {
      d.sel.forEach((id) => {
        const l = store.getLayer(id);
        if (l) l.rotation = d.rotStart.get(id);
      });
      history.cancelGesture();
    } else if (d.kind === 'zone') {
      const z = store.doc.zones.find((z) => z.id === d.zoneId);
      if (z) Object.assign(z, d.origZ);
      history.cancelGesture();
    }
    this.clearGuides();
    this.dragging = null;
    bus.emit('doc');
  }

  onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey) {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.zoomAt(e.clientX, e.clientY, factor);
    } else {
      const v = store.view;
      v.tx -= e.deltaX;
      v.ty -= e.deltaY;
      this.world.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.zoom})`;
    }
  }

  /* ---------------- Gestures ---------------- */
  doMove(d, mp, e) {
    const dx = mp.x - d.startPoint.x;
    const dy = mp.y - d.startPoint.y;
    if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) d.moved = true;
    const prim = store.getLayer(d.sel[0]);
    if (!prim) return;
    let baseX = d.primaryBB.x + dx;
    let baseY = d.primaryBB.y + dy;
    if (!e.altKey) {
      const snap = this.computeSnap({ x: baseX, y: baseY, w: d.primaryBB.w, h: d.primaryBB.h });
      baseX += snap.dx;
      baseY += snap.dy;
      this.renderGuides(snap);
    } else {
      this.clearGuides();
    }
    const actDx = baseX - d.primaryBB.x;
    const actDy = baseY - d.primaryBB.y;
    d.sel.forEach((id) => {
      const l = store.getLayer(id);
      if (!l) return;
      const o = d.orig.get(id);
      l.x = o.x + actDx;
      l.y = o.y + actDy;
      l.slotId = null;
    });
    this.syncLayers();
    this.updateSelectionUI();
  }

  computeSnap(bb) {
    const W = store.canvasWidth(), H = store.canvasHeight();
    const tol = TOLERANCE / store.view.zoom;
    const selSet = new Set(store.selection);
    const others = store.doc.layers
      .filter((l) => !selSet.has(l.id) && l.visible !== false)
      .map((l) => bboxOfLayer(l));
    const xT = [0, W / 2, W];
    const yT = [0, H / 2, H];
    others.forEach((o) => {
      xT.push(o.x, o.x + o.w / 2, o.x + o.w);
      yT.push(o.y, o.y + o.h / 2, o.y + o.h);
    });
    let bestX = null, bestY = null;
    for (const t of xT) {
      for (const side of [0, bb.w / 2, bb.w]) {
        const dd = t - (bb.x + side);
        if (Math.abs(dd) <= tol && (!bestX || Math.abs(dd) < Math.abs(bestX.dx))) bestX = { dx: dd, line: t };
      }
    }
    for (const t of yT) {
      for (const side of [0, bb.h / 2, bb.h]) {
        const dd = t - (bb.y + side);
        if (Math.abs(dd) <= tol && (!bestY || Math.abs(dd) < Math.abs(bestY.dy))) bestY = { dy: dd, line: t };
      }
    }
    const guides = { v: bestX ? [bestX.line] : [], h: bestY ? [bestY.line] : [] };
    return { dx: bestX ? bestX.dx : 0, dy: bestY ? bestY.dy : 0, guides };
  }

  renderGuides(snap) {
    const g = this.roots.guides;
    g.innerHTML = '';
    const v = store.view;
    const W = store.canvasWidth(), H = store.canvasHeight();
    snap.guides.v.forEach((x) => {
      const d = el('div', 'guide-v');
      d.style.left = (v.tx + x * v.zoom) + 'px';
      d.style.height = (H * v.zoom) + 'px';
      g.appendChild(d);
    });
    snap.guides.h.forEach((y) => {
      const d = el('div', 'guide-h');
      d.style.top = (v.ty + y * v.zoom) + 'px';
      d.style.width = (W * v.zoom) + 'px';
      g.appendChild(d);
    });
  }

  clearGuides() {
    this.roots.guides.innerHTML = '';
  }

  drawMarquee(a, b) {
    const mm = this.roots.marquee;
    const v = store.view;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    mm.style.display = 'block';
    mm.style.left = (v.tx + x * v.zoom) + 'px';
    mm.style.top = (v.ty + y * v.zoom) + 'px';
    mm.style.width = (Math.abs(b.x - a.x) * v.zoom) + 'px';
    mm.style.height = (Math.abs(b.y - a.y) * v.zoom) + 'px';
  }

  applyMarquee(a, b) {
    const x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x, b.x), y2 = Math.max(a.y, b.y);
    const ids = store.doc.layers
      .filter((l) => l.visible !== false)
      .filter((l) => {
        const bo = bboxOfLayer(l);
        return !(bo.x > x2 || bo.x + bo.w < x1 || bo.y > y2 || bo.y + bo.h < y1);
      })
      .map((l) => l.id);
    store.setSelection(ids);
    this.syncLayers();
    this.updateSelectionUI();
  }

  /* ---------------- Resize & rotate ---------------- */
  doResize(d, mp, e) {
    d.changed = true;
    const bb = d.groupBB;
    const anchor = d.anchor;
    const lock = !e.shiftKey;
    let w = bb.w, h = bb.h;
    if (d.handle === 'se') { w = mp.x - anchor.x; h = mp.y - anchor.y; }
    else if (d.handle === 'nw') { w = anchor.x - mp.x; h = anchor.y - mp.y; }
    else if (d.handle === 'sw') { w = mp.x - anchor.x; h = anchor.y - mp.y; }
    else if (d.handle === 'ne') { w = mp.x - anchor.x; h = anchor.y - mp.y; }
    w = clamp(w, 6, 6000);
    h = clamp(h, 6, 6000);
    if (lock && d.aspect) {
      const a = d.aspect;
      if (w / a >= h) h = w / a; else w = h * a;
    }
    let sx = w / bb.w, sy = h / bb.h;
    if (d.sel.length === 1) {
      const l = store.getLayer(d.sel[0]);
      let nx = anchor.x - (d.handle === 'se' ? 0 : w);
      let ny = anchor.y - (d.handle === 'se' ? 0 : h);
      if (d.handle === 'nw') { nx = anchor.x - w; ny = anchor.y - h; }
      else if (d.handle === 'sw') { nx = anchor.x - w; ny = anchor.y; }
      else if (d.handle === 'ne') { nx = anchor.x; ny = anchor.y - h; }
      else { nx = anchor.x; ny = anchor.y; }
      const newBB = { x: nx, y: ny, w, h };
      let dx = 0, dy = 0;
      if (!e.altKey) {
        const snap = this.snapResize(newBB);
        dx = snap.dx; dy = snap.dy;
        this.renderGuides(snap);
      } else this.clearGuides();
      l.x = nx + dx; l.y = ny + dy; l.w = w; l.h = h;
      l.slotId = null;
    } else {
      d.sel.forEach((id) => {
        const l = store.getLayer(id);
        const o = d.orig.get(id);
        l.x = anchor.x + (o.x - anchor.x) * sx;
        l.y = anchor.y + (o.y - anchor.y) * sy;
        l.w = Math.max(4, o.w * sx);
        l.h = Math.max(4, o.h * sy);
      });
    }
    this.syncLayers();
    this.updateSelectionUI();
  }

  snapResize(rect) {
    const tol = TOLERANCE / store.view.zoom;
    const W = store.canvasWidth(), H = store.canvasHeight();
    const selSet = new Set(store.selection);
    const others = store.doc.layers.filter((l) => !selSet.has(l.id)).map((l) => bboxOfLayer(l));
    const xT = [0, W, ...others.flatMap((o) => [o.x, o.x + o.w, o.x + o.w / 2])];
    const yT = [0, H, ...others.flatMap((o) => [o.y, o.y + o.h, o.y + o.h / 2])];
    let bestX = null;
    for (const side of [rect.x, rect.x + rect.w]) {
      for (const t of xT) {
        const dd = t - side;
        if (Math.abs(dd) <= tol && (!bestX || Math.abs(dd) < Math.abs(bestX.dd))) bestX = { dd, line: t };
      }
    }
    let bestY = null;
    for (const side of [rect.y, rect.y + rect.h]) {
      for (const t of yT) {
        const dd = t - side;
        if (Math.abs(dd) <= tol && (!bestY || Math.abs(dd) < Math.abs(bestY.dd))) bestY = { dd, line: t };
      }
    }
    return { dx: bestX ? bestX.dd : 0, dy: bestY ? bestY.dd : 0, guides: { v: bestX ? [bestX.line] : [], h: bestY ? [bestY.line] : [] } };
  }

  doRotate(d, e) {
    d.changed = true;
    const m0 = this.screenToModel(e.clientX, e.clientY);
    const ang = Math.atan2(-(m0.y - d.center.y), m0.x - d.center.x);
    let delta = radToDeg(ang - d.startAngle);
    if (!e.altKey) {
      const step = 45;
      const snap = Math.round(delta / step) * step;
      if (Math.abs(delta - snap) <= 5) delta = snap;
    }
    d.sel.forEach((id) => {
      const l = store.getLayer(id);
      if (!l) return;
      l.rotation = normalizeRot((d.rotStart.get(id) || 0) + delta);
    });
    this.syncLayers();
    this.updateSelectionUI();
  }

  /* ---------------- Zones ---------------- */
  selectZone(id) {
    this.activeZone = id;
    store.setSelection([]);
    this.syncZones();
  }

  doZoneDrag(d, mp) {
    d.moved = true;
    const z = store.doc.zones.find((z) => z.id === d.zoneId);
    if (!z) return;
    const o = d.origZ;
    const dx = mp.x - d.startPoint.x;
    const dy = mp.y - d.startPoint.y;
    if (!d.handle) {
      z.x = clamp(o.x + dx, -40, store.canvasWidth() - 20);
      z.y = clamp(o.y + dy, -40, store.canvasHeight() - 30);
    } else {
      let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
      if (d.handle.includes('w')) { nx = clamp(o.x + dx, 0, o.x + o.w - 24); nw = o.w + (o.x - nx); }
      if (d.handle.includes('e')) { nw = clamp(o.w + dx, 24, store.canvasWidth() - nx); }
      if (d.handle.includes('n')) { ny = clamp(o.y + dy, 0, o.y + o.h - 24); nh = o.h + (o.y - ny); }
      if (d.handle.includes('s')) { nh = clamp(o.h + dy, 24, store.canvasHeight() - ny); }
      z.x = nx; z.y = ny; z.w = nw; z.h = nh;
    }
    store.doc.layers.filter((l) => l.slotId === z.id).forEach((l) => {
      l.x = z.x; l.y = z.y; l.w = z.w; l.h = z.h;
    });
    this.syncZones();
    this.syncLayers();
  }

  /* ---------------- Math ---------------- */
  groupBBox(orig) {
    let bb = null;
    orig.forEach((o) => {
      if (!bb) bb = { ...o };
      else {
        const x2 = Math.max(bb.x + bb.w, o.x + o.w);
        const y2 = Math.max(bb.y + bb.h, o.y + o.h);
        bb.x = Math.min(bb.x, o.x);
        bb.y = Math.min(bb.y, o.y);
        bb.w = x2 - bb.x;
        bb.h = y2 - bb.y;
      }
    });
    return bb;
  }

  anchorFor(handle, bb) {
    switch (handle) {
      case 'nw': return { x: bb.x + bb.w, y: bb.y + bb.h };
      case 'ne': return { x: bb.x, y: bb.y + bb.h };
      case 'sw': return { x: bb.x + bb.w, y: bb.y };
      default: return { x: bb.x, y: bb.y };
    }
  }

  aspectOf(layer) {
    if (layer.crop) return layer.crop.sw / layer.crop.sh;
    const asset = store.getAsset(layer.assetKey);
    if (asset && asset.naturalWidth && asset.naturalHeight) return asset.naturalWidth / asset.naturalHeight;
    return layer.w / (layer.h || 1);
  }

  /* ---------------- Public ops ---------------- */
  nudge(dx, dy) {
    const sel = store.selection.filter((id) => store.getLayer(id) && !store.getLayer(id).locked);
    if (!sel.length) return;
    history.commit(() => {
      sel.forEach((id) => {
        const l = store.getLayer(id);
        l.x += dx; l.y += dy;
        l.slotId = null;
      });
    });
  }

  rotateSelected(deg) {
    const sel = store.selection.filter((id) => store.getLayer(id));
    if (!sel.length) return;
    history.commit(() => {
      sel.forEach((id) => {
        const l = store.getLayer(id);
        l.rotation = normalizeRot((l.rotation || 0) + deg);
      });
    });
  }

  deleteSelection() {
    const sel = store.selection.slice();
    if (!sel.length) return;
    history.commit(() => {
      store.doc.layers = store.doc.layers.filter((l) => !sel.includes(l.id));
      store.selection = [];
    });
  }

  duplicateSelection() {
    const sel = store.selection.slice();
    if (!sel.length) return;
    history.commit(() => {
      const newIds = [];
      sel.forEach((id) => {
        const l = store.getLayer(id);
        const copy = { ...l, id: uid(), x: l.x + 24, y: l.y + 24, slotId: null };
        store.doc.layers.push(copy);
        newIds.push(copy.id);
      });
      store.selection = newIds;
    });
  }

  selectAll() {
    store.setSelection(store.doc.layers.filter((l) => l.visible !== false).map((l) => l.id));
  }

  clearSelection() {
    store.setSelection([]);
  }

  deleteActiveZone() {
    if (!this.activeZone) return;
    const id = this.activeZone;
    history.commit(() => {
      store.doc.zones = store.doc.zones.filter((z) => z.id !== id);
      store.doc.layers.forEach((l) => { if (l.slotId === id) l.slotId = null; });
      this.activeZone = null;
    });
  }

  /* ---------------- Alignment & distribute ---------------- */
  alignSelection(kind) {
    const sel = store.selection.filter((id) => store.getLayer(id) && !store.getLayer(id).locked);
    if (!sel.length) return;
    const W = store.canvasWidth(), H = store.canvasHeight();
    history.commit(() => {
      sel.forEach((id) => {
        const l = store.getLayer(id);
        const b = bboxOfLayer(l);
        let dx = 0, dy = 0;
        switch (kind) {
          case 'left': dx = 0 - b.x; break;
          case 'hcenter': dx = (W / 2) - (b.x + b.w / 2); break;
          case 'right': dx = W - (b.x + b.w); break;
          case 'top': dy = 0 - b.y; break;
          case 'vcenter': dy = (H / 2) - (b.y + b.h / 2); break;
          case 'bottom': dy = H - (b.y + b.h); break;
        }
        l.x += dx;
        l.y += dy;
        l.slotId = null;
      });
    });
  }

  distributeSelection(axis) {
    const sel = store.selection.filter((id) => store.getLayer(id) && !store.getLayer(id).locked);
    if (sel.length < 3) return;
    const W = store.canvasWidth(), H = store.canvasHeight();
    history.commit(() => {
      const items = sel.map((id) => {
        const l = store.getLayer(id);
        const b = bboxOfLayer(l);
        return { id, l, left: axis === 'h' ? b.x : b.y, size: axis === 'h' ? b.w : b.h };
      }).sort((m, n) => m.left - n.left);
      if (axis === 'h') {
        const first = items[0].left, last = items[items.length - 1].left + items[items.length - 1].size;
        const totalW = items.reduce((s, m) => s + m.size, 0);
        const gap = Math.max(0, (last - first - totalW) / (items.length - 1));
        let cursor = first;
        items.forEach((m, i) => {
          const bbox = bboxOfLayer(m.l);
          m.l.x += cursor - bbox.x;
          m.l.slotId = null;
          cursor += m.size + gap;
        });
      } else {
        const first = items[0].left, last = items[items.length - 1].left + items[items.length - 1].size;
        const totalH = items.reduce((s, m) => s + m.size, 0);
        const gap = Math.max(0, (last - first - totalH) / (items.length - 1));
        let cursor = first;
        items.forEach((m) => {
          const bbox = bboxOfLayer(m.l);
          m.l.y += cursor - bbox.y;
          m.l.slotId = null;
          cursor += m.size + gap;
        });
      }
    });
  }
}

export const canvasEditor = new Canvas();

export function bgStyle(bg) {
  if (bg.type === 'transparent') return 'repeating-conic-gradient(#2a2f39 0% 25%, #22262e 0% 50%) 0 0 / 20px 20px';
  if (bg.type === 'color') return bg.color;
  if (bg.type === 'linear') {
    const stops = (bg.colors || []).map((s) => `${s.c} ${Math.round(s.t * 100)}%`).join(', ');
    return `linear-gradient(${bg.angle || 90}deg, ${stops})`;
  }
  const stops = (bg.colors || []).map((s) => `${s.c} ${Math.round(s.t * 100)}%`).join(', ');
  return `radial-gradient(circle at 50% 50%, ${stops})`;
}