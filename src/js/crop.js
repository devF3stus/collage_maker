import { store } from './store.js';
import { history } from './history.js';
import { el, clamp, loadImage } from './util.js';
import { fullSrcOfAsset } from './export.js';
import { canvasEditor } from './canvas.js';

class Crop {
  constructor() {
    this.layerId = null;
    this.state = null;
    this.image = null;
    this.srcW = 1;
    this.srcH = 1;
    this.k = 1;
    this.ratio = 0;
    this.els = null;
  }

  isOpen() {
    return !!this.layerId;
  }

  async open(layerId) {
    const layerObj = store.getLayer(layerId);
    if (!layerObj) return;
    const asset = store.getAsset(layerObj.assetKey);
    if (!asset) return;
    this.layerId = layerId;
    const full = await fullSrcOfAsset(asset);
    const img = await loadImage(full).catch(() => null);
    if (!img) return;
    this.image = img;
    this.srcW = img.naturalWidth || layerObj.natW;
    this.srcH = img.naturalHeight || layerObj.natH;
    canvasEditor.cropping = true;

    const base = document.createElement('canvas');
    const m = Math.max(this.srcW, this.srcH);
    const cap = Math.min(m, 2400);
    const k = m ? cap / m : 1;
    this.k = k;
    const W = Math.round(this.srcW * k), H = Math.round(this.srcH * k);
    base.width = W;
    base.height = H;
    base.getContext('2d').drawImage(img, 0, 0, W, H);
    const displaySrc = base.toDataURL();

    const c = layer.crop || { sx: 0, sy: 0, sw: this.srcW, sh: this.srcH };
    this.ratio = layer.crop ? c.sw / c.sh : this.srcW / this.srcH;
    this.state = { ...c };

    this.buildUI(displaySrc, W, H);
    this.syncUI();
  }

  buildUI(displaySrc, W, H) {
    this.overlay = document.getElementById('crop-overlay');
    this.stage = document.getElementById('crop-stage');
    this.stage.innerHTML = '';
    const img = el('div', 'crop-img');
    img.style.background = `url(${displaySrc}) no-repeat`;
    img.style.backgroundSize = '100% 100%';
    img.style.width = W + 'px';
    img.style.height = H + 'px';
    this.imageEl = img;
    this.stage.appendChild(img);

    this.shadeN = this.makeShade('n'); this.shadeS = this.makeShade('s');
    this.shadeE = this.makeShade('e'); this.shadeW = this.makeShade('w');
    this.win = el('div', 'crop-window');
    ['nw', 'ne', 'sw', 'se'].forEach((c) => this.win.appendChild(el('div', 'crop-handle ' + c)));
    this.gridV1 = el('div', 'grid-third'); this.gridV2 = el('div', 'grid-third');
    this.gridH1 = el('div', 'grid-third'); this.gridH2 = el('div', 'grid-third');
    this.stage.append(this.shadeN, this.shadeS, this.shadeE, this.shadeW, this.win);
    this.stage.append(this.gridV1, this.gridV2, this.gridH1, this.gridH2);

    this.centerImage();
    window.addEventListener('keydown', this.keyHandler = (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        e.preventDefault();
        this.cancel();
      }
      if (e.key === 'Enter' && this.isOpen()) {
        e.preventDefault();
        this.apply();
      }
    });

