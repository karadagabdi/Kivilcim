'use strict';
// Kıvılcım: bağımlılıksız, odalı canlı quiz sunucusu.
// Quizler öğretmenin tarayıcısında durur; sunucu yalnızca açık odalardaki quizi bellekte tutar.
// Yerelde: npm start → http://localhost:3000/olustur
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUB = path.join(__dirname, 'public');
const TIMES = [5, 10, 20, 30, 60, 90, 120];
const LIMITS = { title: 80, question: 160, option: 80, questions: 100 };
const MAX_ROOMS = 500;
const MAX_PLAYERS = 300;
const ROOM_TTL = 3 * 60 * 60 * 1000; // 3 saat işlem olmayan oda silinir
const REVEAL_MS = 5000; // doğru cevap bu kadar gösterilir, sonra sıradaki soruya kendiliğinden geçilir
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const rooms = new Map();

// Oyuncu avatarları DiceBear ile çizilir; sunucu yalnızca stil adını ve tohumu saklar.
const AVATAR_STYLES = new Set(['fun-emoji', 'adventurer', 'bottts', 'big-smile', 'pixel-art', 'thumbs']);
function cleanAvatar(raw, fallbackSeed) {
  const style = raw && AVATAR_STYLES.has(raw.style) ? raw.style : 'fun-emoji';
  const seed = clean(raw && raw.seed, 40) || fallbackSeed;
  return { style, seed };
}

const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

// İstemciden gelen quizi asla doğrudan kullanma: biçimini ve sınırlarını burada denetle.
function validateQuiz(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Quiz bulunamadı.');
  if (!Array.isArray(raw.questions) || !raw.questions.length) throw new Error('Quizde en az bir soru olmalı.');
  if (raw.questions.length > LIMITS.questions) throw new Error(`Bir quizde en fazla ${LIMITS.questions} soru olabilir.`);
  const questions = raw.questions.map((q, n) => {
    const text = clean(q && q.text, LIMITS.question);
    const options = Array.isArray(q.options) ? q.options.map((o) => clean(o, LIMITS.option)) : [];
    if (!text) throw new Error(`${n + 1}. sorunun metni boş.`);
    if (options.length < 2 || options.length > 4 || options.some((o) => !o)) throw new Error(`${n + 1}. soruda 2–4 dolu şık olmalı.`);
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= options.length) {
      throw new Error(`${n + 1}. sorunun doğru cevabı seçilmemiş.`);
    }
    return { text, options, correct: q.correct, time: TIMES.includes(q.time) ? q.time : 20 };
  });
  return { title: clean(raw.title, LIMITS.title) || 'Adsız quiz', shuffle: raw.shuffle !== false, questions };
}

