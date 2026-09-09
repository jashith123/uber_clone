@echo off
REM Double-click this file to run SwiftRide.
title SwiftRide server
cd /d "%~dp0"
node scripts\start.mjs
if errorlevel 1 (
  echo.
  echo Something went wrong. The message above says what.
  pause
)
