import { store, bus } from './store.js';

function snapshotDoc() {
  return JSON.parse(JSON.stringify(store.doc));
}

class History {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
    this.gestureBefore = null;
  }

  commit(fn) {
    this.undoStack.push(snapshotDoc());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    if (fn) fn();
    bus.emit('doc');
    this.emit();
  }

  begin() {
    this.gestureBefore = snapshotDoc();
  }

  apply(fn) {
    fn();
    bus.emit('doc');
  }

  finish() {
    if (this.gestureBefore) {
      this.undoStack.push(this.gestureBefore);
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
      this.gestureBefore = null;
      bus.emit('doc');
      this.emit();
    }
  }

  cancelGesture() {
    this.gestureBefore = null;
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(snapshotDoc());
    const prev = this.undoStack.pop();
    store.doc = prev;
    store.selection = [];
    bus.emit('doc');
    bus.emit('selection');
    this.emit();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(snapshotDoc());
    const next = this.redoStack.pop();
    store.doc = next;
    store.selection = [];
    bus.emit('doc');
    bus.emit('selection');
    this.emit();
  }

  emit() {
    bus.emit('history', { canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 });
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.gestureBefore = null;
    this.emit();
  }
}

export const history = new History();