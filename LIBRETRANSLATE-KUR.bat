@echo off
title LibreTranslate kurulumu
cd /d "%~dp0"
echo.
echo   LibreTranslate, ceviriyi bu bilgisayarda yapan acik kaynak motordur.
echo   Kurulduktan sonra hicbir mesaj metni disari cikmaz.
echo.
where python >nul 2>nul
if errorlevel 1 (
  echo   Python bulunamadi.
  echo   https://www.python.org/downloads/ adresinden Python 3.11 veya 3.12 kurun.
  echo   Kurulum ekraninda "Add python.exe to PATH" kutusunu MUTLAKA isaretleyin.
  echo.
  pause
  exit /b
)
echo   Kuruluyor, ilk seferde birkac dakika surebilir...
echo.
python -m pip install --upgrade pip
python -m pip install libretranslate
if errorlevel 1 (
  echo.
  echo   Kurulum basarisiz. Python 3.13 kullaniyorsaniz 3.12'ye dusurun.
  pause
  exit /b
)
echo.
echo   Kurulum tamam. Dil modelleri indiriliyor...
echo   Bu pencere acik kaldigi surece ceviri calisir.
echo.
libretranslate --host 127.0.0.1 --port 5000 --load-only tr,en,ar,de,fr,ru,es,it,fa,az,nl,pt,zh,ja,ko,uk,pl,el,he,hi,id,ro,sv,cs,hu,bg,vi,th,ms,sq,sr,da,fi,nb,sk,sl,ca,tl,ur,bn,ta
pause
