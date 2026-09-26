const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/workspace-model.js'), 'utf8');
const model = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('workspace snapshots exclude incognito and internal pages and strip transient state', async () => {
  const { snapshotTabs } = await model;
  const tabs = snapshotTabs([
    { url: 'https://example.com', title: 'Public', history: ['https://private.example'], token: 'secret', groupId: 'a' },
    { url: 'https://private.example', isIncognito: true }, { url: 'file:///settings.html' }, { url: 'newtab' }, { url: 'javascript:alert(1)' },
  ], { a: { name: 'Research', color: '#22c55e' } });
  assert.deepEqual(tabs, [{ url: 'https://example.com', title: 'Public', group: { key: 'a', name: 'Research', color: '#22c55e' } }]);
});
test('workspace loading rejects corrupt storage and unsafe persisted pages', async () => {
  const { parseWorkspaces } = await model;
  for (const raw of ['null', '{}', 'not json', '[null]']) assert.deepEqual(parseWorkspaces(raw), []);
  const parsed = parseWorkspaces(JSON.stringify([{ id: 'a', name: 'Work', tabs: [
    { url: 'javascript:alert(1)' }, { url: 'file:///C:/secret' }, { url: 'https://private.example', isIncognito: true },
    { url: 'https://example.com', group: { key: 'a', name: '<img onerror=alert(1)>', color: 'url(javascript:evil)' } },
  ] }]));
  assert.equal(parsed[0].tabs.length, 1); assert.equal(parsed[0].tabs[0].group.color, '#3b82f6');
});
