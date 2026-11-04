@echo off
title Serra Dourada - Agente de impressao
cd /d "%~dp0"
:loop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0agente.ps1"
echo O agente parou. Reiniciando em 10 segundos... (feche esta janela para desligar)
timeout /t 10 >nul
goto loop
