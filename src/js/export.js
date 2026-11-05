import { store } from './store.js';
import { el, toast, loadImage, degToRad, clamp } from './util.js';
import { openModal, closeModal, modalButtons } from './modal.js';

export async function fullSrcOfAsset(asset) {
  if (asset.type === 'file') {
    const full = await window.api.readFullFile(asset.path).catch(() => null);
    if (full) return full;
  }
  if (asset.dataURL) return asset.dataURL;
  return asset.preview || null;
}

function fillBackground(ctx, W, H, bg) {
  if (!bg) {
    ctx.clearRect(0, 0, W, H);
    return;
  }
  if (bg.type === 'linear') {
    const cx = W / 2, cy = H / 2;
    const rad = degToRad(bg.angle || 90);
    const d = Math.max(W, H);
    const dx = Math.cos(rad) * d / 2, dy = Math.sin(rad) * d / 2;
    const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    (bg.colors || []).forEach((s) => g.addColorStop(clamp(s.t, 0, 1), s.c));
    ctx.fillStyle = g;
  } else if (bg.type === 'radial') {
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) / 2);
    (bg.colors || []).forEach((s) => g.addColorStop(clamp(s.t, 0, 1), s.c));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = bg.color || '#ffffff';
  }
  ctx.fillRect(0, 0, W, H);
}

function backgroundForExport(bgChoice, format) {
  if (bgChoice === 'white') return { type: 'color', color: '#ffffff' };
  if (bgChoice === 'black') return { type: 'color', color: '#000000' };
  if (bgChoice === 'canvas') {
    const bg = store.doc.canvas.background;
    if (bg.type === 'transparent') return format === 'jpeg' ? { type: 'color', color: '#ffffff' } : null;
    return { type: bg.type, colors: (bg.colors || []).slice(), color: bg.color, angle: bg.angle };
  }
  return null;
}

export async function renderCollage({ scale, bgChoice, format }) {
  const W = store.canvasWidth(), H = store.canvasHeight();
  const maxDim = 7000;
  const s = Math.min(scale, maxDim / Math.max(W, H)) || 1;
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * s);
  cv.height = Math.round(H * s);
  const ctx = cv.getContext('2d');
  const bg = backgroundForExport(bgChoice, format);
  fillBackground(ctx, cv.width, cv.height, bg);
  const layers = store.doc.layers;
  for (const layer of layers) {
    if (layer.visible === false) continue;
    const asset = store.getAsset(layer.assetKey);
    if (!asset) continue;
    try {
      const full = await fullSrcOfAsset(asset);
      const img = await loadImage(full);
      if (!img.width) continue;
      let sx, sy, sw, sh;
      if (layer.crop && layer.crop.sw > 0 && layer.crop.sh > 0) {
        sx = layer.crop.sx; sy = layer.crop.sy; sw = layer.crop.sw; sh = layer.crop.sh;
      } else {
        const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        const fit = layer.objectFit || 'cover';
        const k = fit === 'contain' ? Math.min(layer.w / iw, layer.h / ih) : Math.max(layer.w / iw, layer.h / ih);
        sw = layer.w / k; sh = layer.h / k;
        sx = (iw - sw) / 2; sy = (ih - sh) / 2;
      }
      ctx.save();
      ctx.translate((layer.x + layer.w / 2) * s, (layer.y + layer.h / 2) * s);
      ctx.rotate(degToRad(layer.rotation || 0));
      ctx.drawImage(img, sx, sy, sw, sh,
        (-layer.w / 2) * s, (-layer.h / 2) * s, layer.w * s, layer.h * s);
      ctx.restore();
    } catch (e) {
      console.warn('render layer failed', layer.id, e);
    }
  }
  return cv;
}

export function canvasToDataURL(cv, format, quality) {
  switch (format) {
    case 'jpeg':
      return cv.toDataURL('image/jpeg', quality);
    case 'webp':
      return cv.toDataURL('image/webp', quality);
    default:
      return cv.toDataURL('image/png');
  }
}

