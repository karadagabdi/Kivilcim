'use strict';

const STORE = 'kivilcim-ekran';
let state = null;
let renderedKey = '';
let session = null; // { code, key, quizId } — key yalnızca bu tarayıcıda durur
let stream = null;
const stage = $('#stage');
const spaced = (code) => `${code.slice(0, 3)} ${code.slice(3)}`;

const options = (q, reveal) => `<ol class="opts">${q.options.map((text, i) => {
  if (!reveal) return `<li class="opt o${i}"><b>${LETTERS[i]}</b><span>${esc(text)}</span></li>`;
  const total = q.counts.reduce((a, b) => a + b, 0) || 1;
  const cls = i === q.correct ? 'right' : 'dim';
  return `<li class="opt o${i} ${cls}"><i class="fill" style="--w:${(q.counts[i] / total) * 100}%"></i>
    <b>${i === q.correct ? '✓' : LETTERS[i]}</b><span>${esc(text)}</span><span class="tally">${q.counts[i]}</span></li>`;
}).join('')}</ol>`;

const VIEWS = {
  lobby(s) {
    const site = s.joinUrl.replace(/^https?:\/\//, '');
    const chips = s.players.length
      ? `<ul class="chips">${s.players.map((p) => `<li class="chip">${esc(p.name)}
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

  question(s) {
    const q = s.question;
    return `<div class="qhead">
        <div class="ring" data-countdown><span data-seconds></span></div>
        <h1 class="qtext">${esc(q.text)}</h1>
      </div>
      ${options(q, false)}
      <div class="qfoot">
        <p class="answered" id="answered"></p>
        <button class="btn ghost" data-act="skip" data-primary>Süreyi bitir <kbd>Enter</kbd></button>
      </div>`;
  },

  reveal(s) {
    const q = s.question;
    return `<div class="qhead"><h1 class="qtext">${esc(q.text)}</h1></div>
      ${options(q, true)}
      <div class="qfoot">
        <p class="answered"><b>${q.counts[q.correct]}</b> kişi doğru bildi</p>
        <button class="btn primary" data-act="board" data-primary>Sıralamayı göster <kbd>Enter</kbd></button>
      </div>`;
  },

  scoreboard(s) {
    const last = s.question.number === s.total;
    const rows = s.players.slice(0, 8).map((p, i) => `<li style="--i:${i}">
      <span class="pos">${i + 1}</span><span class="name">${esc(p.name)}</span>
      <span class="gain">${p.gain ? '+' + fmt(p.gain) : ''}</span><span class="pts">${fmt(p.score)}</span></li>`).join('');
    return `<h1 class="section-title">Sıralama</h1>
      <ol class="board">${rows}</ol>
      <div class="center"><button class="btn primary" data-act="next" data-primary>${last ? 'Sonuçları göster' : 'Sonraki soru'} <kbd>Enter</kbd></button></div>`;
  },

  final(s) {
    const top = s.players.slice(0, 3);
    const steps = top.map((p, i) => `<div class="step p${i + 1}">
      <div class="who">${esc(p.name)}</div><div class="score">${fmt(p.score)} puan</div>
      <div class="block">${i + 1}</div></div>`).join('');
    const rest = s.players.slice(3, 10).map((p, i) => `<li style="--i:${i}">
      <span class="pos">${i + 4}</span><span class="name">${esc(p.name)}</span><span></span><span class="pts">${fmt(p.score)}</span></li>`).join('');
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

  // Soru sırasında her yeni cevapta tüm ekranı yeniden çizme; sadece sayacı güncelle.
  const key = s.phase === 'lobby' ? 'lobby:' + s.players.map((p) => p.id).join() : `${s.phase}:${s.question?.number}`;
  if (key !== renderedKey) {
    stage.innerHTML = VIEWS[s.phase](s);
    renderedKey = key;
  }
  const answered = $('#answered');
  if (answered && s.phase === 'question') answered.innerHTML = `<b>${s.answered}</b> / ${s.playerCount} cevap verdi`;
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
