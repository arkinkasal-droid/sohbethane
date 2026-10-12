'use strict';

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { Server } = require('socket.io');
const cev = require('./translate');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(ROOT, 'uploads');
for (const d of [DATA, UPLOADS, path.join(DATA, 'rooms')]) fs.mkdirSync(d, { recursive: true });

/* ================= yapilandirma ================= */
const CFG_PATH = path.join(ROOT, 'config.json');
const DEFAULT_CFG = {
  port: 3000,
  appName: 'SohbetHane',
  ceviri: {
    kip: 'yerel',
    url: 'http://127.0.0.1:5000',
    key: '',
    otomatikBaslat: true,
    diller: 'tr,en,ar,de,fr,ru,es,it,fa,az,nl,pt,zh,ja,ko,uk,pl,el,he,hi,id,ro,sv,cs,hu,bg,vi,th,ms,sq,sr,da,fi,nb,sk,sl,lv,lt,et,ga,ca,eu,gl,tl,ur,bn,ta,te'
  },
  gizlilik: {
    // Dogrudan (P2P) baglanti hicbir yerde kurulmuyor; her sey bu sunucudan geciyor.
    gunlukTut: false
  },
  https: { enabled: false, cert: 'cert.pem', key: 'key.pem' },
  maxFileMB: 100
};
function derinBirlestir(a, b) {
  const o = Object.assign({}, a);
  for (const k in b) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) ? derinBirlestir(a[k] || {}, b[k]) : b[k];
  return o;
}
let CFG = DEFAULT_CFG;
if (fs.existsSync(CFG_PATH)) {
  try { CFG = derinBirlestir(DEFAULT_CFG, JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'))); }
  catch (e) { console.error('config.json okunamadi, varsayilanlar kullanildi.'); }
} else fs.writeFileSync(CFG_PATH, JSON.stringify(DEFAULT_CFG, null, 2));
const PORT = process.env.PORT || CFG.port || 3000;

/* ================= JSON depo ================= */
const jpath = n => path.join(DATA, n + '.json');
const mem = {}; const dirty = new Set();
function get(name, def) {
  if (!(name in mem)) { try { mem[name] = JSON.parse(fs.readFileSync(jpath(name), 'utf8')); } catch (e) { mem[name] = def; } }
  return mem[name];
}
const touch = n => dirty.add(n);
function flush() {
  for (const n of dirty) {
    try { const t = jpath(n) + '.tmp'; fs.writeFileSync(t, JSON.stringify(mem[n])); fs.renameSync(t, jpath(n)); }
    catch (e) { console.error('kaydetme hatasi', n, e.message); }
  }
  dirty.clear();
}
setInterval(flush, 1500);

const roomCache = new Map(); const roomDirty = new Set();
const rpath = id => path.join(DATA, 'rooms', id + '.json');
function msgs(id) {
  if (!roomCache.has(id)) { let a = []; try { a = JSON.parse(fs.readFileSync(rpath(id), 'utf8')); } catch (e) { a = []; } roomCache.set(id, a); }
  return roomCache.get(id);
}
const touchRoom = id => roomDirty.add(id);
function flushRooms() {
  for (const id of roomDirty) {
    try { const t = rpath(id) + '.tmp'; fs.writeFileSync(t, JSON.stringify(roomCache.get(id) || [])); fs.renameSync(t, rpath(id)); }
    catch (e) { console.error('oda kaydetme hatasi', id, e.message); }
  }
  roomDirty.clear();
}
setInterval(flushRooms, 1500);
function kapat() { flush(); flushRooms(); if (ltProc) try { ltProc.kill(); } catch (e) {} process.exit(0); }
process.on('SIGINT', kapat); process.on('SIGTERM', kapat);

const users = get('users', []);
const invites = get('invites', []);
const sessions = get('sessions', {});
const rooms = get('rooms', []);

/* ================= yardimcilar ================= */
const uid = () => crypto.randomBytes(9).toString('hex');
const now = () => Date.now();
const COLORS = ['#C8963E', '#5FB98F', '#7AA2D6', '#D07C8C', '#9C86D8', '#D9A05B', '#63B3C4', '#B99A6B'];

const pubUser = u => u ? {
  id: u.id, username: u.username, name: u.name, lang: u.lang, color: u.color,
  admin: !!u.admin, avatar: u.avatar || null, about: u.about || '', pub: u.pub || null,
  banli: !!u.banli, createdAt: u.createdAt || null, lastSeen: u.lastSeen || null
} : null;
const findUser = id => users.find(u => u.id === id);
const userByName = n => users.find(u => u.username.toLowerCase() === String(n).toLowerCase());
const dmId = (a, b) => 'dm_' + [a, b].sort().join('_');
function ensureDM(a, b) {
  const id = dmId(a, b);
  let r = rooms.find(x => x.id === id);
  if (!r) { r = { id, type: 'dm', name: '', members: [a, b], by: a, createdAt: now(), sure: 0 }; rooms.push(r); touch('rooms'); }
  return r;
}
const roomsOf = u => rooms.filter(r => r.members.includes(u));
const roomById = id => rooms.find(r => r.id === id);

/* ================= uygulama ================= */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);
app.use((req, res, next) => {
  // Disariya hicbir istek gitmesin: sayfa yalnizca kendi sunucusuna baglanabilir.
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
    "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "font-src 'self'; connect-src 'self' ws: wss: blob:; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Permissions-Policy', 'geolocation=(), interest-cohort=()');
  next();
});
app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/dosya', express.static(UPLOADS, { maxAge: '365d', setHeaders: r => r.setHeader('Content-Type', 'application/octet-stream') }));

function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '') || req.query.t;
  const u = sessions[t] && findUser(sessions[t]);
  if (!u) return res.status(401).json({ error: 'Oturum gecersiz. Yeniden giris yapin.' });
  req.user = u; req.token = t; next();
}

