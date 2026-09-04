const { spawn } = require('child_process');
const path = require('path');
const electronPath = require('electron');

function runStartupSample() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const env = { ...process.env, VORTEX_BENCHMARK: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electronPath, ['.'], {
      cwd: path.resolve(__dirname, '..'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('exit', code => {
      const marker = output.match(/VORTEX_BENCHMARK_READY\s+(\{[^\r\n]+\})/);
      if (!marker || (code !== 0 && code !== null)) {
        reject(new Error(`Startup sample failed (${code}).\n${output}`));
        return;
      }
      resolve({ elapsedMs: Date.now() - startedAt, ...JSON.parse(marker[1]) });
    });
  });
}

(async () => {
  const samples = [];
  for (let index = 0; index < 3; index += 1) samples.push(await runStartupSample());
  const average = Math.round(samples.reduce((sum, value) => sum + value.elapsedMs, 0) / samples.length);
  const averageRss = Math.round(samples.reduce((sum, value) => sum + value.rssMB, 0) / samples.length);
  console.log(`Startup samples: ${samples.map(sample => `${sample.elapsedMs}ms`).join(', ')}`);
  console.log(`Main-process RSS samples: ${samples.map(sample => `${sample.rssMB}MB`).join(', ')}`);
  console.log(`Average renderer-ready startup: ${average}ms`);
  console.log(`Average main-process RSS at ready: ${averageRss}MB`);
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
