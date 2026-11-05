import { store, bus } from './store.js';
import { history } from './history.js';
import { el, shortenText } from './util.js';

class LayersPanel {
  init() {
    this.root = document.getElementById('layer-list');
    this.items = new Map();
    bus.on('doc', () => this.render());
    bus.on('selection', () => this.render());
    this.bindTools();
    this.render();
  }

  bindTools() {
    const id = (s) => document.getElementById(s);
    id('btn-bring-front').addEventListener('click', () => this.moveSelection('front'));
    id('btn-bring-forward').addEventListener('click', () => this.moveSelection('forward'));
    id('btn-send-backward').addEventListener('click', () => this.moveSelection('backward'));
    id('btn-send-back').addEventListener('click', () => this.moveSelection('back'));
    id('btn-lock-toggle').addEventListener('click', () => this.toggleLock());
    id('btn-delete-layer').addEventListener('click', () => bus.emit('action', 'delete'));
  }

  render() {
    const layers = store.doc.layers.slice().reverse();
    const wanted = new Set(layers.map((l) => l.id));
    for (const [id, node] of this.items) {
      if (!wanted.has(id)) node.remove();
    }
    const keep = new Map();
    layers.forEach((layer) => {
      let node = this.items.get(layer.id);
      if (!node) {
        node = el('div', 'layer-item');
        node.draggable = true;
        const eye = el('span', 'eye', '👁');
        const name = el('span', 'name');
        const lock = el('span', 'lock', '🔒');
        node.append(eye, name, lock);
        eye.addEventListener('click', (e) => { e.stopPropagation(); this.toggleVisible(layer.id); });
        lock.addEventListener('click', (e) => { e.stopPropagation(); this.toggleLock(layer.id); });
        node.addEventListener('click', (e) => this.clickLayer(e, layer.id));
        node.addEventListener('dblclick', () => bus.emit('rename-layer', layer.id));
        node.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', layer.id); });
        node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('drag-over'); });
        node.addEventListener('dragleave', () => node.classList.remove('drag-over'));
        node.addEventListener('drop', (e) => {
          e.preventDefault();
          node.classList.remove('drag-over');
          const fromId = e.dataTransfer.getData('text/plain');
          const toId = layer.id;
          if (fromId === toId) return;
          this.reorder(fromId, toId);
        });
        this.root.appendChild(node);
      }
      const eye = node.querySelector('.eye');
      const lock = node.querySelector('.lock');
      const name = node.querySelector('.name');
      eye.textContent = layer.visible === false ? '🚫' : '👁';
      eye.classList.toggle('off', layer.visible === false);
      lock.textContent = layer.locked ? '🔒' : '🔓';
      lock.classList.toggle('on', !!layer.locked);
      name.textContent = shortenText(layer.name || 'Layer');
      node.classList.toggle('sel', store.selection.includes(layer.id));
      keep.set(layer.id, node);
    });
    this.items = keep;
  }

  clickLayer(e, id) {
    if (e.ctrlKey) store.toggleSelection(id);
    else store.setSelection([id]);
  }

  toggleVisible(id) {
    history.commit(() => {
      const l = store.getLayer(id);
      if (l) l.visible = l.visible === false ? true : false;
    });
  }

  toggleLock(id) {
    history.commit(() => {
      if (id) {
        const l = store.getLayer(id);
        if (l) l.locked = !l.locked;
      } else {
        const sel = store.selection.slice();
        const anyLocked = sel.some((s) => store.getLayer(s) && store.getLayer(s).locked);
        sel.forEach((s) => {
          const l = store.getLayer(s);
          if (l) l.locked = !anyLocked;
        });
      }
    });
  }

  reorder(fromId, toId) {
    history.commit(() => {
      const arr = store.doc.layers;
      const from = arr.findIndex((l) => l.id === fromId);
      const to = arr.findIndex((l) => l.id === toId);
      if (from < 0 || to < 0) return;
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
    });
  }

  moveSelection(direction) {
    const sel = store.selection.slice();
    if (!sel.length) return;
    history.commit(() => {
      const arr = store.doc.layers;
      const selected = new Set(sel);
      const others = arr.filter((l) => !selected.has(l.id));
      const picked = arr.filter((l) => selected.has(l.id));
      if (direction === 'front') arr.splice(0, arr.length, ...[...others, ...picked]);
      else if (direction === 'back') arr.splice(0, arr.length, ...[...picked, ...others]);
      else if (direction === 'forward') {
        for (let i = 0; i < arr.length - 1; i++) {
          if (selected.has(arr[i].id) && !selected.has(arr[i + 1].id)) {
            const tmp = arr[i]; arr[i] = arr[i + 1]; arr[i + 1] = tmp;
          }
        }
      } else if (direction === 'backward') {
        for (let i = arr.length - 1; i > 0; i--) {
          if (selected.has(arr[i].id) && !selected.has(arr[i - 1].id)) {
            const tmp = arr[i]; arr[i] = arr[i - 1]; arr[i - 1] = tmp;
          }
        }
      }
    });
  }
}

export const layersPanel = new LayersPanel();