    this.stage.addEventListener('pointerdown', (e) => this.onDown(e));
    this.stage.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));

    document.getElementById('crop-cancel').addEventListener('click', () => this.cancel());
    document.getElementById('crop-apply').addEventListener('click', () => this.apply());
    const seg = document.getElementById('crop-ratio-seg');
    seg.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        seg.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this.setRatio(b.dataset.v);
      });
    });
    this.overlay.classList.remove('hidden');
  }

  makeShade(pos) {
    const s = el('div', 'crop-shade');
    s.dataset.pos = pos;
    s.style.cssText = 'position:absolute;';
    return s;
  }

  centerImage() {
    const s = this.stage, img = this.imageEl;
    const rect = s.getBoundingClientRect();
    const x = (rect.width - img.offsetWidth) / 2;
    const y = (rect.height - img.offsetHeight) / 2;
    img.style.left = Math.max(0, x) + 'px';
    img.style.top = Math.max(0, y) + 'px';
  }

  imageRect() {
    const r = this.imageEl.getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, h: r.height };
  }

  toSrc(clientX, clientY) {
    const r = this.imageRect();
    return {
      x: (clientX - r.left) / this.k,
      y: (clientY - r.top) / this.k,
    };
  }

  setRatio(v) {
    if (v === 'free') {
      this.ratio = 0;
      return;
    }
    if (v === 'orig') {
      const asset = store.getAsset(store.getLayer(this.layerId).assetKey);
      this.ratio = (asset ? asset.naturalWidth : this.srcW) / (asset ? asset.naturalHeight : this.srcH);
      return;
    }
    const [a, b] = v.split(':').map(Number);
    this.ratio = a / b;
  }

  rectFromWindow() {
    const r = this.imageRect();
    const s = this.state;
    return {
      x: r.left + s.sx * this.k,
      y: r.top + s.sy * this.k,
      w: s.sw * this.k,
      h: s.sh * this.k,
    };
  }

  syncUI() {
    const s = this.state;
    const r = this.imageRect();
    const x = r.left + s.sx * this.k;
    const y = r.top + s.sy * this.k;
    const w = s.sw * this.k;
    const h = s.sh * this.k;
    const setRect = (node) => {
      node.style.left = x + 'px';
      node.style.top = y + 'px';
      node.style.width = w + 'px';
      node.style.height = h + 'px';
    };
    setRect(this.win);
    this.win.style.borderColor = 'var(--accent)';
    this.shadeN.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.w}px;height:${y - r.top}px;`;
    this.shadeS.style.cssText = `position:absolute;left:${r.left}px;top:${y + h}px;width:${r.w}px;height:${r.top + r.h - y - h}px;`;
    this.shadeW.style.cssText = `position:absolute;left:${r.left}px;top:${y}px;width:${x - r.left}px;height:${h}px;`;
    this.shadeE.style.cssText = `position:absolute;left:${x + w}px;top:${y}px;width:${r.left + r.w - x - w}px;height:${h}px;`;
    const g1 = (gal, gb) => {
      gal.style.cssText = `position:absolute;background:rgba(255,255,255,.18);`;
      gb.style.cssText = `position:absolute;background:rgba(255,255,255,.18);`;
    };
    g1(this.gridV1, this.gridV2);
    this.gridV1.style.left = (x + w / 3) + 'px'; this.gridV1.style.top = y + 'px'; this.gridV1.style.width = '1px'; this.gridV1.style.height = h + 'px';
    this.gridV2.style.left = (x + w * 2 / 3) + 'px'; this.gridV2.style.top = y + 'px'; this.gridV2.style.width = '1px'; this.gridV2.style.height = h + 'px';
    this.gridH1.style.left = x + 'px'; this.gridH1.style.top = (y + h / 3) + 'px'; this.gridH1.style.width = w + 'px'; this.gridH1.style.height = '1px';
    this.gridH2.style.left = x + 'px'; this.gridH2.style.top = (y + h * 2 / 3) + 'px'; this.gridH2.style.width = w + 'px'; this.gridH2.style.height = '1px';
  }

  onDown(e) {
    const h = e.target.closest('.crop-handle');
    const inWin = e.target === this.win || this.win.contains(e.target);
    if (h) {
      this.drag = { kind: 'resize', handle: h.classList[1], start: this.toSrc(e.clientX, e.clientY), st: { ...this.state } };
    } else if (inWin) {
      this.drag = { kind: 'move', start: this.toSrc(e.clientX, e.clientY), st: { ...this.state } };
    } else {
      this.drag = null;
    }
    e.preventDefault();
  }

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    const p = this.toSrc(e.clientX, e.clientY);
    const st = d.st;
    const min = 20;
    let ns = { ...st };
    if (d.kind === 'move') {
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      ns.sx = clamp(st.sx + dx, 0, this.srcW - st.sw);
      ns.sy = clamp(st.sy + dy, 0, this.srcH - st.sh);
    } else {
      let sx0 = st.sx, sy0 = st.sy, sx1 = st.sx + st.sw, sy1 = st.sy + st.sh;
      if (d.handle.includes('e')) sx1 = p.x;
      if (d.handle.includes('w')) sx0 = p.x;
      if (d.handle.includes('s')) sy1 = p.y;
      if (d.handle.includes('n')) sy0 = p.y;
      sx0 = clamp(sx0, 0, this.srcW);
      sy0 = clamp(sy0, 0, this.srcH);
      sx1 = clamp(sx1, 0, this.srcW);
      sy1 = clamp(sy1, 0, this.srcH);
      let sw = sx1 - sx0, sh = sy1 - sy0;
      if (this.ratio > 0) {
        if (sw / sh > this.ratio) {
          sw = sh * this.ratio;
        } else {
          sh = sw / this.ratio;
        }
        const anchorE = d.handle.includes('w');
        const anchorS = d.handle.includes('n');
        if (anchorE) sx0 = sx1 - sw;
        if (!d.handle.includes('w')) sx1 = sx0 + sw;
        if (anchorS) sy0 = sy1 - sh;
        if (!d.handle.includes('n')) sy1 = sy0 + sh;
        sx0 = clamp(sx0, 0, this.srcW - min); sy0 = clamp(sy0, 0, this.srcH - min);
        sx1 = clamp(sx1, min, this.srcW); sy1 = clamp(sy1, min, this.srcH);
        sw = sx1 - sx0; sh = sy1 - sy0;
      }
      if (sw < min || sh < min) return;
      ns = { sx: sx0, sy: sy0, sw, sh };
    }
    this.state = ns;
    this.syncUI();
  }

  onUp() {
    this.drag = null;
  }

  apply() {
    const s = this.state;
    const sw = Math.max(8, Math.round(s.sw)), sh = Math.max(8, Math.round(s.sh));
    const sx = clamp(Math.round(s.sx), 0, Math.max(0, this.srcW - sw));
    const sy = clamp(Math.round(s.sy), 0, Math.max(0, this.srcH - sh));
    const layer = store.getLayer(this.layerId);
    const layerToModify = layer;
    history.commit(() => {
      layerToModify.crop = { sx, sy, sw, sh };
      const ratio = sw / sh;
      layerToModify.h = layerToModify.w / ratio;
    });
    this.close();
  }

  cancel() {
    this.close();
  }

  close() {
    this.layerId = null;
    this.overlay.classList.add('hidden');
    this.stage.innerHTML = '';
    canvasEditor.cropping = false;
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    document.getElementById('crop-ratio-seg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === 'free'));
  }
}

export const crop = new Crop();