'use strict';

const STORE = 'kivilcim-oyuncu';
const AVATAR_STORE = 'kivilcim-avatar';
const screen = $('#screen');
let state = null;
let renderedKey = '';
let stream = null;
let session = null; // { room, id, invite? }

const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
};
const dots = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';

const params = new URLSearchParams(location.search);
const roomFromUrl = () => (params.get('oda') || '').replace(/\D/g, '').slice(0, 6);
// Davet linki (?davet=…) odayı gösterir ama kodu içermez; kod yine elle girilir.
let invite = (params.get('davet') || '').replace(/[^\w-]/g, '').slice(0, 20);

async function showInvite() {
  screen.className = 'screen middle';
  screen.innerHTML = dots;
  try {
    const { title } = await fetch('/api/invite/' + invite).then((r) => (r.ok ? r.json() : Promise.reject()));
    showJoin('', '', title);
  } catch {
    invite = '';
    history.replaceState(null, '', '/');
    showJoin('Bu davet linkinin odası kapanmış. Oda kodunu biliyorsan aşağıya yazabilirsin.', '');
  }
}

function showJoin(message = '', room = roomFromUrl(), inviteTitle = '') {
  state = null;
  renderedKey = 'join';
  $('#meta').textContent = '';
  $('#leave').hidden = true;
  screen.className = 'screen middle';
  screen.innerHTML = `
    <p class="eyebrow">${inviteTitle ? 'Davet edildin' : 'Canlı bilgi yarışması'}</p>
    <h1>${inviteTitle ? `“${esc(inviteTitle)}” oyununa katıl.` : 'Oda kodunu gir, oyuna katıl.'}</h1>
    ${inviteTitle ? '<p class="lead">Öğretmeninin ekranındaki 6 haneli oda kodunu ve adını yaz.</p>' : ''}
    <form id="join" class="field" novalidate>
      <label for="room">Oda kodu</label>
      <input id="room" name="room" class="code-input" inputmode="numeric" pattern="[0-9 ]*" maxlength="7" autocomplete="off" placeholder="123 456" value="${esc(room)}" required>
      <label for="name">Ekranda görünecek adın</label>
      <input id="name" name="name" maxlength="20" autocomplete="nickname" autocapitalize="words" enterkeyhint="go" required>
      <span class="label">Avatarın</span>
      <div class="avatar-pick">
        <img class="av-preview" id="av-preview" alt="Seçili avatar" width="88" height="88">
        <button type="button" class="btn ghost" id="av-shuffle">Değiştir</button>
      </div>
      <div class="av-styles" id="av-styles" role="radiogroup" aria-label="Avatar stili"></div>
      <p class="error" id="err">${esc(message)}</p>
      <button class="btn primary" type="submit">Katıl</button>
    </form>`;
  const form = $('#join');
  (room.length === 6 ? form.name : form.room).focus();

  // Tohum, "Değiştir"e basılana kadar yazılan isimden gelir; böylece avatar isimle birlikte anlık değişir.
  let pref;
  try { pref = JSON.parse(localStorage.getItem(AVATAR_STORE)) || {}; } catch { pref = {}; }
  const avatar = { style: AVATAR_STYLES.includes(pref.style) ? pref.style : AVATAR_STYLES[0], seed: pref.seed || '' };
  const current = () => ({ style: avatar.style, seed: avatar.seed || form.name.value.trim() || 'kivilcim' });
  const drawAvatar = () => {
    if (!form.isConnected) return; // katıldıktan sonra gecikmeli çizim gelirse
    const a = current();
    $('#av-preview').src = avatarUrl(a);
    $('#av-styles').innerHTML = AVATAR_STYLES.map((style) => `
      <button type="button" role="radio" aria-checked="${style === a.style}" aria-label="${style}" data-style="${style}">
        <img src="${avatarUrl({ style, seed: a.seed })}" alt="" width="40" height="40"></button>`).join('');
  };
  let typing;
  form.name.addEventListener('input', () => { clearTimeout(typing); if (!avatar.seed) typing = setTimeout(drawAvatar, 250); });
  $('#av-shuffle').addEventListener('click', () => { avatar.seed = Math.random().toString(36).slice(2, 10); drawAvatar(); });
  $('#av-styles').addEventListener('click', (e) => {
    const b = e.target.closest('[data-style]');
    if (b) { avatar.style = b.dataset.style; drawAvatar(); }
  });
  drawAvatar();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const code = form.room.value.replace(/\D/g, '');
      if (code.length !== 6) throw new Error('Oda kodu 6 haneli olmalı.');
      const { id } = await post('/api/join', { room: code, name: form.name.value, avatar: current(), invite: inviteTitle ? invite : undefined });
      localStorage.setItem(AVATAR_STORE, JSON.stringify(avatar));
      session = { room: code, id, invite: inviteTitle ? invite : undefined };
      localStorage.setItem(STORE, JSON.stringify(session));
      connect();
    } catch (err) {
      $('#err').textContent = err.message;
      btn.disabled = false;
    }
  });
}

