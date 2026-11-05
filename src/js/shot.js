import { store, bus } from './store.js';
import { history } from './history.js';
import { addImageSources } from './clipboard.js';
import { layoutBoxes, applyLayoutToLayers } from './layout.js';
import { canvasEditor } from './canvas.js';

function makeImg(w, h, color) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  return c.toDataURL();
}

export async function run() {
  store.reset();
  history.reset();
  store.doc.canvas.width = 1080;
  store.doc.canvas.height = 1080;
  bus.emit('doc');

  const colors = ['#e74c3c', '#2ecc71', '#3498db', '#f1c40f', '#9b59b6', '#34495e'];
  const sizes = [600, 400, 520, 380, 300, 420];
  const dls = colors.map((c, i) => makeImg(sizes[i], sizes[i], c));
  await addImageSources(dls.map((d, i) => ({ dataURL: d, name: 'Shot Image ' + (i + 1) })));
  const ids = store.doc.layers.map((l) => l.id);
  const boxes = layoutBoxes(ids.length, 'balanced', 1080, 1080, 36, 10);
  applyLayoutToLayers(ids, boxes);
  history.commit(() => {
    const l = store.getLayer(ids[0]);
    if (l) l.rotation = 14;
    store.setSelection([ids[3]]);
  });
  bus.emit('doc');
  bus.emit('selection');
  canvasEditor.updateSelectionUI();
}