/* ---- kurulum / kimlik ---- */
app.get('/api/durum', (req, res) => res.json({
  kurulum: users.length === 0, appName: CFG.appName,
  ceviri: cev.durum()
}));

// Sifre sunucuya hicbir zaman gelmez: istemci sifreden iki ayri anahtar turetir.
// Bu uc nokta yalnizca tuz ve tur sayisini verir.
app.get('/api/tuz/:kul', (req, res) => {
  const u = userByName(req.params.kul);
  if (!u || !u.kdf) return res.json({ kdf: null });
  res.json({ kdf: u.kdf });
});

app.post('/api/kayit', (req, res) => {
  const { username, auth: authKey, name, lang, invite, kdf, pub, sarmal } = req.body || {};
  if (!username || !authKey) return res.status(400).json({ error: 'Kullanici adi ve sifre gerekli.' });
  if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username)) return res.status(400).json({ error: 'Kullanici adi 3-20 karakter olmali; harf, rakam, nokta ve alt cizgi.' });
  if (userByName(username)) return res.status(400).json({ error: 'Bu kullanici adi alinmis.' });
  if (!pub || !sarmal || !kdf) return res.status(400).json({ error: 'Sifreleme anahtarlari eksik geldi. Sayfayi yenileyip tekrar deneyin.' });

  const first = users.length === 0;
  let inv = null;
  if (!first) {
    inv = invites.find(i => i.code === String(invite || '').trim().toUpperCase());
    if (!inv) return res.status(400).json({ error: 'Davet kodu gecersiz.' });
    if (inv.expires && inv.expires < now()) return res.status(400).json({ error: 'Davet kodunun suresi dolmus.' });
    if (inv.used >= inv.max) return res.status(400).json({ error: 'Davet kodu kullanim hakki dolmus.' });
  }
  const u = {
    id: uid(), username, pass: bcrypt.hashSync(String(authKey), 10),
    kdf, pub, sarmal,
    name: (name || username).slice(0, 40), lang: (lang || 'tr').slice(0, 5),
    color: COLORS[users.length % COLORS.length], admin: first, avatar: null, about: '',
    engelli: [], createdAt: now()
  };
  users.push(u); touch('users');
  if (inv) { inv.used++; touch('invites'); }
  for (const o of users) if (o.id !== u.id) ensureDM(u.id, o.id);
  const token = crypto.randomBytes(24).toString('hex');
  sessions[token] = u.id; touch('sessions');
  io.emit('kullanici:yeni', pubUser(u));
  res.json({ token, user: pubUser(u), sarmal: u.sarmal });
});

