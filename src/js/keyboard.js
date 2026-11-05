import { store, bus } from './store.js';
import { history } from './history.js';
import { canvasEditor } from './canvas.js';
import { crop } from './crop.js';
import { pasteFromClipboard } from './clipboard.js';
import { closeModal } from './modal.js';

function eventInInput() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

export function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (eventInInput()) return;
    if (crop.isOpen()) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const modalOpen = document.getElementById('modal-root').classList.contains('open');
    if (mod) {
      switch (key) {
        case 'v': e.preventDefault(); pasteFromClipboard(); break;
        case 'z':
          e.preventDefault();
          if (e.shiftKey) history.redo();
          else history.undo();
          break;
        case 'y': e.preventDefault(); if (history.redoStack && history.redoStack.length) history.redo(); break;
        case 'd': e.preventDefault(); canvasEditor.duplicateSelection(); break;
        case 'a': e.preventDefault(); canvasEditor.selectAll(); break;
        case 'n': e.preventDefault(); if (!modalOpen) bus.emit('action', 'new'); break;
        case 'o': e.preventDefault(); if (!modalOpen) bus.emit('action', 'open'); break;
        case 's': e.preventDefault(); bus.emit('action', 'save'); break;
        case 'e': e.preventDefault(); bus.emit('action', 'export'); break;
        case '0': e.preventDefault(); canvasEditor.setZoom(1); break;
        case '=': case '+': e.preventDefault(); canvasEditor.setZoom(store.view.zoom * 1.15); break;
        case '-': e.preventDefault(); canvasEditor.setZoom(store.view.zoom / 1.15); break;
        default: break;
      }
      return;
    }
    if (modalOpen && key === 'escape') {
      closeModal();
      return;
    }
    switch (key) {
      case 'escape':
        canvasEditor.clearSelection();
        break;
      case 'delete':
      case 'backspace':
        canvasEditor.deleteSelection();
        break;
      case 'arrowleft': e.preventDefault(); canvasEditor.nudge((e.shiftKey ? -10 : -1), 0); break;
      case 'arrowright': e.preventDefault(); canvasEditor.nudge((e.shiftKey ? 10 : 1), 0); break;
      case 'arrowup': e.preventDefault(); canvasEditor.nudge(0, (e.shiftKey ? -10 : -1)); break;
      case 'arrowdown': e.preventDefault(); canvasEditor.nudge(0, (e.shiftKey ? 10 : 1)); break;
      default: break;
    }
  });
}