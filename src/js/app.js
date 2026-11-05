import { canvasEditor } from './canvas.js';
import { initUi } from './ui.js';
import { initTray } from './tray.js';
import { initContextMenu } from './contextmenu.js';
import { initKeyboard } from './keyboard.js';

window.addEventListener('DOMContentLoaded', () => {
  canvasEditor.init();
  initUi();
  initTray();
  initContextMenu();
  initKeyboard();
});

document.addEventListener('contextmenu', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  e.preventDefault();
});

window.addEventListener('error', (e) => {
  console.error('Unhandled error:', e.error ? (e.error.message || e.error) : e.message);
});