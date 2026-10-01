---
name: add-screen
description: Add a new screen (e.g. options, menu, ending) to this raylib app and wire it into screens.h and main.c. Use when the user asks for a new screen/scene/menu/page.
---

Add a screen called `<Name>` (ask for the name if not given; file name `screen_<name>.c`, lowercase).

1. **`src/screens.h`**: add `<NAME>` to the `GameScreen` enum (keep `UNKNOWN = -1` and the first value `= 0` as they are)
   and declare the five functions after the existing ones:
   `void Init<Name>Screen(void); void Update<Name>Screen(void); void Draw<Name>Screen(void); void Unload<Name>Screen(void); int Finish<Name>Screen(void);`
2. **`src/screen_<name>.c`**: copy `src/screen_title.c` as the starting point. Keep the `finishScreen` variable,
   reset it in `Init...`, return it from `Finish...`. Draw with `GetScreenWidth()/GetScreenHeight()` based layout.
3. **`src/main.c`** - add a `case <NAME>:` in each of the four switches:
   - `InitScreen` -> `Init<Name>Screen()`
   - `UnloadScreen` -> `Unload<Name>Screen()`
   - the update switch in `UpdateDrawFrame`: `Update<Name>Screen(); if (Finish<Name>Screen() == 1) TransitionToScreen(<TARGET>);`
   - the draw switch in `UpdateDrawFrame` -> `Draw<Name>Screen()`
4. **Entry point**: make an existing screen reach the new one. Extend that screen's `finishScreen` codes
   (e.g. `finishScreen = 2;`) and add the matching `else if (FinishXScreen() == 2) TransitionToScreen(<NAME>);` in `main.c`.
   Do not call `FinishXScreen()` results twice in a way that skips a code.
5. Verify it compiles: configure and build for the host platform (see CLAUDE.md "Build from a terminal").
   CMake picks up the new file automatically.

Keep the code style of the surrounding files (Allman braces, 4 spaces, short comments).
