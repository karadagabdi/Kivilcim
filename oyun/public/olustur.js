'use strict';

const app = $('#app');
let current = null; // düzenlenen quiz
let saveTimer = null;

const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });
function ago(ts) {
  const min = Math.round((ts - Date.now()) / 60000);
  if (Math.abs(min) < 60) return rtf.format(min, 'minute');
  const h = Math.round(min / 60);
  if (Math.abs(h) < 24) return rtf.format(h, 'hour');
  return rtf.format(Math.round(h / 24), 'day');
}

// ---------- Liste ----------

function card(q) {
  const issues = problems(q);
  return `<li class="quiz-card" data-id="${esc(q.id)}">
    <div>
      <h3>${esc(q.title || 'Adsız quiz')}</h3>
      <p class="muted">${q.questions.length} soru · ${ago(q.updatedAt)} düzenlendi</p>
      ${issues.length ? `<p class="warn">${issues.length} eksik var, oynatmadan önce düzelt.</p>` : ''}
    </div>
    <div class="card-actions">
      <button class="btn primary small" data-do="play">Oyna</button>
      <button class="btn ghost small" data-do="edit">Düzenle</button>
      <span class="spacer"></span>
      <button class="icon-btn" data-do="export" title="Dosya olarak indir" aria-label="Dosya olarak indir">⤓</button>
      <button class="icon-btn danger" data-do="delete" title="Sil" aria-label="Sil">×</button>
    </div>
  </li>`;
}

function renderLibrary() {
  const list = Library.all();
  document.title = 'Kıvılcım · Quizlerin';
  app.innerHTML = `
    <section class="lib-head">
      <div>
        <p class="eyebrow">Quiz stüdyosu</p>
        <h1>Quizlerin</h1>
        <p class="lead">Quizlerin yalnızca bu tarayıcıda saklanır. Başka bir bilgisayarda kullanmak için ⤓ ile indir, orada içe aktar.</p>
      </div>
      <div class="lib-actions">
        <button class="btn primary" data-do="new">Yeni quiz</button>
        <button class="btn ghost" data-do="file">Dosyadan içe aktar</button>
        <button class="btn ghost" data-do="paste">Metin yapıştır</button>
      </div>
    </section>
    ${list.length ? `<ul class="quiz-grid">${list.map(card).join('')}</ul>` : `
    <div class="empty-state">
      <h2>Henüz bir quizin yok.</h2>
      <p class="lead">Sıfırdan başla, sorularını yapıştır ya da bir CSV/JSON dosyası yükle. Önce nasıl çalıştığını görmek istersen örnek quizi ekle.</p>
      <button class="btn ghost" data-do="sample">Örnek quizi ekle</button>
    </div>`}
    <section class="formats">
      <h2>Hangi dosyaları alıyor?</h2>
      <dl>
        <dt>Metin (.txt) ya da yapıştırma</dt><dd>“1. Soru” ve altında “A) …” satırları. Doğru şıkkın sonuna * koy ya da “Cevap: B” yaz.</dd>
        <dt>CSV (.csv)</dt><dd>Excel’de sütunlar: soru, A, B, C, D, doğru (A–D ya da 1–4), süre (sn, isteğe bağlı). “CSV olarak kaydet” ile kaydet.</dd>
        <dt>JSON (.json)</dt><dd>Bu sayfadan indirdiğin quiz dosyaları.</dd>
      </dl>
    </section>`;
}

// ---------- Düzenleyici ----------

