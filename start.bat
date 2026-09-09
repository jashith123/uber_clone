@echo off
REM Double-click this file to run SwiftRide.
title SwiftRide server
cd /d "%~dp0"
node scripts\start.mjs
set RC=%errorlevel%
if "%RC%"=="3" (
  REM Already running in the background. Pause so the message can be read.
  pause
) else if not "%RC%"=="0" (
  echo.
  echo SwiftRide could not start. The message above says why.
  pause
)
