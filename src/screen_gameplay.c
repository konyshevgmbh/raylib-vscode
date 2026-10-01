/**********************************************************************************************
*
*   Gameplay Screen: one centered button that counts clicks/taps.
*
*   Layout is computed from GetScreenWidth()/GetScreenHeight(), so it works in a resizable
*   desktop window, in the browser and full screen on phones.
*
**********************************************************************************************/

#include <stddef.h>

#include "raylib.h"
#include "screens.h"

#if defined(PLATFORM_WEB)
    #include <emscripten/emscripten.h>
#endif

//----------------------------------------------------------------------------------
// Module Variables Definition (local)
//----------------------------------------------------------------------------------
static int finishScreen = 0;
static int clicks = 0;
static char *title = NULL;      // loaded from assets/title.txt

// Returns true when the mouse/touch was released over the rectangle
static bool UpdateButton(Rectangle rec, bool *down, bool *hover)
{
    Vector2 mouse = GetMousePosition();    // touch is mapped to mouse on Android/iOS/Web
    *hover = CheckCollisionPointRec(mouse, rec);
    *down = *hover && IsMouseButtonDown(MOUSE_BUTTON_LEFT);
    return *hover && IsMouseButtonReleased(MOUSE_BUTTON_LEFT);
}

static Rectangle MainButton(void)
{
    int w = GetScreenWidth(), h = GetScreenHeight();
    float bw = w*0.5f, bh = h*0.15f;
    return (Rectangle){ (w - bw)/2, (h - bh)/2, bw, bh };
}

static Rectangle FinishButton(void)
{
    int w = GetScreenWidth(), h = GetScreenHeight();
    float bw = w*0.3f, bh = h*0.06f;
    return (Rectangle){ (w - bw)/2, h*0.85f, bw, bh };
}

//----------------------------------------------------------------------------------
// Gameplay Screen Functions Definition
//----------------------------------------------------------------------------------

void InitGameplayScreen(void)
{
    finishScreen = 0;
    clicks = 0;
    title = LoadFileText("assets/title.txt");
}

void UpdateGameplayScreen(void)
{
    bool down, hover;
    if (UpdateButton(MainButton(), &down, &hover)) { clicks++; PlaySound(fxCoin); }
    if (UpdateButton(FinishButton(), &down, &hover) || IsKeyPressed(KEY_ENTER)) finishScreen = 1;   // TITLE
}

void DrawGameplayScreen(void)
{
    int w = GetScreenWidth(), h = GetScreenHeight();
    bool down, hover;
    Vector2 mouse = GetMousePosition();

    DrawRectangle(0, 0, w, h, RAYWHITE);

    // Main button
    Rectangle btn = MainButton();
    UpdateButton(btn, &down, &hover);
    DrawRectangleRec(btn, down ? DARKBLUE : (hover ? SKYBLUE : BLUE));
    DrawRectangleLinesEx(btn, 3, DARKBLUE);

    // font scales with the button height but never wider than the button (portrait screens)
    int fs = (int)(btn.height*0.4f);
    if (fs > (int)(btn.width*0.15f)) fs = (int)(btn.width*0.15f);
    const char *label = TextFormat("Clicked: %d", clicks);
    DrawText(label, (int)(btn.x + (btn.width - MeasureText(label, fs))/2),
             (int)(btn.y + (btn.height - fs)/2), fs, WHITE);

    if (title)
    {
        int ts = (int)(btn.height*0.3f);
        if (ts > (int)(w*0.1f)) ts = (int)(w*0.1f);
        DrawText(title, (w - MeasureText(title, ts))/2, (int)(btn.y - ts*2), ts, DARKGRAY);
    }

    // Finish button -> back to TITLE screen
    Rectangle fin = FinishButton();
    UpdateButton(fin, &down, &hover);
    DrawRectangleRec(fin, down ? DARKGRAY : (hover ? LIGHTGRAY : GRAY));
    int fs2 = (int)(fin.height*0.5f);
    DrawText("Finish", (int)(fin.x + (fin.width - MeasureText("Finish", fs2))/2), (int)(fin.y + (fin.height - fs2)/2), fs2, WHITE);

    // DEBUG: cross at the mouse position raylib sees, to spot hover/click offsets
    DrawLine((int)mouse.x - 15, (int)mouse.y, (int)mouse.x + 15, (int)mouse.y, RED);
    DrawLine((int)mouse.x, (int)mouse.y - 15, (int)mouse.x, (int)mouse.y + 15, RED);
    DrawText(TextFormat("mouse %d,%d  screen %dx%d", (int)mouse.x, (int)mouse.y, w, h), 10, 10, 16, RED);
#if defined(PLATFORM_WEB)
    {
        // canvas pixel size vs CSS box vs window, and the device pixel ratio
        int cw = EM_ASM_INT({ return document.getElementById('canvas').width; });
        int ch = EM_ASM_INT({ return document.getElementById('canvas').height; });
        int rl = EM_ASM_INT({ return Math.round(document.getElementById('canvas').getBoundingClientRect().left); });
        int rt = EM_ASM_INT({ return Math.round(document.getElementById('canvas').getBoundingClientRect().top); });
        int rw = EM_ASM_INT({ return Math.round(document.getElementById('canvas').getBoundingClientRect().width); });
        int rh = EM_ASM_INT({ return Math.round(document.getElementById('canvas').getBoundingClientRect().height); });
        int iw = EM_ASM_INT({ return window.innerWidth; });
        int ih = EM_ASM_INT({ return window.innerHeight; });
        int dpr = EM_ASM_INT({ return Math.round(window.devicePixelRatio*100); });
        DrawText(TextFormat("canvas %dx%d  css %dx%d @%d,%d", cw, ch, rw, rh, rl, rt), 10, 30, 16, RED);
        DrawText(TextFormat("inner %dx%d  dpr %d%%", iw, ih, dpr), 10, 50, 16, RED);
    }
#endif
}

void UnloadGameplayScreen(void)
{
    UnloadFileText(title);
    title = NULL;
}

int FinishGameplayScreen(void)
{
    return finishScreen;
}