function qCard(q, n, total) {
  return `<li class="q-card" data-n="${n}">
    <div class="q-card-head">
      <span class="q-num">Soru ${n + 1}</span>
      <select data-f="time" aria-label="Süre">${TIMES.map((t) => `<option value="${t}" ${t === q.time ? 'selected' : ''}>${t} sn</option>`).join('')}</select>
      <span class="spacer"></span>
      <button class="icon-btn" data-do="up" ${n === 0 ? 'disabled' : ''} title="Yukarı taşı" aria-label="Yukarı taşı">↑</button>
      <button class="icon-btn" data-do="down" ${n === total - 1 ? 'disabled' : ''} title="Aşağı taşı" aria-label="Aşağı taşı">↓</button>
      <button class="icon-btn" data-do="dup" title="Kopyasını ekle" aria-label="Kopyasını ekle">⧉</button>
      <button class="icon-btn danger" data-do="del" title="Soruyu sil" aria-label="Soruyu sil">×</button>
    </div>
    <textarea data-f="text" maxlength="${LIMITS.question}" rows="2" placeholder="Soruyu yaz">${esc(q.text)}</textarea>
    <div class="opt-edit">${q.options.map((o, i) => `
      <label class="opt-row o${i} ${q.correct === i ? 'is-correct' : ''}">
        <input type="radio" name="c${n}" data-f="correct" value="${i}" ${q.correct === i ? 'checked' : ''} aria-label="${LETTERS[i]} doğru cevap">
        <b>${LETTERS[i]}</b>
        <input type="text" data-f="opt" data-i="${i}" maxlength="${LIMITS.option}" value="${esc(o)}"
          placeholder="${i < 2 ? 'Şık' : 'Şık (isteğe bağlı)'}">
      </label>`).join('')}
    </div>
  </li>`;
}

function renderEditor(focusLast = false) {
  const q = current;
  document.title = `Kıvılcım · ${q.title || 'Yeni quiz'}`;
  app.innerHTML = `
    <div class="ed-top">
      <a href="#" class="back">← Quizler</a>
      <span class="save-state" id="saved">Kaydedildi</span>
      <button class="btn primary" data-do="play">Oyna</button>
    </div>
    <input class="title-input" id="title" maxlength="${LIMITS.title}" placeholder="Quizin adı" value="${esc(q.title)}" aria-label="Quizin adı">
    <div class="ed-settings">
      <label class="check"><input type="checkbox" id="shuffle" ${q.shuffle !== false ? 'checked' : ''}> Şıkları her oyunda karıştır</label>
      <label>Hepsine süre
        <select id="all-time"><option value="">—</option>${TIMES.map((t) => `<option value="${t}">${t} sn</option>`).join('')}</select>
      </label>
      <span class="muted">${q.questions.length} / ${LIMITS.questions} soru · Doğru şıkkın yanındaki daireyi işaretle.</span>
    </div>
    <div id="problems"></div>
    <ol class="q-list">${q.questions.map((x, n) => qCard(x, n, q.questions.length)).join('')}</ol>
    <button class="btn ghost add-q" data-do="add" ${q.questions.length >= LIMITS.questions ? 'disabled' : ''}>+ Soru ekle</button>`;
  if (!q.title) $('#title').focus();
  if (focusLast) {
    const last = [...app.querySelectorAll('.q-card textarea')].pop();
    last.scrollIntoView({ block: 'center', behavior: 'smooth' });
    last.focus({ preventScroll: true });
  }
  showProblems();
}

function showProblems() {
  const box = $('#problems');
  if (!box) return;
  const list = problems(current);
  box.innerHTML = list.length ? `<div class="problems"><b>Oynatmadan önce:</b>
    <ul>${list.slice(0, 5).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    ${list.length > 5 ? `<p class="muted">ve ${list.length - 5} eksik daha</p>` : ''}</div>` : '';
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!current) return;
  Library.put(current);
  const s = $('#saved');
  if (s) s.textContent = 'Kaydedildi';
  showProblems();
}

