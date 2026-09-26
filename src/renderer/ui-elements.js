// Shared, local vector icons and accessible dialogs for browser-owned pages.
const paths = {
  back: '<path d="m14 6-6 6 6 6"/>', forward: '<path d="m10 6 6 6-6 6"/>',
  reload: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
  history: '<path d="M3 5v5h5M3 10a9 9 0 1 1 1 7M12 7v5l3 2"/>',
  settings: '<path d="m10 3-.8 3-3 .7-2.2 2.7 2 2.6-1 3 2 3 3-.3 2 2.3 3-.7 1-3 3-.8 1-3-2-2.4.3-3-3-1.4L13 3Z"/><circle cx="12" cy="12" r="3"/>',
  incognito: '<path d="M3 10h18M6 10l2-6h8l2 6M10 16h4"/><circle cx="6.5" cy="16.5" r="3.5"/><circle cx="17.5" cy="16.5" r="3.5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  workspace: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 5V3h8v2M3 11h18M10 11v10"/>',
  menu: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>', minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  restore: '<path d="M8 8V4h12v12h-4"/><rect x="4" y="8" width="12" height="12" rx="1"/>',
  appearance: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/>',
  widgets: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  privacy: '<path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6Z"/><path d="m8 12 3 3 5-6"/>',
  performance: '<path d="m13 2-9 12h7l-1 8 10-13h-7Z"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
};
export function icon(name) {
  const template = document.createElement('template');
  template.innerHTML = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.settings}</svg>`;
  return template.content.firstElementChild;
}
export function button(label, onClick, className = '') {
  const el = document.createElement('button');
  el.type = 'button'; el.textContent = label; el.className = className;
  if (onClick) el.addEventListener('click', onClick);
  return el;
}
export function element(tag, text, className = '') {
  const el = document.createElement(tag); el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
export function panel(id, title) {
  const dialog = element('dialog', undefined, 'vortex-dialog'); dialog.id = id;
  const heading = element('h2', title); heading.id = `${id}-title`;
  dialog.setAttribute('aria-labelledby', heading.id);
  const header = element('header', undefined, 'vortex-dialog-header');
  const close = button('Close', () => dialog.close(), 'quiet-button');
  header.append(heading, close);
  const content = element('div', undefined, 'vortex-dialog-body');
  dialog.append(header, content); document.body.append(dialog);
  dialog.addEventListener('click', e => {
    const r = dialog.getBoundingClientRect();
    if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close();
  });
  let opener;
  dialog.addEventListener('close', () => {
    opener?.setAttribute('aria-expanded', 'false');
    const active = document.activeElement;
    // Native dialogs normally restore focus synchronously. Do not steal focus
    // from a control or webpage the caller focused after close().
    if (opener?.isConnected && opener.getClientRects().length &&
        (active === document.body || active === dialog || dialog.contains(active))) opener.focus();
  });
  return { dialog, content, open(trigger) {
    document.querySelectorAll('dialog[open]').forEach(other => { if (other !== dialog) other.close(); });
    opener = trigger || document.activeElement;
    opener?.setAttribute('aria-expanded', 'true');
    if (!dialog.open) dialog.showModal();
  } };
}