app.post('/api/giris', (req, res) => {
  const { username, auth: authKey } = req.body || {};
  const u = userByName(username || '');
  if (!u || !bcrypt.compareSync(String(authKey || ''), u.pass))
    return res.status(400).json({ error: 'Kullanici adi veya sifre hatali.' });
  if (u.banli) return res.status(403).json({ error: 'Bu hesap yonetici tarafindan askiya alinmistir.' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions[token] = u.id; touch('sessions');
  for (const o of users) if (o.id !== u.id) ensureDM(u.id, o.id);
  res.json({ token, user: pubUser(u), sarmal: u.sarmal || null, anahtarYok: !u.pub });
});

// Eski (v1) hesaplari sifrelemeye tasima veya sifre degistirme
app.post('/api/anahtar-kur', auth, (req, res) => {
  const { kdf, pub, sarmal, auth: authKey } = req.body || {};
  if (!kdf || !pub || !sarmal || !authKey) return res.status(400).json({ error: 'Anahtar bilgileri eksik.' });
  req.user.kdf = kdf; req.user.pub = pub; req.user.sarmal = sarmal;
  req.user.pass = bcrypt.hashSync(String(authKey), 10);
  touch('users');
  io.emit('kullanici:guncel', pubUser(req.user));
  res.json({ user: pubUser(req.user) });
});

app.post('/api/cikis', auth, (req, res) => { delete sessions[req.token]; touch('sessions'); res.json({ ok: true }); });
app.get('/api/ben', auth, (req, res) => res.json({ user: pubUser(req.user), sarmal: req.user.sarmal || null }));

app.post('/api/profil', auth, (req, res) => {
  const { name, lang, about, avatar } = req.body || {};
  if (name) req.user.name = String(name).slice(0, 40);
  if (lang) req.user.lang = String(lang).slice(0, 5);
  if (about !== undefined) req.user.about = String(about).slice(0, 140);
  if (avatar !== undefined) req.user.avatar = avatar || null;
  touch('users');
  io.emit('kullanici:guncel', pubUser(req.user));
  res.json({ user: pubUser(req.user) });
});

/* ---- engelleme ---- */
/** a kullanicisi b'yi engellemis mi? */
function engelliMi(aId, bId) {
  const a = findUser(aId);
  return !!(a && Array.isArray(a.engelli) && a.engelli.includes(bId));
}
/** Bir kullanicinin acik tum soketlerini zorla kes. */
function soketleriKes(userId) {
  try { io.in('u:' + userId).disconnectSockets(true); } catch (e) {}
}
/** a kullanicisi b'yi sessize almis mi? */
function sessizMi(aId, bId) {
  const a = findUser(aId);
  return !!(a && Array.isArray(a.sessiz) && a.sessiz.includes(bId));
}

app.get('/api/engellenenler', auth, (req, res) => res.json({ engelli: req.user.engelli || [] }));

app.post('/api/engelle/:id', auth, (req, res) => {
  const hedef = findUser(req.params.id);
  if (!hedef) return res.status(404).json({ error: 'Kullanici bulunamadi.' });
  if (hedef.id === req.user.id) return res.status(400).json({ error: 'Kendinizi engelleyemezsiniz.' });
  req.user.engelli = req.user.engelli || [];
  const i = req.user.engelli.indexOf(hedef.id);
  const engelle = req.body.engel !== false;
  if (engelle && i < 0) {
    req.user.engelli.push(hedef.id);
    // Engelleme: her iki taraf birbirini cevrimdisi gorur
    io.to('u:' + hedef.id).emit('durum', { id: req.user.id, cevrimici: false });
    io.to('u:' + req.user.id).emit('durum', { id: hedef.id, cevrimici: false });
  }
  if (!engelle && i >= 0) {
    req.user.engelli.splice(i, 1);
    // Engel kaldirildi: gercek durumu gonder
    const engelleyenOnline = online.has(req.user.id);
    const hedefOnline = online.has(hedef.id);
    if (engelleyenOnline && !engelliMi(hedef.id, req.user.id))
      io.to('u:' + hedef.id).emit('durum', { id: req.user.id, cevrimici: true });
    if (hedefOnline)
      io.to('u:' + req.user.id).emit('durum', { id: hedef.id, cevrimici: true });
  }
  touch('users');
  io.to('u:' + req.user.id).emit('engel:guncel', { engelli: req.user.engelli });
  res.json({ engelli: req.user.engelli });
});

/* ---- davet / yonetim ---- */
const yonetici = (req, res, next) => req.user.admin ? next()
  : res.status(403).json({ error: 'Bu islem icin yonetici olmaniz gerekiyor.' });

app.get('/api/davetler', auth, yonetici, (req, res) => res.json({ invites }));
// Herkes davet kodu uretebilir; yonetici sinirlamalari kontrol edebilir
app.post('/api/davet', auth, (req, res) => {
  const inv = {
    code: crypto.randomBytes(4).toString('hex').toUpperCase(), by: req.user.id,
    max: Math.max(1, parseInt(req.body.max || 1, 10)), used: 0,
    expires: req.body.gun ? now() + parseInt(req.body.gun, 10) * 864e5 : 0, createdAt: now()
  };
  invites.push(inv); touch('invites'); res.json({ invite: inv });
});
app.delete('/api/davet/:code', auth, yonetici, (req, res) => {
  const i = invites.findIndex(x => x.code === req.params.code);
  if (i >= 0) { invites.splice(i, 1); touch('invites'); }
  res.json({ ok: true });
});
app.post('/api/kullanici/:id/yetki', auth, yonetici, (req, res) => {
  const u = findUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'Kullanici bulunamadi.' });
  u.admin = !!req.body.admin; touch('users');
  io.emit('kullanici:guncel', pubUser(u)); res.json({ user: pubUser(u) });
});
app.delete('/api/kullanici/:id', auth, yonetici, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Kendinizi silemezsiniz.' });
  const i = users.findIndex(u => u.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Kullanici bulunamadi.' });
  const [u] = users.splice(i, 1); touch('users');
  for (const t in sessions) if (sessions[t] === u.id) delete sessions[t];
  touch('sessions');
  // Oturum kaydini silmek yetmiyordu: soket kimligini baglanti aninda aldigi icin
  // canli kaliyor ve mesaj gondermeye devam ediyordu. Zorla kesiyoruz.
  soketleriKes(u.id);
  for (const r of rooms) {
    if (!r.members.includes(u.id)) continue;
    r.members = r.members.filter(x => x !== u.id);
    for (const id of r.members) io.to('u:' + id).emit('oda:guncel', r);
  }
  touch('rooms');
  io.emit('kullanici:silindi', { id: u.id }); res.json({ ok: true });
});