function scheduleSave() {
  const s = $('#saved');
  if (s) s.textContent = 'Kaydediliyor…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

app.addEventListener('input', (e) => {
  if (!current) return;
  const t = e.target;
  if (t.id === 'title') current.title = t.value;
  else {
    const el = t.closest('.q-card');
    if (!el) return;
    const q = current.questions[Number(el.dataset.n)];
    if (t.dataset.f === 'text') q.text = t.value;
    else if (t.dataset.f === 'opt') q.options[Number(t.dataset.i)] = t.value;
    else return;
  }
  scheduleSave();
});

app.addEventListener('change', (e) => {
  if (!current) return;
  const t = e.target;
  if (t.id === 'shuffle') current.shuffle = t.checked;
  else if (t.id === 'all-time' && t.value) {
    current.questions.forEach((q) => { q.time = Number(t.value); });
    saveNow();
    return renderEditor();
  } else {
    const el = t.closest('.q-card');
    if (!el) return;
    const q = current.questions[Number(el.dataset.n)];
    if (t.dataset.f === 'time') q.time = Number(t.value);
    else if (t.dataset.f === 'correct') {
      q.correct = Number(t.value);
      el.querySelectorAll('.opt-row').forEach((row, i) => row.classList.toggle('is-correct', i === q.correct));
    } else return;
  }
  scheduleSave();
});

// ---------- Eylemler ----------

function slug(s) {
  return (s || 'quiz').toLocaleLowerCase('tr').replace(/[^a-z0-9çğıöşü]+/g, '-').replace(/^-|-$/g, '') || 'quiz';
}

function download(quiz) {
  const data = JSON.stringify({ title: quiz.title, shuffle: quiz.shuffle !== false, questions: quiz.questions }, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = slug(quiz.title) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function play(quiz) {
  const list = problems(quiz);
  if (list.length) {
    toast(list[0]);
    if (current !== quiz) location.hash = '#duzenle/' + quiz.id;
    return;
  }
  location.href = '/ekran?q=' + encodeURIComponent(quiz.id);
}

function addImported(quiz) {
  Library.put(quiz);
  location.hash = '#duzenle/' + quiz.id;
  const missing = quiz.questions.filter((q) => q.correct === null).length;
  toast(`${quiz.questions.length} soru içe aktarıldı.` + (missing ? ` ${missing} soruda doğru cevabı seçmen gerek.` : ''));
}

const ACTIONS = {
  new() { const q = newQuiz(); Library.put(q); location.hash = '#duzenle/' + q.id; },
  file() { $('#file').click(); },
  paste() { $('#paste-text').value = ''; $('#paste').showModal(); },
  sample() {
    Library.put({ ...newQuiz(SAMPLE.title), questions: SAMPLE.questions.map((q) => ({ ...q, options: [...q.options] })) });
    renderLibrary();
  },
  edit(id) { location.hash = '#duzenle/' + id; },
  export(id) { download(Library.get(id)); },
  delete(id) {
    const q = Library.get(id);
    if (confirm(`“${q.title || 'Adsız quiz'}” silinsin mi? Bu geri alınamaz.`)) { Library.remove(id); renderLibrary(); }
  },
  play(id) {
    if (current) { saveNow(); play(current); } else play(Library.get(id));
  },
  // Düzenleyici içindeki soru eylemleri
  add() {
    const last = current.questions[current.questions.length - 1];
    current.questions.push(blankQuestion(last ? last.time : 20));
    saveNow();
    renderEditor(true);
  },
  up(_, n) { move(n, -1); },
  down(_, n) { move(n, 1); },
  dup(_, n) {
    const q = current.questions[n];
    current.questions.splice(n + 1, 0, { ...q, options: [...q.options] });
    saveNow();
    renderEditor();
  },
  del(_, n) {
    const q = current.questions[n];
    if ((q.text.trim() || q.options.some((o) => o.trim())) && !confirm(`${n + 1}. soru silinsin mi?`)) return;
    current.questions.splice(n, 1);
    saveNow();
    renderEditor();
  },
};

function move(n, d) {
  const qs = current.questions;
  [qs[n], qs[n + d]] = [qs[n + d], qs[n]];
  saveNow();
  renderEditor();
}

app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-do]');
  if (!b || b.disabled) return;
  const id = b.closest('[data-id]')?.dataset.id;
  const n = Number(b.closest('.q-card')?.dataset.n);
  ACTIONS[b.dataset.do](id, n);
});

$('#file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 1e6) return toast('Dosya çok büyük (en fazla 1 MB).');
  try {
    addImported(importFile(f.name, await f.text()));
  } catch (err) {
    toast(err instanceof SyntaxError ? 'JSON dosyası bozuk, açılamadı.' : err.message);
  }
});

$('#paste').addEventListener('close', () => {
  if ($('#paste').returnValue !== 'ok') return;
  const qs = parseText($('#paste-text').value).slice(0, LIMITS.questions);
  if (!qs.length) return toast('Metinde soru bulunamadı. Örnekteki biçimi kullan.');
  addImported({ ...newQuiz('Yapıştırılan quiz'), questions: qs });
});

// ---------- Yönlendirme ----------

function route() {
  if (saveTimer) saveNow();
  const m = location.hash.match(/^#duzenle\/(.+)$/);
  const quiz = m && Library.get(decodeURIComponent(m[1]));
  current = quiz || null;
  if (quiz) renderEditor(); else renderLibrary();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', () => { if (saveTimer) saveNow(); });
route();
