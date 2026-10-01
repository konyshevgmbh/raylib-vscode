const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const DEVICE_STATE_KEY = 'raylibDevices.selected';
const MODE_STATE_KEY = 'raylibDevices.mode';
let PKG = 'com.example.raylibbutton';   // applicationId, read from android/app/build.gradle per project
const ACTIVITY = 'android.app.NativeActivity';
let EXE = 'raylib_button';   // CMake project / executable name, read from CMakeLists.txt per project
const LLDB_PORT = 5039;
let WEB_PORT = 8137;   // per project (see activateProject): two open projects must not share a server

// A raylib project: CMakeLists.txt with project(<name> C) that fetches raylib. Sets EXE to <name>.
function findProjectFolder() {
  for (const f of vscode.workspace.workspaceFolders || []) {
    const p = path.join(f.uri.fsPath, 'CMakeLists.txt');
    try {
      if (!fs.existsSync(p)) continue;
      const txt = fs.readFileSync(p, 'utf8');
      const m = /^\s*project\(\s*(\w+)/m.exec(txt);
      if (m && /FetchContent_Declare\(\s*raylib/.test(txt)) { EXE = m[1]; return f; }
    } catch (e) { /* keep looking */ }
  }
  return null;
}

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const HOST_NAME = IS_WIN ? 'Windows' : IS_MAC ? 'macOS' : 'Linux';
// NDK prebuilt dir name for this host
const NDK_HOST_TAG = IS_WIN ? 'windows-x86_64' : IS_MAC ? 'darwin-x86_64' : 'linux-x86_64';

// First existing SDK location; env vars can be stale (e.g. ANDROID_SDK_ROOT pointing to a removed folder)
function androidSdkRoot() {
  const os = require('os');
  const home = os.homedir();
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    IS_WIN ? path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')
      : IS_MAC ? path.join(home, 'Library', 'Android', 'sdk') : path.join(home, 'Android', 'Sdk'),
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || candidates[candidates.length - 1];
}
function sdkTool(sub, exe) {
  const p = path.join(androidSdkRoot(), sub, exe + (IS_WIN ? '.exe' : ''));
  return fs.existsSync(p) ? p : exe;
}
const adbPath = () => sdkTool('platform-tools', 'adb');
const emulatorPath = () => sdkTool('emulator', 'emulator');

function execFile(cmd, args, timeout = 10000) {
  return new Promise((resolve) => {
    cp.execFile(cmd, args, { timeout }, (err, stdout, stderr) =>
      resolve({ err, stdout: stdout || '', stderr: stderr || '' }));
  });
}

async function listOnlineAndroid() {
  const { stdout } = await execFile(adbPath(), ['devices', '-l']);
  const devices = [];
  for (const line of stdout.split(/\r?\n/).slice(1)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\s+/);
    if (parts[1] !== 'device') continue;
    const serial = parts[0];
    const m = t.match(/model:(\S+)/);
    const model = m ? m[1].replace(/_/g, ' ') : serial;
    let avdName = null;
    if (serial.startsWith('emulator-')) {
      const r = await execFile(adbPath(), ['-s', serial, 'emu', 'avd', 'name']);
      avdName = r.stdout.split(/\r?\n/)[0].trim() || null;
    }
    devices.push({ serial, model, avdName, isEmulator: serial.startsWith('emulator-') });
  }
  return devices;
}

async function listAvds() {
  const { stdout } = await execFile(emulatorPath(), ['-list-avds']);
  return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

const DEVICE_LABELS = {
  windows: { label: `$(device-desktop) ${HOST_NAME}`, description: `${HOST_NAME.toLowerCase()} - desktop` },
  chrome: { label: '$(globe) Chrome', description: 'chrome - web' },
  edge: { label: '$(globe) Edge', description: 'edge - web' },
};

// Lists files under dir relative to it (forward slashes)
function listFiles(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? listFiles(dir, r) : [r];
  });
}