// Kullaniciyi askiya al / geri al (admin)
app.post('/api/kullanici/:id/ban', auth, yonetici, (req, res) => {
  const u = findUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'Kullanici bulunamadi.' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'Kendinizi askiya alamazsiniz.' });
  u.banli = req.body.ban !== false;
  touch('users');
  if (u.banli) {
    // Tum oturumlarini sil ve baglantisini kes
    for (const t in sessions) if (sessions[t] === u.id) delete sessions[t];
    touch('sessions');
    soketleriKes(u.id);
  }
  io.emit('kullanici:guncel', pubUser(u));
  res.json({ user: pubUser(u) });
});

/* ---- sessizlik ---- */
app.get('/api/sessizbilgi', auth, (req, res) => res.json({ sessiz: req.user.sessiz || [] }));

app.post('/api/sessiz/:id', auth, (req, res) => {
  const hedef = findUser(req.params.id);
  if (!hedef) return res.status(404).json({ error: 'Kullanici bulunamadi.' });
  if (hedef.id === req.user.id) return res.status(400).json({ error: 'Kendinizi sessize alamazsiniz.' });
  req.user.sessiz = req.user.sessiz || [];
  const i = req.user.sessiz.indexOf(hedef.id);
  const sustur = req.body.sessiz !== false;
  if (sustur && i < 0) req.user.sessiz.push(hedef.id);
  if (!sustur && i >= 0) req.user.sessiz.splice(i, 1);
  touch('users');
  io.to('u:' + req.user.id).emit('sessiz:guncel', { sessiz: req.user.sessiz });
  res.json({ sessiz: req.user.sessiz });
});

// Bekleyen (onay bekleyen) mesajlari listele
app.get('/api/bekliyor/:id', auth, (req, res) => {
  const r = roomById(req.params.id);
  if (!r || !r.members.includes(req.user.id)) return res.status(404).json({ error: 'Sohbet bulunamadi.' });
  const list = msgs(r.id).filter(m => m.bekliyor && m.from !== req.user.id && !m.deleted);
  res.json({ messages: list });
});

// Bekleyen mesaji onayla veya reddet
app.post('/api/onay/:odaId/:msgId', auth, (req, res) => {
  const r = roomById(req.params.odaId);
  if (!r || !r.members.includes(req.user.id)) return res.status(404).json({ error: 'Sohbet bulunamadi.' });
  const m = msgs(r.id).find(x => x.id === req.params.msgId && x.bekliyor);
  if (!m) return res.status(404).json({ error: 'Mesaj bulunamadi.' });
  const kabul = req.body.kabul !== false;
  if (kabul) {
    m.bekliyor = false;
    touchRoom(r.id);
    // Mesaji gonderen ve alan her ikisine de ilet
    for (const id of r.members) io.to('u:' + id).emit('mesaj', m);
    // Okundu bildirimi gonderene ilet (sessiz oldugu icin bekletilmistir)
    io.to('u:' + m.from).emit('okundu', { room: r.id, user: req.user.id, onaylandi: true });
  } else {
    m.deleted = true; m.bekliyor = false; m.enc = null; m.dosya = null;
    touchRoom(r.id);
    // Sadece gonderende gozuksun ama silinik olarak
    io.to('u:' + m.from).emit('silindi', { room: r.id, id: m.id, reddedildi: true });
  }
  res.json({ ok: true });
});

