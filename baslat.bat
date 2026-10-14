@echo off
chcp 65001 >nul
title CVPilot
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi. Lutfen https://nodejs.org adresinden Node.js 20 veya ustunu kurun.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Paketler kuruluyor, bu ilk seferde bir dakika surebilir...
  call npm install --no-audit --no-fund
)

if not exist .env (
  copy .env.example .env >nul
  echo.
  echo  .env dosyasi olusturuldu. Yapay zeka icin icine ANTHROPIC_API_KEY ekleyin.
  echo.
)

rem Sunucu hazır olunca tarayıcıyı doğru adreste kendisi açar (port doluysa bir sonrakini kullanır).
node server.js --open
pause