export function openExportModal() {
  const body = el('div', 'modal-body');
  const preview = document.createElement('img');
  preview.id = 'export-preview';
  preview.style.display = 'none';
  preview.style.marginBottom = '12px';

  const fmtRow = optRow('Format', makeSelect(['png', 'jpeg', 'webp'], 'png'));
  const scaleRow = optRow('Resolution', segButtons({ '1×': 1, '2×': 2, '3×': 3 }, 1));
  const qualityRow = optRow('Quality', rangeInput(92, 10, 100));
  const bgRow = optRow('Background', makeSelect(['canvas', 'white', 'black', 'transparent'], 'canvas'));

  body.append(preview, fmtRow.root, scaleRow.root, qualityRow.root, bgRow.root);

  let rendered;
  const render = async () => {
    const format = fmtRow.select.value;
    const scale = scaleRow.state.value;
    const quality = qualityRow.input.value;
    rendered = await renderCollage({ scale, bgChoice: bgRow.select.value, format });
    const dataURL = canvasToDataURL(rendered, format, quality / 100);
    preview.src = dataURL;
    preview.style.display = 'block';
  };
  const dirty = () => render();
  fmtRow.select.addEventListener('change', dirty);
  bgRow.select.addEventListener('change', dirty);
  qualityRow.input.addEventListener('input', dirty);
  scaleRow.setChange(dirty);

  const foot = modalButtons([
    { label: 'Cancel' },
    {
      label: 'Export…', primary: true, onClick: async () => {
        const format = fmtRow.select.value;
        if (!rendered) await render();
        const quality = Number(qualityRow.input.value) / 100;
        const dataURL = canvasToDataURL(rendered, format, quality);
        const name = (store.doc.name || 'collage').replace(/\.[^.]*$/, '');
        const res = await window.api.exportImage({ defaultName: name, dataURL, format }).catch(() => ({ ok: false }));
        if (res && res.ok) {
          toast('Collage exported.', 'ok');
          closeModal();
        } else if (!res || !res.canceled) {
          toast("We couldn't export the collage. Please try again.", 'error');
        }
      },
    },
  ]);

  openModal({ title: 'Export Collage', body, footer: foot, width: '460px' });
  render().catch(() => toast('Export preview failed.', 'error'));
}

function optRow(labelText, control) {
  const row = el('div', 'opt-row');
  const span = el('span', null, labelText);
  row.appendChild(span);
  row.appendChild(control.root || control);
  const val = control.valueDisplay;
  if (val) row.appendChild(val);
  return { root: row, select: control.select, input: control.input, state: control.state, setDirty: null, ...control };
}

function makeSelect(options, init) {
  const select = document.createElement('select');
  options.forEach((o) => {
    const op = document.createElement('option');
    op.value = o;
    op.textContent = o === 'canvas' ? 'Canvas setting' : o === 'jpeg' ? 'JPG' : o.toUpperCase();
    select.appendChild(op);
  });
  select.value = init;
  return { root: select, select };
}

function segButtons(map, init) {
  const wrap = el('div', 'seg');
  wrap.style.flex = 'none';
  const state = { value: init };
  const buttons = [];
  for (const [label, val] of Object.entries(map)) {
    const b = el('button', val === init ? 'active' : '', label);
    b.addEventListener('click', () => {
      buttons.forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.value = val;
      if (wrap.onChange) wrap.onChange();
    });
    wrap.appendChild(b);
    buttons.push(b);
  }
  return { root: wrap, state, setChange: (fn) => { wrap.onChange = fn; } };
}

function rangeInput(init, min, max) {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.value = init;
  const val = el('span', 'opt-value', init + '%');
  input.addEventListener('input', () => { val.textContent = input.value + '%'; });
  return { root: input, input, valueDisplay: val };
}