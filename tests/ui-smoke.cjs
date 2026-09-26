// Run inside Electron against a disposable profile, never the user's browsing data.
const { app, BrowserWindow, webContents } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert/strict');
const output = process.env.VORTEX_UI_TEST_DIR;
if (!output || !path.resolve(output).startsWith(path.resolve(__dirname, '../dist') + path.sep)) throw new Error('A workspace-local test directory is required.');
app.setPath('userData', path.join(output, 'profile'));
app.setAppPath(path.resolve(__dirname, '..'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'browser-storage.json'), JSON.stringify({
  showWeatherWidget: 'false', showNewsWidget: 'false', showResourceControl: 'false',
  theme: 'theme-dark', startPage: 'newtab', downloadLocation: output, askDownloadLocation: 'false',
  adblockEnabled: 'false', httpsOnly: 'false',
}));
require('../main.js');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { try { if (await fn()) return; } catch {} await delay(100); }
  throw new Error(`Timed out: ${message}`);
}
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/download')) {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="sample.txt"', 'Content-Length': 65536 });
    let sent = 0; const timer = setInterval(() => { res.write(Buffer.alloc(4096, 65)); sent += 4096; if (sent >= 65536) { clearInterval(timer); res.end(); } }, 70);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><head><title>${req.url.includes('beta') ? 'Beta reference' : 'Alpha research'}</title></head><body><h1>Local browser test</h1><p>Deterministic content for navigation and tab tests.</p></body></html>`);
  }
});
const failures = []; const passed = [];
async function check(name, fn) { try { await fn(); passed.push(name); console.log(`UI PASS: ${name}`); } catch (error) { failures.push({ name, error: error.stack }); console.error(`UI FAIL: ${name}: ${error.message}`); } }
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let win;
  await until(() => { win = BrowserWindow.getAllWindows().find(w => /index\.html/.test(w.webContents.getURL())); return win; }, 'browser window');
  win.webContents.setBackgroundThrottling(false);
  const errors = [];
  win.webContents.on('console-message', details => { if (details?.level === 'error') errors.push(details.message); });
  const run = expression => win.webContents.executeJavaScript(expression, true);
  const click = async selector => {
    const rect = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw Error('Missing control'); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: Math.round(rect.x), y: Math.round(rect.y) });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: Math.round(rect.x), y: Math.round(rect.y) });
    await delay(100);
  };
  const snap = async name => {
    await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await delay(180);
    fs.writeFileSync(path.join(output, `${name}.png`), (await win.capturePage()).toPNG());
  };
  await until(() => run(`document.documentElement.dataset.browserUiReady === 'true'`), 'browser UI initialization');
  win.show(); win.focus(); win.setSize(1280, 850); await delay(450);
  await check('Native caption drag region, complete tab borders and adjacent New tab button', async () => {
    const geometry = await run(`(()=>{const tabs=document.querySelector('#tabs'),tab=tabs.querySelector('.tab'),add=document.querySelector('#new-tab-btn'),drag=document.querySelector('#titlebar-drag-space'),r=drag.getBoundingClientRect(),t=tab.getBoundingClientRect(),s=tabs.getBoundingClientRect();return {dragX:r.x+r.width/2,dragY:r.y+r.height/2,dragWidth:r.width,adjacent:add.previousElementSibling===tab,top:t.top,bottom:t.bottom,stripTop:s.top,stripBottom:s.bottom,border:getComputedStyle(tab).borderBottomWidth};})()`);
    assert.ok(geometry.adjacent); assert.ok(geometry.dragWidth >= 40);
    assert.ok(await run(`(()=>{const s=document.querySelector('#tabs').getBoundingClientRect(),t=document.querySelector('#tabs .tab').getBoundingClientRect(),b=document.querySelector('#new-tab-btn').getBoundingClientRect();return s.width>220 && t.left>=s.left && b.right<=s.right;})()`), 'Tab and New tab must both be visibly inside the strip');
    assert.ok(geometry.top >= geometry.stripTop + 3 && geometry.bottom <= geometry.stripBottom - 3);
    assert.equal(geometry.border, '1px');
    const bounds = win.getContentBounds();
    const { stdout } = await require('util').promisify(require('child_process').execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'chrome-hit-test.ps1'), '-WindowHandle', win.getNativeWindowHandle().readBigUInt64LE().toString(), '-PointX', String(Math.round(bounds.x + geometry.dragX)), '-PointY', String(Math.round(bounds.y + geometry.dragY))], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    const result = stdout.trim();
    assert.equal(result, '2', 'Windows must recognize the empty title bar as HTCAPTION');
    await snap('tab-chrome');
  });
  await check('Toolbar menu opens with pointer and Escape restores focus', async () => {
    await click('#toolbar-menu-btn'); assert.equal(await run(`document.querySelector('#toolbar-menu').open`), true);
    await snap('toolbar-menu');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await delay(80); assert.equal(await run(`document.activeElement.id`), 'toolbar-menu-btn');
  });
  await check('Quick settings are integrated and retain their handlers', async () => {
    await click('#toolbar-menu-btn');
    assert.equal(await run(`document.querySelector('#controls #settings')`), null);
    assert.equal(await run(`document.querySelectorAll('#toolbar-menu .menu-quick-settings input').length`), 5);
    const before = await run(`document.querySelector('#show-bookmarks-bar').checked`);
    await click('#show-bookmarks-bar');
    assert.equal(await run(`localStorage.getItem('showBookmarksBar')`), String(!before));
    assert.equal(await run(`document.querySelector('#toolbar-menu').open`), true);
    await click('#show-bookmarks-bar');
    await run(`document.querySelector('#toolbar-menu').close();document.querySelector('#toolbar-menu-btn').click()`);
    assert.equal(await run(`document.querySelector('#show-bookmarks-bar').checked`), before);
    assert.equal(await run(`document.querySelector('#overlay').classList.contains('active')`), false);
    assert.ok(await run(`(()=>{const r=document.querySelector('#toolbar-menu').getBoundingClientRect();return r.right<=innerWidth && r.bottom<=innerHeight && r.top>=document.querySelector('#controls').getBoundingClientRect().bottom;})()`));
    await run(`[...document.querySelectorAll('#toolbar-menu button')].find(b=>b.textContent==='Manage bookmarks').click()`);
    assert.equal(await run(`document.querySelector('#bookmark-manager').open`), true);
    assert.equal(await run(`document.querySelector('#toolbar-menu').open`), false);
    await run(`document.querySelector('#bookmark-manager').close()`);
  });
  await check('Toolbar pinning persists', async () => {
    await run(`document.querySelector('#toolbar-menu-btn').click(); [...document.querySelectorAll('#toolbar-menu button')].find(b=>b.textContent==='Customize toolbar').click();`);
    assert.deepEqual(await run(`[...document.querySelectorAll('#toolbar-customize .preference-row span')].slice(0,2).map(s=>s.textContent)`), ['Search tabs', 'Workspaces']);
    await run(`document.querySelector('#toolbar-customize input[data-toolbar-item="tab-search-btn"]').click()`);
    assert.equal(await run(`document.querySelector('#tab-search-btn').classList.contains('toolbar-unpinned')`), true);
    await run(`document.querySelector('#toolbar-customize input[data-toolbar-item="tab-search-btn"]').click()`);
    assert.equal(await run(`document.querySelector('#tab-search-btn').classList.contains('toolbar-unpinned')`), false);
    await run(`document.querySelector('#toolbar-customize input[data-toolbar-item="workspace-btn"]').click()`);
    assert.equal(await run(`document.querySelector('#workspace-btn').classList.contains('toolbar-unpinned')`), true);
    await run(`document.querySelector('#toolbar-customize input[data-toolbar-item="workspace-btn"]').click()`);
    assert.equal(await run(`document.querySelector('#workspace-btn').classList.contains('toolbar-unpinned')`), false);
    await run(`document.querySelector('#toolbar-customize input[data-toolbar-item="set-home"]').click()`);
    assert.equal(await run(`document.querySelector('#set-home').classList.contains('toolbar-unpinned')`), false);
    assert.ok(JSON.parse(await run(`window.storage.getItem('toolbarPins')`)).includes('set-home'));
    await run(`document.querySelector('#toolbar-customize').close()`);
  });
  await check('Tab search switches tabs without adding duplicates', async () => {
    await run(`window.newTab(${JSON.stringify(base + '/alpha')}); window.newTab(${JSON.stringify(base + '/beta')});`);
    await delay(500);
    await click('#tab-search-btn');
    await run(`(()=>{const i=document.querySelector('#tab-search input');i.value='alpha';i.dispatchEvent(new Event('input'));})()`);
    const before = await run(`document.querySelectorAll('#tabs .tab').length`);
    await run(`document.querySelector('#tab-search .tab-search-result').click()`);
    assert.equal(await run(`document.querySelectorAll('#tabs .tab').length`), before);
    assert.ok((await run(`document.querySelector('#url').value`)).includes('/alpha'));
  });
  await check('Tab search shortcut works while a webpage has focus', async () => {
    const guest = webContents.getAllWebContents().find(contents => contents.getURL() === base + '/alpha');
    assert.ok(guest);
    guest.focus();
    guest.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control', 'shift'] });
    await until(() => run(`document.querySelector('#tab-search').open`), 'shortcut from webpage');
    await run(`document.querySelector('#tab-search').close()`);
    await delay(80);
  });
  await check('Address bar open-tab result switches to existing tab', async () => {
    await run(`(()=>{const i=document.querySelector('#url');i.focus();i.value='beta';i.dispatchEvent(new Event('input'));})()`);
    await delay(150);
    assert.ok(await run(`document.querySelector('#url-suggestions').textContent.includes('Switch to tab')`));
    await run(`document.querySelector('#url').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    assert.ok((await run(`document.querySelector('#url').value`)).includes('/beta'));
    await run(`document.querySelector('#url').blur(); window.electronAPI.hideSuggestionsOverlay();`);
  });
  await check('Vertical tabs keep content and window controls in bounds', async () => {
    await run(`window.storage.setItem('verticalTabs','true')`);
    await until(() => run(`document.body.dataset.tabLayout==='vertical'`), 'vertical tab layout');
    await delay(100); await snap('vertical-tabs');
    const bounds = await run(`(()=>{const t=document.querySelector('#tabs').getBoundingClientRect(),m=document.querySelector('#main-content').getBoundingClientRect(),w=document.querySelector('#window-controls').getBoundingClientRect();return {right:t.right,left:m.left,controls:w.right,width:innerWidth};})()`);
    assert.ok(bounds.left >= bounds.right - 1); assert.ok(bounds.controls <= bounds.width + 1);
    await click('#collapse-tabs-btn');
    assert.equal(await run(`document.querySelector('#tabs').getBoundingClientRect().width`), 56);
    assert.equal(await run(`document.querySelector('#collapse-tabs-btn').getAttribute('aria-expanded')`), 'false');
    await snap('collapsed-sidebar');
    await click('#collapse-tabs-btn');
    assert.ok(await run(`document.querySelector('#tabs').getBoundingClientRect().width > 100`));
  });
  await check('Workspace save, reopen, rename, delete and undo', async () => {
    await run(`window.newTab(${JSON.stringify(base + '/private')}, false, {incognito:true})`);
    await click('#workspace-btn');
    await run(`(()=>{const f=document.querySelector('#workspace-manager form');f.querySelector('input').value='Research';f.requestSubmit();})()`);
    await delay(200);
    const saved = JSON.parse(await run(`window.storage.getItem('savedWorkspaces')`));
    assert.equal(saved[0].tabs.length, 2);
    assert.ok(saved[0].tabs.every(tab => !tab.url.includes('/private')));
    const before = await run(`document.querySelectorAll('#tabs .tab').length`);
    await run(`[...document.querySelectorAll('#workspace-manager button')].find(b=>b.textContent==='Open tabs').click()`);
    assert.equal(await run(`document.querySelectorAll('#tabs .tab').length`), before + 2);
    await click('#workspace-btn'); await snap('workspaces');
    await run(`(()=>{const i=document.querySelector('.workspace-row input');i.value='Writing';i.dispatchEvent(new Event('change'));})()`); await delay(120);
    assert.equal(JSON.parse(await run(`window.storage.getItem('savedWorkspaces')`))[0].name, 'Writing');
    await run(`[...document.querySelectorAll('.workspace-row button')].find(b=>b.textContent==='Delete').click()`); await delay(120);
    assert.equal(JSON.parse(await run(`window.storage.getItem('savedWorkspaces')`)).length, 0);
    await run(`[...document.querySelectorAll('#workspace-manager button')].find(b=>b.textContent==='Undo').click()`); await delay(120);
    assert.equal(JSON.parse(await run(`window.storage.getItem('savedWorkspaces')`)).length, 1);
    await run(`document.querySelector('#workspace-manager').close()`);
  });
  await check('New-tab layout and quick-link order persist', async () => {
    await run(`window.newTab();`);
    for (const name of ['Alpha', 'Beta']) {
      await run(`document.querySelector('#add-quick-link-btn').click();document.querySelector('#new-quick-link-url').value=${JSON.stringify(base + '/' + name.toLowerCase())};document.querySelector('#new-quick-link-label').value=${JSON.stringify(name)};document.querySelector('#save-quick-link-btn').click();`);
    }
    await click('#newtab-customize-btn');
    await run(`document.querySelector('.quick-link-order .preference-row button:nth-child(2)').click()`);
    await delay(150);
    assert.equal(JSON.parse(await run(`window.storage.getItem('quickLinks')`))[0].label, 'Beta');
    assert.equal(await run(`document.querySelector('#quick-links .quick-link-label').textContent`), 'Beta');
    await run(`(()=>{const s=document.querySelector('#newtab-customize select');s.value='minimal';s.dispatchEvent(new Event('change'));})()`);
    assert.equal(await run(`getComputedStyle(document.querySelector('#widgets-container')).display`), 'none');
    await delay(100); assert.equal(JSON.parse(await run(`window.storage.getItem('newtabLayout')`)).mode, 'minimal');
    await run(`document.querySelector('#newtab-customize').close()`); await snap('minimal-newtab');
  });
  await check('Profile picker exposes active profile and restart action', async () => {
    const profile = await run(`(()=>{const s=document.querySelector('.profile-toolbar-name'),b=document.querySelector('#profile-toolbar-btn');return {name:s.textContent,width:s.getBoundingClientRect().width,buttonWidth:b.getBoundingClientRect().width,display:getComputedStyle(s).display};})()`);
    assert.ok(profile.width > 25, JSON.stringify(profile));
    await run(`window.electronAPI.createProfile('Testing')`); await click('#profile-toolbar-btn'); await delay(150);
    assert.ok(await run(`document.querySelector('#profile-switcher').textContent.includes('Switch and restart')`));
    assert.equal(await run(`document.querySelector('#profile-switcher .preference-row button').disabled`), true);
    await snap('profiles'); await run(`document.querySelector('#profile-switcher').close()`);
  });
  await check('Concurrent same-name downloads receive distinct IDs and complete', async () => {
    win.webContents.downloadURL(base + '/download?one'); win.webContents.downloadURL(base + '/download?two');
    await until(async () => JSON.parse(await run(`window.storage.getItem('downloads')`) || '[]').filter(d => d.state === 'completed').length === 2, 'downloads complete');
    const downloads = JSON.parse(await run(`window.storage.getItem('downloads')`));
    assert.equal(new Set(downloads.map(d => d.id)).size, 2); assert.ok(downloads.every(d => d.progress === 1));
    assert.equal(new Set(downloads.map(d => d.savePath)).size, 2);
    await click('#downloads-toolbar-btn'); await snap('downloads');
    assert.equal(await run(`document.querySelectorAll('#downloads-panel .compact-download').length`), 2);
    await run(`[...document.querySelectorAll('#downloads-panel button')].find(b=>b.textContent==='View all downloads').click()`);
    assert.equal(await run(`document.querySelector('#downloads-modal').open`), true);
    await snap('download-history');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); await delay(100);
    assert.equal(await run(`document.querySelector('#downloads-modal').open`), false);
  });
  await check('Settings search finds cookies and focuses actual controls', async () => {
    const settingsMessages = [];
    const captureSettingsConsole = (_event, contents) => contents.on('console-message', details => settingsMessages.push(details.message));
    app.on('web-contents-created', captureSettingsConsole);
    await run(`window.newTab(new URL('settings.html', location.href).href)`);
    let settings;
    try {
      await until(async () => { settings = webContents.getAllWebContents().find(w => /settings\.html/.test(w.getURL())); return settings && await settings.executeJavaScript(`document.documentElement.dataset.settingsSearchReady==='true' && document.documentElement.dataset.settingsAppReady==='true'`); }, 'settings', 5000);
    } catch (error) {
      throw new Error(`${error.message}: ${settingsMessages.join(' | ')}`);
    } finally { app.removeListener('web-contents-created', captureSettingsConsole); }
    await settings.executeJavaScript(`(()=>{const i=document.querySelector('#settings-search');i.value='cookies';i.dispatchEvent(new Event('input'));})()`, true);
    assert.ok(await settings.executeJavaScript(`document.querySelectorAll('.settings-search-result').length > 0`));
    await snap('settings-search');
    await settings.executeJavaScript(`[...document.querySelectorAll('.settings-search-result')].find(b=>b.querySelector('small').textContent.startsWith('Privacy')).click()`, true); await delay(100);
    assert.ok(await settings.executeJavaScript(`document.querySelector('#privacy-settings').classList.contains('active')`));
    await until(() => settings.executeJavaScript(`document.activeElement.tagName!=='BODY'`), 'settings result focus');
    assert.ok(await settings.executeJavaScript(`document.querySelector('#appearance-settings #vertical-tabs-toggle').closest('.settings-card').textContent.includes('Tab Behavior')`));
    const savedVerticalTabs = await settings.executeJavaScript(`window.electronAPI.getStorageItem('verticalTabs')`);
    assert.equal(savedVerticalTabs, 'true');
    await settings.executeJavaScript(`document.querySelector('#vertical-tabs-toggle').click()`, true);
    await until(() => run(`document.body.dataset.tabLayout==='horizontal'`), 'settings disables vertical tabs');
    await settings.executeJavaScript(`document.querySelector('#vertical-tabs-toggle').click()`, true);
    await until(() => run(`document.body.dataset.tabLayout==='vertical'`), 'settings enables vertical tabs');
    await settings.executeJavaScript(`(()=>{const i=document.querySelector('#settings-search');i.value='zzzz-no-match';i.dispatchEvent(new Event('input'));})()`, true);
    assert.ok(await settings.executeJavaScript(`document.querySelector('.settings-search-status').textContent.includes('No settings found')`));
  });
  await check('Narrow window, tab overflow and theme layouts', async () => {
    await run(`window.newTab();`); win.setSize(800, 600); await delay(200);
    await snap('narrow-vertical');
    await run(`window.storage.setItem('verticalTabs','false')`);
    await until(() => run(`document.body.dataset.tabLayout==='horizontal'`), 'horizontal tab layout');
    await run(`for(let i=0;i<14;i++) window.newTab();`); await delay(100);
    const bounds = await run(`(()=>{const t=document.querySelector('#tabs'),w=document.querySelector('#window-controls').getBoundingClientRect();return {overflow:t.scrollWidth>t.clientWidth,right:w.right,width:innerWidth,body:document.body.scrollWidth};})()`);
    assert.ok(bounds.overflow); assert.ok(bounds.right <= bounds.width + 1); assert.ok(bounds.body <= bounds.width + 1);
    assert.ok(await run(`(()=>{const r=document.querySelector('#new-tab-btn').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth;})()`));
    await snap('narrow-overflow');
    win.setSize(1280, 850);
    await run(`document.body.classList.remove('theme-dark');document.body.classList.add('theme-dark-purple');document.querySelector('#toolbar-menu-btn').click();`); await snap('purple-theme');
  });
  await check('UI scales to 125% and 150% without horizontal overflow', async () => {
    await run(`document.querySelector('#toolbar-menu').close();window.storage.setItem('verticalTabs','true')`);
    await until(() => run(`document.body.dataset.tabLayout==='vertical'`), 'vertical tab layout at scale');
    for (const factor of [1.25, 1.5]) {
      win.webContents.setZoomFactor(factor); await delay(160);
      const fits = await run(`(()=>{const c=document.querySelector('#controls'),m=document.querySelector('#toolbar-menu-btn').getBoundingClientRect();return {fits:c.scrollWidth<=c.clientWidth+1,right:m.right,width:innerWidth};})()`);
      assert.ok(fits.fits); assert.ok(fits.right <= fits.width + 1);
      await snap(`scale-${factor}`);
    }
    win.webContents.setZoomFactor(1);
  });
  await check('Group colors survive workspace restore', async () => {
    await run(`(async()=>{const w=JSON.parse(await window.storage.getItem('savedWorkspaces'));w[0].tabs[0].group={key:'research',name:'Research',color:'#22c55e'};await window.storage.setItem('savedWorkspaces',JSON.stringify(w));})()`);
    await click('#workspace-btn');
    await run(`[...document.querySelectorAll('#workspace-manager button')].find(b=>b.textContent==='Open tabs').click()`);
    assert.ok(await run(`document.querySelector('#tabs .tab.grouped') !== null`));
    assert.ok(await run(`document.querySelector('#tabs .tab-group-label').textContent.includes('Research')`));
    assert.equal(await run(`getComputedStyle(document.querySelector('#tabs .tab.grouped'),'::after').content`), 'none');
    assert.equal(await run(`getComputedStyle(document.querySelector('#tabs .tab.grouped')).borderTopColor`), 'rgb(34, 197, 94)');
    assert.ok(await run(`(()=>{const t=document.querySelector('#tabs').getBoundingClientRect(),a=document.querySelector('#tabs .tab.active').getBoundingClientRect();return a.top>=t.top && a.bottom<=Math.min(t.bottom,innerHeight);})()`));
    await snap('grouped-vertical');
  });
  await check('Preferences, quick links and workspaces survive reload', async () => {
    await delay(600); win.webContents.reload();
    await delay(150);
    await until(() => run(`document.documentElement.dataset.browserUiReady==='true'`), 'reloaded UI');
    assert.equal(await run(`document.body.dataset.tabLayout`), 'vertical');
    assert.equal(await run(`document.querySelector('#set-home').classList.contains('toolbar-unpinned')`), false);
    assert.equal(await run(`document.querySelector('#newtab').dataset.layout`), 'minimal');
    assert.equal(await run(`document.querySelector('#quick-links .quick-link-label').textContent`), 'Beta');
    assert.equal(JSON.parse(await run(`window.storage.getItem('savedWorkspaces')`)).length, 1);
    const lastSession = await run(`localStorage.getItem('lastSessionTabs')`);
    assert.ok(!lastSession.includes('/private'));
  });
  await check('Widget placement, order and keyboard quick-link dialog', async () => {
    // Fixed preview content isolates layout from third-party weather and news services.
    await run(`for(const [id,label] of [['weather-widget','Weather preview'],['news-widget','News preview']]){const w=document.getElementById(id);w.classList.remove('hidden');w.querySelector('.widget-content').textContent=label;}`);
    await click('#newtab-customize-btn');
    await run(`for(const [key,value] of [['mode','information'],['position','below'],['order','news']]){const s=document.querySelector('[data-layout-key="'+key+'"]');s.value=value;s.dispatchEvent(new Event('change'));}`);
    await run(`document.querySelector('#newtab-customize').close()`); await delay(100);
    assert.ok(await run(`document.querySelector('#widgets-container').getBoundingClientRect().top>document.querySelector('#quick-links').getBoundingClientRect().bottom`));
    assert.ok(await run(`document.querySelector('#news-widget').getBoundingClientRect().left<document.querySelector('#weather-widget').getBoundingClientRect().left`));
    await snap('information-newtab');
    await click('#add-quick-link-btn');
    assert.equal(await run(`document.activeElement.id`), 'new-quick-link-url');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); await delay(100);
    assert.equal(await run(`document.querySelector('#add-quick-link-modal').open`), false);
    assert.equal(await run(`document.activeElement.id`), 'add-quick-link-btn');
  });
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed, failures, consoleErrors: errors }, null, 2));
  console.log(`UI checks: ${passed.length} passed; ${failures.length} failed.`);
  server.close(); app.exit(failures.length ? 1 : 0);
}).catch(error => { console.error(error); server.close(); app.exit(1); });
