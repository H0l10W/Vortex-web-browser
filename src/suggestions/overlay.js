const shell = document.getElementById('overlay-shell');

function applyTheme(themeClassName) {
  const all = [
    'theme-dark', 'theme-dark-purple', 'theme-dark-nord',
    'theme-dark-forest', 'theme-dark-rose', 'theme-dark-sakura',
    'theme-dark-sunny'
  ];
  document.body.classList.remove(...all);
  const darkThemes = new Set([
    'theme-dark', 'theme-dark-purple', 'theme-dark-nord',
    'theme-dark-forest', 'theme-dark-rose', 'theme-dark-sakura',
    'theme-dark-sunny'
  ]);
  const normalizedTheme = darkThemes.has(themeClassName) ? themeClassName : 'theme-dark';
  document.body.classList.add(normalizedTheme);
}

function shortenSuggestionUrl(rawUrl) {
  if (!rawUrl) return '';

  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./i, '');
    const path = decodeURIComponent(url.pathname)
      .replace(/\/{2,}/g, '/')
      .replace(/\/$/, '');
    let suffix = path && path !== '/' ? path : '';

    const isGoogleSearch = /(^|\.)google\./i.test(host) && path === '/search';
    const isYouTubeVideo = /(^|\.)youtube\.com$/i.test(host) && path === '/watch';
    const usefulParam = isGoogleSearch
      ? ['q', url.searchParams.get('q')]
      : isYouTubeVideo
        ? ['v', url.searchParams.get('v')]
        : null;

    if (usefulParam?.[1]) {
      const value = usefulParam[1].replace(/\s+/g, ' ').trim();
      suffix += `?${usefulParam[0]}=${value}`;
    }

    const displayUrl = `${host}${suffix}`;
    return displayUrl.length > 72
      ? `${displayUrl.slice(0, 69)}…`
      : displayUrl;
  } catch (_error) {
    const displayUrl = String(rawUrl)
      .replace(/^[a-z][a-z\d+.-]*:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/[#?].*$/, '')
      .replace(/\/$/, '');
    return displayUrl.length > 72
      ? `${displayUrl.slice(0, 69)}…`
      : displayUrl;
  }
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
    main.textContent = entry?.isSearch
      ? (entry?.label || '')
      : shortenSuggestionUrl(entry?.url);
    if (!entry?.isSearch && entry?.url) main.title = entry.url;

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
