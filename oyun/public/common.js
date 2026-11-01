'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const LETTERS = ['A', 'B', 'C', 'D'];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Bir şeyler ters gitti.');
  return data;
}

// Sunucu saatine göre kalan süre; telefonların saati kaymış olabilir.
let clockOffset = 0;
const serverNow = () => Date.now() + clockOffset;

function listen(params, onState) {
  const es = new EventSource('/events?' + new URLSearchParams(params));
  es.onmessage = (e) => {
    const s = JSON.parse(e.data);
    if (s.now) clockOffset = s.now - Date.now();
    onState(s);
  };
  es.onopen = () => document.body.classList.remove('offline');
  es.onerror = () => document.body.classList.add('offline');
  return es;
}

function toast(msg) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2800);
}

// Geri sayımlar: soru süresi ([data-countdown]) ve sıradaki soruya kalan süre ([data-next]).
// İkisi de --p değişkenini 1'den 0'a indirir.
function runCountdown(getState) {
  (function frame() {
    const s = getState();
    const el = $('[data-countdown]');
    if (el && s && s.phase === 'question') {
      const q = s.question;
      const left = Math.max(0, q.deadline - serverNow());
      el.style.setProperty('--p', (left / q.duration).toFixed(4));
      const num = $('[data-seconds]', el);
      if (num) num.textContent = Math.ceil(left / 1000);
      el.classList.toggle('urgent', left < 5000);
    }
    if (s && s.phase === 'reveal' && s.nextAt) {
      const left = Math.max(0, s.nextAt - serverNow());
      const bar = $('[data-next]');
      if (bar) bar.style.setProperty('--p', (left / s.revealMs).toFixed(4));
      const num = $('[data-next-seconds]');
      if (num) num.textContent = Math.ceil(left / 1000);
    }
    requestAnimationFrame(frame);
  })();
}

const fmt = (n) => n.toLocaleString('tr-TR');

// Oyuncu avatarları: https://www.dicebear.com (SVG, tohum aynıysa resim de aynı).
const AVATAR_STYLES = ['fun-emoji', 'adventurer', 'bottts', 'big-smile', 'pixel-art', 'thumbs'];
const avatarUrl = (a) => `https://api.dicebear.com/9.x/${a.style}/svg?radius=50&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf&seed=${encodeURIComponent(a.seed)}`;
const avatarImg = (a, cls = 'av') => (a ? `<img class="${cls}" src="${avatarUrl(a)}" alt="" loading="lazy" width="64" height="64">` : '');