/* ---- kisiler / odalar ---- */
app.get('/api/kisiler', auth, (req, res) => res.json({ users: users.map(pubUser) }));

app.get('/api/odalar', auth, (req, res) => {
  res.json({
    rooms: roomsOf(req.user.id).map(r => {
      const m = msgs(r.id);
      const last = [...m].reverse().find(x => !x.deleted) || null;
      const unread = m.filter(x => x.from !== req.user.id && !(x.readBy || []).includes(req.user.id) && !x.deleted).length;
      return Object.assign({}, r, { unread, lastTs: last ? last.ts : 0, lastId: last ? last.id : null });
    })
  });
});
app.post('/api/oda', auth, (req, res) => {
  const { name, members } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Gruba bir isim verin.' });
  const arsiv = !!req.body.arsiv;
  const wall = !arsiv && req.body.tip === 'wall';
  const ms = arsiv ? [req.user.id]
    : Array.from(new Set([req.user.id, ...(members || [])])).filter(findUser);
  const r = {
    id: 'gr_' + uid(), type: wall ? 'wall' : 'group', arsiv, name: String(name).slice(0, 60),
    members: ms, by: req.user.id, createdAt: now(), sure: 0
  };
  rooms.push(r); touch('rooms');
  for (const id of ms) io.to('u:' + id).emit('oda:yeni', r);
  res.json({ room: r });
});

// Birebir sohbeti gruba donustur
app.post('/api/oda/:id/donustur', auth, (req, res) => {
  const dm = roomById(req.params.id);
  if (!dm || dm.type !== 'dm' || !dm.members.includes(req.user.id))
    return res.status(404).json({ error: 'Sohbet bulunamadi.' });
  const name = String(req.body.name || '').slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Grup adi gerekli.' });
  const ekstra = (req.body.members || []).filter(id => findUser(id) && !dm.members.includes(id));
  const ms = [...dm.members, ...ekstra];
  const r = {
    id: 'gr_' + uid(), type: 'group', arsiv: false, name,
    members: ms, by: req.user.id, createdAt: now(), sure: 0,
    kaynakDm: dm.id
  };
  rooms.push(r); touch('rooms');
  for (const id of ms) io.to('u:' + id).emit('oda:yeni', r);
  res.json({ room: r });
});
app.post('/api/oda/:id/uyeler', auth, (req, res) => {
  const r = roomById(req.params.id);
  if (!r || r.type !== 'group' || !r.members.includes(req.user.id)) return res.status(404).json({ error: 'Grup bulunamadi.' });
  const add = (req.body.ekle || []).filter(id => findUser(id) && !r.members.includes(id));
  const rem = (req.body.cikar || []).filter(id => r.members.includes(id));
  r.members.push(...add);
  r.members = r.members.filter(id => !rem.includes(id));
  if (req.body.isim) r.name = String(req.body.isim).slice(0, 60);
  touch('rooms');
  for (const id of [...r.members, ...rem]) io.to('u:' + id).emit('oda:guncel', r);
  res.json({ room: r });
});
app.post('/api/oda/:id/ayril', auth, (req, res) => {
  const r = roomById(req.params.id);
  if (!r || r.type !== 'group') return res.status(404).json({ error: 'Grup bulunamadi.' });
  r.members = r.members.filter(id => id !== req.user.id); touch('rooms');
  io.to('u:' + req.user.id).emit('oda:cikildi', { id: r.id });
  for (const id of r.members) io.to('u:' + id).emit('oda:guncel', r);
  res.json({ ok: true });
});
// Sureli mesaj ayari
app.post('/api/oda/:id/sure', auth, (req, res) => {
  const r = roomById(req.params.id);
  if (!r || !r.members.includes(req.user.id)) return res.status(404).json({ error: 'Sohbet bulunamadi.' });
  r.sure = Math.max(0, parseInt(req.body.sure || 0, 10)); touch('rooms');
  for (const id of r.members) io.to('u:' + id).emit('oda:guncel', r);
  res.json({ room: r });
});

