@echo off
setlocal EnableExtensions
REM Run Nutrition Tracker deploy inside WSL (Docker Desktop + Ubuntu required).
REM Usage: deploy-from-windows.bat [--skip-test] [--skip-git] [-m "message"]  etc.
REM Same flags as ./deploy.sh — see README or run with --help via Ubuntu: ./deploy.sh --help

cd /d "%~dp0"

where wsl.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: wsl.exe not found. Install WSL2 and Ubuntu — see docs/SETUP-WINDOWS-WSL.md
  exit /b 1
)

for /f "usebackq delims=" %%i in (`wsl.exe wslpath -u "%CD%" 2^>nul`) do set "REPO_WSL=%%i"
if not defined REPO_WSL (
  echo ERROR: Could not map this folder into WSL.
  echo Clone the repo inside Ubuntu instead:  cd ~ ^&^& git clone ... ^&^& cd Nutrition-Tracker
  exit /b 1
)

wsl.exe bash -lc "cd '%REPO_WSL%' && bash deploy.sh %*"
exit /b %ERRORLEVEL%