// Copies templates/ (src/, assets/, CMakeLists.txt, CMakePresets.json, .vscode/, .gitignore) into the
// workspace folder. Registered before the project check in activate(), so it also works in an empty
// folder. Dot-names are stored as "dot.*" in templates/ so they are not dropped when packaging.
async function initProject() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) return vscode.window.showErrorMessage('Raylib: open a folder first');
  const folder = folders.length === 1 ? folders[0]
    : (await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Create the base structure in...' }));
  if (!folder) return;
  const tpl = path.join(__dirname, 'templates');
  const base = path.basename(folder.uri.fsPath).replace(/[^A-Za-z0-9_]/g, '_');
  const name = await vscode.window.showInputBox({
    prompt: 'Project name (CMake project, executable and Android package are derived from it)',
    value: /^[A-Za-z]/.test(base) ? base : `app_${base}`,
    validateInput: (v) => (/^[A-Za-z][A-Za-z0-9_]*$/.test(v) ? undefined : 'Letters, digits and _ only; must start with a letter'),
  });
  if (!name) return;
  const pkg = `com.example.${name.replace(/_/g, '').toLowerCase()}`;
  const TEXT = /\.(c|h|txt|json|gradle|xml|html|js|webmanifest|properties|rc|bat|in|md)$|^gradlew$/;
  const personalize = (txt) => txt
    .split('com.example.raylibbutton').join(pkg)
    .split('raylib_button').join(name)
    .split('raylib button').join(name);
  const files = listFiles(tpl).map((f) => ({ from: path.join(tpl, f), rel: f.replace(/(^|\/)dot\./g, '$1.') }));
  const existing = files.filter((f) => fs.existsSync(path.join(folder.uri.fsPath, f.rel)));
  if (existing.length) {
    const ans = await vscode.window.showWarningMessage(
      `Raylib: already exist: ${existing.map((f) => f.rel).join(', ')}. Overwrite?`, { modal: true }, 'Overwrite');
    if (ans !== 'Overwrite') return;
  }
  for (const f of files) {
    const to = path.join(folder.uri.fsPath, f.rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (TEXT.test(path.basename(f.from))) fs.writeFileSync(to, personalize(fs.readFileSync(f.from, 'utf8')));
    else fs.copyFileSync(f.from, to);
  }
  vscode.window.showInformationMessage(`Raylib: created ${files.length} files (src/, assets/, CMake, .vscode/).`);
  tryActivateProject();
  vscode.workspace.openTextDocument(path.join(folder.uri.fsPath, 'src', 'main.c')).then((d) => vscode.window.showTextDocument(d));
}

let projectActive = false;
let extContext;

// Activates the project features (status bar, run, debug provider) once, as soon as the workspace
// holds the raylib project - at startup, or right after Raylib: Init created it (no reload needed).
function tryActivateProject() {
  if (projectActive) return;
  const projectFolder = findProjectFolder();
  // Command Palette entries (package.json: menus.commandPalette) are shown only in this project
  vscode.commands.executeCommand('setContext', 'raylibDevices.active', !!projectFolder);
  if (!projectFolder) return; // not the raylib_ex workspace - stay dormant
  projectActive = true;
  activateProject(extContext, projectFolder);
}

function activate(context) {
  extContext = context;
  context.subscriptions.push(vscode.commands.registerCommand('raylibDevices.init', initProject));
  tryActivateProject();
}

function activateProject(context, projectFolder) {
  const root = projectFolder.uri.fsPath;
  // Each project gets its own web port and Android package, otherwise a second open project would
  // be served by (or installed over) the first one.
  let h = 0;
  for (const ch of root) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  WEB_PORT = 8137 + (h % 800);
  try {
    const m = /applicationId\s+'([^']+)'/.exec(fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8'));
    if (m) PKG = m[1];
  } catch (e) { /* no android/ folder */ }
  const output = vscode.window.createOutputChannel('Raylib');

  const modeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
  modeItem.command = 'raylibDevices.toggleMode';
  const backendItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  backendItem.command = 'raylibDevices.toggleBackend';
  const deviceItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  deviceItem.command = 'raylibDevices.pickDevice';
  const runItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  runItem.text = '$(play)';
  runItem.tooltip = 'Raylib: Run on selected device';
  runItem.command = 'raylibDevices.run';

  const currentDevice = () => context.workspaceState.get(DEVICE_STATE_KEY, { kind: 'windows' });
  const currentMode = () => context.workspaceState.get(MODE_STATE_KEY, 'debug');
  // Setting raylibDevices.androidBackend: native (local SDK/NDK), docker, or auto (native if an NDK is installed)
  const currentBackend = () => {
    const v = vscode.workspace.getConfiguration('raylibDevices').get('androidBackend', 'auto');
    if (v === 'native' || v === 'docker') return v;
    return fs.existsSync(path.join(androidSdkRoot(), 'ndk')) ? 'native' : 'docker';
  };

  function updateStatusBar() {
    const d = currentDevice();
    if (d.kind === 'chrome') deviceItem.text = DEVICE_LABELS.chrome.label;
    else if (d.kind === 'edge') deviceItem.text = DEVICE_LABELS.edge.label;
    else if (d.kind === 'android-online') deviceItem.text = `$(device-mobile) ${d.model}`;
    else if (d.kind === 'android-avd') deviceItem.text = `$(device-mobile) ${d.avdName}`;
    else deviceItem.text = DEVICE_LABELS.windows.label;
    deviceItem.show();
    modeItem.text = currentMode() === 'release' ? '$(package) Release' : '$(debug-alt) Debug';
    modeItem.tooltip = 'Raylib: click to toggle Debug/Release';
    modeItem.show();
    if (d.kind === 'android-online' || d.kind === 'android-avd') {
      backendItem.text = currentBackend() === 'native' ? '$(rocket) Local SDK' : '$(vm) Docker';
      backendItem.tooltip = 'Raylib: click to toggle Android build backend (local SDK / Docker); setting raylibDevices.androidBackend';
      backendItem.show();
    } else {
      backendItem.hide();
    }
    runItem.show();
  }

  async function setDevice(d) {
    await context.workspaceState.update(DEVICE_STATE_KEY, d);
    updateStatusBar();
  }

  async function toggleBackend() {
    const next = currentBackend() === 'native' ? 'docker' : 'native';
    await vscode.workspace.getConfiguration('raylibDevices').update('androidBackend', next, vscode.ConfigurationTarget.Workspace);
    updateStatusBar();
  }

  async function toggleMode() {
    await context.workspaceState.update(MODE_STATE_KEY, currentMode() === 'release' ? 'debug' : 'release');
    updateStatusBar();
  }

  async function pickDevice() {
    const items = [];
    items.push({ kind: vscode.QuickPickItemKind.Separator, label: 'Available Devices' });
    items.push({ ...DEVICE_LABELS.windows, device: { kind: 'windows' } });
    items.push({ kind: vscode.QuickPickItemKind.Separator, label: 'Web' });
    items.push({ ...DEVICE_LABELS.chrome, device: { kind: 'chrome' } });
    items.push({ ...DEVICE_LABELS.edge, device: { kind: 'edge' } });

    let online = [];
    try { online = await listOnlineAndroid(); } catch (e) { online = []; }
    items.push({ kind: vscode.QuickPickItemKind.Separator, label: 'Android' });
    for (const dev of online) {
      items.push({
        label: dev.isEmulator ? `$(device-mobile) ${dev.avdName || dev.model} (running)` : `$(device-mobile) ${dev.model}`,
        description: dev.serial,
        device: { kind: 'android-online', serial: dev.serial, model: dev.avdName || dev.model },
      });
    }
    items.push({ label: '$(radio-tower) Connect device over Wi-Fi...', description: 'adb connect ip:port', action: 'wifi-connect' });
    items.push({ label: '$(key) Pair device over Wi-Fi (Android 11+)...', description: 'adb pair ip:port', action: 'wifi-pair' });

    let avds = [];
    try { avds = await listAvds(); } catch (e) { avds = []; }
    const running = new Set(online.filter((d) => d.avdName).map((d) => d.avdName));
    const offline = avds.filter((n) => !running.has(n));
    if (offline.length) {
      items.push({ kind: vscode.QuickPickItemKind.Separator, label: 'Offline Emulators' });
      for (const name of offline) {
        items.push({ label: `$(play-circle) Start ${name}`, description: 'mobile emulator', device: { kind: 'android-avd', avdName: name } });
      }
    }

    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select a device to use' });
    if (!picked) return;
    if (picked.action === 'wifi-connect') return connectWifi();
    if (picked.action === 'wifi-pair') return pairWifi();
    if (picked.device) await setDevice(picked.device);
  }

  async function connectWifi() {
    const target = await vscode.window.showInputBox({
      prompt: "Device IP:port for 'adb connect' (Settings > Developer options > Wireless debugging)",
      placeHolder: '192.168.1.23:5555',
    });
    if (!target) return;
    const r = await execFile(adbPath(), ['connect', target]);
    const out = (r.stdout + r.stderr).trim();
    if (/connected|already/i.test(out)) {
      vscode.window.showInformationMessage(`Raylib: ${out}`);
      await setDevice({ kind: 'android-online', serial: target, model: target });
    } else {
      vscode.window.showErrorMessage(`Raylib: adb connect failed - ${out || 'no response'}`);
    }
  }

  async function pairWifi() {
    const pairTarget = await vscode.window.showInputBox({ prompt: 'Pairing IP:port (Wireless debugging > Pair device with pairing code)', placeHolder: '192.168.1.23:37251' });
    if (!pairTarget) return;
    const code = await vscode.window.showInputBox({ prompt: 'Pairing code (6 digits)' });
    if (!code) return;
    const r = await execFile(adbPath(), ['pair', pairTarget, code]);
    const out = (r.stdout + r.stderr).trim();
    if (!/success/i.test(out)) {
      vscode.window.showErrorMessage(`Raylib: pairing failed - ${out || 'no response'}`);
      return;
    }
    vscode.window.showInformationMessage('Raylib: paired. Now enter the connect address shown on the device (different port than pairing).');
    await connectWifi();
  }

  async function ensureAvdBooted(avdName, progress) {
    progress.report({ message: `Starting ${avdName}...` });
    cp.spawn(emulatorPath(), ['-avd', avdName], { detached: true, stdio: 'ignore' }).unref();
    let serial = null;
    for (let i = 0; i < 60 && !serial; i++) {
      const match = (await listOnlineAndroid()).find((d) => d.avdName === avdName);
      if (match) serial = match.serial;
      else await new Promise((r) => setTimeout(r, 2000));
    }
    if (!serial) throw new Error(`Timed out waiting for ${avdName} to appear in adb devices`);
    progress.report({ message: `Waiting for ${avdName} to finish booting...` });
    for (let i = 0; i < 60; i++) {
      const r = await execFile(adbPath(), ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']);
      if (r.stdout.trim() === '1') return serial;
      await new Promise((r2) => setTimeout(r2, 2000));
    }
    throw new Error(`Timed out waiting for ${avdName} to boot`);
  }

  // ---- build helpers ----

  // Runs a command, streaming to the Raylib output channel. Rejects on non-zero exit.
  function runLogged(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
      output.appendLine(`> ${cmd} ${args.join(' ')}`);
      const proc = cp.spawn(cmd, args, { cwd: root, shell: true, ...opts });
      proc.stdout.on('data', (d) => output.append(d.toString()));
      proc.stderr.on('data', (d) => output.append(d.toString()));
      proc.on('error', reject);
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code} (see Raylib output)`))));
    });
  }

  const withProgress = (title, fn) =>
    vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, fn);

  // Windows: Visual Studio (multi-config, build-windows/<cfg>/exe); Linux/macOS: Ninja (build-linux|build-macos/exe).
  async function buildDesktop(cap) {
    await withProgress(`Raylib: Building ${HOST_NAME} ${cap}...`, async () => {
      if (IS_WIN) {
        await runLogged('cmake', ['--preset', 'windows']);
        await runLogged('cmake', ['--build', '--preset', `windows-${cap.toLowerCase()}`]);
      } else {
        const preset = IS_MAC ? 'macos' : 'linux';
        await runLogged('cmake', ['--preset', preset, `-DCMAKE_BUILD_TYPE=${cap}`]);
        await runLogged('cmake', ['--build', '--preset', preset]);
      }
    });
  }

  // Web is always built inside the emscripten/emsdk Docker image (no local emsdk needed).
  // The project is mounted at /src; -fdebug-prefix-map rewrites /src back to the host path
  // in the DWARF info, so Chrome DevTools (C/C++ DevTools Support extension) finds main.c.
  let webServer = null;
  async function buildAndServeWeb(cap) {
    const dir = `build-web/${cap}`;
    const hostRoot = root.split(path.sep).join('/');
    const docker = (cmd) => runLogged('docker', ['run', '--rm', '-v', `"${root}:/src"`, '-w', '/src', 'emscripten/emsdk', ...cmd]);
    await withProgress(`Raylib: Building Web ${cap} (Docker)...`, async () => {
      await docker(['emcmake', 'cmake', '-S', '.', '-B', dir, `-DCMAKE_BUILD_TYPE=${cap}`,
        `-DCMAKE_C_FLAGS="-fdebug-prefix-map=/src=${hostRoot}"`]);
      await docker(['cmake', '--build', dir, '-j']);
    });
    if (webServer) webServer.kill();
    webServer = cp.spawn(IS_WIN ? 'python' : 'python3', ['-m', 'http.server', String(WEB_PORT)], { cwd: path.join(root, dir) });
    webServer.on('error', () => {});
    await new Promise((r) => setTimeout(r, 800));
  }

  // Finds the NDK's lldb-server for the given ABI (host-side copy, pushed to the device).
  function findLldbServer(abi) {
    const arch = { 'arm64-v8a': 'aarch64', 'armeabi-v7a': 'arm', x86_64: 'x86_64', x86: 'i386' }[abi];
    if (!arch) throw new Error(`Unsupported device ABI: ${abi}`);
    const ndkRoot = path.join(androidSdkRoot(), 'ndk');
    const versions = fs.existsSync(ndkRoot) ? fs.readdirSync(ndkRoot).sort().reverse() : [];
    for (const v of versions) {
      const clangRoot = path.join(ndkRoot, v, 'toolchains', 'llvm', 'prebuilt', NDK_HOST_TAG);
      for (const lib of ['lib64', 'lib']) {
        const base = path.join(clangRoot, lib, 'clang');
        if (!fs.existsSync(base)) continue;
        for (const ver of fs.readdirSync(base)) {
          const p = path.join(base, ver, 'lib', 'linux', arch, 'lldb-server');
          if (fs.existsSync(p)) return p;
        }
      }
    }
    throw new Error('lldb-server not found in any installed NDK');
  }

  // Gradle output dir (see android/app/build.gradle): Docker builds use their own one
  const androidBuildDir = (backend) => path.join(root, 'build-android', backend === 'docker' ? 'docker' : 'gradle');

  // Unstripped libraylib_button.so from the build, needed by lldb for symbols.
  function findUnstrippedSo(abi, backend) {
    const base = path.join(androidBuildDir(backend), 'intermediates', 'cxx', 'Debug');
    const walk = (dir) => {
      for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { const r = walk(full); if (r) return r; }
        else if (e.name === `lib${EXE}.so` && path.basename(path.dirname(full)) === abi && full.includes(`${path.sep}obj${path.sep}`)) return full;
      }
      return null;
    };
    const so = walk(base);
    if (!so) throw new Error(`Unstripped lib${EXE}.so for ${abi} not found under ${base}`);
    return so;
  }

  const adbRun = (serial, args) => execFile(adbPath(), ['-s', serial, ...args]);

  // Builds the APK (local SDK or Docker mingc/android-build-box), installs it, launches it and,
  // for Debug, attaches lldb-server so VS Code (CodeLLDB) can set breakpoints in C.
  async function runAndroid(d, cap) {
    let serial = d.serial;
    if (d.kind === 'android-avd') {
      serial = await withProgress(`Raylib: ${d.avdName}`, (p) => ensureAvdBooted(d.avdName, p));
      await setDevice({ kind: 'android-online', serial, model: d.avdName });
    }
    output.show(true);
    const backend = currentBackend();
    output.appendLine(`\n=== Raylib: Android ${cap} on ${serial} (${backend} build) ===`);
    const debug = cap === 'Debug';
    // Build only the ABI of this device: faster, and avoids Gradle's parallel-link hashing race on Windows
    const abi = (await adbRun(serial, ['shell', 'getprop', 'ro.product.cpu.abi'])).stdout.trim();
    const abiArg = abi ? [`-Pandroid.injected.build.abi=${abi}`] : [];

    await withProgress(`Raylib: Building Android ${cap} (${backend})...`, () => {
      if (backend === 'native') {
        // full path: VS Code's environment does not search the current directory for executables
        const gradlew = `"${path.join(root, 'android', IS_WIN ? 'gradlew.bat' : 'gradlew')}"`;
        return runLogged(gradlew, [`assemble${cap}`, '--console=plain', '--no-watch-fs', ...abiArg], {
          cwd: path.join(root, 'android'),
          env: { ...process.env, ANDROID_HOME: androidSdkRoot(), ANDROID_SDK_ROOT: androidSdkRoot() },
        });
      }
      return runLogged('docker', ['run', '--rm', '-v', `"${root}:/project"`, '-v', 'raylib-gradle:/root/.gradle',
        '-v', 'raylib-android-ndk:/opt/android-sdk/ndk', // keeps the NDK Gradle installs (not in the image)
        '-w', '/project/android', 'mingc/android-build-box',
        'sh', '-c', `"chmod +x gradlew && ./gradlew -Pdocker ${abiArg.join(' ')} assemble${cap} --console=plain"`]);
    });

    // A single-ABI build (-Pandroid.injected.build.abi) writes the APK to intermediates/apk, a normal
    // build to outputs/apk; the other one can be stale, so take whichever was written last.
    const apkName = `app-${cap.toLowerCase()}.apk`;
    const appBuild = androidBuildDir(backend);
    const apk = [path.join(appBuild, 'outputs', 'apk', cap.toLowerCase(), apkName),
                 path.join(appBuild, 'intermediates', 'apk', cap.toLowerCase(), apkName)]
      .filter((f) => fs.existsSync(f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    if (!apk) throw new Error(`APK not produced under ${appBuild}`);

    await withProgress('Raylib: Installing...', async () => {
      let r = await execFile(adbPath(), ['-s', serial, 'install', '-r', '-t', apk], 300000);
      output.appendLine((r.stdout + r.stderr).trim());
      if (r.err && /INSTALL_FAILED_(UPDATE_INCOMPATIBLE|VERSION_DOWNGRADE)|signatures do not match/.test(r.stdout + r.stderr)) {
        // Different signing key (e.g. installed earlier from a local Gradle build) - reinstall.
        output.appendLine('Install failed - uninstalling old build and retrying...');
        await adbRun(serial, ['uninstall', PKG]);
        r = await execFile(adbPath(), ['-s', serial, 'install', '-r', '-t', apk], 300000);
        output.appendLine((r.stdout + r.stderr).trim());
        if (r.err) throw new Error('adb install failed (see Raylib output)');
      } else if (r.err) {
        throw new Error('adb install failed (see Raylib output)');
      }
    });

    // A lldb-server left over from a previous session keeps the abstract socket and the binary
    // ("Text file busy"), and pidof below would wrongly report it as our new server - kill and wait.
    for (let i = 0; i < 15; i++) {
      if (!(await adbRun(serial, ['shell', 'run-as', PKG, 'pidof', 'lldb-server'])).stdout.trim()) break;
      await adbRun(serial, ['shell', 'run-as', PKG, 'pkill', '-9', 'lldb-server']);
      await new Promise((r) => setTimeout(r, 200));
    }
    await adbRun(serial, ['shell', 'am', 'force-stop', PKG]);
    // wait until the old process is really gone, or pidof below may return its stale PID
    for (let i = 0; i < 20 && (await adbRun(serial, ['shell', 'pidof', PKG])).stdout.trim(); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    await adbRun(serial, ['shell', 'am', 'start', '-W', '-n', `${PKG}/${ACTIVITY}`]);

    if (!debug) {
      vscode.window.showInformationMessage(`Raylib: Release build launched on ${serial}`);
      return undefined;
    }

    const lldbServer = findLldbServer(abi);
    // lldb keeps the .so open for the whole session; on Windows that would lock the file in the Gradle
    // build dir and the next build would fail to relink it. Give lldb its own copy (one dir per run).
    const builtSo = findUnstrippedSo(abi, backend);
    const symRoot = path.join(root, 'build-android', 'dbg', 'symbols');
    for (const old of fs.existsSync(symRoot) ? fs.readdirSync(symRoot) : []) {
      try { fs.rmSync(path.join(symRoot, old), { recursive: true, force: true }); } catch (e) { /* still in use */ }
    }
    const symDir = path.join(symRoot, String(Date.now()));
    fs.mkdirSync(symDir, { recursive: true });
    const so = path.join(symDir, path.basename(builtSo));
    fs.copyFileSync(builtSo, so);
    output.appendLine(`lldb-server: ${lldbServer}\nsymbols: ${so}`);

    let appPid = '';
    for (let i = 0; i < 20 && !appPid; i++) {
      appPid = (await adbRun(serial, ['shell', 'pidof', PKG])).stdout.trim().split(/\s+/).pop();
      if (!appPid) await new Promise((r) => setTimeout(r, 300));
    }
    if (!appPid) throw new Error('App did not start (no PID)');

    // lldb needs the real main executable so its dynamic-loader tracking finds our .so
    const dbgDir = path.join(root, 'build-android', 'dbg');
    fs.mkdirSync(dbgDir, { recursive: true });
    const appProcess = path.join(dbgDir, abi.includes('64') ? 'app_process64' : 'app_process32');
    await adbRun(serial, ['pull', `/system/bin/${path.basename(appProcess)}`, appProcess]);

    await adbRun(serial, ['push', lldbServer, '/data/local/tmp/lldb-server']);
    await adbRun(serial, ['shell', 'chmod', '755', '/data/local/tmp/lldb-server']);
    await adbRun(serial, ['shell', 'run-as', PKG, 'cp', '/data/local/tmp/lldb-server', './lldb-server']);
    await adbRun(serial, ['shell', 'run-as', PKG, 'chmod', '700', './lldb-server']);

    // Abstract unix socket + adb forward: works on devices whose SELinux policy blocks TCP listen.
    const socketName = `lldb-gdbserver-${PKG}`;
    await adbRun(serial, ['forward', `tcp:${LLDB_PORT}`, `localabstract:${socketName}`]);
    const server = cp.spawn(adbPath(), ['-s', serial, 'shell', 'run-as', PKG, './lldb-server', 'gdbserver',
      '--attach', appPid, `unix-abstract://${socketName}`]);
    server.stdout.on('data', (x) => output.append(x.toString()));
    server.stderr.on('data', (x) => output.append(x.toString()));
    context.subscriptions.push({ dispose: () => server.kill() });

    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      up = !!(await adbRun(serial, ['shell', 'run-as', PKG, 'pidof', 'lldb-server'])).stdout.trim();
      if (!up) await new Promise((r) => setTimeout(r, 300));
    }
    if (!up) throw new Error('lldb-server did not start on the device');
    await new Promise((r) => setTimeout(r, 500));

    return {
      type: 'lldb',
      request: 'custom',
      name: `Android: Debug (${abi})`,
      // Docker builds record /project/... in the debug info, so map it to the workspace.
      // Native builds record the real host path: do NOT add a sourceMap there - with one, lldb
      // compares paths case-sensitively (D:/ in the DWARF vs d:\ from VS Code) and never binds breakpoints.
      ...(backend === 'docker' ? { sourceMap: { '/project': root } } : {}),
      targetCreateCommands: ['platform select remote-android', `target create ${appProcess}`],
      processCreateCommands: [
        `settings set target.exec-search-paths ${path.dirname(so)}`,'settings set plugin.process.gdb-remote.packet-timeout 10', `gdb-remote localhost:${LLDB_PORT}`,
        // ART raises these on purpose (implicit null checks, GC, thread handoff); like Android
        // Studio, pass them to the app without stopping. Breakpoints are unaffected.
        'process handle SIGSEGV SIGBUS SIGCHLD SIGPIPE SIGURG SIGUSR1 SIGUSR2 SIGXCPU -n false -p true -s false',
        'process handle SIGSTOP -n false -p false -s false',
        // attaching leaves the app stopped, and a "custom" launch does not resume it by itself
        'process continue'],
    };
  }

  // Turns "Debug"/"Release" + the status bar selection into a concrete debug
  // configuration (or undefined when the app was launched without a debugger).
  async function resolveRaylibConfig(name) {
    const cap = name === 'Release' ? 'Release' : 'Debug';
    // End a previous session first: it may hold files (symbols, exe) that the new build has to replace.
    const active = vscode.debug.activeDebugSession;
    if (active) {
      await vscode.debug.stopDebugging(active);
      await new Promise((r) => setTimeout(r, 1000));
    }
    await context.workspaceState.update(MODE_STATE_KEY, cap.toLowerCase());
    updateStatusBar();
    const d = currentDevice();
    try {
      if (d.kind === 'chrome' || d.kind === 'edge') {
        await buildAndServeWeb(cap);
        return {
          type: d.kind === 'chrome' ? 'chrome' : 'msedge',
          request: 'launch',
          name: `Web: ${cap}`,
          url: `http://localhost:${WEB_PORT}/${EXE}.html`,
          webRoot: path.join(root, 'build-web', cap),
        };
      }
      if (d.kind === 'android-online' || d.kind === 'android-avd') {
        return await runAndroid(d, cap); // lldb config for Debug, undefined for Release
      }
      output.show(true);
      await buildDesktop(cap);
      const program = IS_WIN ? path.join(root, 'build-windows', cap, `${EXE}.exe`) : path.join(root, IS_MAC ? 'build-macos' : 'build-linux', EXE);
      return {
        type: IS_WIN ? 'cppvsdbg' : 'lldb', // MSVC debugger on Windows, CodeLLDB elsewhere
        request: 'launch',
        name: `${HOST_NAME}: ${cap}`,
        program,
        args: [],
        cwd: path.dirname(program),
      };
    } catch (e) {
      vscode.window.showErrorMessage(`Raylib: ${e.message}`);
      return undefined;
    }
  }

  // Generates the platform icons from assets/icon.png with tools/gen_icons.js (pure Node.js, runs
  // inside VS Code itself - no bash / ImageMagick needed).
  async function generateIcons() {
    const script = path.join(root, 'tools', 'gen_icons.js');
    if (!fs.existsSync(script)) return vscode.window.showErrorMessage(`Raylib: ${script} not found`);
    const gen = require(script);
    const picked = await vscode.window.showQuickPick(
      [{ label: 'All platforms', target: 'all' }, ...gen.targets.map((t) => ({ label: { ios: 'iOS' }[t] || t.charAt(0).toUpperCase() + t.slice(1), target: t }))],
      { placeHolder: 'Generate icons from assets/icon.png for...' });
    if (!picked) return;
    output.show(true);
    output.appendLine(`
=== Raylib: generating icons (${picked.target}) ===`);
    try {
      delete require.cache[require.resolve(script)];   // always run the current version of the script
      require(script).generate(root, picked.target, (line) => output.appendLine(line));
      vscode.window.showInformationMessage(`Raylib: icons generated (${picked.label})`);
    } catch (e) {
      vscode.window.showErrorMessage(`Raylib: ${e.message}`);
    }
  }

  async function run() {
    await vscode.debug.startDebugging(projectFolder, currentMode() === 'release' ? 'Release' : 'Debug');
  }

  updateStatusBar();

  context.subscriptions.push(
    output, modeItem, backendItem, deviceItem, runItem,
    { dispose: () => webServer && webServer.kill() },
    vscode.commands.registerCommand('raylibDevices.pickDevice', pickDevice),
    vscode.commands.registerCommand('raylibDevices.toggleMode', toggleMode),
    vscode.commands.registerCommand('raylibDevices.toggleBackend', toggleBackend),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('raylibDevices') && updateStatusBar()),
    vscode.commands.registerCommand('raylibDevices.generateIcons', generateIcons),
    vscode.commands.registerCommand('raylibDevices.run', run),
    vscode.debug.registerDebugConfigurationProvider('raylib', {
      resolveDebugConfiguration(folder, cfg) { return resolveRaylibConfig(cfg.name); },
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
