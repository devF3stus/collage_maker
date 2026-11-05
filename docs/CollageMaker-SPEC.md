# CollageMaker — Product & Frontend Architecture Specification

**Version:** 1.0
**Status:** Approved design target for refactor of the current Electron/vanilla-JS implementation
**Core promise:** **Copy → Paste → Auto-Arrange → Tweak → Export** with absolute minimal friction.

---

## Table of Contents

1. [Executive Summary & Design Principles](#1-executive-summary--design-principles)
2. [Information Architecture](#2-information-architecture)
3. [Low-Fidelity UI Layout Schematics](#3-low-fidelity-ui-layout-schematics)
4. [Interaction State Diagrams](#4-interaction-state-diagrams)
5. [Visual Design Tokens](#5-visual-design-tokens)
6. [TypeScript Interfaces](#6-typescript-interfaces)
7. [Component Tree & Module Boundaries](#7-component-tree--module-boundaries)
8. [Performance & Rendering Strategy](#8-performance--rendering-strategy)
9. [UX Edge Case Handling Matrix](#9-ux-edge-case-handling-matrix)
10. [MVP vs. Future Roadmap Triage](#10-mvp-vs-future-roadmap-triage)
11. [Migration Path from Current Codebase](#11-migration-path-from-current-codebase)

---

## 1. Executive Summary & Design Principles

CollageMaker is a desktop collage application for Windows (Electron). Its single most important behavior is that a user can go from a foreign image on their clipboard to a finished arranged collage in under ten seconds, without ever opening a file explorer.

| Principle | Statement | Observable consequence |
|---|---|---|
| **Frictionless Creation** | The default empty state teaches exactly one verb: *paste*. | Empty canvas shows a single dropzone card: "Paste anywhere using Ctrl + V". |
| **Inspector, not sidebar** | One adaptive right panel replaces the traditional left tool rail + right layers rail. | Zero chrome at launch; the canvas is the hero. |
| **One action, one home** | Global ops live in the top bar; workspace properties live in the Inspector. Never both. | No duplicated toolbar buttons; no discoverability ambiguity. |
| **Smart implicit behavior** | The app infers intent from canvas state instead of asking questions. | Ctrl+V fills the next grid slot automatically in Grid mode; lands freeform (staggered) in Freeform mode. No modals. |
| **Non-destructive everything** | Crop, resize, rotate, border, shadow are pure display transforms. | Original raster data is preserved; export math is deterministic. |
| **Uncluttered extremes** | Advanced features live *in context* (inside the Inspector or on the surface), never sprawled. | No "Custom Layout Builder" modal — save current canvas as a template from the Inspector. |

---

## 2. Information Architecture

### 2.1 Navigation Model

Three explicit regions, each with a single responsibility:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  GLOBAL (File / Edit / View / Help + project title)                          │
│  Undo/Redo · Paste (primary) · Add File                                      │
│  Zoom · Fit · Export (primary accent)                                        │
├───────────────  VIEWPORT  ───────────────────────────────┬───────────────────┤
│                                                          │  INSPECTOR        │
│  Canvas + objects + guides + HUD + crop overlay          │  (adaptive)       │
│  paste · drop · pan · zoom · select · drag · swap        │  STATE 1 / STATE 2│
│                                                          │                   │
└───────────────────────────────────────────────────────────┴───────────────────┘
| Status strip: canvas size · image count · zoom           (optional, dismissible) |
```

**Navigation rules:**

- The Inspector is **context-driven**, not user-driven. It swaps modes automatically on selection change (see §4, State Diagram D).
- There is **no left rail**, **no layers panel** in the MVP shell. Z-order controls are quick-actions inside Inspector State 2.
- Every transient action (paste, clone, delete, swap) is reachable from the keyboard first, the surface HUD second, the Inspector third.

### 2.2 Information Architecture Map

```
CollageMaker
├── File
│   ├── New Collage  (Ctrl+N)
│   ├── Open Project (.collage)  (Ctrl+O)
│   ├── Save Project  (Ctrl+S)
│   ├── Save As…
│   └── Export…  (Ctrl+E)
├── Edit
│   ├── Undo  (Ctrl+Z) / Redo  (Ctrl+Y)
│   ├── Paste Image  (Ctrl+V)
│   ├── Duplicate  (Ctrl+D)
│   ├── Select All  (Ctrl+A)
│   ├── Delete  (Del)
│   └── Replace from Clipboard
├── View
│   ├── Zoom In / Out / 100% / Fit
│   ├── Toggle Inspector  (Ctrl+B)
│   └── Toggle Status Strip
├── Help
│   └── About · Keyboard Shortcuts
└── Inspector (adaptive single panel)
    ├── STATE 1 — Canvas Context (nothing selected)
    │   ├── Layout Engine: [ Auto Grid | Preset Templates | Freeform ]
    │   ├── Layout Geometry: Gap · Padding · Corner Radius
    │   ├── Canvas Sizing: aspect presets + Custom…
    │   ├── Canvas Background: Solid / Gradient presets / Transparent
    │   └── (Freeform & Template modes) "Save Current Canvas as Template"
    └── STATE 2 — Object Context (1 image selected)
        ├── Quick Actions: Bring Fwd / Send Bk / Center H / Center V
        ├── Transform: W · H (+aspect lock) · Rotation
        ├── Framing & Crop: Enter Crop Mode · Fill Slot / Fit (Contain)
        ├── Appearance: Border W · Border Color · Drop Shadow
        └── Replace Image from Clipboard · Name · Delete
```

### 2.3 Task Flows (primary)

| Flow | Steps (all keyboard-first) |
|---|---|
| New collage | `Ctrl+N` → `Ctrl+V` × N → `Auto Grid` tweak gap → `Ctrl+E` |
| Business-card style | `Ctrl+N` → pick `4:5` → pick template → `Ctrl+V` × slots → export |
| Precise custom canvas | `Ctrl+N` → Inspector: `Custom…` → draw images in Freeform → `Ctrl+E` |
| Reuse a composition | Freeform arrangement → Inspector → "Save Current Canvas as Template" → reuse later |

---

## 3. Low-Fidelity UI Layout Schematics

### 3.1 Top Navigation Bar

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ ▦ CollageMaker      File ▾  Edit ▾  View ▾  Help ▾                                    │
│        Untitled Collage                      (inline editable)                        │
│ ────────────────────────────────────────────────────────────────                      │
│ ↶ Undo   ↷ Redo     [ + Paste Image (Ctrl+V) ]   + Add File…                          │
│                                                                                       │
│ ◈◈◈◈  [ ⌄ 100% ]  ◈◈◈◈   [ Fit to Screen ]                    [ Export… (Ctrl+E) ]  │
└───────────────────────────────────────────────────────────────────────────────────────┘
  L: identity + menu + title            C: history + intake            R: view + export
```

Rules:
- `[ + Paste Image ]` is the **only** filled/accent-intent low-saturation button at rest; `Export` is the single high-accent CTA.
- Zoom percentage is a **text dropdown** (type-to-set, wheel-to-step when focused).
- Title is one inline editable field; double-click to rename (mirrors "Untitled Collage" until then).

### 3.2 Workspace Viewport — Empty State

```
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║                          ┌─────────────────────────┐                     ║
║                          │          ⌁⌁⌁⌁           │                     ║
║                          │  Paste anywhere using   │                     ║
║                          │         Ctrl + V        │                     ║
║                          │  or drag & drop images  │                     ║
║                          │   directly into window  │                     ║
║                          │                         │                     ║
║                          │  [ Browse Files ]       │  [ Select Template ]║
║                          └─────────────────────────┘                     ║
║                                                                          ║
║    (canvas boundary: subtle shadow, centered, ~60% of viewport)          ║
╔══════════════════════════════════════════════════════════════════════════╝
```

### 3.3 Workspace Viewport — Active State

```
╔══════════════════════════════════════════════════════════════╗
║   [canvas]  ┌────────────────────────────┐                    ║
║             │  ┌───────┐  ┌────────┐     │  (magnetic guide)  ║
║             │  │ img A │  │ mg B ▸ │     │                    ║
║             │  │       │  └────────┘     │                    ║
║             │  │ ░ HUD ░   ┌──────────┐  │  HUD above focus:  ║
║             │  │ [Crop][Swap][✕]       │  │  [ Crop ] [ Swap ] ║
║             │  │               │ img C │  │  [ Delete ]        ║
║             │  └──────────────┴────────┘  │                    ║
║             │                             │                    ║
║             └─────────────────────────────┘                    ║
║      (8-point box + top rotate handle on selected object)      ║
║                                                                ║
╔════════════════════════════════════════════════════════════════╝
```

### 3.4 Inspector — State 1 (Canvas Context)

```
┌──────────────────────────────┐
│ INSPECTOR                    │
│                              │
│ LAYOUT ENGINE                │
│ [ Auto Grid | Preset | Free ?]│  ← segmented, primary
│                              │
│ GEOMETRY                     │
│ Gap Spacing      ▬▬▬▬●── 12px │
│ Outer Padding    ▬▬▬▬●── 40px │
│ Corner Radius    ▬▬▬▬──●  8px │
│                              │
│ CANVAS SIZING                │
│ (▣) 1:1 1080×1080            │
│ ( ) 16:9 1920×1080           │
│ ( ) 9:16 1080×1920           │
│ ( ) 4:5 1080×1350            │
│ ( ) Custom…                  │
│                              │
│ BACKGROUND                   │
│ (●) Solid  ( ) Gradients  ( ) Tr?│
│  ▛▞▜▟▟▜▗▘▙▚▛▞▜ +picker        │
│                              │
│ SAVE CANVAS AS TEMPLATE      │
│ [ Save Current Canvas… ]     │
└──────────────────────────────┘
```

### 3.5 Inspector — State 2 (Object Context)

```
┌──────────────────────────────┐
│ INSPECTOR                    │
│  Image: "Sunset 01"    (✏)  │
│ QUICK ACTIONS                │
│ [⇤Fwd][⇥Back][⌶CenterH][□CenterV]│
│ TRANSFORM                    │
│ W [  640  ]  H [  480  ] □ Lock A?│
│ Rotation [ ⌄ 14° ]           │
│ X [ 220 ]  Y [ 300 ]         │
│ FRAMING & CROP               │
│ [ Enter In-Canvas Crop Mode ]│
│ (●) Fill Slot  ( ) Fit (Contain)│
│ APPEARANCE                   │
│ Border Width [ ▬●── 2 ]      │
│ Border Color  #FFFFFF        │
│ ☑ Drop Shadow  (Soft)        │
│                              │
│ ▣ Replace Image from Clipboard│
│ 🗑 Delete Image               │
└──────────────────────────────┘
```

### 3.6 In-Canvas Crop Mode

```
╔══════════════════════════════════════════════════╗
║                    (darkened 55%)                ║
║                                                   ║
║       ┌───────────────────────────────┐           ║
║       │   (object expands to frame)   │           ║
║       │   ░░░░░ DOCUMENT ░░░░░░░░░░░  │           ║
║       │   ░ + handle (drags image     │           ║
║       │   ░   inside its box)         │           ║
║       └───────────────────────────────┘           ║
║   Esc = cancel   ·   Enter = commit   ·   click-away = commit ║
╔════════════════════════════════════════════════════╝
```

---

## 4. Interaction State Diagrams

### Diagram A — App Shell States

```
                    ┌──────────────┐
                    │   EMPTY      │  ← first launch / New
                    └──────┬───────┘
          Ctrl+V / drop / browse ▼ or template pick
                    ┌──────────────┐
       ┌───────────▶│   ACTIVE     │◀──────────┐
       │            └──────┬───────┘           │ selection cleared
       │             selection ↑               │ or Esc on canvas
       │                   ▼                   │
       │            ┌──────────────┐           │
       └───────────▶│  OBJECT SEL  │───────────┤  (double-click)
                    └──────┬───────┘           │
                           ▼                   │
                    ┌──────────────┐  Enter/Esc│
                    │   CROP MODE  │───────────┤
                    └──────────────┘           │
```
- Any transition emits `push(snapshot)` when the starting state is mutated (see §8.2 history).

### Diagram B — Ctrl+V Intake Engine (decision tree)

```
      Ctrl+V
        │
        ▼
 clipboard has bitmap? ──no──▶ toast bottom: "No image data found in clipboard."
        │ yes                             │
        ▼                                 ▼
  decode bitmap                     (no object created)
        ▼
 source > 4000px? ──yes──▶ display box auto-scaled to fit canvas; raw res preserved
        │ no                            for export
        ▼
 LAYOUT ENGINE?
 ├─ Grid / Template:  empty slot exists? ──yes──▶ fill NEXT sequential slot (fade-in)
 │                             │ no              
 │                             ▼                 
 │                    freeform fallback (below)   
 └─ Freeform:        center on viewport, staggered +20,+20 from previous object
        │
        ▼
 wheels-up in 120ms + auto-select new object
```

### Diagram C — Selection Lifecycle

```
 pointer-down on object
   ├─ plain click        → select (replace)           → show handles + HUD
   ├─ Ctrl+click         → toggle in/out of multi-select
   ├─ drag               → move (snap in Freeform)    → commit on pointer-up
   ├─ corner handle      → resize (aspect-locked unless Shift) → commit on up
   ├─ rotation handle    → rotate (snap 45° unless Alt) → commit on up
   └─ double-click       → CROP MODE → pan/scale frame → commit on Enter/away
 pointer-down on canvas  → deselect; Inspector → STATE 1
```

### Diagram D — Inspector Mode Logic

```
selection.count == 0  → STATE 1 (Canvas)
selection.count == 1  → STATE 2 (Object) [prefill from object]
selection.count  > 1  → STATE 2 (multi)  [hide single-only; show align/distribute]
crop-mode active      → Inspector disabled/locked (surface-only controls)
```

---

## 5. Visual Design Tokens

### 5.1 Color Palette

| Token | Value | Usage |
|---|---|---|
| `--bg-app` | `#16181d` | Window chrome, viewport backdrop |
| `--bg-panel` | `#1d2026` | Top bar, Inspector |
| `--bg-surface` | `#242830` | Cards, inputs, HUD |
| `--bg-elevated` | `#2c313b` | Dropdowns, popovers |
| `--border-subtle` | `#2e333d` | Hairlines |
| `--border-strong` | `#3a404d` | Focus rings (secondary) |
| `--text-primary` | `#e6e9ef` | Headings, labels |
| `--text-secondary` | `#9aa3b2` | Body, hints |
| `--text-faint` | `#5f6res` / `#6a7280` | Disabled |
| `--accent-primary` | `#4f8cff` | Export CTA, selection, guides, focus |
| `--accent-primary--hover` | `#6ea5ff` | Hover of accent |
| `--success` | `#54c97c` | Upload/paste confirmations |
| `--danger` | `#f0656a` | Delete hover/destructive |
| `--warning` | `#f5b942` | Deprecation/notice |
| `--canvas-default-bg` | `#ffffff` | Default canvas fill |
| `--checker-light/--checker-dark` | `#2a2f39` / `#22262e` | Transparent-canvas checkerboard |

### 5.2 Typography

| Scale | Size / Weight / Line height | Where |
|---|---|---|
| Display/Heading | 20 / 600 / 1.25 | Empty-state headline |
| Section Title | 12 / 600 / 1.3 (uppercase, +0.6px tracking) | Inspector section headers |
| Body 13 | 13 / 400 / 1.45 | Controls, lists |
| Body 14 | 14 / 400 / 1.5 | Modal body, toast text |
| Label/Caption | 11 / 500 / 1.3 | Badges, tooltips, status strip |
| Mono | 12 / 400 / 1.4 (`Consolas`) | W/H numeric, zoom % |
| Buttons | 13 / 600 / 1 | Top bar & primary CTA |

### 5.3 Spacing Grid (4px base)

```
4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64
Inspector padding : 12  ·  Section gap : 24
Surface gap      : 8   ·  Panel gap   : 4
Input h          : 32  ·  Button h    : 32 (top bar) / 28 (inline)
Icon hit area    : min 28×28
```
Top bar h `52px` · Status strip `28px` · Inspector `280px fixed`.

### 5.4 Radii, Shadows, Elevations

| Token | Value |
|---|---|
| `--radius-sm` | 6px (inputs, segmented) |
| `--radius-md` | 8px (cards, HUD) |
| `--radius-lg` | 12px (modal, dropzone) |
| `--shadow-canvas` | `0 12px 48px rgba(0,0,0,.55)` |
| `--shadow-pop` | `0 8px 24px rgba(0,0,0,.4)` |
| `--shadow-modal` | `0 20px 60px rgba(0,0,0,.5)` |
| `--focus-ring` | `0 0 0 2px rgba(79,140,255,.45)` |
| Selection outline | 2px `--accent-primary`, -1px offset |

### 5.5 Motion

| Duration | Easing | Use |
|---|---|---|
| 120ms | `cubic-bezier(.2,0,0,1)` | Slot fill fade-in, handle snap |
| 180ms | `ease-out` | HUD appear, inspector mode swap |
| 240ms | `ease` | Modal open/close, guide fade |
| ≥ 24 fps | — | All pointer-driven transforms are **direct** (no transition) |

---

## 6. TypeScript Interfaces

### 6.1 Core State

```ts
export type LayoutEngine = 'auto-grid' | 'templates' | 'freeform';
export type ObjectFit = 'fill' | 'contain';
export type BackgroundSpec =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; type: 'linear' | 'radial'; angle: number; stops: Array<{ color: string; t: number }> }
  | { kind: 'transparent' };
export type AspectPreset = '1:1' | '16:9' | '9:16' | '4:5' | 'custom';

export interface CanvasSettings {
  id: string;
  width: number;            // logical px (model space)
  height: number;
  background: BackgroundSpec;
  cornerRadius: number;     // 0..32
  gap: number;              // 0..64  (slot-to-slot)
  padding: number;          // 0..100 (canvas inner margin)
  engine: LayoutEngine;
  templateId: string | null;
  slotCount?: number;       // desired slots for auto-grid/template
}

export interface ImageObject {
  id: string;
  name: string;
  assetKey: string;                 // pointer into AssetStore (never the blob itself)
  slotId: string | null;            // null in freeform
  // transform (model space, top-left origin, rotation about center)
  x: number; y: number; w: number; h: number; rotation: number;
  objectFit: ObjectFit;
  crop: CropRegion | null;          // non-destructive
  border: { width: number; color: string; radius: number } | null;
  shadow: { enabled: boolean; blur: number; offsetY: number; opacity: number } | null;
  visible: boolean;
  locked: boolean;
  createdAt: number;
  stale?: boolean;                  // asset failed to decode
}

export interface CropRegion { sx: number; sy: number; sw: number; sh: number; }

export interface Slot {
  id: string;
  x: number; y: number; w: number; h: number;
  radius: number;                        // per-slot radius override (≈ corners)
  occupiedBy: string | null;             // ImageObject.id
}

export interface Template {
  id: string;
  name: string;
  source: 'builtin' | 'user';
  slots: Array<Omit<Slot, 'occupiedBy' | 'id'>>;  // relative geometry 0..1
  canvasRatio: { w: number; h: number };
}
```

### 6.2 App State & Store

```ts
export interface AppState {
  version: number;
  title: string;
  canvas: CanvasSettings;
  slots: Slot[];
  objects: ImageObject[];              // z-order = array order (last → topmost)
  selection: string[];                 // ImageObject.id[] — array keeps order
  viewport: ViewportState;             // ephemeral, not persisted
  lastSavedPath: string | null;
}

export interface ViewportState {
  zoom: number;                        // 0.10 .. 5.00
  tx: number; ty: number;              // camera translation (screen px)
}

export interface HistoryStack {
  undo: Snapshot[];
  redo: Snapshot[];
  limit: number;                       // 100 by default
  /** current gesture pre-state while dragging (not yet committed) */
  inFlight: Snapshot | null;
}

type Snapshot = SerializedAppState;     // JSON: deep-cloned, assets stripped to keys
```

### 6.3 Store Actions (command pattern, all undoable)

```ts
export interface StoreActions {
  // document
  newCollage(s: Partial<CanvasSettings>): void;
  setCanvas(patch: Partial<CanvasSettings>): void;
  setTitle(t: string): void;
  // objects
  pasteImage(bitmap: ImageBitmap | string, opts?: { toSlotId?: string }): Promise<Iio['id']>;
  addImageFromAssets(paths: string[]): Promise<void>;
  replaceFromClipboard(objId: string): Promise<void>;
  duplicate(objIds: string[]): void;
  delete(objIds: string[]): void;
  setTransform(objId: string, patch: Partial<Transform>): void;   // gesture-safe
  setCrop(objId: string, patch: CropRegion | null): void;
  setObjectFit(objId: string, fit: ObjectFit): void;
  setAppearance(objId: string, patch: Partial<Appearance>): void;
  // layout
  applyLayout(engine: LayoutEngine, opts?: { templateId?: string }): void;
  setSpacing(patch: { gap?: number; padding?: number; radius?: number }): void;
  saveCanvasAsTemplate(name: string): void;
  // selection & history
  select(ids: string[], mode?: SelectionMode): void;   // 'replace' | 'toggle' | 'add'
  undo(): void; redo(): void;
}
```

### 6.4 Asset Store

```ts
export interface AssetRecord {
  key: string;
  source: { type: 'file'; path: string } | { type: 'data'; dataUrl: string } | { type: 'blob'; blob: Blob };
  bitmap: ImageBitmap;            // decoded once, cached; source of truth for render
  naturalW: number; naturalH: number;
  previewBitmap?: ImageBitmap;    // ≤1600px preview used on canvas surface
  refCount: number;
}
```

---

## 7. Component Tree & Module Boundaries

```
<App/>
├── <TopBar>                        ← identity, title, history, intake, zoom, export
│   ├── <TitleInput/>
│   ├── <HistoryButtons/>  <PasteButton/>  <AddFileButton/>
│   └── <ZoomControl/>  <ExportButton/>
├── <Viewport>
│   ├── <CanvasSurface/>            ← DOM layer of objects (GPU-composited)
│   │   ├── <SlotLayer/>            ← grid slots / slot highlight on drag-over
│   │   ├── <ObjectLayer/>          ← per-image <ImageObjectView/>
│   │   ├── <GuideLayer/>           ← magnetic snap guides (transient)
│   │   └── <SelectionOverlay/>     ← 8-point box + rotate handle
│   ├── <FloatingHUD/>              ← [Crop][Swap][Delete] above focus object
│   ├── <CropOverlay/>              ← modal crop surface (own event loop)
│   └── <PanZoomController/>        ← wheel/pinch/pan, camera math (not a component)
├── <Inspector/>                    ← adaptive; renders per selection state
│   ├── <CanvasTab/>                ← State 1
│   │   ├── <LayoutEngineSeg/>
│   │   ├── <GeometryControls/>     ← gap/padding/radius sliders
│   │   ├── <AspectPicker/>  <BackgroundControls/>  <SaveTemplateButton/>
│   └── <ObjectTab/>                ← State 2
│       ├── <QuickActions/>  <TransformControls/>  <CropFrameControls/>
│       └── <AppearanceControls/>  <ReplaceClipboardButton/>
├── <ModalLayer/>  <ToastLayer/>  <ContextMenuLayer/>
└── <StatusStrip/>                  ← canvas size · object count · zoom
```

**Boundary rules**
- **UI Shell** never mutates state directly — it dispatches `StoreActions`.
- **CanvasSurface** is a pure function of `objects + slots + camera`; gesture handlers emit transforms, not DOM writes.
- **Inspector** reads state via selectors, writes via actions. `290ms` selection-debounce prevents flicker during drag-deselect peaks.
- All raster I/O (decode, preview generation, export render) lives in the **AssetPipeline** module, isolated from the UI thread interaction path.

---

## 8. Performance & Rendering Strategy

### 8.1 Raster pipeline (target: interaction ≥60fps up to 60 objects)

1. **Decode once, cache forever.** Every asset decodes to a single reusable `ImageBitmap` on the main thread once, plus a downscaled `previewBitmap` (longest edge ≤ 1600px). Original resolution is retained as an on-disk or Blob reference.
2. **Edit-time surface draws previews; export-time draws originals.** The canvas surface composites only `previewBitmap`s so W/H scaling stays cheap. `renderExport()` re-runs the same transform math against full-resolution bitmaps offscreen (see §8.3).
3. **GPU compositing.** Each object is a composited element; transforms (translate/scale/rotate) are CSS `transform`-only during gestures, so the compositor never re-rasterizes the image — only re-transforms its texture. Border/shadow live on the same layer to avoid repaints.
4. **Zero full-canvas raster during gestures.** Smart guides and selection overlap are separate overlay layers; guides fade with `opacity` transitions only.
5. **Debounced handles.** Nudge/typing transforms (Inspector W/H, rotation field) go through a `rAF`-debounced apply; pointer handles apply directly.
6. **Optional OffscreenCanvas mode.** For very large canvases (`width*height*zoom` > budget), `ObjectLayer` can be rendered into an offscreen canvas texture (`requestAnimationFrame` + `blitOnMessage`), trading a bit of crispness for smooth zoom/pan.
7. **Memory guard.** Previews are bounded; bitmap pool evicts LRU beyond 400MB; failed decodes set `stale` and show a broken-image badge rather than blocking the flow.

### 8.2 History engine

- Snapshots are **serialized AppState with assets stripped to keys** (AssetStore lives outside snapshots). Deep-clone cost is O(UI model) and ms-level.
- **Gesture-safe**: `begin()` captures pre-state; pointer-up either `commit()` (push) or `cancel()` (discard). Slider/number inputs commit on `pointerup`/`blur`, not on every `input`.
- Undo of a big paste is a fast array swap, not a re-render of bitmaps (bitmaps are cached and keyed).

### 8.3 Export math

```
result = W*scale × H*scale offscreen canvas
  for obj in objects(Z-order):
    ctx.setTransform(1,0,0,1,0,0)
    ctx.translate(cx*s, cy*s); ctx.rotate(rot)
    ctx.save(); apply rounded-rect clip (cornerRadius)
    drawImage(fullBitmap, sx, sy, sw, sh, -w/2*s, -h/2*s, w*s, h*s)   // non-destructive crop
    stroke border / paint shadow via ctx.shadow*
```
Export is deterministic — identical canvas + state ⇒ identical pixels. JPEG export flattens transparent background to requested solid (default white).

---

## 9. UX Edge Case Handling Matrix

| # | Edge case | Expected behavior |
|---|---|---|
| 1 | Clipboard holds text / no bitmap | Bottom toast: *"No image data found in clipboard."*; no object created |
| 2 | Clipboard holds multiple images * | Paste first; additional payloads queued as sequential pastes |
| 3 | Pasted image > 4000px | Display box auto-scaled to canvas; raw pixels preserved for export |
| 4 | Paste while an image is selected (Freeform) | New image nested +20,+20; previous selection collapses to new |
| 5 | Paste with all slots full (Grid/Template) | Falls back to freeform cascade; global gap/padding unchanged |
| 6 | Dropping unsupported file (`.exe`, `.txt`) | Toast *"This file type isn't supported."*; no partial add |
| 7 | File fails to decode mid-import | Skip + toast *"1 of 3 images failed to load."*; don't roll back the batch |
| 8 | Object dragged fully off-canvas | Preview clamps; object remains recoverable via Inspector W/H reset & `Ctrl+A` |
| 9 | Shift during resize | Freely distort aspect; default is locked aspect |
| 10 | Alt during rotation | Disables 45° snapping (precise rotation) |
| 11 | Locked object selected | Handles hide transform; HUD shows 🔒; Inspector edits disabled with tooltip |
| 12 | Multiple objects selected → Inspector | Multi-mode: hide name/crop/border; show align & distribute |
| 13 | Double-click empty canvas area | No-op (deselect); double-click object = crop mode |
| 14 | Crop frame smaller than min (12px) | Clamp; pointer-up that yields < min is ignored |
| 15 | Crop commit on click-away | Commits current frame (matches "click away commits frame") — undoable |
| 16 | JPG export with transparent background | Auto-flatten to chosen solid (default white) |
| 17 | Resize handle on 1×1 corner | AspectJitter guard: min 6px; corner handles keep anchor fixed |
| 18 | Undo immediately after paste-fade | Fade is reverted with object; animation does not replay on redo (idempotent render) |
| 19 | Canvas resized smaller than objects | Objects preserved & clipped (non-destructive); Inspector notes "may be outside canvas" |
| 20 | Template applied with more/fewer images than slots | Extra objects → freeform stash; empty slots remain visible placeholders |
| 21 | Drag-A onto B in Grid mode | B slot highlights accent; release swaps positions; grid metrics unchanged |
| 22 | Zoom >400% | Handles scale counter-proportionally (constant screen size); editable precision arrows |
| 23 | `Ctrl+Z` during active drag | Drag completes/reverts as a unit (gesture-safe history) |
| 24 | New collision on paste (overlapping freeform) | Cascade offset intends overlap by design (stagger); snap guides render on demand |
| 25 | System clipboard lost focus (app blurred) | Paste handler stays active via window blur-guard only for pan; intake requires focus |

### Sequence for the "no-image clipboard" toast (single source of truth)

```
ClipboardService.read() 
  → formats: bitmap? → decode 
  → file-paths with image ext? → import each
  → else → emit('noImage') → ToastLayer shows 3.2s, dismissible, non-blocking
```

---

## 10. MVP vs. Future Roadmap Triage

### MUST HAVE — MVP v1.0
- [x] Electron shell, single window, empty-state dropzone
- [x] `Ctrl+V` bitmap intake with slot-aware placement (Rules 1–4) + staggered freeform
- [x] Drag & drop + "Browse Files" intake (multi)
- [x] Primitive canvas editor: move, resize (aspect-locked), rotate (45° snap), delete, duplicate, select (single + Ctrl multi)
- [x] Inspector State 1: engine segmented control, gap/padding sliders, aspect presets, solid/transparent background
- [x] Inspector State 2: W/H + aspect lock, rotation, enter-crop, fill/contain fit
- [x] Auto Grid + built-in templates (2–9 slots) + Freeform
- [x] Undo/redo (gesture-safe), `Ctrl+S` project save and `Ctrl+O` open
- [x] Export PNG/JPG/WebP (1×–3×), background handling, preview before save
- [x] Smart guide snapping (Freeform) + align/distribute on multi-select
- [x] Toasts + empty-state affordability; friendly errors

### SHOULD HAVE — v1.1
- [ ] In-canvas crop mode (double-click) with pan/scale frame
- [ ] Drag-to-swap in Grid/Template mode
- [ ] Replace Image from Clipboard
- [ ] Border width/color + corner radius (surface-level, non-destructive)
- [ ] Floating HUD above selection (`Crop / Swap / Delete`)
- [ ] "Save Current Canvas as Template" button (no separate builder modal)

### NICE TO HAVE — v1.2
- [ ] Drop shadow toggle (soft presets)
- [ ] Gradient background presets (curated swatches, not a full editor)
- [ ] Template gallery view with thumbnails
- [ ] Bundled installer + auto-update
- [ ] Status strip with live canvas dims / object count / zoom

### DO NOT BUILD YET (explicitly deferred / forbidden)
- Manual slot splitters & per-slot manual geometry editors
- Full layer tree panel (drag trees, blend modes, masks)
- Radial gradient editor (angle/blur/stops) — curated presets only
- Filters / adjustment layers / text tool
- Plugins / scripting
- 3D or perspective transforms
- Any kind of modal "Layout Builder" workflow

---

## 11. Migration Path from Current Codebase

The existing app is an Electron + vanilla-ES-module implementation at `src/js/*` with the same underlying model. The refactor is **incremental**, not a rewrite:

| Current module | Refactor target | Notes |
|---|---|---|
| `store.js` (Store+doc) | `store.ts` + typed `AppState` | Adopt §6 interfaces; keep event bus (`bus.js`). |
| `history.js` | command/gesture-safe engine per §8.2 | Already snapshot-based; add `inFlight` gesture node. |
| `canvas.js` | `CanvasSurface` + `PanZoomController` | Extract selection/guide/HUD into overlay layers (§7). |
| `clipboard.js` | `ClipboardService` + `AssetPipeline` | Add >4000px rule + preview/full split. |
| `layout.js` | `LayoutEngine` (auto-grid/templates/freeform) | Add drag-to-swap + slot occupancy model. |
| `ui.js` (left rail) | **delete** left rail; move controls into `Inspector` States 1/2 | IA change per §2. |
| `export.js` | `renderExport()` offscreen renderer | Deterministic math per §8.3. |

**Order of operations (each step shippable):**
1. Introduce typed `AppState` model + `AssetStore` (bitmap/preview split) behind existing store.
2. Build `Inspector` (right, adaptive) reusing existing store; keep old left rail read-only temporarily for parity testing.
3. Flip default: remove left rail; wire Inspector States 1/2.
4. Add drag-to-swap, in-canvas crop, floating HUD.
5. Replace export with deterministic offscreen renderer; add JPEG flatten.
6. Promote quality gates: 60fps budget test (60 objects), snapshot serialize/undo bench, export pixel-fixtures.

---

*End of specification. Appendices (keyboard reference, A/B test plan for empty-state copy) available on request.*