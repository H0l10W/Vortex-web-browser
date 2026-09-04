async function fetchLists(urls) {
  const results = await Promise.allSettled((urls || []).map(async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }));
  const completed = results
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value);
  return completed.length ? completed.join('\n') : null;
}

process.parentPort.once('message', async event => {
  try {
    const urlsByMode = event.data?.urlsByMode || {};
    const [balanced, strict] = await Promise.all([
      fetchLists(urlsByMode.balanced),
      fetchLists(urlsByMode.strict),
    ]);
    process.parentPort.postMessage({ ok: true, filters: { balanced, strict } });
  } catch (error) {
    process.parentPort.postMessage({ ok: false, error: error.message });
  }
});
