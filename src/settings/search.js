import { icon, element, button } from '../renderer/ui-elements.js';

window.addEventListener('DOMContentLoaded', () => {
  const header = document.getElementById('full-settings-header');
  const tabs = [...document.querySelectorAll('.settings-tab-button')];
  const sections = [...document.querySelectorAll('.settings-tab-content')];
  for (const tab of tabs) {
    tab.querySelector('.setting-icon')?.replaceChildren(icon(tab.dataset.tab === 'general' ? 'settings' : tab.dataset.tab));
    tab.setAttribute('aria-controls', `${tab.dataset.tab}-settings`);
  }
  // Use the same vector vocabulary for section headings instead of platform emoji.
  document.querySelectorAll('.settings-card h4').forEach(heading => {
    const text = heading.textContent.replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]+/u, '').trim();
    heading.textContent = text;
  });
  const searchWrap = element('div', undefined, 'settings-search-wrap');
  const search = document.createElement('input'); search.type = 'search'; search.id = 'settings-search';
  search.placeholder = 'Search settings'; search.setAttribute('aria-label', 'Search settings');
  const clear = button('Clear', () => { search.value = ''; render(); search.focus(); }, 'settings-search-clear');
  searchWrap.append(icon('search'), search, clear); header.append(searchWrap);
  const results = element('section', undefined, 'settings-search-results'); results.hidden = true;
  results.setAttribute('aria-label', 'Settings search results');
  const status = element('p', '', 'settings-search-status'); status.setAttribute('role', 'status');
  const list = element('div', undefined, 'settings-search-list'); results.append(status, list);
  document.querySelector('.settings-tab-content').parentElement.prepend(results);

  const entries = [];
  for (const section of sections) {
    const sectionId = section.id.replace(/-settings$/, '');
    const category = tabs.find(tab => tab.dataset.tab === sectionId)?.querySelector('.setting-text')?.textContent || sectionId;
    for (const card of section.querySelectorAll('.settings-card')) {
      const heading = card.querySelector('h4, h3');
      const name = heading?.textContent.trim() || category;
      const controls = [...card.querySelectorAll('input:not([type="hidden"]), select, button, [role="button"]')];
      const indexed = new Set();
      for (const control of controls) {
        if (control.closest('[hidden], .modal') || control.type === 'file') continue;
        const row = control.closest('.setting-group, .toggle-setting, .profile-control-group, .privacy-cleanup-row') || control.parentElement;
        const label = control.labels?.[0]?.textContent.trim() || row.querySelector('.setting-label, .toggle-label, strong, label')?.textContent.trim() || control.getAttribute('aria-label') || (control.tagName === 'BUTTON' ? control.textContent.trim() : '');
        if (!label || indexed.has(label)) continue;
        indexed.add(label);
        entries.push({ name: label.replace(/\s+/g, ' '), context: `${category} · ${name}`, text: `${category} ${name} ${label} ${row.textContent}`.toLocaleLowerCase(), sectionId, target: control, row });
      }
      entries.push({ name, context: category, text: `${category} ${card.textContent}`.toLocaleLowerCase(), sectionId, target: controls[0] || heading || card, row: card });
    }
  }
  let selectedSection = tabs.find(tab => tab.classList.contains('active'))?.dataset.tab || 'general';
  const aliases = { theme: 'appearance', cookies: 'cookie', downloads: 'download', restart: 'restart', password: 'login', toolbar: 'appearance' };
  const hideResults = () => {
    results.hidden = true;
    sections.forEach(section => { section.hidden = false; section.classList.toggle('active', section.id === `${selectedSection}-settings`); });
    clear.hidden = !search.value;
  };
  function render() {
    const query = search.value.trim().toLocaleLowerCase(); clear.hidden = !query;
    if (!query) { hideResults(); return; }
    sections.forEach(section => { section.hidden = true; }); results.hidden = false; list.replaceChildren();
    const words = query.split(/\s+/);
    const found = entries.filter(entry => words.every(word => entry.text.includes(word) || (aliases[word] && entry.text.includes(aliases[word]))))
      .sort((a, b) => {
        const score = entry => words.reduce((sum, word) => sum + (entry.name.toLocaleLowerCase().includes(word) ? 10 : 0), 0);
        return score(b) - score(a);
      });
    status.textContent = found.length ? `${found.length} matching settings` : `No settings found for “${search.value.trim()}”. Try “cookies”, “downloads”, or “theme”.`;
    for (const entry of found) {
      const result = button('', () => {
        search.value = ''; selectedSection = entry.sectionId; hideResults();
        tabs.find(tab => tab.dataset.tab === entry.sectionId)?.click();
        requestAnimationFrame(() => {
          entry.row.scrollIntoView({ block: 'center', behavior: 'instant' });
          if (!entry.target.matches('button,input,select,textarea,[tabindex]')) entry.target.tabIndex = -1;
          entry.target.focus({ preventScroll: true });
          entry.row.classList.add('setting-search-highlight');
          setTimeout(() => entry.row.classList.remove('setting-search-highlight'), 2200);
        });
      }, 'settings-search-result');
      result.append(element('strong', entry.name), element('small', entry.context)); list.append(result);
    }
  }
  search.addEventListener('input', render);
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); search.value = ''; render(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); list.querySelector('button')?.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); list.querySelector('button')?.click(); }
  });
  tabs.forEach(tab => tab.addEventListener('click', () => {
    selectedSection = tab.dataset.tab; search.value = ''; hideResults();
    tabs.forEach(other => other.setAttribute('aria-current', other === tab ? 'page' : 'false'));
  }));
  hideResults();
  const requestedTab = location.hash.slice(1);
  tabs.find(tab => tab.dataset.tab === requestedTab)?.click();
  const userAgent = document.getElementById('user-agent-input-full');
  if (userAgent) {
    const note = element('small', 'Restart required after changing the user agent.', 'restart-required-note'); userAgent.parentElement.append(note);
  }
  document.documentElement.dataset.settingsSearchReady = 'true';
});
