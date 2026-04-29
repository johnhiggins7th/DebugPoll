@echo off
cd /d "%~dp0"
set "DEBUGPOLL_DIR=%~dp0"
title Remote DebugStats
mode con: cols=140 lines=30 >nul
powershell -NoProfile -ExecutionPolicy Bypass -NoExit -Command "$raw = $Host.UI.RawUI; try { $f = $raw.FontSize; $raw.FontSize = New-Object Management.Automation.Host.Size($f.Width, ($f.Height + 2)); } catch {}; Set-Location -LiteralPath $env:DEBUGPOLL_DIR; if (Test-Path .\node.exe) { & .\node.exe .\debugpoll.js } else { node .\debugpoll.js }"