/* ---- gecmis ---- */
app.get('/api/gecmis/:id', auth, (req, res) => {
  const r = roomById(req.params.id);
  if (!r || !r.members.includes(req.user.id)) return res.status(404).json({ error: 'Sohbet bulunamadi.' });
  const all = msgs(r.id);
  const limit = Math.min(parseInt(req.query.limit || 60, 10), 500);
  const before = req.query.before ? parseInt(req.query.before, 10) : null;
  const list = (before ? all.filter(m => m.ts < before) : all).slice(-limit);
  res.json({ messages: list, hasMore: all.length > list.length });
});

/* ---- ceviri (istemci cozdukten sonra cagirir) ---- */
app.post('/api/cevir', auth, async (req, res) => {
  const metin = String(req.body.metin || '').slice(0, 6000);
  const hedef = String(req.body.hedef || req.user.lang || 'tr').slice(0, 5);
  if (!metin.trim()) return res.json({ metin, kaynak: null, motor: 'yok' });
  const r = await cev.translate(metin, hedef, CFG.ceviri);
  res.json({ metin: r.text, kaynak: r.src, motor: r.motor, hata: r.hata || null });
});
app.get('/api/ceviri-durum', auth, async (req, res) => {
  await cev.yerelKontrol(CFG.ceviri.url);
  res.json({ durum: cev.durum(), kip: CFG.ceviri.kip });
});

/* ---- dosya (icerik istemcide sifrelenmis olarak gelir) ---- */
const storage = multer.diskStorage({
  destination: (q, f, cb) => cb(null, UPLOADS),
  filename: (q, f, cb) => cb(null, uid() + '.bin')
});
const upload = multer({ storage, limits: { fileSize: (CFG.maxFileMB || 100) * 1024 * 1024 } });
app.post('/api/yukle', auth, upload.single('dosya'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya alinamadi.' });
  res.json({ url: '/dosya/' + req.file.filename, size: req.file.size });
});

/* ================= sunucu ================= */
let server;
if (CFG.https && CFG.https.enabled) {
  try {
    server = https.createServer({
      cert: fs.readFileSync(path.join(ROOT, CFG.https.cert)),
      key: fs.readFileSync(path.join(ROOT, CFG.https.key))
    }, app);
  } catch (e) { console.error('HTTPS sertifikasi okunamadi, HTTP ile devam ediliyor:', e.message); server = http.createServer(app); }
} else server = http.createServer(app);

const io = new Server(server, { maxHttpBufferSize: 2e7 });

/* ================= sureli mesaj supurgesi ================= */
function supur() {
  const t = now();
  for (const r of rooms) {
    const list = roomCache.has(r.id) ? roomCache.get(r.id) : null;
    if (!list) continue;
    let d = false;
    for (const m of list) {
      if (m.deleted || !m.expiresAt) continue;
      if (m.expiresAt <= t) {
        m.deleted = true; m.enc = null; m.dosya = null; m.trc = null; m.suresiDoldu = true;
        d = true;
        for (const id of r.members) io.to('u:' + id).emit('silindi', { room: r.id, id: m.id, sure: true });
      }
    }
    if (d) touchRoom(r.id);
  }
}
setInterval(supur, 5000);

/* ================= socket ================= */
const online = new Map();
io.use((s, next) => {
  const t = s.handshake.auth && s.handshake.auth.token;
  const u = sessions[t] && findUser(sessions[t]);
  if (!u) return next(new Error('yetkisiz'));
  s.userId = u.id; next();
});

