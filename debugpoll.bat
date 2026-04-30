@echo off
cd /d "%~dp0"
set "DEBUGPOLL_DIR=%~dp0"
title Remote DebugStats

powershell -NoProfile -ExecutionPolicy Bypass -NoExit -Command "Set-Location -LiteralPath $env:DEBUGPOLL_DIR; if (Test-Path .\node.exe) { & .\node.exe .\debugpoll.js } else { node .\debugpoll.js }"