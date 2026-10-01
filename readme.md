# raylib button

One button in the middle of the window; counts clicks/taps. Same `src/main.c` and `CMakeLists.txt` for all platforms (raylib 5.5, fetched automatically).

## Windows
```
cmake --preset windows
cmake --build --preset windows-release
```
Needs Visual Studio 2022. Output: `build-windows/Release/raylib_button.exe` (+ `assets/` next to it).

## Linux
```
sudo apt install cmake ninja-build g++ git libx11-dev libxrandr-dev libxinerama-dev libxcursor-dev libxi-dev libgl1-mesa-dev
cmake --preset linux -DCMAKE_BUILD_TYPE=Release
cmake --build --preset linux
```
Output: `build-linux/raylib_button` (macOS: `build-macos/raylib_button`). (Build verified in an Ubuntu 24.04 container.)

## macOS (untested: no Mac available)
```
cmake --preset macos -DCMAKE_BUILD_TYPE=Release
cmake --build --preset macos
```
Needs Xcode command line tools, CMake and Ninja.

## iOS (untested: no Mac available)
raylib has no native iOS platform, so this uses raylib's SDL backend on SDL3 (raylib `master`, see `CMakeLists.txt`).
```
cmake --preset ios-simulator            # or ios-device -DIOS_DEVELOPMENT_TEAM=<team id>
cmake --build --preset ios-simulator
open build-ios/simulator/raylib_button.xcodeproj
```
Needs Xcode; pick a simulator/device and Run. `assets/` is bundled as a folder resource.

## Web (Docker, no local emsdk)
```
docker run --rm -v "%cd%:/src" -w /src emscripten/emsdk emcmake cmake -S . -B build-web/Release -DCMAKE_BUILD_TYPE=Release
docker run --rm -v "%cd%:/src" -w /src emscripten/emsdk cmake --build build-web/Release
cd build-web/Release && python -m http.server 8137   # open http://localhost:8137/raylib_button.html
```
(With a local emsdk: `emcmake cmake ...` directly.) `assets/` is preloaded into the wasm virtual FS.

## Android (needs Android SDK + NDK 25.2.9519653, JDK 17+; or Docker, see F5 below)
Set `ANDROID_HOME`, then:
```
cd android
gradlew assembleDebug
```
APK: `build-android/gradle/outputs/apk/debug/app-debug.apk` (`adb install -r` it).
Android Studio can also open `android/`. `assets/` is packed into the APK.

## Assets
`assets/title.txt` is read at startup with the same path (`assets/title.txt`) on every platform.

## F5 in VS Code
![VS Code status bar: Debug/Release toggle, device picker, run button](vscode-UI.png)

On the left of the status bar: the **Debug/Release** toggle (`Debug`), the **device picker** (`Windows`) and the **run** button (▷).

Open this folder in VS Code (extension in `tools/vscode-raylib-devices`; install once with
`code --install-extension tools/vscode-raylib-devices/raylib-devices-0.0.21.vsix`).
Status bar: **Debug/Release** toggle, **device picker** (Windows / Chrome / Edge / Android devices,
Wi-Fi adb, emulators) and a run button. F5 runs the `Debug` or `Release` entry from `launch.json`
on the selected device. Palette commands: **Raylib: Init** (see below), Select Device, Toggle Debug/Release,
Toggle Android Build Backend, Generate Icons, Run. Desktop runs on the host OS (Windows: MSVC debugger `cppvsdbg`; Linux/macOS: CodeLLDB),
Android is built with the local SDK/NDK (Gradle) or in Docker (`mingc/android-build-box`) - click the backend item in the status bar or set `raylibDevices.androidBackend` (`auto`/`native`/`docker`; auto = local if an NDK is installed) - then installed and launched via adb; Debug attaches lldb-server + CodeLLDB, so breakpoints in `main.c` work, Web is built in Docker (`emscripten/emsdk` image, so Docker + python are needed, no local emsdk); Debug keeps DWARF, so install the Chrome extension *C/C++ DevTools Support (DWARF)* and debug `main.c` in DevTools (F12).

## Raylib: Init (new project from template)
In an empty folder run **Raylib: Init** from the Command Palette: it asks for a project name and scaffolds the
same base project (CMake + presets, `src/`, `assets/`, `android/`, `icons/`, `web/`, `.vscode/`, `tools/gen_icons.js`,
`CLAUDE.md` and an `add-screen` Claude skill), renaming `raylib_button` and the Android package to your name.
The templates live in `tools/vscode-raylib-devices/templates/`; keep them in sync with the root project.

## Structure
`src/main.c` (main loop, fade transitions, shared font/sound) and `src/screen_*.c` (TITLE <-> GAMEPLAY;
the button lives in `screen_gameplay.c`) come from [raylib-game-template](https://github.com/raysan5/raylib-game-template)
(zlib license), adapted to an adaptive layout. The web page template is `web/shell.html`.

## Icons
Source: `assets/icon.png`. Desktop windows use it directly; the rest is generated and committed:
Android `mipmap-*`, Windows `icons/icon.ico` (embedded via `icons/app.rc`), iOS `ios/AppIcon.xcassets`,
Web `icons/web/` (favicon, iPhone home-screen icon, installable-app manifest with 192/512 icons; copied next to the page).
Regenerate after changing `assets/icon.png` with any of:
- VS Code command **Raylib: Generate Icons from assets/icon.png** (Ctrl+Shift+P), or the tasks **Icons: ...** (Terminal > Run Task)
- `node tools/gen_icons.js [all|android|windows|ios|web]`

The generator (`tools/gen_icons.js`) is plain Node.js with no dependencies (no ImageMagick), so it works the same on every OS.

## Plugin development
Tasks (Terminal > Run Task): **Plugin: Bump version**, **Plugin: Package (.vsix)**, **Plugin: Package and install**.

## CI
`.github/workflows/build.yml` builds Windows, Linux, Web and Android on every push/PR and uploads artifacts.
macOS and iOS (simulator, unsigned) are informational (`continue-on-error`) because they were written without a Mac.
