// tools/launch-mobile.mjs — avvio orchestrato della demo su mobile.
//
//   npm run dev            -> solo dev server Vite (come prima)
//   npm run dev:android    -> dev server + emulatore Android (Pixel) + demo in Chrome (shader visibile)
//   npm run dev:ios        -> dev server + simulatore iOS + demo in Safari
//   npm run dev --android / --ios  -> stessa cosa via flag (anche `-- --android`)
//
// Fa tutte le operazioni nell'ordine giusto: avvia Vite e in parallelo fa il boot del device,
// aspetta che entrambi siano pronti, poi apre la demo. Ctrl+C ferma il dev server.

import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = os.homedir();
const ANDROID_HOME = process.env.ANDROID_HOME || path.join(HOME, 'Library/Android/sdk');
const ADB = path.join(ANDROID_HOME, 'platform-tools', 'adb');
const EMULATOR = path.join(ANDROID_HOME, 'emulator', 'emulator');
const AVD = process.env.MOBILE_AVD || 'Pixel_API36';
const IOS_DEVICE = process.env.MOBILE_IOS_DEVICE || 'iPhone 15';
const PORT = Number(process.env.PORT) || 5173;
const URL_HOST = `http://localhost:${PORT}/`;     // simulatore iOS: rete condivisa con l'host
const URL_EMU = `http://10.0.2.2:${PORT}/`;       // emulatore Android: l'host è 10.0.2.2

// --- rilevamento modalità: argv (android|ios|--android|--ios) o flag npm (npm_config_*) ---
const argv = process.argv.slice(2).map((s) => s.replace(/^--?/, '').toLowerCase());
const wants = (m) => argv.includes(m) || process.env[`npm_config_${m}`];
const mode = wants('android') ? 'android' : wants('ios') ? 'ios' : 'web';

const log = (m) => console.log(`\x1b[36m[launch:${mode}]\x1b[0m ${m}`);

// --- helper ---
const adb = (...args) => spawnSync(ADB, args, { encoding: 'utf8' }).stdout || '';
const xcrun = (...args) => spawnSync('xcrun', args, { encoding: 'utf8' }).stdout || '';

function checkPort(port) {
  return new Promise((res) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => { s.end(); res(true); });
    s.once('error', () => res(false));
  });
}
async function waitForPort(port, ms = 90000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await checkPort(port)) return true; await sleep(500); }
  throw new Error(`dev server non raggiungibile su :${port}`);
}

// --- Vite (dev server, resta in foreground) ---
function startVite() {
  const args = ['--config', 'vite.config.demo.js'];
  // Per i device serve un bind IPv4 raggiungibile: l'emulatore Android vede l'host a
  // 10.0.2.2 (IPv4 loopback) e il check porta usa 127.0.0.1. Senza questo, Vite può
  // legarsi solo a ::1 (IPv6) e device + waitForPort falliscono.
  if (mode !== 'web') args.push('--host', '0.0.0.0');
  const vite = spawn('vite', args, { stdio: 'inherit' });
  vite.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => { vite.kill('SIGINT'); process.exit(0); });
  return vite;
}

// --- Android ---
function emulatorRunning() {
  return adb('devices').split('\n').some((l) => l.startsWith('emulator-') && l.includes('\tdevice'));
}
async function bootAndroid() {
  if (!fs.existsSync(EMULATOR)) throw new Error(`emulatore non trovato in ${EMULATOR}`);
  if (!emulatorRunning()) {
    log(`avvio emulatore ${AVD} (-gpu host)…`);
    const emu = spawn(EMULATOR, ['-avd', AVD, '-gpu', 'host', '-no-boot-anim', '-no-audio'],
      { detached: true, stdio: 'ignore' });
    emu.unref();
  } else {
    log('emulatore già attivo');
  }
  spawnSync(ADB, ['wait-for-device']);
  const t = Date.now();
  while (adb('shell', 'getprop', 'sys.boot_completed').trim() !== '1') {
    if (Date.now() - t > 180000) throw new Error('timeout boot emulatore');
    await sleep(2000);
  }
  adb('shell', 'input', 'keyevent', '82');                       // sblocca keyguard
  adb('shell', 'settings', 'put', 'global', 'hidden_api_policy', '1'); // per Maestro
  log('boot Android completato');
}
function tapNode(search) {
  adb('shell', 'uiautomator', 'dump', '/sdcard/wd.xml');
  const xml = adb('shell', 'cat', '/sdcard/wd.xml');
  for (const seg of xml.split('<node')) {
    if (!seg.includes(search)) continue;
    const b = seg.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!b) continue;
    adb('shell', 'input', 'tap', String(((+b[1]) + (+b[3])) >> 1), String(((+b[2]) + (+b[4])) >> 1));
    return true;
  }
  return false;
}
async function openAndroidDemo() {
  // FIX shader WebGL: Chrome rende la GL in SwiftShader -> il canvas si compone (con -gpu host
  // resterebbe bianco per un limite di compositing dell'emulatore su Apple Silicon).
  adb('root'); await sleep(2000);
  adb('shell',
    'echo "chrome --disable-fre --no-first-run --use-gl=angle --use-angle=swiftshader --ignore-gpu-blocklist" > /data/local/tmp/chrome-command-line');
  adb('shell', 'am', 'force-stop', 'com.android.chrome'); await sleep(1000);
  log('apro la demo in Chrome…');
  adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', URL_EMU, '-p', 'com.android.chrome');
  // chiudi i popup di onboarding di Chrome
  for (let i = 0; i < 4; i++) {
    await sleep(2000);
    for (const t of ['terms_accept', 'text="No thanks"', 'text="No, thanks"', 'negative_button', 'text="Got it"', 'text="Continue"']) {
      if (tapNode(t)) await sleep(1000);
    }
  }
  adb('shell', 'input', 'tap', '30', '600'); // chiude eventuale tooltip
}

// --- iOS ---
async function bootIOS() {
  log(`boot simulatore ${IOS_DEVICE}…`);
  spawnSync('xcrun', ['simctl', 'bootstatus', IOS_DEVICE, '-b'], { stdio: 'ignore' });
  spawnSync('open', ['-a', 'Simulator']);
  log('boot iOS completato');
}
function openIOSDemo() {
  log('apro la demo in Safari…');
  xcrun('simctl', 'openurl', 'booted', URL_HOST);
}

// --- main ---
const vite = startVite();
if (mode === 'web') {
  // niente device: solo dev server
} else {
  try {
    const booted = mode === 'android' ? bootAndroid() : bootIOS();
    await Promise.all([waitForPort(PORT), booted]);
    if (mode === 'android') await openAndroidDemo(); else openIOSDemo();
    log(`✅ pronto — demo aperta su ${mode === 'android' ? 'Chrome (emulatore)' : 'Safari (simulatore)'}. Ctrl+C per fermare.`);
  } catch (e) {
    console.error(`\x1b[31m[launch:${mode}] errore:\x1b[0m ${e.message}`);
    console.error('Il dev server resta attivo. Avvia il device a mano e ricarica la demo.');
  }
}
