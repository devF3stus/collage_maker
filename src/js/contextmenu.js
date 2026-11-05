import { store, bus } from './store.js';
import { history } from './history.js';
import { canvasEditor } from './canvas.js';
import { crop } from './crop.js';
import { pasteFromClipboard } from './clipboard.js';
import { fullSrcOfAsset } from './export.js';
import { toast, el } from './util.js';
import { promptModal } from './modal.js';

const menuEl = document.getElementById('context-menu');

export function initContextMenu() {
  bus.on('contextmenu', ({ x, y, layer, zone }) => {
    if (crop.isOpen()) return;
    showMenu(x, y, layer, zone);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!menuEl.classList.contains('hidden') && !menuEl.contains(e.target)) hideMenu();
  });
  window.addEventListener('blur', hideMenu);
}

function build(action, label, opts = {}) {
  const item = el('div', 'cm-item' + (opts.danger ? ' danger' : ''));
  item.textContent = label;
  item.addEventListener('click', async () => {
    hideMenu();
    if (opts.before) opts.before();
    await dispatch(action, opts.pal);
  });
  return item;
}

function showMenu(x, y, layer, zone) {
  menuEl.innerHTML = '';
  const hasSel = store.selection.length > 0;
  const hasLayer = !!layer;
  const label = build('__label__', hasLayer ? 'Actions for selected layer(s)' : hasSel ? 'Actions for selected layer(s)' : 'Canvas actions');
  label.className = 'cm-label';
  menuEl.appendChild(label);

  if (layer) menuEl.appendChild(build('cut', 'Cut', { pal: layer.id }));
  if (layer) menuEl.appendChild(build('copy', 'Copy', { pal: layer.id }));
  menuEl.appendChild(build('paste', 'Paste'));
  menuEl.appendChild(build('duplicate', 'Duplicate'));
  const sep1 = el('div', 'cm-sep');
  menuEl.appendChild(sep1);
  menuEl.appendChild(build('delete', 'Delete', { danger: true }));
  const sep2 = el('div', 'cm-sep');
  menuEl.appendChild(sep2);
  menuEl.appendChild(build('front', 'Bring to Front'));
  menuEl.appendChild(build('forward', 'Bring Forward'));
  menuEl.appendChild(build('backward', 'Send Backward'));
  menuEl.appendChild(build('back', 'Send to Back'));
  const sep3 = el('div', 'cm-sep');
  menuEl.appendChild(sep3);
  menuEl.appendChild(build('rotatecw', 'Rotate 90° →'));
  menuEl.appendChild(build('rotateccw', 'Rotate 90° ←'));
  if (store.selection.length === 1) {
    menuEl.appendChild(build('crop', 'Crop…'));
  }
  menuEl.appendChild(build('lock', 'Lock / Unlock'));
  menuEl.appendChild(build('rename', 'Rename…'));

  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = 210, mh = menuEl.getBoundingClientRect ? 0 : 0;
  menuEl.style.left = Math.min(x, vw - mw) + 'px';
  menuEl.style.top = Math.min(y, vh - 320) + 'px';
  menuEl.classList.remove('hidden');
}

function hideMenu() {
  menuEl.classList.add('hidden');
  menuEl.innerHTML = '';
}

async function dispatch(action, pal) {
  switch (action) {
    case 'delete': bus.emit('action', 'delete'); break;
    case 'duplicate': canvasEditor.duplicateSelection(); break;
    case 'front': bus.emit('action', 'front'); break;
    case 'forward': bus.emit('action', 'forward'); break;
    case 'backward': bus.emit('action', 'backward'); break;
    case 'back': bus.emit('action', 'back'); break;
    case 'rotatecw': canvasEditor.rotateSelected(90); break;
    case 'rotateccw': canvasEditor.rotateSelected(-90); break;
    case 'crop': {
      if (store.selection.length === 1) crop.open(store.selection[0]);
      break;
    }
    case 'lock': bus.emit('action', 'lock'); break;
    case 'rename': bus.emit('rename-layer', store.selection[0]); break;
    case 'paste': await pasteFromClipboard(); break;
    case 'cut': {
      await copySelectionToClipboard();
      canvasEditor.deleteSelection();
      break;
    }
    case 'copy':
      await copySelectionToClipboard();
      break;
  }
}

async function copySelectionToClipboard() {
  const ids = store.selection;
  if (ids.length !== 1) {
    toast('Copy works with a single image selected.', 'error');
    return;
  }
  const layer = store.getLayer(ids[0]);
  const asset = store.getAsset(layer.assetKey);
  if (!asset) return;
  const full = await fullSrcOfAsset(asset);
  const ok = await window.api.writeClipboardImage(full).catch(() => false);
  if (!ok) toast('Could not copy image to clipboard.', 'error');
  else toast('Image copied to clipboard.', 'ok');
}