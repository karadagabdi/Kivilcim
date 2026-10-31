'use strict';
// Quizler bu tarayıcının localStorage'ında durur; sunucuya yalnızca oyun açılırken gönderilir.

const LIB_KEY = 'kivilcim-quizler';
const TIMES = [5, 10, 20, 30, 60, 90, 120];
const LIMITS = { title: 80, question: 160, option: 80, questions: 100 };

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const blankQuestion = (time = 20) => ({ text: '', options: ['', '', '', ''], correct: null, time });
const newQuiz = (title = '') => ({ id: uid(), title, shuffle: true, questions: [blankQuestion()], updatedAt: Date.now() });

const Library = {
  all() {
    try { return JSON.parse(localStorage.getItem(LIB_KEY)) || []; } catch { return []; }
  },
  save(list) { localStorage.setItem(LIB_KEY, JSON.stringify(list)); },
  get(id) { return this.all().find((q) => q.id === id); },
  put(quiz) {
    const list = this.all();
    quiz.updatedAt = Date.now();
    const i = list.findIndex((q) => q.id === quiz.id);
    if (i < 0) list.unshift(quiz); else list[i] = quiz;
    this.save(list);
  },
  remove(id) { this.save(this.all().filter((q) => q.id !== id)); },
};

// Boş bırakılan 3. ve 4. şıkları at; doğru cevabın sırasını buna göre kaydır.
function toPayload(quiz) {
  return {
    title: quiz.title,
    shuffle: quiz.shuffle !== false,
    questions: quiz.questions.map((q) => {
      const kept = q.options.map((text, i) => ({ text: text.trim(), i })).filter((o) => o.text);
      return { text: q.text.trim(), options: kept.map((o) => o.text), correct: kept.findIndex((o) => o.i === q.correct), time: q.time };
    }),
  };
}

// Oynatmadan önce düzeltilmesi gerekenler; boş liste = hazır.
function problems(quiz) {
  const out = [];
  if (!quiz.questions.length) out.push('Quizde hiç soru yok.');
  if (quiz.questions.length > LIMITS.questions) out.push(`En fazla ${LIMITS.questions} soru olabilir.`);
  quiz.questions.forEach((q, n) => {
    const filled = q.options.filter((o) => o.trim()).length;
    if (!q.text.trim()) out.push(`${n + 1}. sorunun metni boş.`);
    if (filled < 2) out.push(`${n + 1}. soruda en az 2 şık olmalı.`);
    if (q.correct === null || !q.options[q.correct] || !q.options[q.correct].trim()) out.push(`${n + 1}. sorunun doğru cevabı seçilmedi.`);
  });
  return out;
}

// ---------- İçe aktarma ----------

const LETTER = (s) => 'ABCD'.indexOf(String(s).trim().toUpperCase());

function normalizeQuestion(text, options, correct, time) {
  const opts = options.map((o) => String(o ?? '').trim().slice(0, LIMITS.option)).slice(0, 4);
  while (opts.length < 4) opts.push('');
  return {
    text: String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, LIMITS.question),
    options: opts,
    correct: Number.isInteger(correct) && correct >= 0 && correct < 4 ? correct : null,
    time: TIMES.includes(Number(time)) ? Number(time) : 20,
  };
}

/* Düz metin:
   1. Soru metni (birden fazla satıra bölünebilir)
   A) şık   B) şık ...      doğru şıkkı * ile işaretle ya da altına "Cevap: B" yaz */
function parseText(txt) {
  const qs = [];
  let cur = null;
  const start = (text) => { cur = { text, options: [], correct: null, done: false }; qs.push(cur); };
  for (const raw of txt.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    // Şıklardan sonra gelen boş satır ya da "Cevap:" satırı soruyu kapatır.
    if (!line) { if (cur && cur.options.length) cur.done = true; continue; }
    let m;
    if (cur && (m = line.match(/^(?:cevap|doğru cevap|doğru|dogru|answer)\s*[:：-]?\s*([A-Da-d])\b/i))) {
      cur.correct = LETTER(m[1]);
      cur.done = true;
    } else if (cur && !cur.done && cur.options.length < 4 && (m = line.match(/^(\*)?\s*([A-Da-d])\s*[)\.:-]\s*(.*?)\s*(\*)?$/))
      && LETTER(m[2]) === cur.options.length && m[3]) {
      if (m[1] || m[4]) cur.correct = cur.options.length;
      cur.options.push(m[3]);
    } else if ((m = line.match(/^\d+\s*[.)-]\s*(.+)$/))) {
      start(m[1]);
    } else if (!cur || cur.done || cur.options.length === 4) {
      start(line);
    } else if (!cur.options.length) {
      cur.text += ' ' + line; // satıra bölünmüş soru
    } else {
      cur.options[cur.options.length - 1] += ' ' + line; // satıra bölünmüş şık
    }
  }
  return qs.filter((q) => q.text).map((q) => normalizeQuestion(q.text, q.options, q.correct));
}

function parseCSVRows(text) {
  const first = text.split('\n')[0];
  const d = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/* CSV (Excel → "CSV olarak kaydet"):  soru ; A ; B ; C ; D ; doğru (A–D ya da 1–4) ; süre */
function parseCSV(text) {
  const out = [];
  for (const r of parseCSVRows(text.replace(/^﻿/, ''))) {
    if (!r[0] || !r[0].trim()) continue;
    const key = (r[5] || '').trim();
    const correct = /^[1-4]$/.test(key) ? Number(key) - 1 : LETTER(key);
    if (correct < 0 && !out.length) continue; // başlık satırı
    out.push(normalizeQuestion(r[0], r.slice(1, 5), correct, r[6]));
  }
  return out;
}

// Kendi dışa aktardığımız biçim ya da { baslik, sure, sorular:[{ soru, siklar, dogru(1-4) }] }
function parseJSON(text) {
  const d = JSON.parse(text);
  if (Array.isArray(d.questions)) {
    return { title: d.title, shuffle: d.shuffle, questions: d.questions.map((q) => normalizeQuestion(q.text, q.options, q.correct, q.time)) };
  }
  if (Array.isArray(d.sorular)) {
    return { title: d.baslik, questions: d.sorular.map((q) => normalizeQuestion(q.soru, q.siklar, q.dogru - 1, d.sure)) };
  }
  throw new Error('Bu JSON bir quiz dosyasına benzemiyor.');
}

function importFile(name, text) {
  const base = name.replace(/\.[^.]+$/, '').slice(0, LIMITS.title);
  let data;
  if (/\.json$/i.test(name)) data = parseJSON(text);
  else if (/\.(csv|tsv)$/i.test(name)) data = { questions: parseCSV(text) };
  else data = { questions: parseText(text) };
  if (!data.questions.length) throw new Error('Dosyada soru bulunamadı. Biçimi kontrol et.');
  return { ...newQuiz(data.title || base), shuffle: data.shuffle !== false, questions: data.questions.slice(0, LIMITS.questions) };
}

const SAMPLE = {
  title: 'Örnek: Genel kültür',
  questions: [
    normalizeQuestion('Dünyanın en büyük okyanusu hangisidir?', ['Atlas Okyanusu', 'Hint Okyanusu', 'Büyük Okyanus (Pasifik)', 'Arktik Okyanusu'], 2),
    normalizeQuestion('Bir yılda kaç ay vardır?', ['10', '11', '12', '13'], 2, 10),
    normalizeQuestion('Deniz seviyesinde su kaç °C\'de kaynar?', ['90', '100', '110', '120'], 1),
    normalizeQuestion('Işık sesten daha hızlıdır.', ['Doğru', 'Yanlış'], 0, 10),
  ],
};
