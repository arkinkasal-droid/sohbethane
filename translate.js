'use strict';
/**
 * Ceviri motoru.
 * Oncelik: yerel LibreTranslate (127.0.0.1:5000) -> DeepL -> Google
 * Gizlilik: "yerel" kipte metin bu bilgisayardan hicbir zaman disari cikmaz.
 */

const cache = new Map();
const MAX_CACHE = 8000;
const ckey = (t, h) => h + '\u0000' + t;
function putCache(k, v) {
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(k, v);
}
async function withTimeout(p, ms) {
  let t;
  try { return await Promise.race([p, new Promise((_, r) => { t = setTimeout(() => r(new Error('zaman asimi')), ms); })]); }
  finally { clearTimeout(t); }
}

/* ---------------- yerel LibreTranslate izleyicisi ---------------- */
const yerel = { url: 'http://127.0.0.1:5000', ayakta: false, diller: [], sonKontrol: 0 };

async function yerelKontrol(url) {
  const hedef = String(url || yerel.url).replace(/\/+$/, '');
  try {
    const r = await withTimeout(fetch(hedef + '/languages'), 3000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    yerel.url = hedef;
    yerel.ayakta = Array.isArray(j) && j.length > 0;
    yerel.diller = yerel.ayakta ? j.map(x => x.code) : [];
  } catch (e) { yerel.ayakta = false; yerel.diller = []; }
  yerel.sonKontrol = Date.now();
  return yerel.ayakta;
}
function durum() {
  return { ayakta: yerel.ayakta, url: yerel.url, diller: yerel.diller, sonKontrol: yerel.sonKontrol };
}

/* ---------------- saglayicilar ---------------- */
async function libre(text, target, base, key) {
  const u = String(base).replace(/\/+$/, '');
  const body = { q: text, source: 'auto', target, format: 'text' };
  if (key) body.api_key = key;
  const r = await fetch(u + '/translate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('libretranslate ' + r.status);
  const j = await r.json();
  if (!j.translatedText) throw new Error('libretranslate bos yanit');
  return { text: j.translatedText, src: (j.detectedLanguage && j.detectedLanguage.language) || null };
}
async function deepl(text, target, cfg) {
  const p = new URLSearchParams();
  p.set('text', text); p.set('target_lang', String(target).toUpperCase().split('-')[0]);
  const r = await fetch(cfg.deeplUrl || 'https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: { Authorization: 'DeepL-Auth-Key ' + cfg.key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: p
  });
  if (!r.ok) throw new Error('deepl ' + r.status);
  const j = await r.json();
  const t = j.translations && j.translations[0];
  if (!t) throw new Error('deepl bos yanit');
  return { text: t.text, src: (t.detected_source_language || '').toLowerCase() || null };
}
async function google(text, target) {
  const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl='
    + encodeURIComponent(target) + '&dt=t&q=' + encodeURIComponent(text);
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('google ' + r.status);
  const j = await r.json();
  const out = (j[0] || []).map(x => x[0]).join('');
  if (!out) throw new Error('google bos yanit');
  return { text: out, src: j[2] || null };
}

/* ---------------- yanit dogrulama ----------------
   Bazi servisler hata mesajini normal ceviri gibi dondurur
   ("'AUTO' IS AN INVALID SOURCE LANGUAGE..." gibi). Bunlar mesaj
   yerine gecmesin diye eleniyor. */
const HATA_IZI = [
  'INVALID SOURCE LANGUAGE', 'INVALID TARGET LANGUAGE', 'LANGPAIR=',
  'MYMEMORY WARNING', 'QUERY LENGTH LIMIT', 'PLEASE SELECT TWO DISTINCT LANGUAGES',
  'INVALID API KEY', 'QUOTA EXCEEDED', 'TOO MANY REQUESTS'
];
function gecerliMi(cikti, girdi) {
  if (!cikti || typeof cikti !== 'string') return false;
  const u = cikti.toUpperCase();
  for (const iz of HATA_IZI) if (u.includes(iz)) return false;
  // Kisa bir metne karsilik devasa bir yanit geldiyse bu ceviri degildir
  if (girdi.length < 60 && cikti.length > girdi.length * 8 + 120) return false;
  return true;
}

/* ---------------- ana giris ---------------- */
/** cfg: { kip:'yerel'|'karma'|'dis', url, key, deeplUrl } */
async function translate(text, target, cfg = {}) {
  const clean = String(text || '');
  if (!clean.trim() || !target) return { text: clean, src: null, motor: 'yok' };
  const k = ckey(clean, target);
  if (cache.has(k)) return cache.get(k);

  const kip = String(cfg.kip || 'yerel').toLowerCase();
  if (Date.now() - yerel.sonKontrol > 45000) await yerelKontrol(cfg.url);

  const sira = [];
  if (kip === 'yerel' || kip === 'karma') sira.push('yerel');
  if (kip === 'karma' || kip === 'dis') { if (cfg.key) sira.push('deepl'); sira.push('google'); }

  let sonHata = null;
  for (const ad of sira) {
    try {
      let res;
      if (ad === 'yerel') {
        if (!yerel.ayakta) { sonHata = new Error('yerel LibreTranslate calismiyor'); continue; }
        res = await withTimeout(libre(clean, target, cfg.url || yerel.url, cfg.key), 25000);
      } else if (ad === 'deepl') res = await withTimeout(deepl(clean, target, cfg), 12000);
      else res = await withTimeout(google(clean, target), 12000);
      if (!gecerliMi(res.text, clean)) throw new Error(ad + ' hata metni dondurdu');
      const out = { text: res.text, src: res.src, motor: ad };
      putCache(k, out);
      return out;
    } catch (e) { sonHata = e; }
  }
  return { text: clean, src: null, motor: 'yok', hata: sonHata ? sonHata.message : 'bilinmiyor' };
}

module.exports = { translate, yerelKontrol, durum };