io.on('connection', socket => {
  const me = findUser(socket.userId);
  if (!me) return socket.disconnect(true);
  socket.join('u:' + me.id);
  online.set(me.id, (online.get(me.id) || 0) + 1);
  for (const u of users) if (!engelliMi(u.id, me.id)) io.to('u:' + u.id).emit('durum', { id: me.id, cevrimici: true });
  socket.emit('cevrimici:liste', [...online.keys()].filter(id => !engelliMi(me.id, id)));
  socket.emit('engel:guncel', { engelli: me.engelli || [] });
  socket.emit('sessiz:guncel', { sessiz: me.sessiz || [] });

  socket.on('mesaj', (d, ack) => {
    try {
      const oda = roomById(d && d.room);
      if (!oda || !oda.members.includes(me.id)) return ack && ack({ error: 'Sohbet bulunamadi.' });
      if (!d.enc || !d.enc.ct || !d.enc.keys) return ack && ack({ error: 'Sifreli paket eksik.' });
      const m = {
        id: uid(), room: oda.id, from: me.id, ts: now(),
        enc: d.enc,                       // {eph, iv, ct, keys:{uid:{iv,ct}}}
        dosya: d.dosya || null,           // {url, size} - icerik sifreli
        replyTo: d.replyTo || null,
        ttl: Math.max(0, parseInt(d.ttl || oda.sure || 0, 10)),
        tekGoruntuleme: !!d.tekGoruntuleme,
        expiresAt: 0, edited: 0, deleted: false, reactions: {}, readBy: [me.id], trc: {}
      };
      // Karsi taraf beni engellediyse ozel sohbette mesaj hic gonderilmesin
      if (oda.type === 'dm') {
        const oteki = oda.members.find(x => x !== me.id);
        if (oteki && engelliMi(me.id, oteki)) return ack && ack({ error: 'Bu kisiyi engellediniz. Mesaj gondermek icin engeli kaldirin.' });
        if (oteki && engelliMi(oteki, me.id)) return ack && ack({ error: 'Mesaj iletilemedi.' });
        // Sessizlik: alici gondereni sessize almissa mesaj onay beklesin
        if (oteki && sessizMi(oteki, me.id)) {
          m.bekliyor = true;
          msgs(oda.id).push(m); touchRoom(oda.id);
          ack && ack({ ok: true, id: m.id, ts: m.ts, bekliyor: true });
          io.to('u:' + me.id).emit('mesaj', m);        // gonderene gorun (bekliyor isaretli)
          io.to('u:' + oteki).emit('bekliyor:var', { room: oda.id, count: msgs(oda.id).filter(x => x.bekliyor && !x.deleted).length });
          return;
        }
      }
      msgs(oda.id).push(m); touchRoom(oda.id);
      ack && ack({ ok: true, id: m.id, ts: m.ts });
      for (const id of oda.members) {
        if (id !== me.id && engelliMi(id, me.id)) continue; // beni engelleyene iletme
        io.to('u:' + id).emit('mesaj', m);
      }
    } catch (e) { ack && ack({ error: 'Mesaj gonderilemedi.' }); }
  });

  // Istemci cevirdikten sonra sifreli ceviri onbellegini geri gonderir
  socket.on('ceviri', d => {
    const oda = roomById(d && d.room);
    if (!oda || !oda.members.includes(me.id)) return;
    const m = msgs(oda.id).find(x => x.id === d.id);
    if (!m || m.deleted || !d.lang || !d.paket) return;
    m.trc = m.trc || {};
    if (!m.trc[d.lang]) { m.trc[d.lang] = d.paket; touchRoom(oda.id); }
  });

  socket.on('yaziyor', d => {
    const oda = roomById(d && d.room);
    if (!oda || !oda.members.includes(me.id)) return;
    for (const id of oda.members)
      if (id !== me.id && !engelliMi(id, me.id))
        io.to('u:' + id).emit('yaziyor', { room: oda.id, user: me.id, aktif: !!d.aktif });
  });

  socket.on('okundu', d => {
    const oda = roomById(d && d.room);
    if (!oda || !oda.members.includes(me.id)) return;
    let ch = false;
    const t = now();
    for (const m of msgs(oda.id)) {
      m.readBy = m.readBy || [];
      if (!m.readBy.includes(me.id)) {
        m.readBy.push(me.id); ch = true;
        // Sureli mesajin sayaci, alici mesaji gorunce baslar (Signal mantigi)
        if (m.from !== me.id && !m.expiresAt) {
          if (m.tekGoruntuleme) m.expiresAt = t + 15000;
          else if (m.ttl) m.expiresAt = t + m.ttl * 1000;
        }
      }
    }
    if (ch) { touchRoom(oda.id); for (const id of oda.members) io.to('u:' + id).emit('okundu', { room: oda.id, user: me.id }); }
  });

  socket.on('tepki', d => {
    const oda = roomById(d && d.room);
    if (!oda || !oda.members.includes(me.id)) return;
    const m = msgs(oda.id).find(x => x.id === d.id);
    if (!m) return;
    m.reactions = m.reactions || {};
    const e = String(d.emoji || '').slice(0, 8);
    const arr = m.reactions[e] || [];
    const i = arr.indexOf(me.id);
    if (i >= 0) arr.splice(i, 1); else arr.push(me.id);
    if (arr.length) m.reactions[e] = arr; else delete m.reactions[e];
    touchRoom(oda.id);
    for (const id of oda.members)
      if (!engelliMi(id, me.id)) io.to('u:' + id).emit('tepki', { room: oda.id, id: m.id, reactions: m.reactions });
  });

  socket.on('duzenle', d => {
    const oda = roomById(d && d.room);
    if (!oda || !oda.members.includes(me.id)) return;
    const m = msgs(oda.id).find(x => x.id === d.id);
    if (!m || m.from !== me.id || m.deleted || !d.enc) return;
    m.enc = d.enc; m.trc = {}; m.edited = now();
    touchRoom(oda.id);
    for (const id of oda.members) io.to('u:' + id).emit('guncelle', m);
  });

  socket.on('sil', d => {
    const oda = roomById(d && d.room);
    if (!oda || !oda.members.includes(me.id)) return;
    const m = msgs(oda.id).find(x => x.id === d.id);
    if (!m || (m.from !== me.id && !me.admin)) return;
    if (m.dosya && m.dosya.url) { try { fs.unlinkSync(path.join(UPLOADS, path.basename(m.dosya.url))); } catch (e) {} }
    m.deleted = true; m.enc = null; m.dosya = null; m.trc = null;
    touchRoom(oda.id);
    for (const id of oda.members) io.to('u:' + id).emit('silindi', { room: oda.id, id: m.id });
  });

  socket.on('disconnect', () => {
    const n = (online.get(me.id) || 1) - 1;
    if (n <= 0) {
      online.delete(me.id);
      me.lastSeen = now(); touch('users');
      for (const u of users) if (!engelliMi(u.id, me.id)) io.to('u:' + u.id).emit('durum', { id: me.id, cevrimici: false, lastSeen: me.lastSeen });
    }
    else online.set(me.id, n);
  });
});