function createRoom(quiz) {
  let code;
  do code = String(crypto.randomInt(100000, 1000000)); while (rooms.has(code));
  const room = {
    code,
    hostKey: crypto.randomUUID(),
    invite: crypto.randomBytes(6).toString('base64url'), // paylaşılan davet linki; kodu içermez
    quiz,
    phase: 'lobby', index: -1, questions: [], startedAt: 0, deadline: 0, duration: 0, nextAt: 0, timer: null, counts: [],
    players: new Map(),
    clients: new Set(),
    lastActive: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// İstenirse şıklar her oyunda karışır; doğru cevabın yeri sabit kalmaz.
function prepareQuestions(quiz) {
  return quiz.questions.map((q) => {
    const order = q.options.map((_, i) => i);
    if (quiz.shuffle) shuffle(order);
    return { text: q.text, options: order.map((i) => q.options[i]), correct: order.indexOf(q.correct), time: q.time };
  });
}

const ranking = (room) => [...room.players.values()].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
const everyoneAnswered = (room) => room.players.size > 0 && [...room.players.values()].every((p) => p.answer !== null);

function startQuestion(room, i) {
  Object.assign(room, { phase: 'question', index: i, startedAt: Date.now(), duration: room.questions[i].time * 1000 });
  room.deadline = room.startedAt + room.duration;
  for (const p of room.players.values()) Object.assign(p, { answer: null, answerAt: 0, gain: 0, correct: false });
  clearTimeout(room.timer);
  room.timer = setTimeout(() => endQuestion(room), room.duration + 250);
  broadcast(room);
}

function endQuestion(room) {
  if (room.phase !== 'question') return;
  clearTimeout(room.timer);
  const q = room.questions[room.index];
  room.counts = q.options.map(() => 0);
  for (const p of room.players.values()) {
    if (p.answer !== null) room.counts[p.answer]++;
    p.correct = p.answer === q.correct;
    if (p.correct) {
      // Hızlı cevap daha çok puan: 500–1000, üst üste doğruya +50'şer (en fazla +150).
      const left = Math.max(0, 1 - (p.answerAt - room.startedAt) / room.duration);
      p.streak++;
      p.gain = Math.round(500 + 500 * left) + Math.min(p.streak - 1, 3) * 50;
      p.score += p.gain;
    } else {
      p.streak = 0;
      p.gain = 0;
    }
  }
  room.phase = 'reveal';
  room.nextAt = Date.now() + REVEAL_MS;
  room.timer = setTimeout(() => advance(room), REVEAL_MS);
  broadcast(room);
}

// Cevap gösterimi bitti: sıradaki soru ya da sonuçlar.
function advance(room) {
  if (room.phase !== 'reveal') return;
  clearTimeout(room.timer);
  room.nextAt = 0;
  if (room.index + 1 < room.questions.length) return startQuestion(room, room.index + 1);
  room.phase = 'final';
  broadcast(room);
}

function resetGame(room) {
  clearTimeout(room.timer);
  Object.assign(room, { phase: 'lobby', index: -1, questions: [], counts: [], nextAt: 0 });
  // Oyun bittikten sonra çıkanlar kürsüde kalır; yeni oyuna taşınmazlar.
  for (const p of room.players.values()) if (p.left) room.players.delete(p.id);
  for (const p of room.players.values()) Object.assign(p, { score: 0, streak: 0, gain: 0, correct: false, answer: null });
}

// Ekrandaki katılma adresi: localhost'tan açıldıysa yerel ağ IP'si, değilse sitenin kendi adresi.
function joinUrlFor(req) {
  const host = req.headers.host || `localhost:${PORT}`;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host)) {
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0];
    return `${proto}://${host}`;
  }
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|lo)/.test(name)) continue;
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return `http://${a.address}:${PORT}`;
  }
  return `http://${host}`;
}

function view(room, c) {
  const s = {
    phase: room.phase,
    now: Date.now(),
    code: room.code,
    title: room.quiz.title,
    total: room.quiz.questions.length,
    playerCount: room.players.size,
    answered: [...room.players.values()].filter((p) => p.answer !== null).length,
  };
  const q = room.questions[room.index];
  if (q && (room.phase === 'question' || room.phase === 'reveal')) {
    s.question = { text: q.text, options: q.options, number: room.index + 1, deadline: room.deadline, duration: room.duration };
    // Doğru cevap, süre bitmeden kimseye gönderilmez.
    if (room.phase === 'reveal') {
      Object.assign(s.question, { correct: q.correct, counts: room.counts });
      Object.assign(s, { nextAt: room.nextAt, revealMs: REVEAL_MS, last: room.index + 1 === room.questions.length });
    }
  }
  const rank = ranking(room);
  if (c.role === 'host') {
    // Yönetici, kimin hangi şıkkı seçtiğini anlık görür (doğru/yanlış bilgisi yalnızca süre bitince).
    const reveal = room.phase === 'reveal';
    s.joinUrl = c.joinUrl;
    s.invite = room.invite;
    s.players = rank.map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, score: p.score, answer: p.answer,
      gain: reveal ? p.gain : 0, correct: reveal ? p.correct : null,
    }));
    return s;
  }
  const me = room.players.get(c.id);
  if (!me) return { phase: 'gone' };
  s.me = {
    name: me.name, avatar: me.avatar, score: me.score, gain: me.gain, correct: me.correct,
    answer: me.answer, streak: me.streak, rank: rank.indexOf(me) + 1,
  };
  return s;
}

