#!/bin/sh
cd "$(dirname "$0")"
command -v python3 >/dev/null 2>&1 || { echo "Python 3 kurulu degil."; exit 1; }
python3 -m pip install --upgrade pip
python3 -m pip install libretranslate
exec libretranslate --host 127.0.0.1 --port 5000 \
  --load-only tr,en,ar,de,fr,ru,es,it,fa,az,nl,pt,zh,ja,ko,uk,pl,el,he,hi,id,ro,sv,cs,hu,bg,vi,th,ms,sq,sr,da,fi,nb,sk,sl,ca,tl,ur,bn,ta
