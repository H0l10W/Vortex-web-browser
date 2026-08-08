const fs = require('fs');
const path = require('path');
const readline = require('readline');

const root = path.resolve(__dirname);
const outputLines = [];
const files = {
  package: path.join(root, 'package.json'),
  main: path.join(root, 'main.js'),
  preload: path.join(root, 'preload.js'),
  index: path.join(root, 'index.html'),
  settings: path.join(root, 'settings.html')
};

function read(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

function printResult(ok, label, details = '') {
  const status = ok ? 'PASS' : 'FAIL';
  const line = `${status} - ${label}${details ? `: ${details}` : ''}`;
  console.log(line);
  outputLines.push(line);
  return ok;
}

function writeReport(report) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `security-test-report-${timestamp}.txt`;
  const filePath = path.join(root, filename);

  fs.writeFileSync(filePath, report, 'utf8');
  console.log(`\nExported report to: ${filePath}`);
}

function promptExport() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('Export prompt skipped (non-interactive terminal).');
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Export this security report to a .txt file? (y/N): ', (answer) => {
    rl.close();
    const normalized = String(answer).trim().toLowerCase();
    if (normalized === 'y' || normalized === 'yes') {
      writeReport(outputLines.join('\n') + '\n');
    } else {
      console.log('Report export cancelled.');
    }
  });
}

function findWebPreferencesBlocks(source) {
  const blocks = [];
  const regex = /webPreferences\s*:\s*\{/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const openBrace = match.index + match[0].lastIndexOf('{');
    let depth = 1;
    let pos = openBrace + 1;
    while (pos < source.length && depth > 0) {
      const char = source[pos];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      pos += 1;
    }

    if (depth === 0) {
      blocks.push(source.slice(openBrace + 1, pos - 1).trim());
    }
  }
  return blocks;
}

