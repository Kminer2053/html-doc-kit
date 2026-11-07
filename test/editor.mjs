// 편집기 시험: 실제 입력·단축키·서식·넘침·저장·임시 저장·회귀·그림 옮기기 (t2_edit + t4_regress 이식 + 그림 옮기기)
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {open, sleep} from './lib/cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'editor');
fs.mkdirSync(out, {recursive: true});
const SRC = path.join(here, 'out', 'golden', 'kit.html');
if (!fs.existsSync(SRC)) {
  console.log('SKIP 시험 대상 ' + SRC + ' 없음 (test/golden.mjs 먼저)');
  process.exit(0);
}
const COPY = path.join(out, 'work.html'); // 임시 저장 키가 문서 번호를 쓰므로 복사본으로 시험한다
fs.copyFileSync(SRC, COPY);

let fails = 0;
let passes = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  else passes++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== '' ? '  → ' + extra : ''));
};

const b = await open(1600, 1000);
const autoDialog = setInterval(async () => {
  const hit = b.events.findLast((e) => e.method === 'Page.javascriptDialogOpening' && !e.done);
  if (hit) {
    hit.done = true;
    await b.send('Page.handleJavaScriptDialog', {accept: true}).catch(() => {});
  }
}, 50);

const DRAFT = `'dk-draft:'+document.documentElement.dataset.docId+':'+document.documentElement.dataset.docRev`;
const ACTIVE = `.dk-page.dk-active`;
const findHost = (txt) => `[...document.querySelectorAll('${ACTIVE} [data-dk-host]')].find(h=>h.innerText.includes(${JSON.stringify(txt)}))`;
const caretEnd = (sel) => b.ev(`(()=>{const h=${sel};h.focus();const r=document.createRange();r.selectNodeContents(h);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);return 1})()`);
const rectOf = (sel) => b.ev(`(()=>{const e=${sel};const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,left:r.left,top:r.top,right:r.right,bottom:r.bottom}})()`);
const status = () => b.ev(`document.querySelector('#dk-status').textContent`);
const state = (expr) => b.ev(`dkKit.state().${expr}`);
const selectAll = () => b.key('a', 'KeyA', 65, 4);
const backspace = () => b.key('Backspace', 'Backspace', 8);
const esc = () => b.key('Escape', 'Escape', 27);
const settle = () => b.settle();
// 임시 저장(0.8초 뒤)에 글이 들어갈 때까지 최대 5초 기다린다. 고정 대기는 느린 기계에서 간헐 실패한다
const draftHas = (txt) => b.until(`(localStorage.getItem(${DRAFT})||'').includes(${JSON.stringify(txt)})`);
const ready = async () => {
  for (let i = 0; i < 100 && !(await b.ev(`document.documentElement.dataset.dkReady==='1'`)); i++) await sleep(50);
};
const reload = async () => {
  const n = b.events.length;
  await b.send('Page.reload', {ignoreCache: true});
  for (let i = 0; i < 200 && !b.events.slice(n).some((e) => e.method === 'Page.loadEventFired'); i++) await sleep(50);
  await sleep(500);
  await ready();
};
const drop = async () => {
  await b.ev(`document.querySelector('.dk-banner [data-a=drop]')?.click();1`);
  await sleep(100);
};
// 새 상태로 시작: 다른 곳으로 나갔다 들어와(같은 주소의 해시만 바꾸면 다시 열리지 않는다) 임시 저장을 버린다
const fresh = async (hash = '') => {
  await b.send('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false}).catch(() => {});
  await b.nav('about:blank');
  await b.nav(COPY, hash);
  await ready();
  await drop();
  await b.ev(`localStorage.clear();1`);
};
const recover = async (hash = '') => {
  try {
    await esc();
  } catch {}
  try {
    await fresh(hash);
  } catch (e) {
    console.log('   복구 실패 ' + e.message.slice(0, 120));
  }
};
const scenario = async (name, hash, fn) => {
  try {
    await fresh(hash);
    await fn();
  } catch (e) {
    check(name + ' (시험 중 오류)', false, String(e.message).slice(0, 300));
  }
  await recover();
};

// ───────────── t2: 입력·서식·저장 ─────────────
await scenario('입력·메모·제목·저장·다시 열기', '#15', async () => {
  check('시작 시 편집 켜짐', await b.ev(`document.body.classList.contains('dk-editing')&&document.querySelectorAll('[contenteditable=true]').length>500`), String(await b.ev(`document.querySelectorAll('[contenteditable=true]').length`)));

  // 1. 클릭해서 글자 치기
  const p = findHost('연간 실적');
  const r0 = await rectOf(p);
  await b.click(r0.x, r0.y);
  check('글자를 누르면 그 칸에 커서', await b.ev(`document.activeElement===${p}`));
  await caretEnd(p);
  await b.type(' 뷁쀍테스트');
  check('글자 입력', (await b.ev(`${p}.innerText`)).includes('뷁쀍테스트'));
  check('상태 표시 저장 안 됨', (await status()) === '저장 안 됨', await status());
  await sleep(400);
  const faces = await b.ev(`[...document.fonts].filter(f=>f.family==='DocKitFull').map(f=>f.weight+':'+f.status).join(',')`);
  check('새 글자에 예비 글꼴 사용', faces.includes('400:loaded'), faces);

  // 2. 칸 안에서는 단축키가 듣지 않음
  const idx0 = await state('index');
  await b.key('ArrowLeft', 'ArrowLeft', 37);
  await b.key('n', 'KeyN', 78, 0, 'n');
  check('칸 안에서 ← 는 쪽을 넘기지 않음', (await state('index')) === idx0);
  check('칸 안에서 n 은 메모를 열지 않고 글자로 들어감', (await b.ev(`document.querySelector('.dk-speaker').hidden`)) && (await b.ev(`${p}.innerText`)).includes('n'));
  await backspace();

  // 3. Enter 는 줄바꿈만
  const kids = await b.ev(`${p}.parentElement.children.length`);
  await b.key('Enter', 'Enter', 13, 0, '\r');
  await b.type('둘째 줄');
  const html = await b.ev(`${p}.innerHTML`);
  check('Enter 는 줄바꿈', html.includes('<br>') && !/<(div|p)[ >]/.test(html) && (await b.ev(`${p}.parentElement.children.length`)) === kids, html.slice(-60));

  // 4. Esc 뒤에는 단축키 복귀
  await esc();
  check('Esc 로 칸에서 나옴', await b.ev(`document.activeElement===document.body`));
  await b.key('ArrowLeft', 'ArrowLeft', 37);
  check('칸 밖에서 ← 쪽 이동', (await state('index')) === 13, String(await state('index')));
  await b.key('ArrowRight', 'ArrowRight', 39);
  check('다시 15쪽', (await state('index')) === 14);
  check('쪽을 넘겨도 고친 글자 유지', await b.ev(`${findHost('둘째 줄')}!=null`));
  await b.key('ㅜ', 'KeyN', 78, 0, 'ㅜ');
  check('한글 입력 상태에서도 N 으로 메모 열림', !(await b.ev(`document.querySelector('.dk-speaker').hidden`)));

  // 5. 발표 메모 고치기
  const note = `document.querySelector('#dk-note-text')`;
  await caretEnd(note);
  await b.type(' 메모추가문장');
  check('메모 고침이 자료에 반영', await b.ev(`dkKit.state().book.pages[14].notes.endsWith('메모추가문장')`));
  await esc();
  await b.ev('dkKit.go(13);dkKit.go(14);1');
  check('쪽을 다녀와도 메모 유지', await b.ev(`${note}.textContent.endsWith('메모추가문장')`));
  await b.key('ㅜ', 'KeyN', 78, 0, 'ㅜ');

  // 8. 제목
  const h1 = `document.querySelector('${ACTIVE} .page-header h1')`;
  await caretEnd(h1);
  await b.type('(수정)');
  check('제목이 쪽 목록·자료에 반영', await b.ev(`document.querySelector('#dk-picker').options[14].textContent.endsWith('(수정)')&&dkKit.state().book.pages[14].title.endsWith('(수정)')`));
  await esc();

  // 12. 저장 경로
  await b.ev('dkKit.go(14);1');
  await b.ev(`(()=>{window.__w=[];window.__picks=0;window.showSaveFilePicker=async(o)=>{window.__picks++;window.__name=o.suggestedName;return {createWritable:async()=>({write:async(x)=>window.__w.push(x),close:async()=>{}})}};return 1})()`);
  await b.ev(`document.querySelector('#dk-save').click();new Promise(r=>setTimeout(r,200))`);
  check('저장 → 저장됨 표시', (await status()).startsWith('저장됨'), (await status()) + ' / ' + (await b.ev(`window.__name`)));
  await caretEnd(p);
  await b.type('!');
  await b.key('s', 'KeyS', 83, 4); // ⌘S
  await sleep(250);
  check('⌘S 로 같은 파일에 다시 저장(다시 묻지 않음)', await b.ev(`window.__picks===1&&window.__w.length===2`), await b.ev(`window.__picks+'/'+window.__w.length`));
  await esc();
  const saved = await b.ev(`window.__w[1]`);
  fs.writeFileSync(path.join(out, 'saved1.html'), saved);
  check('저장 뒤 임시 저장 지움', await b.ev(`localStorage.getItem(${DRAFT})===null`));

  // 13. 저장 파일 다시 열기
  const body = saved.slice(saved.indexOf('<body'), saved.indexOf('<script id="dk-book"'));
  check('저장 파일 본문에 편집 표시 없음', !/contenteditable|data-dk-host|data-dk-deco|data-scene-element|dk-over|dk-bad|spellcheck/.test(body), (body.match(/contenteditable|data-dk-host|data-dk-deco|data-scene-element|dk-over|dk-bad|spellcheck/) || [''])[0]);
  check('저장 파일에 편집 막대 없음', !/class="dk-ui/.test(body));
  await b.nav('about:blank');
  await b.nav(path.join(out, 'saved1.html'), '#15');
  await ready();
  await drop();
  check('다시 열면 고친 글자 유지', await b.ev(`${findHost('둘째 줄')}!=null&&${findHost('뷁쀍테스')}!=null`));
  check('다시 열면 제목·메모 유지', await b.ev(`document.querySelector('#dk-picker').options[14].textContent.endsWith('(수정)')&&dkKit.state().book.pages[14].notes.endsWith('메모추가문장')`));
  check('다시 열어도 편집 켜짐', await b.ev(`document.body.classList.contains('dk-editing')&&document.querySelectorAll('[contenteditable=true]').length>500`));
  const again = await b.ev(`dkKit.cleanHtml()`);
  check('다시 저장해도 파일이 그대로(찌꺼기 안 쌓임)', again === saved, again.length + ' vs ' + saved.length);
  if (again !== saved) {
    let i = 0;
    while (again[i] === saved[i]) i++;
    console.log('   첫 차이', JSON.stringify(saved.slice(Math.max(0, i - 60), i + 80)), '\n   ↔', JSON.stringify(again.slice(Math.max(0, i - 60), i + 80)));
  }
});

await scenario('붙여넣기', '#15', async () => {
  const q = findHost('PMI 용역결과');
  await caretEnd(q);
  await b.ev(`(()=>{const dt=new DataTransfer();dt.setData('text/html','<h1 style="color:red">큰제목</h1>');dt.setData('text/plain','붙임첫줄\\n붙임둘째');const h=${q};return h.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))})()`);
  const qh = await b.ev(`${q}.innerHTML`);
  check('붙여넣기 서식 제거', qh.includes('붙임첫줄') && qh.includes('붙임둘째') && !qh.includes('<h1') && !qh.includes('color:red'), qh.slice(-50));
});

await scenario('서식 막대', '#15', async () => {
  const t = findHost('외부 전문성으로');
  await b.ev(`(()=>{const h=${t};const n=[...h.childNodes].find(x=>x.nodeType===3&&x.nodeValue.length>8)||h.firstChild.firstChild||h.firstChild;h.focus();const r=document.createRange();r.setStart(n,2);r.setEnd(n,6);const s=getSelection();s.removeAllRanges();s.addRange(r);return s.toString()})()`);
  await sleep(150);
  const barRect = await b.ev(`(()=>{const e=document.querySelector('.dk-float:not([hidden])');if(!e)return null;const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}})()`);
  const selRect = await b.ev(`(()=>{const r=getSelection().getRangeAt(0).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}})()`);
  check('글자를 고르면 서식 막대가 화면 안에', barRect && barRect.left >= 0 && barRect.right <= 1600 && barRect.top >= 0, JSON.stringify(barRect));
  check('막대가 고른 글자 근처', barRect && Math.abs(barRect.bottom - selRect.top) < 40, JSON.stringify(selRect));
  const clickBar = async (sel) => {
    const r = await rectOf(`document.querySelector('.dk-float:not([hidden]) ${sel}')`);
    await b.click(r.x, r.y);
    await sleep(80);
  };
  await clickBar('[data-cmd=bold]');
  let th = await b.ev(`${t}.innerHTML`);
  check('굵게는 style 로(블록 CSS 영향 없음)', /font-weight/.test(th), th.slice(0, 120));
  check('굵게 뒤에도 글자 선택 유지', (await b.ev(`getSelection().toString().length`)) > 0);
  await clickBar('[data-size="1.1"]');
  th = await b.ev(`${t}.innerHTML`);
  check('글자 크게(굵게 유지·숫자 커짐)', /font-weight/.test(th) && /font-size:\s*[\d.]+px/.test(th) && !th.includes('xxx-large') && !/<font/.test(th), th.slice(0, 160));
  const px1 = await b.ev(`parseFloat(getComputedStyle(getSelection().anchorNode.parentElement).fontSize)`);
  await clickBar('[data-size="1.1"]');
  const px2 = await b.ev(`parseFloat(getComputedStyle(getSelection().anchorNode.parentElement).fontSize)`);
  check('한 번 더 누르면 더 커짐', px2 > px1 * 1.05, px1 + ' → ' + px2);
  await clickBar('[data-size="0.9"]');
  check('크게 뒤에도 글자 선택 유지', (await b.ev(`getSelection().toString().length`)) > 0);
  check('임시 표시 남지 않음', !th.includes('data-dk-sel') && !th.includes('data-ed-sel'));
  await clickBar('[data-color="#c92a2a"]');
  th = await b.ev(`${t}.innerHTML`);
  check('글자색', /rgb\(201,\s*42,\s*42\)|#c92a2a/i.test(th), th.slice(0, 200));
});

await scenario('넘침 경고', '#15', async () => {
  const longHost = findHost('연 1회 운영성과');
  await caretEnd(longHost);
  await b.type(' 아주 긴 글을 넣어 칸을 넘치게 합니다.'.repeat(60));
  await sleep(300);
  const st = await status();
  check('넘치면 경고', st.includes('넘침') && (await b.ev(`document.querySelector('${ACTIVE}').classList.contains('dk-over')`)), st);
  await b.ev(`document.execCommand('undo');1`);
  await sleep(300);
  const st2 = await status();
  check('되돌리면 경고 사라짐', !st2.includes('넘침') && !(await b.ev(`document.querySelector('${ACTIVE}').classList.contains('dk-over')`)), st2);
  const scrolled = await b.ev(`[document.querySelector('${ACTIVE}'),...document.querySelectorAll('${ACTIVE} *')].filter(e=>e.scrollTop||e.scrollLeft).length`);
  check('되돌리면 장표가 제자리로', scrolled === 0, String(scrolled));
});

await scenario('한글 조합 입력', '#15', async () => {
  const k = findHost('자문단을 운영하고');
  await caretEnd(k);
  const before = await b.ev(`${k}.innerText`);
  for (const c of ['ㅎ', '하', '한']) {
    await b.send('Input.imeSetComposition', {text: c, selectionStart: c.length, selectionEnd: c.length});
    await sleep(30);
  }
  await b.type('한');
  await b.send('Input.imeSetComposition', {text: 'ㄱ', selectionStart: 1, selectionEnd: 1});
  await sleep(30);
  await b.type('글');
  await sleep(50);
  const after = await b.ev(`${k}.innerText`);
  check('한글 조합이 중복 없이 들어감', after === before + '한글', after.slice(-12));
});

await scenario('편집 끄기', '#15', async () => {
  await b.key('e', 'KeyE', 69, 0, 'e');
  check('E 로 편집 끄기', (await b.ev(`document.querySelectorAll('[contenteditable=true]').length`)) === 0 && !(await b.ev(`document.body.classList.contains('dk-editing')`)));
  await b.key('ㄷ', 'KeyE', 69, 0, 'ㄷ');
  check('한글 입력 상태에서도 E 로 다시 켜짐', await b.ev(`document.body.classList.contains('dk-editing')`));
});

await scenario('내려받기 저장', '#15', async () => {
  const dl = path.join(out, 'dl');
  fs.rmSync(dl, {recursive: true, force: true});
  fs.mkdirSync(dl);
  await b.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: dl});
  await b.ev(`window.showSaveFilePicker=undefined;document.querySelector('#dk-save').click();1`);
  for (let i = 0; i < 60 && !fs.readdirSync(dl).some((f) => f.endsWith('.html')); i++) await sleep(100);
  const got = fs.readdirSync(dl);
  check('내려받기로 저장', got.length === 1 && got[0] === 'work.html', got.join(','));
  check('내려받음 표시', (await status()).startsWith('내려받음'), await status());
});

await scenario('임시 저장 되살리기', '#15', async () => {
  const p2 = findHost('연간 실적');
  await caretEnd(p2);
  await b.type('임시저장시험');
  await draftHas('임시저장시험');
  check('입력 뒤 임시 저장', await b.ev(`localStorage.getItem(${DRAFT})!==null`));
  await reload();
  check('다시 열면 불러오기 안내', await b.ev(`document.querySelector('.dk-banner')!=null`));
  await b.ev(`document.querySelector('.dk-banner [data-a=load]').click();1`);
  await sleep(100);
  check('불러오기로 되살림', await b.ev(`${findHost('임시저장시험')}!=null&&${findHost('임시저장시험')}.isContentEditable`));
  check('되살린 뒤 저장 안 됨 표시', (await status()) === '저장 안 됨', await status());
  await reload();
  await b.ev(`document.querySelector('.dk-banner [data-a=drop]').click();1`);
  await reload();
  check('버리기 뒤 안내 없음', await b.ev(`document.querySelector('.dk-banner')==null&&${findHost('임시저장시험')}==null`));
});

// R11: 임시 저장 기다리기는 고정 대기가 아니라 짧게 반복 확인한다
await scenario('시험 도우미: 늦게 참이 되는 조건을 끝까지 기다림', '#15', async () => {
  await b.ev(`window.__late=0;setTimeout(()=>window.__late=1,1500);1`);
  const t0 = Date.now();
  const got = await b.until(`window.__late===1`);
  const took = Date.now() - t0;
  check('R11 1.5초 뒤 참이 되는 조건을 놓치지 않음', got === true && took >= 1400 && took < 4000, `${got} ${took}ms`);
  const t1 = Date.now();
  const never = await b.until(`false`, 300);
  check('R11 끝내 거짓이면 정한 시간 뒤 false', never === false && Date.now() - t1 < 2000, `${never} ${Date.now() - t1}ms`);
  const p = findHost('연간 실적');
  await caretEnd(p);
  await b.type('반복확인');
  check('R11 입력 뒤 임시 저장을 5초 안에 확인', await draftHas('반복확인'));
});

await scenario('표지 그림 바꾸기 버튼', '#1', async () => {
  await b.ev('dkKit.go(0);1');
  await settle();
  const img = await rectOf(`document.querySelector('${ACTIVE} img')`);
  await b.click(img.x, img.y);
  await sleep(80);
  check('표지 그림을 누르면 그림 바꾸기 버튼', await b.ev(`[...document.querySelectorAll('.dk-float:not([hidden]) button')].some(x=>x.textContent==='그림 바꾸기')`));
});

// ───────────── t4: 회귀 ─────────────
await scenario('12쪽 표 거짓 경고', '#12', async () => {
  const d3 = findHost('외부연계 데이터 자산화');
  await caretEnd(d3);
  await b.type(' 및 표준화 작업 강화');
  await sleep(250);
  check('12쪽 표 둘째 행이 두 줄이 돼도 거짓 경고 없음', !(await status()).includes('넘침'), await status());
});

await scenario('3쪽 아이콘', '#3', async () => {
  // 새 키트는 아이콘이 글자 칸 바깥 형제이면 칸에 넣지 않는다. 글자를 지워도 아이콘이 남고 다시 쓸 수 있어야 한다
  const head = `document.querySelector('${ACTIVE} .stakeholder-head')`;
  const hostSel = `${head}.querySelector('[data-dk-host]')`;
  await b.ev(`(${hostSel}).focus();1`);
  await selectAll();
  await backspace();
  check('3쪽 글자 지워도 아이콘 유지', await b.ev(`(()=>{const h=${head};return !!h.querySelector('svg')&&h.querySelector('[data-dk-host]').hasAttribute('data-dk-empty')})()`));
  await b.type('새 이름');
  const hv = await b.ev(`(()=>{const h=${head};return {svg:!!h.querySelector('svg'),txt:h.querySelector('[data-dk-host]').innerText,empty:h.querySelector('[data-dk-host]').hasAttribute('data-dk-empty')}})()`);
  check('3쪽 다시 쓰면 아이콘 + 글자', hv.svg && hv.txt.includes('새 이름') && !hv.empty, JSON.stringify(hv));
});

await scenario('14쪽 화살표', '#14', async () => {
  const arrow = await rectOf(`[...document.querySelectorAll('${ACTIVE} [data-dk-deco],${ACTIVE} [data-dk-host]')].find(e=>e.textContent.includes('↔'))`);
  await b.click(arrow.x, arrow.y);
  await b.type('Q글');
  const arrowHost = await b.ev(`(()=>{const h=${findHost('Q글')};return h?h.innerHTML:''})()`);
  check('14쪽 화살표를 눌러도 글자가 버려지지 않음', arrowHost.includes('Q글') && arrowHost.includes('↔'), arrowHost.slice(0, 90));
});

await scenario('라벨+문단 칸 비운 뒤 불러오기', '#4', async () => {
  const para = `[...document.querySelectorAll('${ACTIVE} [data-dk-host]')].find(h=>h.tagName==='P')`;
  const hostsBefore = await b.ev(`document.querySelectorAll('${ACTIVE} [data-dk-host]').length`);
  await b.ev(`(${para}).focus();1`);
  await selectAll();
  await backspace();
  await sleep(1000);
  await reload();
  await b.ev(`document.querySelector('.dk-banner [data-a=load]').click();1`);
  await sleep(200);
  const hostsAfter = await b.ev(`document.querySelectorAll('${ACTIVE} [data-dk-host]').length`);
  check('비운 문단을 불러와도 칸 수 그대로', hostsAfter === hostsBefore, hostsBefore + ' → ' + hostsAfter);
  const er = await rectOf(`document.querySelector('${ACTIVE} p[data-dk-empty]')`);
  await b.click(er.x, er.y);
  await b.type('되살림');
  check('그 자리에 다시 쓰기', await b.ev(`(()=>{const p=[...document.querySelectorAll('${ACTIVE} p')].find(x=>x.innerText.includes('되살림'));return !!p&&!p.hasAttribute('data-dk-empty')})()`));
});

await scenario('비운 가로 배치 칸', '#2', async () => {
  const flex = findHost('대내외 환경');
  await b.ev(`(${flex}).focus();1`);
  const isFlex = await b.ev(`getComputedStyle(${flex}).display`);
  await selectAll();
  await backspace();
  const dispEmpty = await b.ev(`getComputedStyle(document.activeElement).display`);
  check('비워도 가로 배치 유지', dispEmpty === isFlex, isFlex + ' → ' + dispEmpty);
  await b.key('Enter', 'Enter', 13, 0, '\r');
  await b.type('새글');
  const fh = await b.ev(`document.activeElement.innerHTML`);
  check('비운 가로 배치 칸도 Enter 무시', !/<br>새글/.test(fh), fh);
});

await scenario('임시 저장 창 뒤로 키가 새지 않음', '#3', async () => {
  await caretEnd(`document.querySelector('${ACTIVE} .page-header h1')`);
  await b.type('임시');
  await draftHas('임시');
  await reload();
  const i0 = await state('index');
  await b.key('ArrowRight', 'ArrowRight', 39);
  await b.key('ㅜ', 'KeyN', 78, 0, 'ㅜ');
  await b.key('ㄱ', 'KeyR', 82, 0, 'ㄱ');
  check('임시 저장 창이 떠 있으면 단축키 막힘', (await state('index')) === i0 && (await b.ev(`document.querySelector('.dk-speaker').hidden&&!document.body.classList.contains('dk-reading')`)), String(await state('index')));
});

await scenario('연속 읽기', '#7', async () => {
  await b.ev(`document.querySelector('#dk-read').click();1`);
  await sleep(200);
  await b.key('ㅜ', 'KeyN', 78, 0, 'ㅜ');
  await sleep(300);
  const seen = await b.ev(`(()=>{const t=document.querySelector('#dk-viewport').getBoundingClientRect().top;return [...document.querySelectorAll('.dk-page')].findIndex(s=>s.getBoundingClientRect().bottom>t+50)})()`);
  check('연속 읽기에서 메모를 열어도 보이는 쪽과 메모가 같음', seen === (await state('index')) && (await state('index')) === 6, `${seen} / ${await state('index')}`);
  await b.key('ㅜ', 'KeyN', 78, 0, 'ㅜ');
  await sleep(200);
  await b.key('ArrowRight', 'ArrowRight', 39);
  await sleep(300);
  check('→ 는 다음 쪽으로', (await state('index')) === 7, String(await state('index')));
  await b.ev(`document.querySelector('#dk-read').click();dkKit.go(0);1`);
  await b.send('Emulation.setDeviceMetricsOverride', {width: 800, height: 1000, deviceScaleFactor: 1, mobile: false});
  await sleep(200);
  await b.ev(`document.querySelector('#dk-read').click();1`);
  await sleep(300);
  const seq = [];
  for (let i = 0; i < 5; i++) {
    await b.key('ArrowRight', 'ArrowRight', 39);
    await sleep(250);
    seq.push((await state('index')) + 1);
  }
  check('세로로 긴 창에서 → 가 한 쪽씩', seq.join() === '2,3,4,5,6', seq.join());
});

await scenario('진짜 넘침은 잡는다', '#5', async () => {
  const circle = `[...document.querySelectorAll('${ACTIVE} [data-dk-host]')].find(h=>h.innerText.trim()==='1')`;
  await caretEnd(circle);
  await b.type(' 1 1');
  await sleep(250);
  check('5쪽 숫자 원을 벗어나면 경고', (await status()).includes('넘침'), await status());
  await esc();
  await b.ev('dkKit.go(5);1');
  await sleep(150);
  check('다른 쪽에 있어도 넘친 쪽을 알림', (await status()).includes('5쪽 넘침'), await status());
  await b.ev('dkKit.go(4);1');
  await sleep(150);
  await b.ev(`(()=>{const h=[...document.querySelectorAll('${ACTIVE} [data-dk-host]')].find(h=>h.innerText.includes('1 1 1'));h.textContent='1';h.dispatchEvent(new InputEvent('input',{bubbles:true}));return 1})()`);
  await sleep(250);
  await b.ev('dkKit.go(14);1');
  await sleep(150);
  check('손대지 않은 쪽 경고 없음', !(await status()).includes('넘침'), await status());
});

await scenario('지우기 되돌리기·메모 단추', '#15', async () => {
  const band = findHost('외부 전문성으로');
  await b.ev(`(()=>{const h=${band};h.focus();const n=[...h.childNodes].find(x=>x.nodeType===3&&x.nodeValue.length>8)||h.firstChild;const r=document.createRange();r.setStart(n,2);r.setEnd(n,6);const s=getSelection();s.removeAllRanges();s.addRange(r);return 1})()`);
  await sleep(120);
  const clickBar = async (sel) => {
    const r = await rectOf(`document.querySelector('.dk-float:not([hidden]) ${sel}')`);
    await b.click(r.x, r.y);
    await sleep(80);
  };
  await clickBar('[data-color="#c92a2a"]');
  const colored = await b.ev(`(${band}).innerHTML`);
  await clickBar('[data-cmd=removeFormat]');
  const cleared = await b.ev(`(${band}).innerHTML`);
  await b.ev(`document.execCommand('undo');1`);
  await sleep(80);
  const undone = await b.ev(`(${band}).innerHTML`);
  check('지우기 뒤 ⌘Z 로 되돌림', /rgb\(201/.test(colored) && !/rgb\(201/.test(cleared) && /rgb\(201/.test(undone), cleared.slice(0, 60));
  await b.ev(`document.querySelector('#dk-notes').click();1`);
  await sleep(100);
  const hidden = await b.ev(`[...document.querySelectorAll('.dk-float')].every(x=>x.hidden)`);
  await b.ev(`document.querySelector('#dk-notes').click();1`);
  check('메모 단추를 눌러도 막대 안 남음', hidden);
});

// ───────────── 새 기능: 그림 옮기기 ─────────────
const dragHelpers = () => {
  const IMG = `document.querySelector('${ACTIVE} img')`;
  const drag = async (dx, dy, steps = 8) => {
    const r = await rectOf(IMG);
    const x = r.x;
    const y = r.y;
    await b.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y});
    await b.send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1});
    for (let i = 1; i <= steps; i++) {
      await b.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: x + (dx * i) / steps, y: y + (dy * i) / steps, button: 'left', buttons: 1});
      await sleep(15);
    }
    await b.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', buttons: 0, clickCount: 1});
    await sleep(120);
  };
  const hostRects = () => b.ev(`JSON.stringify([...document.querySelectorAll('${ACTIVE} [data-dk-host]')].map(h=>{const r=h.getBoundingClientRect();return [r.left,r.top,r.width,r.height].map(v=>Math.round(v*10)/10)}))`);
  const barOpen = () => b.ev(`[...document.querySelectorAll('.dk-float')].some(x=>!x.hidden)`);
  const translate = () => b.ev(`${IMG}.style.translate`);
  return {IMG, drag, hostRects, barOpen, translate};
};

