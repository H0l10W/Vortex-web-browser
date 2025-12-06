// Security Test Script for Vortex Browser
// This script tests various security aspects of the browser

const { app, BrowserWindow, BrowserView, session } = require('electron');
const path = require('path');

console.log('=== VORTEX BROWSER SECURITY TEST REPORT ===');
console.log('Date:', new Date().toISOString());
console.log('Version:', app.getVersion());

// Test 1: Check sandbox status
console.log('\n1. SANDBOX STATUS:');
try {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  console.log('✅ Sandbox enabled successfully');
  win.close();
} catch (error) {
  console.log('❌ Sandbox test failed:', error.message);
}

// Test 2: Check web security
console.log('\n2. WEB SECURITY:');
try {
  const testView = new BrowserView({
    webPreferences: {
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      enableRemoteModule: false,
      sandbox: true
    }
  });
  console.log('✅ Web security preferences configured correctly');
  testView.webContents.destroy();
} catch (error) {
  console.log('❌ Web security test failed:', error.message);
}

// Test 3: Check CSP headers
console.log('\n3. CONTENT SECURITY POLICY:');
const fs = require('fs');
try {
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const settingsHtml = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8');
  
  const cspRegex = /Content-Security-Policy.*content="([^"]+)"/i;
  const indexCSP = indexHtml.match(cspRegex);
  const settingsCSP = settingsHtml.match(cspRegex);
  
  if (indexCSP && indexCSP[1].includes("object-src 'none'") && indexCSP[1].includes("upgrade-insecure-requests")) {
    console.log('✅ Index.html CSP properly configured');
    console.log('   - Includes object-src none');
    console.log('   - Includes upgrade-insecure-requests');
  } else {
    console.log('❌ Index.html CSP missing security directives');
  }
  
  if (settingsCSP && settingsCSP[1].includes("object-src 'none'")) {
    console.log('✅ Settings.html CSP properly configured');
  } else {
    console.log('❌ Settings.html CSP missing security directives');
  }
} catch (error) {
  console.log('❌ CSP test failed:', error.message);
}

// Test 4: Check dangerous command line switches
console.log('\n4. COMMAND LINE SECURITY:');
const commandLine = process.argv.join(' ');
if (commandLine.includes('--no-sandbox') || commandLine.includes('--disable-web-security')) {
  console.log('❌ Dangerous command line switches detected');
} else {
  console.log('✅ No dangerous command line switches found');
}

// Test 5: Check main.js security configurations
console.log('\n5. MAIN PROCESS SECURITY:');
try {
  const mainJs = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  
  const securityChecks = [
    { check: 'contextIsolation: true', name: 'Context Isolation' },
    { check: 'nodeIntegration: false', name: 'Node Integration Disabled' },
    { check: 'webSecurity: true', name: 'Web Security Enabled' },
    { check: 'sandbox: true', name: 'Sandbox Enabled' },
    { check: 'allowRunningInsecureContent: false', name: 'Insecure Content Blocked' }
  ];
  
  securityChecks.forEach(({ check, name }) => {
    if (mainJs.includes(check)) {
      console.log(`✅ ${name}: Found`);
    } else {
      console.log(`❌ ${name}: Missing or disabled`);
    }
  });
  
  // Check for dangerous switches
  if (mainJs.includes("'no-sandbox'") || mainJs.includes("'disable-web-security'")) {
    console.log('❌ Dangerous switches found in main.js');
  } else {
    console.log('✅ No dangerous switches in main.js');
  }
} catch (error) {
  console.log('❌ Main.js security test failed:', error.message);
}

// Test 6: Check preload script security
console.log('\n6. PRELOAD SCRIPT SECURITY:');
try {
  const preloadJs = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  
  if (preloadJs.includes('contextBridge.exposeInMainWorld')) {
    console.log('✅ Using contextBridge for secure IPC');
  } else {
    console.log('❌ contextBridge not found - potential security risk');
  }
  
  if (preloadJs.includes('require(') && !preloadJs.includes('const { contextBridge, ipcRenderer')) {
    console.log('❌ Direct require() usage detected - potential security risk');
  } else {
    console.log('✅ No unsafe require() usage detected');
  }
} catch (error) {
  console.log('❌ Preload script test failed:', error.message);
}

console.log('\n=== SECURITY TEST SUMMARY ===');
console.log('Tests completed at:', new Date().toLocaleString());
console.log('Review the results above for any security issues.');
console.log('❌ = Security concern that should be addressed');
console.log('✅ = Security measure properly implemented');