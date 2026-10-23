@echo off
setlocal EnableExtensions
REM Nutrition Tracker — run ./deploy.sh entirely inside WSL (Docker Desktop + Ubuntu).
REM Usage: deploy-from-windows.bat [--skip-test] [--skip-git] [-m "message"] ...
REM See docs/WINDOWS-TROUBLESHOOTING.md and docs/SETUP-WINDOWS-WSL.md

cd /d "%~dp0"

REM --- TODO 1: Require WSL; all deploy logic stays in Linux path space ---
where wsl.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: wsl.exe not found. Install WSL2 + Ubuntu — docs/SETUP-WINDOWS-WSL.md
  exit /b 1
)

for /f "usebackq delims=" %%i in (`wsl.exe wslpath -u "%CD%" 2^>nul`) do set "REPO_WSL=%%i"
if not defined REPO_WSL (
  echo ERROR: Could not map this folder into WSL.
  echo Clone inside Ubuntu:  cd ~ ^&^& git clone ... ^&^& cd Nutrition-Tracker
  exit /b 1
)

REM deploy.sh runs wsl-preflight automatically when executed under WSL.
wsl.exe bash -ic "cd '%REPO_WSL%' && exec ./deploy.sh %*"
exit /b %ERRORLEVEL%
