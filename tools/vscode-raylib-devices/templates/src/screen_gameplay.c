#include "raylib.h"
#include "screens.h"

static int finishScreen = 0;

void InitGameplayScreen(void)
{
    finishScreen = 0;
}

void UpdateGameplayScreen(void)
{
    // Press enter or tap to go back to the TITLE screen
    if (IsKeyPressed(KEY_ENTER) || IsGestureDetected(GESTURE_TAP)) finishScreen = 1;   // TITLE
}

void DrawGameplayScreen(void)
{
    int w = GetScreenWidth(), h = GetScreenHeight();
    DrawRectangle(0, 0, w, h, RAYWHITE);
    DrawText("GAMEPLAY SCREEN", (w - MeasureText("GAMEPLAY SCREEN", 30))/2, h/2 - 15, 30, DARKGRAY);
}

void UnloadGameplayScreen(void)
{
}

int FinishGameplayScreen(void)
{
    return finishScreen;
}
