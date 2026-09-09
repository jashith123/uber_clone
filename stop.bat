@echo off
REM Stops SwiftRide if it is running in the background.
cd /d "%~dp0"
node scripts\stop.mjs
pause