await scenario('그림 옮기기: 끌기·배치·제자리로', '#1', async () => {
  await b.ev('dkKit.go(0);1');
  await settle();
  const {IMG, drag, hostRects, barOpen, translate} = dragHelpers();
  const hasImg = await b.ev(`!!${IMG}`);
  check('1쪽에 그림이 있음', hasImg);
  if (!hasImg) return;
  const rectsBefore = await hostRects();
  const imgBefore = await rectOf(IMG);
  await drag(60, 40);
  const tr = await translate();
  check('끌면 translate 가 생김', tr !== '', JSON.stringify(tr));
  const imgAfter = await rectOf(IMG);
  const mx = imgAfter.left - imgBefore.left;
  const my = imgAfter.top - imgBefore.top;
  check('그림이 오른쪽 아래로 옮겨짐', mx > 20 && my > 10, `${mx},${my}`);
  check('그림이 마우스를 따라 같은 거리만 옮겨짐(±3px)', Math.abs(mx - 60) <= 3 && Math.abs(my - 40) <= 3, `마우스 60,40 / 그림 ${mx.toFixed(1)},${my.toFixed(1)} / translate ${tr} / 쪽 배율 ${await b.ev(`getComputedStyle(document.querySelector('${ACTIVE}')).getPropertyValue('--dk-scale')`)}`);
  check('옮겨도 글자 칸 배치 그대로', (await hostRects()) === rectsBefore);
  check('끈 뒤에는 막대가 열리지 않음(클릭으로 번지지 않음)', !(await barOpen()));

  // 눌렀다 떼기만: 막대와 제자리로
  const c = await rectOf(IMG);
  await b.click(c.x, c.y);
  await sleep(100);
  const hasHome = await b.ev(`[...document.querySelectorAll('.dk-float:not([hidden]) button')].some(x=>x.textContent.includes('제자리로'))`);
  check('그냥 누르면 막대에 제자리로', hasHome);
  const homeBtn = await rectOf(`[...document.querySelectorAll('.dk-float:not([hidden]) button')].find(x=>x.textContent.includes('제자리로'))`).catch(() => null);
  if (homeBtn) {
    await b.click(homeBtn.x, homeBtn.y);
    await sleep(100);
  }
  check('제자리로를 누르면 translate 지워짐', (await translate()) === '', JSON.stringify(await translate()));
  const back = await rectOf(IMG);
  check('원래 자리로 돌아옴', Math.abs(back.left - imgBefore.left) < 1.5 && Math.abs(back.top - imgBefore.top) < 1.5, `${back.left},${back.top} vs ${imgBefore.left},${imgBefore.top}`);
  check('제자리로 뒤에도 글자 칸 배치 그대로', (await hostRects()) === rectsBefore);
});