function parseOption(block, key) {
  const pattern = new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*:\s*([^,\n]+)`, 'i');
  const match = block.match(pattern);
  if (!match) return { found: false, value: null };
  const rawValue = match[1].trim();
  const normalized = rawValue.replace(/,$/, '');
  return { found: true, value: normalized };
}

function findCSPMeta(html) {
  if (!html) return false;
  const regex = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i;
  return regex.test(html);
}

function searchRepo(pattern, repoRoot) {
  const result = [];
  const regex = new RegExp(pattern, 'i');
  const entries = fs.readdirSync(repoRoot);
  for (const filename of entries) {
    const fullPath = path.join(repoRoot, filename);
    if (!fs.lstatSync(fullPath).isFile()) continue;
    const ext = path.extname(filename).toLowerCase();
    if (!['.js', '.json', '.html', '.htm'].includes(ext)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    if (regex.test(content)) result.push(filename);
  }
  return result;
}

function main() {
  console.log('Browser security audit script');
  console.log('==============================\n');

  const packageSource = read(files.package);
  if (!packageSource) {
    printResult(false, 'package.json found', 'Missing package.json');
    process.exit(1);
  }

  const mainSource = read(files.main);
  if (!mainSource) {
    printResult(false, 'main.js found', 'Missing main.js');
    process.exit(1);
  }

  const preloadSource = read(files.preload);
  if (!preloadSource) {
    printResult(false, 'preload.js found', 'Missing preload.js');
    process.exit(1);
  }

  const htmlSource = read(files.index) || read(files.settings) || '';

  let passed = 0;
  let failed = 0;
  let warnings = 0;

  function assert(label, ok, details = '') {
    if (printResult(ok, label, details)) {
      passed += 1;
    } else {
      failed += 1;
    }
  }

  function warn(label, ok, details = '') {
    if (ok) {
      passed += 1;
      printResult(true, label, details);
    } else {
      warnings += 1;
      console.log(`WARN - ${label}${details ? `: ${details}` : ''}`);
    }
  }

  const packageJson = JSON.parse(packageSource);
  const buildConfig = packageJson.build || {};
  const asarEnabled = buildConfig.asar === true || (buildConfig.win && buildConfig.win.asar === true);
  assert('App package version', typeof packageJson.version === 'string' && packageJson.version.length > 0);
  assert('ASAR packaging enabled', asarEnabled, asarEnabled ? '' : 'Build config does not enable ASAR');

  const webPrefBlocks = findWebPreferencesBlocks(mainSource);
  assert('Found BrowserWindow webPreferences blocks', webPrefBlocks.length > 0, `${webPrefBlocks.length} blocks found`);

  webPrefBlocks.forEach((block, index) => {
    const prefix = `BrowserWindow webPreferences block #${index + 1}`;
    const policies = [
      { key: 'contextIsolation', expected: 'true', required: true, safeIfMissing: false },
      { key: 'nodeIntegration', expected: 'false', required: true, safeIfMissing: false },
      { key: 'sandbox', expected: 'true', required: true, safeIfMissing: false },
      { key: 'webSecurity', expected: 'true', required: false, safeIfMissing: true, missingMessage: 'Defaults to true' },
      { key: 'allowRunningInsecureContent', expected: 'false', required: false, safeIfMissing: true, missingMessage: 'Defaults to false' },
      { key: 'enableRemoteModule', expected: 'false', required: false, safeIfMissing: true, missingMessage: 'Defaults to false' }
    ];

    policies.forEach((policy) => {
      const result = parseOption(block, policy.key);
      if (!result.found) {
        if (policy.safeIfMissing) {
          warn(`${prefix} - ${policy.key}`, false, policy.missingMessage || 'Missing, using safe default');
        } else {
          assert(`${prefix} - ${policy.key} present`, false, 'Not found');
        }
        return;
      }

      if (result.value === String(policy.expected)) {
        assert(`${prefix} - ${policy.key} == ${policy.expected}`, true);
      } else {
        assert(`${prefix} - ${policy.key} == ${policy.expected}`, false, `Found ${result.value}`);
      }
    });

    const webviewResult = parseOption(block, 'webviewTag');
    if (webviewResult.found && webviewResult.value === 'true') {
      warn(`${prefix} - webviewTag usage`, false, 'WebView is enabled; review content isolation for embedded webviews');
    } else {
      assert(`${prefix} - webviewTag disabled or absent`, true);
    }
  });

  const cspPresent = findCSPMeta(htmlSource);
  warn('Content Security Policy meta tag present in HTML', cspPresent, cspPresent ? '' : 'No CSP meta tag found in index/settings HTML');

  const preloadHasBridge = /contextBridge\.exposeInMainWorld\s*\(/.test(preloadSource);
  assert('Preload uses contextBridge.exposeInMainWorld', preloadHasBridge);
  const preloadHasElectron = /require\(['"]electron['"]\)/.test(preloadSource);
  assert('Preload imports electron safely', preloadHasElectron);

  const suspiciousPatterns = [
    { pattern: 'nodeIntegration\s*:\s*true', label: 'nodeIntegration enabled in repo' },
    { pattern: 'enableRemoteModule\s*:\s*true', label: 'enableRemoteModule enabled in repo' },
    { pattern: 'allowRunningInsecureContent\s*:\s*true', label: 'allowRunningInsecureContent enabled in repo' }
  ];

  suspiciousPatterns.forEach(({ pattern, label }) => {
    const found = new RegExp(pattern, 'i').test(mainSource);
    assert(label, !found, found ? 'Found insecure preference' : 'Not found');
  });

  const cspFiles = searchRepo('Content-Security-Policy', root);
  warn('CSP header or meta found in repository', cspFiles.length > 0, cspFiles.length > 0 ? `Found in ${cspFiles.join(', ')}` : 'No CSP string found');

  const summaryLines = [
    '',
    'Summary:',
    `  Passed: ${passed}`,
    `  Failed: ${failed}`,
    `  Warnings: ${warnings}`
  ];

  summaryLines.forEach((line) => {
    console.log(line);
    outputLines.push(line);
  });

  promptExport();
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
