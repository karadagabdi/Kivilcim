'use strict';

const STORE = 'kivilcim-ekran';
let state = null;
let renderedKey = '';
let session = null; // { code, key, quizId } — key yalnızca bu tarayıcıda durur
let stream = null;
const stage = $('#stage');
const spaced = (code) => `${code.slice(0, 3)} ${code.slice(3)}`;

// Şık kutuları; sayılar ve çubuklar updateLive() ile anlık güncellenir.
const options = (q, reveal) => `<ol class="opts">${q.options.map((text, i) => {
  const cls = reveal ? (i === q.correct ? 'right' : 'dim') : '';
  return `<li class="opt o${i} ${cls}"><i class="fill"></i>
    <b>${reveal && i === q.correct ? '✓' : LETTERS[i]}</b><span>${esc(text)}</span><span class="tally">0</span></li>`;
}).join('')}</ol>`;

// Sol: soru. Sağ: oyuncular ve seçtikleri şık, canlı.
function live(s, reveal) {
  const q = s.question;
  const foot = reveal
    ? `<div class="next-info">
         <p><b>${q.counts[q.correct]}</b> kişi doğru bildi · ${s.last ? 'Sonuçlar' : 'Sıradaki soru'} <span data-next-seconds></span> sn içinde</p>
         <div class="track" data-next><i></i></div>
       </div>
       <button class="btn primary" data-act="next" data-primary>${s.last ? 'Sonuçları göster' : 'Hemen geç'} <kbd>Enter</kbd></button>`
    : `<p class="answered" id="answered"></p>
       <button class="btn ghost" data-act="skip" data-primary>Süreyi bitir <kbd>Enter</kbd></button>`;
  return `<section class="live ${reveal ? 'is-reveal' : ''}">
    <div class="live-main">
      <div class="qhead">
        ${reveal ? '' : '<div class="ring" data-countdown><span data-seconds></span></div>'}
        <div class="qtitle">
          <p class="eyebrow">Soru ${q.number} / ${s.total}</p>
          <h1 class="qtext">${esc(q.text)}</h1>
        </div>
      </div>
      ${options(q, reveal)}
      <div class="qfoot">${foot}</div>
    </div>
    <aside class="live-side" aria-label="Oyuncuların cevapları">
      <div class="side-head"><h2>Oyuncular</h2><span class="muted" id="side-count"></span></div>
      <ol class="side-list" id="side"></ol>
    </aside>
  </section>`;
}

function pick(p, reveal) {
  if (p.answer === null) return reveal ? '<span class="pick none">—</span>' : '<span class="pick wait" aria-label="Bekleniyor"><i></i><i></i><i></i></span>';
  return `<span class="pick o${p.answer}">${LETTERS[p.answer]}</span>`;
}

function updateLive(s) {
  const reveal = s.phase === 'reveal';
  const q = s.question;
  const counts = reveal ? q.counts : q.options.map((_, i) => s.players.filter((p) => p.answer === i).length);
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  stage.querySelectorAll('.opt').forEach((li, i) => {
    li.querySelector('.tally').textContent = counts[i];
    li.querySelector('.fill').style.setProperty('--w', `${(counts[i] / total) * 100}%`);
  });
  const answered = $('#answered');
  if (answered) answered.innerHTML = `<b>${s.answered}</b> / ${s.playerCount} cevap verdi`;
  $('#side-count').textContent = reveal ? 'Sıralama' : `${s.answered} / ${s.playerCount}`;
  $('#side').innerHTML = s.players.map((p, i) => `
    <li class="${reveal ? (p.correct ? 'ok' : 'miss') : ''} ${p.answer !== null ? 'done' : ''}">
      <span class="pos">${i + 1}</span>
      <span class="name">${avatarImg(p.avatar)}${esc(p.name)}</span>
      ${pick(p, reveal)}
      <span class="pts">${fmt(p.score)}${reveal && p.gain ? `<small>+${fmt(p.gain)}</small>` : ''}</span>
    </li>`).join('') || '<li class="muted">Oyuncu yok.</li>';
}

