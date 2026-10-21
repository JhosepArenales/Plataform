@echo off
chcp 65001 >nul
title Consola de Emi (local)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No encontre Node.js en este computador.
  echo  Instala la version LTS desde https://nodejs.org y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

echo.
echo  === Consola de Emi - prueba local contra n8n ===
echo.
if "%N8N_URL%"=="" set /p N8N_URL=  URL de tu n8n (ej. https://n8n.mesfix.com): 
if "%EMI_SECRET%"=="" set /p EMI_SECRET=  Secreto del webhook (el mismo de la credencial "Emi - secreto del webhook"): 
echo.
echo  Abriendo http://localhost:8765 ... (no cierres esta ventana mientras pruebas)
echo.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8765"
node tools\dev-server.js
echo.
pause
