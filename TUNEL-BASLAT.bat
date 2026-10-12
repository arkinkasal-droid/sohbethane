@echo off
title SohbetHane - gizli adres tuneli
cd /d "%~dp0"
echo.
echo   Bu pencere, bilgisayarinizin IP adresini gizleyen tuneli acar.
echo   Karsi taraf yalnizca Cloudflare adresini gorur, sizin adresinizi asla.
echo.

if not exist cloudflared.exe (
  echo   cloudflared indiriliyor, bir kez yapiliyor...
  curl -L -o cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
  if not exist cloudflared.exe (
    echo.
    echo   Indirme basarisiz. Su adresten "cloudflared-windows-amd64.exe" dosyasini indirin,
    echo   adini cloudflared.exe yapip bu klasore koyun:
    echo   https://github.com/cloudflare/cloudflared/releases/latest
    echo.
    pause
    exit /b
  )
)

echo.
echo   Tunel aciliyor. Birazdan asagida "https://....trycloudflare.com" seklinde
echo   bir adres cikacak. O adresi kopyalayin.
echo.
echo   Sonra SohbetHane'de: zarf simgesi -^> "Davet linkinde kullanilacak adres"
echo   kutusuna yapistirin -^> davet linkini kopyalayip gonderin.
echo.
echo   ONEMLI: Bu pencere kapaninca tunel kapanir ve adres degisir.
echo   Sohbet ederken acik kalsin.
echo.
cloudflared.exe tunnel --url http://localhost:3000
pause
