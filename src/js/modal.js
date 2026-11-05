import { el } from './util.js';

const root = () => document.getElementById('modal-root');

export function openModal({ title, body, footer, width }) {
  const backdrop = el('div', 'modal-backdrop');
  const modal = el('div', 'modal');
  if (width) modal.style.width = width;
  const head = el('div', 'modal-head');
  head.appendChild(el('span', null, title));
  const closeBtn = el('button', 'x', '✕');
  closeBtn.addEventListener('click', close);
  head.appendChild(closeBtn);
  modal.appendChild(head);
  if (body) modal.appendChild(body);
  if (footer) modal.appendChild(footer);
  backdrop.appendChild(modal);
  root().innerHTML = '';
  root().appendChild(backdrop);
  root().classList.add('open');
  return { backdrop, modal, close };
}

export function closeModal() {
  root().classList.remove('open');
  root().innerHTML = '';
}

export function modalButtons(buttons) {
  const foot = el('div', 'modal-foot');
  buttons.forEach((b) => {
    const btn = el('button', 'wbtn' + (b.primary ? ' primary' : ''), b.label);
    btn.addEventListener('click', (e) => b.onClick && b.onClick(e));
    foot.appendChild(btn);
  });
  return foot;
}

export function confirmModal(message, onYes, opts = {}) {
  const body = el('div', 'modal-body');
  body.appendChild(el('p', 'hint', message));
  const foot = modalButtons([
    { label: 'Cancel' },
    { label: opts.confirmLabel || 'OK', primary: true, onClick: () => { closeModal(); onYes && onYes(); } },
  ]);
  openModal({ title: opts.title || 'Confirm', body, footer: foot });
}

export function promptModal(title, label, initial, onOk) {
  const body = el('div', 'modal-body');
  const input = el('input', 'grow-input');
  input.type = 'text';
  input.value = initial || '';
  input.style.marginTop = '8px';
  body.appendChild(el('label', 'hint', label));
  body.appendChild(input);
  const foot = modalButtons([
    { label: 'Cancel' },
    { label: 'Save', primary: true, onClick: () => { closeModal(); onOk(input.value.trim()); } },
  ]);
  openModal({ title, body, footer: foot });
  setTimeout(() => { input.focus(); input.select(); }, 30);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') closeModal(), onOk(input.value.trim());
  });
}