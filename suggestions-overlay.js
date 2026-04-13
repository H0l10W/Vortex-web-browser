const shell = document.getElementById('overlay-shell');

function applyTheme(themeClassName) {
  const all = [
    'theme-light', 'theme-dark',
    'theme-light-mint', 'theme-light-sakura', 'theme-light-sunny',
    'theme-dark-purple', 'theme-dark-nord', 'theme-dark-forest', 'theme-dark-rose'
  ];
  document.body.classList.remove(...all);
  if (!themeClassName) return;
  const classes = String(themeClassName).split(/\s+/).filter(Boolean);
  classes.forEach(c => document.body.classList.add(c));
}

function render(payload) {
  shell.innerHTML = '';
  const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  const selectedIndex = Number(payload?.selectedIndex) || 0;

  suggestions.forEach((entry, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'item';
    if (index === selectedIndex) item.classList.add('active');

    const source = document.createElement('span');
    source.className = 'source';
    source.textContent = entry?.isSearch ? 'Search' : (entry?.source || 'history');

    const main = document.createElement('span');
    main.className = 'main';
    main.textContent = entry?.isSearch ? (entry?.label || '') : (entry?.url || '');

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = entry?.isSearch ? '' : (entry?.label || '');

    item.appendChild(source);
    item.appendChild(main);
    item.appendChild(meta);

    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      window.overlayAPI.selectSuggestion(index);
    });

    shell.appendChild(item);
  });
}

window.overlayAPI.onData((payload) => {
  applyTheme(payload?.themeClassName || '');
  render(payload || {});
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    window.overlayAPI.hideOverlay();
  }
});
