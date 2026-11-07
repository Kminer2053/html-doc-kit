// html-doc-kit 뷰어·편집기. 문서 파일 끝에 실려 조작 막대를 만들고 글자·표·메모·그림을 고치게 한다.
// 조작 막대는 실행할 때 만들고 저장할 때 지운다. 편집 표시도 저장할 때 모두 지운다.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const doc = $('#dk-document');
  if (!doc) return;
  const pages = $$(':scope > .dk-page', doc);
  const viewport = $('#dk-viewport');
  const root = document.documentElement;
  const docId = root.dataset.docId || 'doc';
  const docRev = root.dataset.docRev || '1';
  const DRAFT_KEY = 'dk-draft:' + docId + ':' + docRev;
  const FILE_NAME = decodeURIComponent(location.pathname.split('/').pop() || '') || 'document.html';
  const OVER_TOLERANCE = 3; // 처음 값보다 이만큼(px) 더 넘치거나 겹쳐야 경고한다
  const BIG_IMAGE = 200000; // 이보다 큰 새 그림은 임시 저장에 넣지 않는다(저장 공간이 모자라 글까지 못 남긴다)
  const MANY_HOSTS = 200; // 칸이 이보다 많은 쪽은 겹침을 재지 않는다(입력이 느려진다)
  const HINT_ON = '글자를 눌러 바로 고칩니다 · 그림은 끌어서 옮깁니다 · Esc 글자에서 나오기 · ⌘S/Ctrl+S 저장 · 글자 밖에서 ← → 이동 · N 메모 · R 연속 읽기 · F 전체화면 · E 편집 끄기';
  const HINT_OFF = '← → 이동 · Space 다음 · R 연속 읽기 · N 메모 · F 전체화면 · E 편집 켜기';

  const book = JSON.parse($('#dk-book').textContent || '{}');
  book.pages = book.pages || [];
  pages.forEach((p, i) => {
    const b = (book.pages[i] = book.pages[i] || {});
    b.id = b.id || String(i + 1).padStart(2, '0');
    b.title = b.title || '쪽 ' + (i + 1);
    b.notes = b.notes || '';
    b.key = b.key || '';
  });
  book.pages.length = pages.length;

  let index = 0;
  let reading = false;
  let notesOpen = false;
  let running = false;
  let started = 0;
  let stored = 0;
  let editing = false;
  let dirty = false;
  let saving = false;
  let modalOpen = false;
  let revision = 0;
  let fileHandle = null;
  let draftTimer = 0;
  let overTimer = 0;
  let scrollTimer = 0;
  let base = null;
  let lastOver = 0;
  let savedNote = '';
  let draftBroken = false;
  let savedRange = null;
  let pickedImage = null;
  let drag = null;
  let suppressClick = false;
  const touched = new Set();
  const decoOf = new WeakMap();
  const overBy = pages.map(() => 0);

  // ── 조작 막대 ──
  const bar = document.createElement('nav');
  bar.className = 'dk-ui dk-controls';
  bar.setAttribute('aria-label', '문서 조작');
  bar.innerHTML =
    '<button id="dk-prev" aria-label="이전 쪽">←</button><button id="dk-next" aria-label="다음 쪽">→</button><span id="dk-position" aria-live="polite"></span>' +
    '<select id="dk-picker" aria-label="쪽 선택"></select><button id="dk-read" aria-pressed="false">읽기 R</button><button id="dk-notes" aria-pressed="false">메모 N</button>' +
    '<button id="dk-full">전체화면 F</button><time id="dk-elapsed">00:00</time><button id="dk-start">시작</button><button id="dk-reset">초기화</button>' +
    '<button id="dk-edit" aria-pressed="true" title="편집 켜고 끄기">편집 켜짐 E</button><button id="dk-save" title="저장 (⌘S 또는 Ctrl+S)">저장</button><span id="dk-status" aria-live="polite"></span>';
  document.body.prepend(bar);
  const foot = document.createElement('div');
  foot.className = 'dk-ui dk-foot';
  document.body.append(foot);
  const speaker = document.createElement('aside');
  speaker.className = 'dk-ui dk-speaker';
  speaker.hidden = true;
  speaker.innerHTML = '<h2 id="dk-note-title"></h2><div id="dk-note-meta"></div><div id="dk-note-key"></div><div id="dk-note-text"></div>';
  $('#dk-workspace').append(speaker);
  const status = $('#dk-status');
  const editBtn = $('#dk-edit');
  const picker = $('#dk-picker');
  const noteKey = $('#dk-note-key');
  const noteText = $('#dk-note-text');
  book.pages.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = p.id + ' · ' + p.title;
    picker.append(o);
  });
  document.body.classList.add('dk-js');

  // ── 쪽 표시 ──
  const stamp = (t) => {
    t = Math.max(0, Math.floor(t));
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  };
  const pageWidth = (p) => parseFloat(getComputedStyle(p).getPropertyValue('--dk-w')) || 794;
  const pageHeight = (p) => parseFloat(getComputedStyle(p).getPropertyValue('--dk-h')) || 0;
  function resize() {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    pages.forEach((p) => {
      const pw = pageWidth(p);
      const ph = pageHeight(p);
      const fit = reading || !ph ? Math.min((w - 24) / pw, 1) : Math.min((w - 8) / pw, (h - 8) / ph);
      p.style.setProperty('--dk-scale', Math.max(0.1, fit));
    });
  }
  function fillNotes() {
    const p = book.pages[index];
    $('#dk-note-title').textContent = p.title;
    const total = book.pages.slice(0, index + 1).reduce((a, x) => a + (x.seconds || 0), 0);
    $('#dk-note-meta').textContent = p.seconds ? '이 쪽 ' + p.seconds + '초 · 누적 ' + stamp(total) + (book.minutes ? ' / ' + stamp(book.minutes * 60) : '') : '';
    noteKey.textContent = p.key || '';
    noteText.textContent = p.notes || '';
  }
  function showPage(n) {
    index = Number.isFinite(n) ? Math.max(0, Math.min(pages.length - 1, n)) : 0;
    pages.forEach((p, i) => p.classList.toggle('dk-active', i === index));
    $('#dk-position').textContent = index + 1 + ' / ' + pages.length;
    picker.value = index;
    $('#dk-prev').disabled = index === 0;
    $('#dk-next').disabled = index === pages.length - 1;
    fillNotes();
    try {
      history.replaceState(null, '', '#' + (index + 1));
    } catch (e) {}
    document.title = book.pages[index].id + ' · ' + book.pages[index].title + (book.title ? ' | ' + book.title : '');
  }
  function go(n) {
    showPage(n);
    if (reading) pages[index].scrollIntoView({block: 'start'});
    else viewport.scrollTop = 0;
    hideBars();
    if (!reading) getSelection().removeAllRanges();
    checkOverflow();
  }
  function toggleRead() {
    reading = !reading;
    document.body.classList.toggle('dk-reading', reading);
    $('#dk-read').setAttribute('aria-pressed', reading);
    resize();
    if (reading) pages[index].scrollIntoView({block: 'start'});
    hideBars();
    checkOverflow();
  }
  function toggleNotes() {
    notesOpen = !notesOpen;
    speaker.hidden = !notesOpen;
    $('#dk-notes').setAttribute('aria-pressed', notesOpen);
    resize();
    hideBars();
    // 메모를 열고 닫으면 배율이 바뀌어 화면이 밀리므로 연속 읽기에서는 현재 쪽으로 다시 맞춘다
    if (reading) pages[index].scrollIntoView({block: 'start'});
  }
  async function full() {
    try {
      if (!document.fullscreenElement) await root.requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) {}
  }
  function timer() {
    const sec = (stored + (running ? Date.now() - started : 0)) / 1000;
    const el = $('#dk-elapsed');
    el.textContent = stamp(sec);
    el.classList.toggle('dk-late', !!book.minutes && sec > book.minutes * 60);
  }
  $('#dk-prev').onclick = () => go(index - 1);
  $('#dk-next').onclick = () => go(index + 1);
  picker.onchange = (e) => go(Number(e.target.value));
  $('#dk-notes').onclick = toggleNotes;
  $('#dk-read').onclick = toggleRead;
  $('#dk-full').onclick = full;
  $('#dk-start').onclick = () => {
    if (running) stored += Date.now() - started;
    else started = Date.now();
    running = !running;
    $('#dk-start').textContent = running ? '정지' : '시작';
    timer();
  };
  $('#dk-reset').onclick = () => {
    stored = 0;
    started = Date.now();
    timer();
  };
  // 높이가 내용만큼인 쪽은 끝까지 스크롤한 뒤 다음 쪽으로 간다
  function stepForward() {
    const left = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    if (!reading && left > 2) viewport.scrollBy(0, viewport.clientHeight * 0.9);
    else go(index + 1);
  }
  document.addEventListener('keydown', (e) => {
    if (e.target.isContentEditable || e.target.matches('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey || (e.target.matches('button') && e.key === ' ')) return;
    let hit = true;
    if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'PageDown' || e.key === ' ') stepForward();
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(index - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(pages.length - 1);
    else if (e.code === 'KeyN') toggleNotes();
    else if (e.code === 'KeyR') toggleRead();
    else if (e.code === 'KeyF') full();
    else hit = false;
    if (hit) e.preventDefault();
  });

  // ── 고칠 수 있는 자리 찾기 ──
  // 줄바꿈 태그는 가로 배치 안에서 block으로 보고되지만 글자 흐름의 일부다
  const isBlockChild = (c) => !c.matches('br,style') && !getComputedStyle(c).display.startsWith('inline');
  // 글자가 든 요소에서 위로 올라가 가장 가까운 블록을 편집 단위로 삼는다(문단 안 굵은 글씨까지 한 덩어리로)
  // 곁에 블록 형제가 있으면(제목 + 본문 문단처럼) 묶지 않고 그 글자만 따로 고치게 한다
  function blockOf(el, top) {
    let e = el;
    while (e !== top && getComputedStyle(e).display === 'inline') {
      const parent = e.parentElement;
      if ([...parent.children].some(isBlockChild)) break;
      e = parent;
    }
    return e;
  }
  // 칸 맨 앞의 아이콘·색 표시·화살표는 글자가 그 안으로 들어가지 않게 잠근다
  function lockDecoration(h) {
    const d = h.firstElementChild;
    if (!d || !(d.matches('svg') || (d.matches('i') && d.textContent.trim().length <= 2))) return;
    let n = h.firstChild;
    while (n !== d && !(n.nodeValue || '').trim()) n = n.nextSibling;
    if (n !== d) return;
    d.dataset.dkDeco = '';
    d.setAttribute('contenteditable', 'false');
    decoOf.set(h, d);
  }
  // 글자와 블록 자식이 섞인 바깥 틀은 칸으로 삼지 않는다. 표 전체가 한 칸이 되지 않게 글자만 감싼다
  function wrapLooseText(e) {
    if (![...e.children].some(isBlockChild)) return false;
    [...e.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim()).forEach((n) => {
      const s = document.createElement('dk-text'); // span이면 문서의 span 스타일이 걸린다
      n.replaceWith(s);
      s.append(n);
    });
    return true;
  }
  function markHosts(top) {
    const found = new Set($$('[data-dk-empty]', top));
    const textNodes = () => {
      const out = [];
      const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue.trim() && !n.parentElement.closest('svg,style,script,textarea')) out.push(n);
      return out;
    };
    new Set(textNodes().map((n) => n.parentElement)).forEach(wrapLooseText);
    textNodes().forEach((n) => {
      const b = blockOf(n.parentElement, top);
      if (b !== top) {
        found.add(b);
        return;
      }
      // 쪽 바로 아래 맨몸 글자도 칸이 되게 감싼다
      const s = document.createElement('dk-text'); // span이면 문서의 span 스타일이 걸린다
      n.replaceWith(s);
      s.append(n);
      found.add(s);
    });
    $$('td,th', top).forEach((c) => {
      if (!c.textContent.trim() && !c.children.length && getComputedStyle(c).width !== '0px') found.add(c);
    });
    for (const e of found) {
      let up = e.parentElement;
      while (up && up !== top && !found.has(up)) up = up.parentElement;
      if (up && up !== top) continue; // 더 바깥 덩어리가 있으면 그쪽이 맡는다
      e.dataset.dkHost = '';
      e.spellcheck = false;
      lockDecoration(e);
      if (editing) e.contentEditable = 'true';
    }
  }
  const hostOf = (t) => {
    const e = t && t.nodeType === 1 ? t : t && t.parentElement;
    return e && e.closest ? e.closest('[data-dk-host]') : null;
  };
  const isNote = (h) => h === noteText || h === noteKey;
  const isFlexy = (h) => /flex|grid/.test(getComputedStyle(h).display);
  // 가로 배치 칸은 줄바꿈과 글자 조각이 각각 따로 놓여 모양이 깨진다
  const noBreak = (h) => h === noteKey || isFlexy(h);
  const hasWords = (h) => [...h.childNodes].some((n) => !(n.dataset && 'dkDeco' in n.dataset) && n.textContent.trim());
  const innerOf = (p) => $('.dk-page-inner', p);

  function setEditing(on) {
    editing = on;
    document.body.classList.toggle('dk-editing', on);
    editBtn.setAttribute('aria-pressed', on);
    editBtn.textContent = on ? '편집 켜짐 E' : '편집 꺼짐 E';
    foot.textContent = on ? HINT_ON : HINT_OFF;
    $$('[data-dk-host]').forEach((e) => {
      if (on) e.contentEditable = 'true';
      else e.removeAttribute('contenteditable');
    });
    if (!on) {
      if (document.activeElement && hostOf(document.activeElement)) document.activeElement.blur();
      hideBars();
    }
    checkOverflow();
  }

  // ── 고친 내용 반영 ──
  function touch(el) {
    const page = el.closest && el.closest('.dk-page');
    if (page) touched.add(pages.indexOf(page));
    dirty = true;
    revision++;
    showStatus();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 800);
    clearTimeout(overTimer);
    overTimer = setTimeout(checkOverflow, 120);
  }
  const oneLine = (e) => e.innerText.replace(/\s+/g, ' ').trim();
  // 제목 표시가 숨은 머리줄에 붙은 쪽(표지)은 눈에 보이는 첫 큰 제목을 쓴다
  function titleParts(page) {
    const shown = (e) => e.getBoundingClientRect().height > 0;
    const marked = $$('[data-dk-title]', page).filter(shown);
    if (marked.length) return marked;
    const first = $$('h1,h2', page).find(shown);
    return first ? [first] : [];
  }
  function syncBook(h) {
    const page = book.pages[index];
    if (h === noteText) page.notes = h.innerText.replace(/\n+$/, '');
    else if (h === noteKey) page.key = oneLine(h);
    else {
      const i = pages.indexOf(h.closest('.dk-page'));
      if (i < 0) return;
      const parts = titleParts(pages[i]);
      if (!parts.some((p) => p === h || p.contains(h) || h.contains(p))) return;
      const title = parts.map(oneLine).filter(Boolean).join(' ');
      book.pages[i].title = title;
      picker.options[i].textContent = book.pages[i].id + ' · ' + title;
      if (i === index) {
        $('#dk-note-title').textContent = title;
        document.title = book.pages[i].id + ' · ' + title + (book.title ? ' | ' + book.title : '');
      }
    }
  }
  document.addEventListener('input', (e) => {
    const h = hostOf(e.target);
    if (!h) return;
    // 지워진 잠금 아이콘은 되살린다
    const deco = decoOf.get(h);
    if (deco && !h.contains(deco)) h.prepend(deco);
    // 비운 칸은 표시해 둔다. 저장 뒤 다시 열어도 다시 쓸 수 있고, 편집 중에는 누를 자리가 남는다
    if (!isNote(h)) {
      if (hasWords(h)) h.removeAttribute('data-dk-empty');
      else if (!h.hasAttribute('data-dk-empty')) h.setAttribute('data-dk-empty', getComputedStyle(h).display === 'inline' ? 'inline' : '');
    }
    syncBook(h);
    touch(h);
  });
  // 칸 밖으로 커서가 나가면 숨은 영역이 밀려 올라가므로, 칸에서 나오거나 글이 다시 들어오면 되돌린다
  function resetScroll(page) {
    [page, ...$$('*', page)].forEach((e) => {
      if (e.scrollTop) e.scrollTop = 0;
      if (e.scrollLeft) e.scrollLeft = 0;
    });
  }
  document.addEventListener('focusout', (e) => {
    const page = e.target.closest && e.target.closest('.dk-page');
    if (page) resetScroll(page);
  });

  // ── 넘침 경고 ──
  // 고정 크기 쪽은 글이 길어지면 잘리거나 옆 내용을 덮는다. 칸마다 처음 값과 견준다.
  // 창 크기·메모 패널에 따라 배율이 바뀌면 글줄도 달라지므로 언제나 1배 상태로 잰다.
  function atFullScale(fn) {
    doc.classList.add('dk-measuring');
    try {
      return fn();
    } finally {
      doc.classList.remove('dk-measuring');
    }
  }
  function textBox(h) {
    const r = document.createRange();
    r.selectNodeContents(h);
    const b = r.getBoundingClientRect();
    return b.width || b.height ? b : null;
  }
  // 칸마다 [쪽 끝·꼬리말 선을 넘은 값, 칸 자신을 넘은 값, 칸이 든 상자를 넘은 값, 다른 칸·그림과 겹친 값]을 재서 따로 기준값과 견준다.
  // body는 쪽 안의 상자(띠·표 테두리)가 꼬리말 선을 덮은 값이다
  function measurePage(page) {
    const top = innerOf(page);
    const hosts = $$('[data-dk-host]', page);
    const edge = page.getBoundingClientRect();
    const fixed = pageHeight(page) > 0;
    const footer = $('.page-footer,[data-dk-footer],footer', page);
    // 커서를 따라 쪽 안이 밀려 올라가 있어도 제자리 기준으로 잰다
    const shift = page.scrollTop + top.scrollTop;
    // 꼬리말은 내용과 함께 밀리므로 그대로 쓰고, 쪽 끝은 밀리지 않으므로 민 만큼 뺀다
    const limit = !fixed ? Infinity : footer ? footer.getBoundingClientRect().top : edge.bottom - shift;
    const boxes = hosts.map(textBox);
    const overlap = fixed && hosts.length <= MANY_HOSTS;
    const solids = overlap ? $$('img,svg', page).map((i) => i.getBoundingClientRect()).filter((r) => r.width > 120) : [];
    const cells = hosts.map((h, j) => {
      const b = boxes[j];
      if (!b) return [0, 0, 0, 0];
      const out = Math.max(0, b.right - edge.right, h.closest('.page-footer,[data-dk-footer],footer') ? 0 : b.bottom - limit);
      const own = Math.max(h.scrollHeight - h.clientHeight, h.scrollWidth - h.clientWidth, 0);
      let box = 0;
      for (let e = h.parentElement; e && e !== top && !e.matches('.page-body,[data-dk-body],main,article'); e = e.parentElement) {
        // 표 행은 여러 행을 묶은 칸 때문에 값이 부풀어 뺀다(표가 길어지면 꼬리말 선에서 잡힌다)
        if (e.clientHeight && !e.matches('tr,tbody,thead,table')) box = Math.max(box, e.scrollHeight - e.clientHeight, e.scrollWidth - e.clientWidth);
      }
      let hit = 0;
      if (overlap) {
        const test = (o) => {
          const w = Math.min(b.right, o.right) - Math.max(b.left, o.left);
          const t = Math.min(b.bottom, o.bottom) - Math.max(b.top, o.top);
          if (w > 1 && t > 1) hit = Math.max(hit, Math.min(w, t));
        };
        boxes.forEach((o, k) => {
          if (o && k !== j) test(o);
        });
        solids.forEach(test);
      }
      return [out, own, box, hit].map(Math.round);
    });
    let body = 0;
    if (fixed) {
      // 꼬리말을 품은 틀과 쪽 전체를 덮는 배경은 처음부터 선을 넘으니 재지 않는다
      const inside = $$('*', top).filter((x) => !x.closest('figure,svg,.page-footer,[data-dk-footer],footer') && !(footer && x.contains(footer)) && x.getBoundingClientRect().height < edge.height - 1);
      body = Math.round(Math.max(0, ...inside.map((x) => x.getBoundingClientRect().bottom - limit)));
    }
    return {cells, body};
  }
  function checkOverflow() {
    if (!base) return;
    const flagged = pages.map((s, i) => i).filter((i) => overBy[i] > 0);
    const targets = reading ? new Set([...touched, ...flagged, index]) : new Set([index]);
    atFullScale(() => {
      targets.forEach((i) => {
        const hosts = $$('[data-dk-host]', pages[i]);
        const now = measurePage(pages[i]);
        // 칸 수가 달라졌으면(직접 고친 파일) 기준을 새로 잡는다
        if (!base[i] || base[i].cells.length !== now.cells.length) base[i] = now;
        let worst = editing && now.body - base[i].body > OVER_TOLERANCE ? now.body - base[i].body : 0;
        now.cells.forEach((c, j) => {
          const was = base[i].cells[j];
          const over = editing ? Math.max(...c.map((v, k) => v - was[k])) : 0;
          const bad = over > OVER_TOLERANCE;
          hosts[j].classList.toggle('dk-bad', bad);
          if (bad) worst = Math.max(worst, over);
        });
        overBy[i] = worst;
        pages[i].classList.toggle('dk-over', worst > 0);
        if (!worst) resetScroll(pages[i]);
      });
    });
    lastOver = Math.max(...[...targets].map((i) => overBy[i]));
    showStatus();
  }
  function showStatus() {
    const parts = [];
    const others = editing ? overBy.map((v, i) => (v > 0 && i !== index ? i + 1 : 0)).filter(Boolean) : [];
    if (lastOver > 0) parts.push('⚠ ' + lastOver + 'px 넘침');
    else if (others.length) parts.push('⚠ ' + others.join('·') + '쪽 넘침');
    if (dirty) parts.push('저장 안 됨');
    else if (savedNote) parts.push(savedNote);
    else if (editing) parts.push('글자를 눌러 고치세요');
    if (dirty && draftBroken) parts.push('임시 저장 안 됨');
    status.textContent = parts.join(' · ');
    status.title = parts.join(' · ');
    status.classList.toggle('dk-warn', lastOver > 0 || others.length > 0 || (dirty && draftBroken));
  }

  // ── 글자 입력 ──
  document.addEventListener('beforeinput', (e) => {
    const h = hostOf(e.target);
    if (!h) return;
    const type = e.inputType;
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      // 문단을 나누면 칸 구조가 무너지므로 줄바꿈만 넣는다
      if (type === 'insertParagraph' || noBreak(h)) e.preventDefault();
      if (type === 'insertParagraph' && !noBreak(h)) document.execCommand('insertLineBreak');
    } else if (type === 'insertFromDrop' || (type.startsWith('format') && (isNote(h) || isFlexy(h)))) {
      e.preventDefault();
    }
  });
  // 붙여넣기는 글자만(다른 곳의 서식이 문서 모양을 깨지 않게)
  document.addEventListener('paste', (e) => {
    const h = hostOf(e.target);
    if (!h) return;
    e.preventDefault();
    let text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (noBreak(h)) text = text.replace(/\n+/g, ' ');
    text.split('\n').forEach((line, i) => {
      if (i) document.execCommand('insertLineBreak');
      if (line) document.execCommand('insertText', false, line);
    });
  });
  document.addEventListener('dragstart', (e) => {
    if (editing && e.target.closest && e.target.closest('.dk-page')) e.preventDefault();
  });
  document.addEventListener('mousedown', (e) => {
    if (!editing || !e.target.closest) return;
    // 그림은 끌어서 옮긴다
    const pic = movableOf(e.target);
    if (pic) {
      e.preventDefault();
      if (document.activeElement && hostOf(document.activeElement)) document.activeElement.blur();
      getSelection().removeAllRanges();
      startDrag(pic, e);
      return;
    }
    // 잠근 아이콘을 누르면 커서가 그 안에 갇혀 치는 글자가 버려지므로 칸 글자 끝으로 보낸다
    const deco = e.target.closest('[data-dk-deco]');
    if (deco) {
      e.preventDefault();
      const h = hostOf(deco.parentElement);
      h.focus();
      const r = document.createRange();
      r.selectNodeContents(h);
      r.collapse(false);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return;
    }
    // 칸 밖을 누르면 브라우저가 가까운 칸에 커서를 넣는다. 그러면 이어서 누른 Space·N·→ 가 글자로 들어가므로 막는다
    if (e.target.closest('[data-dk-host],.dk-ui') || !e.target.closest('.dk-page')) return;
    e.preventDefault();
    if (document.activeElement && hostOf(document.activeElement)) document.activeElement.blur();
    getSelection().removeAllRanges();
  });
  // 임시 저장 창이 떠 있는 동안에는 뒤쪽 단축키가 듣지 않게 한다
  document.addEventListener('keydown', (e) => {
    if (!modalOpen || (e.target.closest && e.target.closest('.dk-modal') && ['Enter', ' ', 'Tab'].includes(e.key))) return;
    if (e.key !== 'Tab') e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
      e.preventDefault();
      save();
      return;
    }
    const h = hostOf(e.target);
    // 전체 선택은 칸 안 글자만(잠근 아이콘은 빼고)
    if (h && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyA') {
      e.preventDefault();
      const kids = [...h.childNodes];
      const first = kids.findIndex((n) => !(n.dataset && 'dkDeco' in n.dataset));
      const r = document.createRange();
      r.setStart(h, Math.max(0, first));
      r.setEnd(h, kids.length);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return;
    }
    if (e.key === 'Escape' && h) {
      e.preventDefault();
      getSelection().removeAllRanges();
      e.target.blur();
      return;
    }
    if (!h && !e.metaKey && !e.ctrlKey && !e.altKey && e.code === 'KeyE' && !e.target.matches('input,textarea,select')) {
      e.preventDefault();
      setEditing(!editing);
    }
  });

  // ── 서식 막대 ──
  const fmt = document.createElement('div');
  fmt.className = 'dk-ui dk-float';
  fmt.hidden = true;
  fmt.setAttribute('role', 'toolbar');
  fmt.setAttribute('aria-label', '글자 서식');
  fmt.innerHTML =
    '<button data-cmd="bold" title="굵게"><b>굵게</b></button><button data-size="1.1" title="글자 크게">가+</button><button data-size="0.9" title="글자 작게">가−</button>' +
    ['#182d42', '#1b5790', '#0f93be', '#c92a2a', '#ffffff'].map((c) => `<button class="dk-swatch" data-color="${c}" title="글자색" style="background:${c}"></button>`).join('') +
    '<input type="color" value="#182d42" title="다른 글자색"><button data-cmd="removeFormat" title="서식 지우기">지우기</button>';
  document.body.append(fmt);
  const imgBar = document.createElement('div');
  imgBar.className = 'dk-ui dk-float';
  imgBar.hidden = true;
  imgBar.innerHTML = '<button data-a="swap">그림 바꾸기</button><button data-a="home">제자리로</button><input type="file" accept="image/*" hidden>';
  document.body.append(imgBar);

  function hideBars() {
    fmt.hidden = true;
    imgBar.hidden = true;
    pickedImage = null;
  }
  function placeBar(el, rect) {
    el.hidden = false;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = Math.max(6, Math.min(innerWidth - w - 6, rect.left + rect.width / 2 - w / 2)) + 'px';
    el.style.top = (rect.top - h - 8 > 6 ? rect.top - h - 8 : Math.min(innerHeight - h - 6, rect.bottom + 8)) + 'px';
  }
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === $('input[type=color]', fmt)) return;
    const s = getSelection();
    const h = editing && s.rangeCount && !s.isCollapsed ? hostOf(s.anchorNode) : null;
    if (!h || isNote(h) || isFlexy(h)) {
      fmt.hidden = true;
      return;
    }
    savedRange = s.getRangeAt(0).cloneRange();
    placeBar(fmt, savedRange.getBoundingClientRect());
  });
  // 막대를 눌러도 글자 선택이 풀리지 않게 한다
  fmt.addEventListener('mousedown', (e) => {
    if (!e.target.matches('input')) e.preventDefault();
  });
  function restoreSelection() {
    const s = getSelection();
    if (savedRange && (s.isCollapsed || !s.rangeCount)) {
      s.removeAllRanges();
      s.addRange(savedRange);
    }
  }
  // 브라우저 명령으로 글자 묶음을 만들어(굵게·색 유지) 그 크기만 지금 크기의 k배로 바꾼다
  function sizeSelection(k) {
    const s = getSelection();
    const from = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
    const host = hostOf(from);
    const px = parseFloat(atFullScale(() => getComputedStyle(from).fontSize)) * k;
    document.execCommand('fontSize', false, '7');
    $$('[style*="xxx-large"],font[size="7"]', host).forEach((e) => {
      e.removeAttribute('size');
      e.style.fontSize = px.toFixed(1) + 'px';
    });
  }
  function colorSelection(c) {
    restoreSelection();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('foreColor', false, c);
  }
  fmt.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    restoreSelection();
    document.execCommand('styleWithCSS', false, true);
    if (b.dataset.cmd) document.execCommand(b.dataset.cmd);
    else if (b.dataset.size) sizeSelection(Number(b.dataset.size));
    else if (b.dataset.color) colorSelection(b.dataset.color);
  });
  $('input[type=color]', fmt).addEventListener('input', (e) => colorSelection(e.target.value));

  // ── 그림 옮기기·바꾸기 ──
  // <img>와 SVG(차트 포함)를 옮긴다. 칸 앞 잠금 아이콘과 작은 아이콘은 뺀다
  function movableOf(t) {
    const el = t.closest('img,svg');
    if (!el || !el.closest('.dk-page') || el.closest('[data-dk-deco]') || el.dataset.dkDeco !== undefined) return null;
    if (el.matches('svg')) {
      const r = el.getBoundingClientRect();
      if (r.width < 48 && r.height < 48) return null;
    }
    return el;
  }
  const offsetOf = (el) => {
    const m = /(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(el.style.translate || '');
    return m ? [Number(m[1]), Number(m[2])] : [0, 0];
  };
  function startDrag(el, e) {
    const page = el.closest('.dk-page');
    const r = el.getBoundingClientRect();
    const box = page.getBoundingClientRect();
    const [ox, oy] = offsetOf(el);
    // 화면 1px이 몇 배인지. 쪽 배율로 나눠 끌린 거리를 문서 좌표로 바꾼다
    const k = box.width / (page.offsetWidth || box.width) || 1;
    drag = {el, page, r, box, ox, oy, sx: e.clientX, sy: e.clientY, k, moved: false};
  }
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      imgBar.hidden = true;
      // 그림을 자르는 상위 틀이 있으면 옮긴 그림이 잘리므로 풀어 준다
      for (let p = drag.el.parentElement; p && !p.classList.contains('dk-page-inner'); p = p.parentElement) {
        if (getComputedStyle(p).overflow !== 'visible') p.style.overflow = 'visible';
      }
      if (getComputedStyle(drag.el).display === 'inline') drag.el.style.display = 'inline-block';
    }
    // 쪽 밖으로 나가지 않게 한다
    const cx = Math.max(drag.box.left - drag.r.left, Math.min(drag.box.right - drag.r.right, dx));
    const cy = Math.max(drag.box.top - drag.r.top, Math.min(drag.box.bottom - drag.r.bottom, dy));
    drag.el.style.translate = `${Math.round(drag.ox + cx / drag.k)}px ${Math.round(drag.oy + cy / drag.k)}px`;
  });
  document.addEventListener('mouseup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.moved) {
      suppressClick = true;
      touch(d.el);
    }
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.dk-ui')) return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const pic = editing && e.target.closest ? movableOf(e.target) : null;
    if (!pic) {
      imgBar.hidden = true;
      pickedImage = null;
      return;
    }
    pickedImage = pic;
    $('[data-a=swap]', imgBar).hidden = !pic.matches('img');
    placeBar(imgBar, pic.getBoundingClientRect());
  });
  const imgInput = $('input', imgBar);
  imgBar.addEventListener('click', (e) => {
    const act = e.target.dataset && e.target.dataset.a;
    if (act === 'swap') imgInput.click();
    if (act === 'home' && pickedImage) {
      pickedImage.style.translate = '';
      touch(pickedImage);
      placeBar(imgBar, pickedImage.getBoundingClientRect());
    }
  });
  imgInput.addEventListener('change', () => {
    const file = imgInput.files[0];
    const target = pickedImage;
    imgInput.value = '';
    if (!file || !target) return;
    const reader = new FileReader();
    reader.onload = () => {
      // 먼저 읽어 보고 브라우저가 그릴 수 있는 그림일 때만 바꾼다
      const test = new Image();
      test.onload = () => {
        target.src = reader.result;
        touch(target);
      };
      test.onerror = () => {
        status.textContent = '이 그림 파일은 열 수 없습니다';
        status.classList.add('dk-warn');
      };
      test.src = reader.result;
    };
    reader.readAsDataURL(file);
    imgBar.hidden = true;
  });

  // ── 연속 읽기 ──
  // 보고 있는 쪽을 현재 쪽으로 삼는다(메모가 다른 쪽에 들어가지 않게)
  function followReading() {
    if (!reading || (document.activeElement && isNote(document.activeElement))) return;
    const top = viewport.getBoundingClientRect().top;
    const i = pages.findIndex((s) => {
      const r = s.getBoundingClientRect();
      return r.bottom > top + r.height / 3; // 맨 위 쪽이 3분의 2 넘게 지나가면 다음 쪽으로 본다
    });
    if (i < 0 || i === index) return;
    const scrolled = viewport.scrollTop;
    showPage(i);
    viewport.scrollTop = scrolled;
    checkOverflow();
  }
  viewport.addEventListener('scroll', () => {
    if (!drag) hideBars();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(followReading, 120);
  });
  window.addEventListener('resize', () => {
    hideBars();
    resize();
  });

  // ── 저장 ──
  function stripEditor(top) {
    $$('[data-dk-host]', top).forEach((e) => {
      e.removeAttribute('data-dk-host');
      e.removeAttribute('contenteditable');
      e.removeAttribute('spellcheck');
    });
    $$('[data-dk-deco]', top).forEach((e) => {
      e.removeAttribute('data-dk-deco');
      e.removeAttribute('contenteditable');
    });
    $$('.dk-over,.dk-bad', top).forEach((e) => e.classList.remove('dk-over', 'dk-bad'));
    $$('[class=""]', top).forEach((e) => e.removeAttribute('class'));
    return top;
  }
  function cleanHtml() {
    const copy = stripEditor(root.cloneNode(true));
    $$('.dk-ui', copy).forEach((e) => e.remove());
    $$('.dk-page', copy).forEach((e) => {
      e.classList.remove('dk-active');
      e.style.removeProperty('--dk-scale');
    });
    $('body', copy).removeAttribute('class');
    $('#dk-document', copy).removeAttribute('class');
    $('title', copy).textContent = book.title || 'document';
    $('#dk-book', copy).textContent = JSON.stringify(book).replace(/</g, '\\u003c');
    $('#dk-base', copy).textContent = base ? JSON.stringify(base) : '';
    return '<!doctype html>\n' + copy.outerHTML;
  }
  const clock = () => {
    const now = new Date();
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  };
  // rev: 저장을 시작할 때의 수정 번호. 쓰는 사이에 더 고친 글자가 있으면 저장 안 됨으로 남긴다
  function afterSave(rev, confirmed) {
    if (rev === revision) {
      dirty = false;
      if (confirmed) {
        touched.clear();
        clearTimeout(draftTimer);
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch (e) {}
      }
    }
    savedNote = (confirmed ? '저장됨 ' : '내려받음 ') + clock();
    checkOverflow();
    showStatus();
  }
  function download(html) {
    const url = URL.createObjectURL(new Blob([html], {type: 'text/html'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = FILE_NAME;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function save() {
    if (saving || modalOpen) return;
    saving = true;
    try {
      const rev = revision;
      const html = cleanHtml();
      if (window.showSaveFilePicker) {
        try {
          if (!fileHandle) fileHandle = await showSaveFilePicker({suggestedName: FILE_NAME, types: [{description: 'HTML 파일', accept: {'text/html': ['.html']}}]});
          const w = await fileHandle.createWritable();
          await w.write(html);
          await w.close();
          afterSave(rev, true);
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
          fileHandle = null; // 권한이 막히면 내려받기로 넘어간다
        }
      }
      // 내려받기는 사용자가 취소해도 알 수 없으므로 임시 저장을 지우지 않는다
      saveDraft();
      download(html);
      afterSave(rev, false);
    } finally {
      saving = false;
    }
  }
  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      saveDraft();
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ── 임시 저장 ──
  // 저장하지 않고 창을 닫아도 다음에 열 때 되살린다. 그림 자료는 빼고 고친 쪽의 본문과 메모만 둔다
  const originals = new Map();
  $$('.dk-page img', doc).forEach((im, k) => {
    im.dataset.dkImg = im.dataset.dkImg || String(k);
    originals.set(im.dataset.dkImg, im.getAttribute('src'));
  });
  function saveDraft() {
    if (!dirty) return;
    try {
      const saved = {};
      let bigImage = false;
      touched.forEach((i) => {
        const c = stripEditor(pages[i].cloneNode(true));
        $$('img', c).forEach((im) => {
          const k = im.dataset.dkImg;
          const src = im.getAttribute('src') || '';
          const same = originals.get(k) === src;
          if (!same && src.length > BIG_IMAGE) bigImage = true;
          if (originals.has(k) && (same || src.length > BIG_IMAGE)) im.setAttribute('src', '@@IMG' + k + '@@');
        });
        saved[i] = $('.dk-page-inner', c).innerHTML;
      });
      localStorage.setItem(DRAFT_KEY, JSON.stringify({time: Date.now(), pages: saved, book, bigImage}));
      draftBroken = false;
    } catch (e) {
      draftBroken = true; // 저장 공간이 모자라거나 막혀 있어도 편집은 계속된다
    }
    showStatus();
  }
  // 먼저 고르게 한다. 고르지 않고 고치거나 저장하면 옛 임시 저장과 섞여 글이 사라질 수 있다
  function offerDraft() {
    let draft = null;
    try {
      draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    } catch (e) {}
    if (!draft || !draft.pages) return;
    const when = new Date(draft.time);
    const pad = (n) => String(n).padStart(2, '0');
    const modal = document.createElement('div');
    modal.className = 'dk-ui dk-modal';
    modal.innerHTML = `<div class="dk-banner" role="alertdialog" aria-modal="true"><span>저장하지 않은 편집이 있습니다(${when.getMonth() + 1}/${when.getDate()} ${pad(when.getHours())}:${pad(when.getMinutes())}).${draft.bigImage ? ' 바꾼 그림은 크기가 커서 함께 남기지 못했습니다. 불러온 뒤 다시 넣어 주세요.' : ''}</span><button data-a="load">불러오기</button><button data-a="drop">버리기</button></div>`;
    const blocked = [$('#dk-workspace'), bar];
    blocked.forEach((e) => {
      e.inert = true;
    });
    modalOpen = true;
    modal.addEventListener('click', (e) => {
      const act = e.target.dataset.a;
      if (!act) return;
      modal.remove();
      modalOpen = false;
      blocked.forEach((b) => {
        b.inert = false;
      });
      if (act === 'drop') {
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch (err) {}
        return;
      }
      Object.entries(draft.pages).forEach(([i, html]) => {
        if (!pages[i]) return;
        originals.forEach((src, k) => {
          html = html.split('@@IMG' + k + '@@').join(src);
        });
        const top = innerOf(pages[i]);
        top.innerHTML = html;
        markHosts(top);
        touched.add(Number(i));
      });
      if (draft.book && draft.book.pages) book.pages.forEach((p, i) => Object.assign(p, draft.book.pages[i]));
      book.pages.forEach((p, i) => {
        picker.options[i].textContent = p.id + ' · ' + p.title;
      });
      dirty = true;
      revision++;
      go(index);
    });
    document.body.append(modal);
    $('button', modal).focus();
  }

  // ── 시작 ──
  // 만들 때 숨겨진 쪽(자체 슬라이드 CSS)을 드러낸다
  $$('.dk-source-page', doc).forEach((s) => {
    const c = getComputedStyle(s);
    if (c.display === 'none') s.style.setProperty('display', 'block', 'important');
    if (c.visibility !== 'visible') s.style.setProperty('visibility', 'visible', 'important');
    if (c.opacity === '0') s.style.setProperty('opacity', '1', 'important');
  });
  showPage(Number(location.hash.slice(1) || 1) - 1);
  pages.forEach((p) => markHosts(innerOf(p)));
  [noteKey, noteText].forEach((n) => {
    n.dataset.dkHost = '';
    n.spellcheck = false;
  });
  document.execCommand('styleWithCSS', false, true);
  $('#dk-save').addEventListener('click', save);
  editBtn.addEventListener('click', () => setEditing(!editing));
  resize();
  setEditing(true);
  setInterval(timer, 250);
  const ready = () =>
    Promise.all($$('img', doc).map((i) => (i.complete ? null : new Promise((r) => {
      i.addEventListener('load', r, {once: true});
      i.addEventListener('error', r, {once: true});
    })))).then(() => document.fonts.ready);
  ready().then(() => {
    resize();
    // 기준값은 처음 문서에서 한 번만 재고 파일에 함께 저장한다(넘친 채 저장해도 경고가 살아 있게)
    const stored = $('#dk-base').textContent.trim();
    if (stored) base = JSON.parse(stored);
    else {
      const was = index;
      base = atFullScale(() =>
        pages.map((s, i) => {
          pages.forEach((o, j) => o.classList.toggle('dk-active', j === i));
          return measurePage(s);
        }),
      );
      pages.forEach((o, j) => o.classList.toggle('dk-active', j === was));
    }
    checkOverflow();
    offerDraft();
    document.documentElement.dataset.dkReady = '1';
  });
  window.dkKit = {cleanHtml, go, state: () => ({index, reading, editing, dirty, pages: pages.length, book})};
})();
