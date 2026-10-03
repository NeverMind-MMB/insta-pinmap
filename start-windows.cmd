@echo off
REM ---------------------------------------------------------------------------
REM  Ortsammlung - start on Windows
REM
REM  Prerequisite: Node.js from https://nodejs.org (the LTS version is enough).
REM  After that, a double-click on this file is all it takes.
REM ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"

if "%PINMAP_PORT%"=="" set PINMAP_PORT=8080

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found.
  echo.
  echo   Please install it once from https://nodejs.org ^(LTS^),
  echo   then close this window and double-click again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting the Ortsammlung ...
echo   The browser will open by itself in a moment.
echo.

start "" http://127.0.0.1:%PINMAP_PORT%/
node server.js --port %PINMAP_PORT%

echo.
echo   The server has stopped.
pause
