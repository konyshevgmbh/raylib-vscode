/*******************************************************************************************
*
*   raylib button - screens, transitions and main loop
*
*   Structure (screens TITLE <-> GAMEPLAY, fade transitions, shared font
*   and sound) is taken from https://github.com/raysan5/raylib-game-template
*   Copyright (c) 2021-2026 Ramon Santamaria (@raysan5), zlib/libpng license.
*   Altered: window/assets handling for desktop, web, Android and iOS; adaptive layout.
*
********************************************************************************************/

#include <stddef.h>

#include "raylib.h"
#include "screens.h"    // NOTE: Declares global (extern) variables and screens functions

#if defined(RAYLIB_EX_IOS)
    #include <SDL3/SDL_main.h>              // provides the UIApplicationMain entry point on iOS
#endif

#if defined(PLATFORM_WEB)
    #include <emscripten/emscripten.h>
#endif

//----------------------------------------------------------------------------------
// Shared Variables Definition (global)
// NOTE: Those variables are shared between modules through screens.h
//----------------------------------------------------------------------------------
GameScreen currentScreen = TITLE;
Font font = { 0 };
Music music = { 0 };
Sound fxCoin = { 0 };

//----------------------------------------------------------------------------------
// Global Variables Definition (local to this module)
//----------------------------------------------------------------------------------
// Required variables to manage screen transitions (fade-in, fade-out)
static float transAlpha = 0.0f;
static bool onTransition = false;
static bool transFadeOut = false;
static int transFromScreen = -1;
static GameScreen transToScreen = UNKNOWN;

//----------------------------------------------------------------------------------
// Module Functions Definition
//----------------------------------------------------------------------------------
static void InitScreen(int screen)
{
    switch (screen)
    {
        case TITLE: InitTitleScreen(); break;
        case GAMEPLAY: InitGameplayScreen(); break;
        default: break;
    }
}

static void UnloadScreen(int screen)
{
    switch (screen)
    {
        case TITLE: UnloadTitleScreen(); break;
        case GAMEPLAY: UnloadGameplayScreen(); break;
        default: break;
    }
}

// Request transition to next screen
static void TransitionToScreen(int screen)
{
    onTransition = true;
    transFadeOut = false;
    transFromScreen = currentScreen;
    transToScreen = screen;
    transAlpha = 0.0f;
}

// Update transition effect (fade-in, fade-out)
static void UpdateTransition(void)
{
    if (!transFadeOut)
    {
        transAlpha += 0.05f;

        // NOTE: Due to float internal representation, condition jumps on 1.0f instead of 1.05f
        // For that reason we compare against 1.01f, to avoid last frame loading stop
        if (transAlpha > 1.01f)
        {
            transAlpha = 1.0f;

            UnloadScreen(transFromScreen);
            InitScreen(transToScreen);
            currentScreen = transToScreen;

            // Activate fade out effect to next loaded screen
            transFadeOut = true;
        }
    }
    else  // Transition fade out logic
    {
        transAlpha -= 0.02f;

        if (transAlpha < -0.01f)
        {
            transAlpha = 0.0f;
            transFadeOut = false;
            onTransition = false;
            transFromScreen = -1;
            transToScreen = UNKNOWN;
        }
    }
}

// Draw transition effect (full-screen rectangle)
static void DrawTransition(void)
{
    DrawRectangle(0, 0, GetScreenWidth(), GetScreenHeight(), Fade(BLACK, transAlpha));
}

// Update and draw game frame
static void UpdateDrawFrame(void)
{
    // Update
    //----------------------------------------------------------------------------------
    if (!onTransition)
    {
        switch (currentScreen)
        {
            case TITLE:
            {
                UpdateTitleScreen();
                if (FinishTitleScreen() == 1) TransitionToScreen(GAMEPLAY);
            } break;
            case GAMEPLAY:
            {
                UpdateGameplayScreen();
                if (FinishGameplayScreen() == 1) TransitionToScreen(TITLE);
            } break;
            default: break;
        }
    }
    else UpdateTransition();    // Update transition (fade-in, fade-out)

    // Draw
    //----------------------------------------------------------------------------------
    BeginDrawing();

        ClearBackground(RAYWHITE);

        switch (currentScreen)
        {
            case TITLE: DrawTitleScreen(); break;
            case GAMEPLAY: DrawGameplayScreen(); break;
            default: break;
        }

        // Draw full screen rectangle in front of everything
        if (onTransition) DrawTransition();

    EndDrawing();
}

//----------------------------------------------------------------------------------
// Program main entry point
//----------------------------------------------------------------------------------
int main(void)
{
    // Resizable: desktop window can be resized, web canvas follows the browser window.
    // Android/iOS are always full screen. The UI is laid out from GetScreenWidth/Height.
    SetConfigFlags(FLAG_WINDOW_RESIZABLE);
#if defined(PLATFORM_ANDROID) || defined(__ANDROID__) || defined(RAYLIB_EX_IOS)
    // Mobile: 0x0 = use the real display size. A fixed size (800x450) would be rendered
    // as a letterboxed viewport in the middle of the screen.
    InitWindow(0, 0, "raylib button");
#else
    InitWindow(800, 450, "raylib button");
#endif

#if defined(PLATFORM_DESKTOP)
    ChangeDirectory(GetApplicationDirectory()); // assets/ is copied next to the executable

    // Window/taskbar icon (Windows and Linux; the exe icon on Windows comes from icons/app.rc)
    Image icon = LoadImage("assets/icon.png");
    if (icon.data != NULL)
    {
        ImageFormat(&icon, PIXELFORMAT_UNCOMPRESSED_R8G8B8A8);
        SetWindowIcon(icon);
        UnloadImage(icon);
    }
#endif

    InitAudioDevice();      // Initialize audio device

    // Load global data (assets that must be available in all screens, i.e. font).
    // Same relative path on every platform: copied next to the exe (desktop),
    // preloaded into the virtual FS (web), packed into the APK assets (android).
    font = LoadFont("assets/mecha.png");
    fxCoin = LoadSound("assets/coin.wav");

    // Setup and init first screen
    currentScreen = TITLE;
    InitTitleScreen();

#if defined(PLATFORM_WEB)
    emscripten_set_main_loop(UpdateDrawFrame, 0, 1);
#else
    SetTargetFPS(60);       // Set our game to run at 60 frames-per-second

    while (!WindowShouldClose())    // Detect window close button or ESC key
    {
        UpdateDrawFrame();
    }
#endif

    // De-Initialization
    UnloadScreen(currentScreen);
    UnloadFont(font);
    UnloadSound(fxCoin);
    CloseAudioDevice();     // Close audio context

    CloseWindow();          // Close window and OpenGL context
    return 0;
}
