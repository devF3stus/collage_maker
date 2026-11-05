// AssetStore per docs/CollageMaker-SPEC.md §6.4 + §8.1: decodes each asset once into
// a reusable ImageBitmap (full-res, lazy) plus a <=1600px preview bitmap, tracks
// refCount per key, and evicts LRU cached bitmaps beyond a memory budget.
// Surface is Map-compatible so existing modules (project.js, store consumers) keep working.

import { uid } from './util.js';

const DEFAULT_BUDGET = 400 * 1024 * 1024; // 400 MB of decoded bitmaps

const approxBytes = (bmp) => (bmp ? bmp.width * bmp.height * 4 : 0);

async function dataURLToBitmap(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => createImageBitmap(img).then(resolve, reject);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataURL;
  });
}

export class AssetStore {
  constructor(opts = {}) {
    this._records = new Map();
    this.budget = opts.budget || DEFAULT_BUDGET;
    this.bytes = 0;
  }

  get size() {
    return this._records.size;
  }

  has(key) {
    return this._records.has(key);
  }

  get(key) {
    return this._records.get(key);
  }

  keys() {
    return this._records.keys();
  }

  values() {
    return this._records.values();
  }

  entries() {
    return this._records.entries();
  }

  [Symbol.iterator]() {
    return this._records[Symbol.iterator]();
  }

  forEach(cb, thisArg) {
    this._records.forEach((value, key) => cb.call(thisArg, value, key, this._records));
  }

  set(key, value) {
    const record = value && typeof value === 'object' && value.source ? value : this._fromLegacy(key, value);
    this._records.set(key, record);
    return this;
  }

  delete(key) {
    const record = this._records.get(key);
    if (record) {
      this._close(record);
      this._records.delete(key);
    }
    return this;
  }

  clear() {
    for (const key of Array.from(this._records.keys())) this.delete(key);
  }

  register(source) {
    const key = uid();
    const dataURL = source && source.dataURL ? source.dataURL : null;
    const path = source && source.path ? source.path : null;
    const record = this._fromScratch(key, {
      type: path ? 'file' : 'data',
      path,
      dataURL,
      preview: (source && source.preview) || dataURL || null,
      natW: source ? (source.natW ?? source.naturalW ?? null) : null,
      natH: source ? (source.natH ?? source.naturalH ?? null) : null,
    });
    this._records.set(key, record);
    this.touch(key);
    return key;
  }

  _fromScratch(key, a) {
    const natW = a.natW ?? null;
    const natH = a.natH ?? null;
    return {
      key,
      source: a.type === 'file' ? { type: 'file', path: a.path } : { type: 'data', dataUrl: a.dataURL },
      type: a.type,
      path: a.path || null,
      dataURL: a.dataURL || null,
      preview: a.preview || null,
      natW,
      natH,
      naturalW: natW,
      naturalH: natH,
      refCount: 0,
      lastUsed: Date.now(),
      stale: false,
      _bitmap: null,
      _previewBitmap: null,
    };
  }

  _fromLegacy(key, a) {
    return this._fromScratch(key, {
      type: a.type === 'file' ? 'file' : 'data',
      path: a.path,
      dataURL: a.dataURL,
      preview: a.preview || a.dataURL || null,
      natW: a.natW ?? a.naturalW ?? null,
      natH: a.natH ?? a.naturalH ?? null,
    });
  }

  touch(key) {
    const r = this._records.get(key);
    if (r) r.lastUsed = Date.now();
  }

  recomputeRefs(activeKeys) {
    const counts = new Map();
    for (const k of activeKeys) if (k) counts.set(k, (counts.get(k) || 0) + 1);
    for (const [key, r] of this._records) r.refCount = counts.get(key) || 0;
    return this;
  }

  activeKeysFrom(doc) {
    return ((doc && doc.layers) || []).map((l) => l.assetKey).filter(Boolean);
  }

  async getPreviewBitmap(key) {
    const r = this._records.get(key);
    if (!r || r.stale) return null;
    if (r._previewBitmap) {
      this.touch(key);
      return r._previewBitmap;
    }
    const src = r.preview || r.dataURL;
    if (!src) return null;
    const bmp = await dataURLToBitmap(src).catch(() => null);
    if (bmp) {
      r._previewBitmap = bmp;
      this.bytes += approxBytes(bmp);
      this.touch(key);
      this.enforceBudget();
    } else {
      r.stale = true;
    }
    return r._previewBitmap;
  }

  async getFullBitmap(key) {
    const r = this._records.get(key);
    if (!r || r.stale) return null;
    if (r._bitmap) {
      this.touch(key);
      return r._bitmap;
    }
    let src;
    if (r.type === 'file' && r.path) {
      src = await window.api.readFullFile(r.path).catch(() => null);
    } else {
      src = r.dataURL;
    }
    if (!src) {
      r.stale = true;
      return null;
    }
    const bmp = await dataURLToBitmap(src).catch(() => null);
    if (bmp) {
      r._bitmap = bmp;
      this.bytes += approxBytes(bmp);
      this.touch(key);
      this.enforceBudget();
    } else {
      r.stale = true;
    }
    return r._bitmap;
  }

  getBitmap(key) {
    return this.getFullBitmap(key);
  }

  enforceBudget() {
    if (this.bytes <= this.budget) return;
    const candidates = Array.from(this._records.values())
      .filter((r) => r._bitmap || r._previewBitmap)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const r of candidates) {
      if (this.bytes <= this.budget) break;
      this._close(r);
    }
  }

  stats() {
    return { records: this._records.size, bytes: this.bytes, budget: this.budget };
  }

  _close(r) {
    if (r._previewBitmap) {
      this.bytes = Math.max(0, this.bytes - approxBytes(r._previewBitmap));
      try { r._previewBitmap.close(); } catch (e) { /* noop */ }
      r._previewBitmap = null;
    }
    if (r._bitmap) {
      this.bytes = Math.max(0, this.bytes - approxBytes(r._bitmap));
      try { r._bitmap.close(); } catch (e) { /* noop */ }
      r._bitmap = null;
    }
  }
}