const write = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

function broadcast(room) {
  room.lastActive = Date.now();
  for (const c of room.clients) write(c.res, view(room, c));
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (now - room.lastActive > ROOM_TTL) {
      clearTimeout(room.timer);
      for (const c of room.clients) { write(c.res, { phase: 'gone' }); c.res.end(); }
      rooms.delete(room.code);
    } else {
      for (const c of room.clients) c.res.write(': ping\n\n');
    }
  }
}, 20000);

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 10000) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (ch) => {
      d += ch;
      if (d.length > limit) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const NO_ROOM = { error: 'Bu kodla açık bir oda yok. Kodu kontrol et.' };
const isHost = (room, key) => typeof key === 'string' && key === room.hostKey;
const byInvite = (slug) => [...rooms.values()].find((r) => r.invite === slug);

function removePlayer(room, id) {
  const p = room.players.get(id);
  if (!p) return;
  // Bitmiş oyunda sıralama ekranda kalsın diye oyuncu yalnızca işaretlenir.
  if (room.phase === 'final') p.left = true;
  else room.players.delete(id);
  if (room.phase === 'question' && everyoneAnswered(room)) endQuestion(room);
  else broadcast(room);
}

function openStream(req, res, url) {
  const room = rooms.get(url.searchParams.get('room'));
  const role = url.searchParams.get('role') === 'host' ? 'host' : 'player';
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Oda yoksa ya da anahtar yanlışsa istemci yeniden katılma/oda açma ekranına döner.
  if (!room || (role === 'host' && !isHost(room, url.searchParams.get('key')))) {
    write(res, { phase: 'gone' });
    return res.end();
  }
  const c = { res, role, id: url.searchParams.get('id'), joinUrl: role === 'host' ? joinUrlFor(req) : '' };
  room.clients.add(c);
  write(res, view(room, c));
  req.on('close', () => room.clients.delete(c));
}

async function newRoom(req, res) {
  if (rooms.size >= MAX_ROOMS) return send(res, 503, { error: 'Sunucu dolu, biraz sonra tekrar dene.' });
  const body = await readBody(req, 300000);
  let quiz;
  try { quiz = validateQuiz(body.quiz); } catch (e) { return send(res, 400, { error: e.message }); }
  const room = createRoom(quiz);
  send(res, 200, { code: room.code, key: room.hostKey });
}

async function join(req, res) {
  const body = await readBody(req);
  const room = rooms.get(String(body.room || '').trim());
  if (body.invite) {
    const invited = byInvite(String(body.invite));
    if (!invited) return send(res, 404, { error: 'Bu davet linkinin odası kapanmış.' });
    if (invited !== room) return send(res, 400, { error: 'Bu kod davet edildiğin odaya ait değil.' });
  }
  if (!room) return send(res, 404, NO_ROOM);
  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  if (name.length < 2) return send(res, 400, { error: 'İsim en az 2 harf olmalı.' });
  if (room.phase === 'final') return send(res, 409, { error: 'Bu oyun bitti. Yenisini bekle.' });
  if (room.players.size >= MAX_PLAYERS) return send(res, 409, { error: 'Oda dolu.' });
  const key = name.toLocaleLowerCase('tr');
  if ([...room.players.values()].some((p) => p.name.toLocaleLowerCase('tr') === key)) {
    return send(res, 409, { error: 'Bu isim alınmış, başka bir isim dene.' });
  }
  const id = crypto.randomUUID();
  room.players.set(id, { id, name, avatar: cleanAvatar(body.avatar, name), score: 0, streak: 0, gain: 0, correct: false, answer: null, answerAt: 0, joinedAt: Date.now() });
  send(res, 200, { id });
  broadcast(room);
}

async function answer(req, res) {
  const { room: code, id, index, choice } = await readBody(req);
  const room = rooms.get(code);
  if (!room) return send(res, 404, NO_ROOM);
  const p = room.players.get(id);
  if (!p) return send(res, 404, { error: 'Oyuncu bulunamadı.' });
  if (room.phase !== 'question' || index !== room.index || Date.now() > room.deadline) {
    return send(res, 409, { error: 'Süre doldu.' });
  }
  if (p.answer !== null) return send(res, 409, { error: 'Zaten cevap verdin.' });
  const q = room.questions[room.index];
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return send(res, 400, { error: 'Geçersiz şık.' });
  p.answer = choice;
  p.answerAt = Date.now();
  send(res, 200, { ok: true });
  if (everyoneAnswered(room)) endQuestion(room);
  else broadcast(room);
}

async function leave(req, res) {
  const { room: code, id } = await readBody(req);
  const room = rooms.get(code);
  if (room) removePlayer(room, id);
  send(res, 200, { ok: true });
}

async function hostAction(req, res, action) {
  const body = await readBody(req);
  const room = rooms.get(body.room);
  if (!room) return send(res, 404, NO_ROOM);
  if (!isHost(room, body.key)) return send(res, 403, { error: 'Bu odayı yönetme yetkin yok.' });
  if (action === 'start' && room.phase === 'lobby' && room.players.size) {
    resetGame(room);
    room.questions = prepareQuestions(room.quiz);
    startQuestion(room, 0);
  } else if (action === 'skip' && room.phase === 'question') {
    endQuestion(room);
  } else if (action === 'next' && room.phase === 'reveal') {
    advance(room);
  } else if (action === 'reset') {
    resetGame(room);
    broadcast(room);
  } else if (action === 'kick' && room.players.has(body.id)) {
    room.players.delete(body.id);
    if (room.phase === 'question' && everyoneAnswered(room)) endQuestion(room);
    else broadcast(room);
  } else {
    return send(res, 409, { error: 'Bu adım şu an yapılamaz.' });
  }
  send(res, 200, { ok: true });
}

const PAGES = { '/': 'play.html', '/ekran': 'host.html', '/olustur': 'olustur.html' };

function serveStatic(req, res, pathname) {
  const file = path.join(PUB, PAGES[pathname] || path.normalize(pathname));
  if (!file.startsWith(PUB + path.sep)) return send(res, 404, { error: 'Bulunamadı' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'Bulunamadı' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/events') return openStream(req, res, url);
    if (req.method === 'GET' && url.pathname === '/saglik') return send(res, 200, { ok: true, rooms: rooms.size });
    if (req.method === 'POST' && url.pathname === '/api/rooms') return await newRoom(req, res);
    if (req.method === 'POST' && url.pathname === '/api/join') return await join(req, res);
    if (req.method === 'POST' && url.pathname === '/api/leave') return await leave(req, res);
    if (req.method === 'GET' && url.pathname.startsWith('/api/invite/')) {
      const room = byInvite(url.pathname.slice('/api/invite/'.length));
      return room ? send(res, 200, { title: room.quiz.title }) : send(res, 404, { error: 'Bu davet linkinin odası kapanmış.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/answer') return await answer(req, res);
    if (req.method === 'POST' && url.pathname.startsWith('/api/host/')) {
      return await hostAction(req, res, url.pathname.slice('/api/host/'.length));
    }
    if (req.method === 'GET') return serveStatic(req, res, url.pathname);
    send(res, 405, { error: 'İzin verilmeyen istek' });
  } catch {
    if (!res.headersSent) send(res, 400, { error: 'Geçersiz istek' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Kıvılcım hazır.`);
  console.log(`  Quiz hazırla ve oyna: http://localhost:${PORT}/olustur`);
  console.log(`  Oyuncular:            http://localhost:${PORT}/\n`);
});
