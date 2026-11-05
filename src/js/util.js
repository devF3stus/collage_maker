export function uid() {
  return 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function degToRad(d) {
  return (d * Math.PI) / 180;
}

export function radToDeg(r) {
  return (r * 180) / Math.PI;
}

export function shortName(p) {
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1];
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load failed'));
    img.src = src;
  });
}

export function loadImageDims(dataURL) {
  return loadImage(dataURL).then((img) => ({ w: img.naturalWidth, h: img.naturalHeight, img }));
}

export const TOLERANCE = 6;

export class Bus {
  constructor() {
    this.handlers = new Map();
  }
  on(ev, fn) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev).add(fn);
    return () => this.handlers.get(ev)?.delete(fn);
  }
  emit(ev, payload) {
    (this.handlers.get(ev) || new Set()).forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error(e);
      }
    });
  }
}

export function toast(message, type = 'info', duration = 3200) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : type === 'ok' ? ' ok' : '');
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 320);
  }, duration);
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function shortenText(s, n = 42) {
  const t = String(s);
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

export function bboxOfLayer(layer) {
  const c = Math.cos(degToRad(layer.rotation));
  const s = Math.sin(degToRad(layer.rotation));
  const w = layer.w, h = layer.h;
  const cx = layer.x + w / 2, cy = layer.y + h / 2;
  const dx0 = -w / 2 * c + h / 2 * s;
  const dy0 = -w / 2 * s - h / 2 * c;
  const dx1 = w / 2 * c + h / 2 * s;
  const dy1 = w / 2 * s - h / 2 * c;
  const abs = [Math.abs(dx0), Math.abs(dx1), Math.abs(w / 2 * c - h / 2 * s), Math.abs(w / 2 * c + h / 2 * s)];
  const abs2 = [Math.abs(dy0), Math.abs(dy1), Math.abs(w / 2 * s - h / 2 * c), Math.abs(w / 2 * s + h / 2 * c)];
  return {
    x: cx - Math.max(...abs),
    y: cy - Math.max(...abs2),
    w: 2 * Math.max(...abs),
    h: 2 * Math.max(...abs2),
  };
}

export function compoundBBox(layers, getLayer) {
  let r = null;
  for (const id of layers) {
    const b = bboxOfLayer(getLayer(id));
    if (!r) r = b;
    else {
      const x2 = Math.max(r.x + r.w, b.x + b.w);
      const y2 = Math.max(r.y + r.h, b.y + b.h);
      r.x = Math.min(r.x, b.x);
      r.y = Math.min(r.y, b.y);
      r.w = x2 - r.x;
      r.h = y2 - r.y;
    }
  }
  return r;
}