const VIEWS = {
  lobby: (s) => `
    ${avatarImg(s.me.avatar, 'av-preview')}
    <h1>Hazırsın, ${esc(s.me.name)}.</h1>
    <p class="lead">Adın büyük ekranda. Oyun başlayınca ilk soru burada açılacak.</p>
    ${dots}`,

  question(s) {
    const q = s.question;
    if (s.me.answer !== null) {
      return `<div class="badge wait">${ICON.clock}</div>
        <h1>Cevabın alındı.</h1>
        <p class="lead">${LETTERS[s.me.answer]} şıkkını seçtin. Süre bitince sonucu göreceksin.</p>${dots}`;
    }
    return `<div class="track" data-countdown><i></i></div>
      <p class="pq">${esc(q.text)}</p>
      <div class="opts">${q.options.map((t, i) => `<button class="opt o${i}" data-choice="${i}"><b>${LETTERS[i]}</b><span>${esc(t)}</span></button>`).join('')}</div>`;
  },

  reveal(s) {
    const { me, question: q } = s;
    const [cls, icon, title] = me.correct ? ['good', ICON.check, 'Doğru!']
      : me.answer === null ? ['bad', ICON.clock, 'Süre doldu'] : ['bad', ICON.cross, 'Olmadı'];
    return `<div class="badge ${cls}">${icon}</div>
      <h1>${title}</h1>
      ${me.correct
        ? `<p class="big-num">+${fmt(me.gain)}</p>${me.streak > 1 ? `<p class="lead">Üst üste ${me.streak} doğru, serini koru.</p>` : ''}`
        : `<p class="lead">Doğru cevap: <strong>${LETTERS[q.correct]}) ${esc(q.options[q.correct])}</strong></p>`}
      <div class="card">
        <div class="row"><span class="muted">Toplam puan</span><strong>${fmt(me.score)}</strong></div>
        <div class="row"><span class="muted">Sıran</span><strong>${me.rank}. / ${s.playerCount}</strong></div>
      </div>
      <p class="muted">${s.last ? 'Sonuçlar' : 'Sıradaki soru'} <span data-next-seconds></span> sn içinde</p>`;
  },

  final: (s) => `
    <p class="eyebrow">Oyun bitti</p>
    <p class="big-num">${s.me.rank}.</p>
    <h1>${s.me.rank === 1 ? 'Birincisin, tebrikler!' : s.me.rank <= 3 ? 'Kürsüdesin!' : 'Güzel oyundu.'}</h1>
    <p class="lead">${fmt(s.me.score)} puan topladın.</p>
    <button class="btn primary" type="button" data-leave>Başka odaya katıl</button>`,
};

function render(s) {
  if (s.phase === 'gone') {
    stream.close();
    localStorage.removeItem(STORE);
    return showJoin('Oyundan çıkarıldın ya da oda kapandı. Tekrar katılabilirsin.', session ? session.room : roomFromUrl());
  }
  state = s;
  $('#leave').hidden = s.phase === 'final';
  // Biten oyun hatırlanmasın: sayfa yeniden açılınca doğrudan kod ekranı gelsin.
  if (s.phase === 'final') localStorage.removeItem(STORE);
  $('#meta').textContent = s.question && s.phase !== 'final' ? `${s.question.number} / ${s.total} · ${fmt(s.me.score)} puan` : s.me.name;

  const key = `${s.phase}:${s.question?.number}:${s.me.answer}`;
  if (key === renderedKey) return;
  renderedKey = key;
  screen.className = s.phase === 'question' && s.me.answer === null ? 'screen' : 'screen middle';
  screen.innerHTML = VIEWS[s.phase](s);
  if (s.phase === 'reveal' && navigator.vibrate) navigator.vibrate(s.me.correct ? 60 : [40, 60, 40]);
}

// Oyundan çık (oyun sırasında ya da bittikten sonra) ve temiz bir kod ekranına dön.
async function leave() {
  if (stream) stream.close();
  stream = null;
  localStorage.removeItem(STORE);
  const old = session;
  session = null;
  invite = '';
  history.replaceState(null, '', '/');
  showJoin('', '');
  if (old) post('/api/leave', { room: old.room, id: old.id }).catch(() => {});
}

$('#leave').addEventListener('click', () => {
  if (state && state.phase !== 'final' && !confirm('Oyundan çıkmak istiyor musun? Puanın silinecek.')) return;
  leave();
});

screen.addEventListener('click', async (e) => {
  if (e.target.closest('[data-leave]')) return leave();
  const btn = e.target.closest('[data-choice]');
  if (!btn || !state || state.phase !== 'question') return;
  const buttons = screen.querySelectorAll('[data-choice]');
  buttons.forEach((b) => { b.disabled = true; if (b !== btn) b.classList.add('dim'); });
  try {
    await post('/api/answer', { room: session.room, id: session.id, index: state.question.number - 1, choice: Number(btn.dataset.choice) });
  } catch (err) {
    toast(err.message);
    buttons.forEach((b) => { b.disabled = false; b.classList.remove('dim'); });
  }
});

function connect() {
  if (stream) stream.close();
  renderedKey = '';
  screen.className = 'screen middle';
  screen.innerHTML = dots;
  stream = listen({ room: session.room, role: 'player', id: session.id }, render);
}

try { session = JSON.parse(localStorage.getItem(STORE)); } catch { session = null; }
// Bağlantıyla farklı bir odaya geldiyse eski oturumu kullanma.
const linked = roomFromUrl();
const sameRoom = invite ? session && session.invite === invite : !linked || (session && linked === session.room);
if (session && session.room && session.id && sameRoom) connect();
else if (invite) showInvite();
else showJoin();
runCountdown(() => state);