const VIEWS = {
  lobby(s) {
    const site = s.joinUrl.replace(/^https?:\/\//, '');
    const chips = s.players.length
      ? `<ul class="chips">${s.players.map((p) => `<li class="chip">${avatarImg(p.avatar)}${esc(p.name)}
          <button data-kick="${p.id}" aria-label="${esc(p.name)} oyundan çıkar" title="Çıkar">×</button></li>`).join('')}</ul>`
      : '<p class="empty">Henüz kimse yok. İlk katılan burada görünecek.</p>';
    return `<section class="lobby">
      <div class="join">
        <p class="eyebrow">${esc(s.title)} · ${s.total} soru</p>
        <h1>Telefonunu al, oyuna katıl.</h1>
        <div class="join-grid">
          <div><p class="eyebrow">Adres</p><div class="join-site">${esc(site)}</div></div>
          <div><p class="eyebrow">Oda kodu</p><div class="join-url">${spaced(s.code)}</div></div>
        </div>
        <p class="hint">Telefonundan adresi aç, oda kodunu ve adını yaz. Kendi internetinle, istediğin yerden katılabilirsin.</p>
        <ol class="steps">
          <li>Adresi aç, oda kodunu ve adını yaz.</li>
          <li>Soru ekranda çıkınca cevabını telefondan seç.</li>
          <li>Doğru ve hızlı olan daha çok puan alır.</li>
        </ol>
        <a class="quiet-link" href="/olustur">← Başka bir quiz seç</a>
      </div>
      <div class="roster">
        <div class="roster-head"><h2>Oyuncular</h2><span class="count">${s.players.length}</span></div>
        ${chips}
        <button class="btn primary" data-act="start" data-primary ${s.players.length ? '' : 'disabled'}>Oyunu başlat <kbd>Enter</kbd></button>
      </div>
    </section>`;
  },

  question: (s) => live(s, false),
  reveal: (s) => live(s, true),

  final(s) {
    const top = s.players.slice(0, 3);
    const steps = top.map((p, i) => `<div class="step p${i + 1}">
      ${avatarImg(p.avatar, 'av big')}<div class="who">${esc(p.name)}</div><div class="score">${fmt(p.score)} puan</div>
      <div class="block">${i + 1}</div></div>`).join('');
    const rest = s.players.slice(3, 10).map((p, i) => `<li style="--i:${i}">
      <span class="pos">${i + 4}</span><span class="name">${avatarImg(p.avatar)}${esc(p.name)}</span><span></span><span class="pts">${fmt(p.score)}</span></li>`).join('');
    return `<h1 class="section-title">Kazananlar</h1>
      <div class="podium">${steps}</div>
      ${rest ? `<ol class="board">${rest}</ol>` : ''}
      <div class="center">
        <button class="btn primary" data-act="reset" data-primary>Aynı quizi tekrar oyna <kbd>Enter</kbd></button>
        <a class="btn ghost" href="/olustur">Quizlere dön</a>
      </div>`;
  },
};

function render(s) {
  if (s.phase === 'gone') return openRoom(session && session.quizId); // oda süresi doldu ya da sunucu yeniden başladı
  state = s;
  $('#title').textContent = s.title;
  $('#meta').innerHTML = s.question && s.phase !== 'final'
    ? `Oda <b>${spaced(s.code)}</b> · Soru <b>${s.question.number}</b> / ${s.total} · ${s.playerCount} oyuncu`
    : `Oda <b>${spaced(s.code)}</b> · ${s.playerCount} oyuncu`;

  // Soru sırasında her yeni cevapta tüm ekranı yeniden çizme; sadece canlı kısımları güncelle.
  const key = s.phase === 'lobby' ? 'lobby:' + s.players.map((p) => p.id).join() : `${s.phase}:${s.question?.number}`;
  if (key !== renderedKey) {
    stage.innerHTML = VIEWS[s.phase](s);
    renderedKey = key;
  }
  if (s.phase === 'question' || s.phase === 'reveal') updateLive(s);
}

async function act(action, body) {
  try {
    await post('/api/host/' + action, { ...body, room: session.code, key: session.key });
  } catch (e) {
    toast(e.message);
    renderedKey = '';
    render(state);
  }
}

stage.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  if (btn.dataset.kick) act('kick', { id: btn.dataset.kick });
  else if (btn.dataset.act) { btn.disabled = true; act(btn.dataset.act); }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.repeat) return;
  const btn = $('[data-primary]');
  if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
});

function connect() {
  if (stream) stream.close();
  renderedKey = '';
  stream = listen({ room: session.code, role: 'host', key: session.key }, render);
}

function notice(html) {
  stage.innerHTML = `<div class="notice">${html}<p><a class="btn ghost" href="/olustur">Quizlere git</a></p></div>`;
}

async function openRoom(quizId) {
  if (stream) stream.close();
  localStorage.removeItem(STORE);
  const quiz = quizId && Library.get(quizId);
  if (!quiz) return notice('<h1>Oynatılacak quiz seçilmedi.</h1><p class="lead">Quizlerinden birini seçip “Oyna”ya bas.</p>');
  stage.innerHTML = '<p class="empty">Oda açılıyor…</p>';
  try {
    const { code, key } = await post('/api/rooms', { quiz: toPayload(quiz) });
    session = { code, key, quizId };
    localStorage.setItem(STORE, JSON.stringify(session));
    connect();
  } catch (e) {
    notice(`<h1>Oda açılamadı.</h1><p class="lead">${esc(e.message)}</p>`);
  }
}

try { session = JSON.parse(localStorage.getItem(STORE)); } catch { session = null; }
// Aynı quizin açık odası varsa ona dön (sayfa yenilendiğinde oyun kaybolmasın); yoksa yeni oda aç.
const wanted = new URLSearchParams(location.search).get('q');
if (session && session.code && session.key && (!wanted || wanted === session.quizId)) connect();
else openRoom(wanted || (session && session.quizId));
runCountdown(() => state);