await scenario('그림 옮기기: 쪽 밖으로 못 나감', '#1', async () => {
  await b.ev('dkKit.go(0);1');
  await settle();
  const {IMG, drag} = dragHelpers();
  const page = await rectOf(`document.querySelector('${ACTIVE}')`);
  const within = (r) => r.left >= page.left - 1 && r.top >= page.top - 1 && r.right <= page.right + 1 && r.bottom <= page.bottom + 1;
  const fmt = (r) => `img ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)} / page ${Math.round(page.left)},${Math.round(page.top)},${Math.round(page.right)},${Math.round(page.bottom)} / translate ${''}`;
  await drag(4000, 3000, 12);
  let far = await rectOf(IMG);
  check('오른쪽 아래로 멀리 끌어도 쪽 안', within(far), fmt(far) + (await b.ev(`${IMG}.style.translate`)));
  await fresh('#1');
  await b.ev('dkKit.go(0);1');
  await settle();
  await drag(-4000, -3000, 12);
  far = await rectOf(IMG);
  check('왼쪽 위로 멀리 끌어도 쪽 안', within(far), fmt(far) + (await b.ev(`${IMG}.style.translate`)));
});

await scenario('그림 옮기기: 저장 뒤 다시 열기', '#1', async () => {
  await b.ev('dkKit.go(0);1');
  await settle();
  const {IMG, drag, translate} = dragHelpers();
  await drag(60, 40);
  const trSaved = await translate();
  const movedRect = await rectOf(IMG);
  const html = await b.ev(`dkKit.cleanHtml()`);
  const file = path.join(out, 'moved.html');
  fs.writeFileSync(file, html);
  await b.nav('about:blank');
  await b.nav(file, '#1');
  await ready();
  await drop();
  const trAfter = await b.ev(`document.querySelector('.dk-page img').style.translate`);
  check('옮긴 위치가 저장 파일에 남음', trSaved !== '' && html.includes('translate'), trSaved);
  const reopened = await rectOf(`document.querySelector('${ACTIVE} img')`);
  check('다시 열어도 같은 위치', trAfter === trSaved && Math.abs(reopened.left - movedRect.left) < 1.5 && Math.abs(reopened.top - movedRect.top) < 1.5, `${trAfter} / ${trSaved}`);
  const again = await b.ev(`dkKit.cleanHtml()`);
  check('옮긴 뒤 다시 저장해도 파일이 그대로', again === html, again.length + ' vs ' + html.length);
});

clearInterval(autoDialog);
await b.close();
console.log(fails ? `\n실패 ${fails}건 (통과 ${passes}건)` : `\n모두 통과 (${passes}건)`);
process.exit(fails ? 1 : 0);
