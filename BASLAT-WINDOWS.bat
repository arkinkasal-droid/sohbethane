@echo off
title SohbetHane
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js kurulu degil.
  echo https://nodejs.org adresinden LTS surumunu kurup bu dosyayi tekrar calistirin.
  pause
  exit /b
)
if not exist node_modules (
  echo Gerekli paketler kuruluyor, bir kez beklemeniz yeterli...
  call npm install
)
start "" http://localhost:3000
node server.js
pause