/* ================= LibreTranslate otomatik baslatma ================= */
let ltProc = null;
function libreBaslat() {
  if (!CFG.ceviri.otomatikBaslat) return;
  const { spawn } = require('child_process');
  const komut = process.platform === 'win32' ? 'libretranslate.exe' : 'libretranslate';
  const args = ['--host', '127.0.0.1', '--port', '5000', '--load-only', CFG.ceviri.diller, '--update-models'];
  try {
    ltProc = spawn(komut, args, { stdio: 'ignore', detached: false });
    ltProc.on('error', () => { ltProc = null; });
  } catch (e) { ltProc = null; }
}

/* ================= baslat ================= */
function ips() {
  const out = [];
  const n = os.networkInterfaces();
  for (const k in n) for (const x of n[k]) if (x.family === 'IPv4' && !x.internal) out.push(x.address);
  return out;
}
server.listen(PORT, '0.0.0.0', async () => {
  const p = (CFG.https && CFG.https.enabled) ? 'https' : 'http';
  console.log('\n  ' + CFG.appName + ' calisiyor  ·  uctan uca sifreli\n');
  console.log('  Bu bilgisayarda : ' + p + '://localhost:' + PORT);
  for (const ip of ips()) console.log('  Ayni agdakiler  : ' + p + '://' + ip + ':' + PORT);

  const ayakta = await cev.yerelKontrol(CFG.ceviri.url);
  if (ayakta) console.log('\n  Ceviri: yerel LibreTranslate calisiyor (' + cev.durum().diller.length + ' dil). Metin disari cikmiyor.');
  else {
    console.log('\n  Ceviri: yerel LibreTranslate bulunamadi.');
    if (CFG.ceviri.otomatikBaslat) {
      console.log('  Baslatiliyor... (ilk seferde dil modelleri iner, birkac dakika surebilir)');
      libreBaslat();
      const bekle = setInterval(async () => {
        if (await cev.yerelKontrol(CFG.ceviri.url)) {
          clearInterval(bekle);
          console.log('  Ceviri hazir: yerel LibreTranslate (' + cev.durum().diller.length + ' dil).');
        }
      }, 5000);
      setTimeout(() => clearInterval(bekle), 600000);
    }
    if (CFG.ceviri.kip === 'yerel') console.log('  Kurulum icin: LIBRETRANSLATE-KUR.bat');
  }
  console.log('\n  Gizlilik: dogrudan baglanti yok, tum trafik bu sunucudan geciyor.');
  console.log('  Adresinizi gizlemek icin TUNEL-BASLAT.bat ile Cloudflare tuneli acin.');
  console.log('');
});
