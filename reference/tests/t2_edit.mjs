// 시험 2: 실제 입력·단축키·서식·넘침·저장·임시 저장
import fs from 'node:fs';
import {open, sleep} from './cdp.mjs';
const here = new URL('.', import.meta.url).pathname;
const EDIT = '/Users/hoonsbook/AX2030/outputs/AX2030_본부장회의_요약기반_15p_v6_편집용.html';
const COPY = here + 'work.html'; // 임시 저장 키가 파일 경로를 쓰므로 복사본으로 시험한다
fs.copyFileSync(EDIT, COPY);
let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''));
};
const b = await open(1600, 1000);
// 나갈 때 뜨는 확인 창은 자동으로 넘긴다
const autoDialog = setInterval(async () => {
  const hit = b.events.findLast((e) => e.method === 'Page.javascriptDialogOpening' && !e.done);
  if (hit) {
    hit.done = true;
    await b.send('Page.handleJavaScriptDialog', {accept: true}).catch(() => {});
  }
}, 50);
const rectOf = (sel) => b.ev(`(()=>{const e=${sel};e.scrollIntoView&&0;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,left:r.left,top:r.top,right:r.right,bottom:r.bottom}})()`);
const findHost = (txt) => `[...document.querySelectorAll('.slide.active [data-ed]')].find(h=>h.innerText.includes(${JSON.stringify(txt)}))`;
const caretEnd = (sel) => b.ev(`(()=>{const h=${sel};h.focus();const r=document.createRange();r.selectNodeContents(h);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);return 1})()`);

await b.nav(COPY, '#15');
check('시작 시 편집 켜짐', await b.ev(`document.body.classList.contains('ed-on')&&document.querySelectorAll('[contenteditable=true]').length>500`), String(await b.ev(`document.querySelectorAll('[contenteditable=true]').length`)));

// 1. 클릭해서 글자 치기(장표에 없던 글자 포함)
const p = findHost('연간 실적');
const r0 = await rectOf(p);
await b.click(r0.x, r0.y);
check('글자를 누르면 그 칸에 커서', await b.ev(`document.activeElement===${p}`));
await caretEnd(p);
await b.type(' 뷁쀍테스트');
check('글자 입력', (await b.ev(`${p}.innerText`)).includes('뷁쀍테스트'));
check('상태 표시 저장 안 됨', (await b.ev(`document.querySelector('#ed-status').textContent`)) === '저장 안 됨');
await sleep(400);
const faces = await b.ev(`[...document.fonts].filter(f=>f.family==='ReportNotoFull').map(f=>f.weight+':'+f.status).join(',')`);
check('새 글자에 예비 글꼴 사용', faces.includes('400:loaded'), faces);
await b.shot(here + 's_typed.png');

// 2. 글자 칸 안에서는 단축키가 듣지 않음
const idx0 = await b.ev('index');
await b.key('ArrowLeft', 'ArrowLeft', 37);
await b.key('n', 'KeyN', 78, 0, 'n');
check('칸 안에서 ← 는 쪽을 넘기지 않음', (await b.ev('index')) === idx0);
check('칸 안에서 n 은 메모를 열지 않고 글자로 들어감', (await b.ev(`document.querySelector('#speaker').hidden`)) && (await b.ev(`${p}.innerText`)).includes('n'));
await b.key('Backspace', 'Backspace', 8);

// 3. Enter 는 줄바꿈만(칸 구조 유지)
const kids = await b.ev(`${p}.parentElement.children.length`);
await b.key('Enter', 'Enter', 13, 0, '\r');
await b.type('둘째 줄');
const html = await b.ev(`${p}.innerHTML`);
check('Enter 는 줄바꿈', html.includes('<br>') && !/<(div|p)[ >]/.test(html) && (await b.ev(`${p}.parentElement.children.length`)) === kids, html.slice(-60));

// 4. Esc 뒤에는 단축키 복귀
await b.key('Escape', 'Escape', 27);
check('Esc 로 칸에서 나옴', (await b.ev(`document.activeElement===document.body`)));
await b.key('ArrowLeft', 'ArrowLeft', 37);
check('칸 밖에서 ← 쪽 이동', (await b.ev('index')) === 13);
await b.key('ArrowRight', 'ArrowRight', 39);
check('다시 15쪽', (await b.ev('index')) === 14);
check('쪽을 넘겨도 고친 글자 유지', (await b.ev(`${findHost('둘째 줄')}!=null`)));
await b.key('ㅜ', 'KeyN', 78, 0, 'ㅜ');
check('한글 입력 상태에서도 N 으로 메모 열림', !(await b.ev(`document.querySelector('#speaker').hidden`)));

// 5. 발표 메모 고치기
const note = `document.querySelector('#note-text')`;
await caretEnd(note);
await b.type(' 메모추가문장');
check('메모 고침이 자료에 반영', (await b.ev(`BOOK.pages[14].narration.endsWith('메모추가문장')&&BOOK.pages[14].notes.endsWith('메모추가문장')`)));
await b.key('Escape', 'Escape', 27);
await b.ev('go(13);go(14);1');
check('쪽을 다녀와도 메모 유지', (await b.ev(`${note}.textContent.endsWith('메모추가문장')`)));
await b.key('ㅜ', 'KeyN', 78, 0, 'ㅜ');

// 6. 붙여넣기는 글자만
const q = findHost('PMI 용역결과');
await caretEnd(q);
await b.ev(`(()=>{const dt=new DataTransfer();dt.setData('text/html','<h1 style="color:red">큰제목</h1>');dt.setData('text/plain','붙임첫줄\\n붙임둘째');const h=${q};return h.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))})()`);
const qh = await b.ev(`${q}.innerHTML`);
check('붙여넣기 서식 제거', qh.includes('붙임첫줄') && qh.includes('붙임둘째') && !qh.includes('<h1') && !qh.includes('color:red'), qh.slice(-50));

// 7. 서식 막대
const t = findHost('외부 전문성으로');
await b.ev(`(()=>{const h=${t};const n=[...h.childNodes].find(x=>x.nodeType===3&&x.nodeValue.length>8)||h.firstChild.firstChild||h.firstChild;h.focus();const r=document.createRange();r.setStart(n,2);r.setEnd(n,6);const s=getSelection();s.removeAllRanges();s.addRange(r);return s.toString()})()`);
await sleep(150);
const barRect = await b.ev(`(()=>{const e=document.querySelector('.ed-bar:not([hidden])');if(!e)return null;const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}})()`);
const selRect = await b.ev(`(()=>{const r=getSelection().getRangeAt(0).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}})()`);
check('글자를 고르면 서식 막대가 화면 안에', barRect && barRect.left >= 0 && barRect.right <= 1600 && barRect.top >= 0, JSON.stringify(barRect));
check('막대가 고른 글자 근처', barRect && Math.abs(barRect.bottom - selRect.top) < 40, JSON.stringify(selRect));
await b.shot(here + 's_bar.png');
const clickBar = async (sel) => {
  const r = await rectOf(`document.querySelector('.ed-bar ${sel}')`);
  await b.click(r.x, r.y);
  await sleep(80);
};
await clickBar('[data-cmd=bold]');
let th = await b.ev(`${t}.innerHTML`);
check('굵게는 style 로(블록 CSS 영향 없음)', /font-weight:\s*(bold|700)/.test(th) || /font-weight/.test(th), th.slice(0, 120));
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
check('임시 표시 남지 않음', !th.includes('data-ed-sel'));
await clickBar('[data-color="#c92a2a"]');
th = await b.ev(`${t}.innerHTML`);
check('글자색', /rgb\(201,\s*42,\s*42\)|#c92a2a/i.test(th), th.slice(0, 200));
await b.key('Escape', 'Escape', 27);

// 8. 제목 고치면 목록·메모 제목도 같이
const h1 = `document.querySelector('.slide.active .page-header h1')`;
await caretEnd(h1);
await b.type('(수정)');
check('제목이 쪽 목록·자료에 반영', (await b.ev(`document.querySelector('#picker').options[14].textContent.endsWith('(수정)')&&BOOK.pages[14].title.endsWith('(수정)')`)));
await b.key('Escape', 'Escape', 27);

// 9. 넘침 경고
const longHost = findHost('연 1회 운영성과');
await caretEnd(longHost);
await b.type(' 아주 긴 글을 넣어 칸을 넘치게 합니다.'.repeat(60));
await sleep(300);
const st = await b.ev(`document.querySelector('#ed-status').textContent`);
check('넘치면 경고', st.includes('넘침') && (await b.ev(`document.querySelector('.slide.active').classList.contains('ed-over')`)), st);
await b.shot(here + 's_over.png');
await b.ev(`document.execCommand('undo');1`);
await sleep(300);
const st2 = await b.ev(`document.querySelector('#ed-status').textContent`);
check('되돌리면 경고 사라짐', !st2.includes('넘침') && !(await b.ev(`document.querySelector('.slide.active').classList.contains('ed-over')`)), st2);
const scrolled = await b.ev(`[document.querySelector('.slide.active'),...document.querySelectorAll('.slide.active *')].filter(e=>e.scrollTop||e.scrollLeft).length`);
check('되돌리면 장표가 제자리로', scrolled === 0, String(scrolled));
await b.key('Escape', 'Escape', 27);

// 10. 한글 조합 입력
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
await b.key('Escape', 'Escape', 27);

// 11. 편집 끄기·목차
await b.key('e', 'KeyE', 69, 0, 'e');
check('E 로 편집 끄기', (await b.ev(`document.querySelectorAll('[contenteditable=true]').length`)) === 0 && !(await b.ev(`document.body.classList.contains('ed-on')`)));
await b.key('ㄷ', 'KeyE', 69, 0, 'ㄷ');
check('한글 입력 상태에서도 E 로 다시 켜짐', await b.ev(`document.body.classList.contains('ed-on')`));

// 12. 저장 경로: 파일 선택 저장(같은 파일에 다시 저장)
await b.ev('go(14);1');
await b.ev(`(()=>{window.__w=[];window.__picks=0;window.showSaveFilePicker=async(o)=>{window.__picks++;window.__name=o.suggestedName;return {createWritable:async()=>({write:async(x)=>window.__w.push(x),close:async()=>{}})}};return 1})()`);
await b.ev(`document.querySelector('#save').click();new Promise(r=>setTimeout(r,200))`);
check('저장 → 저장됨 표시', (await b.ev(`document.querySelector('#ed-status').textContent`)).startsWith('저장됨'), await b.ev(`window.__name`));
await caretEnd(p);
await b.type('!');
await b.key('s', 'KeyS', 83, 4); // ⌘S
await sleep(250);
check('⌘S 로 같은 파일에 다시 저장(다시 묻지 않음)', (await b.ev(`window.__picks===1&&window.__w.length===2`)));
await b.key('Escape', 'Escape', 27);
const saved = await b.ev(`window.__w[1]`);
fs.writeFileSync(here + 'saved1.html', saved);
check('저장 뒤 임시 저장 지움', (await b.ev(`localStorage.getItem('ax2030-edit-draft:'+location.pathname)===null`)));

// 13. 저장 파일 다시 열기
const body = saved.slice(saved.indexOf('<body'), saved.indexOf('<script id="ed-book"'));
check('저장 파일 본문에 편집 표시 없음', !/contenteditable|data-ed|data-scene-element|ed-over|spellcheck/.test(body), (body.match(/contenteditable|data-ed[^i]|data-scene-element|ed-over|spellcheck/) || [''])[0]);
check('저장 파일에 편집 막대 없음', !/class="ed-ui/.test(body));
await b.nav(here + 'saved1.html', '#15');
check('다시 열면 고친 글자 유지', await b.ev(`${findHost('둘째 줄')}!=null&&${findHost('뷁쀍테스')}!=null`));
check('다시 열면 제목·메모 유지', await b.ev(`document.querySelector('#picker').options[14].textContent.endsWith('(수정)')&&BOOK.pages[14].narration.endsWith('메모추가문장')`));
check('다시 열어도 편집 켜짐', await b.ev(`document.body.classList.contains('ed-on')&&document.querySelectorAll('[contenteditable=true]').length>500`));
const again = await b.ev(`axEditor.cleanHtml()`);
check('다시 저장해도 파일이 그대로(찌꺼기 안 쌓임)', again === saved, again.length + ' vs ' + saved.length);
if (again !== saved) {
  let i = 0;
  while (again[i] === saved[i]) i++;
  console.log('   첫 차이', JSON.stringify(saved.slice(i - 60, i + 80)), '\n   ↔', JSON.stringify(again.slice(i - 60, i + 80)));
}
await b.shot(here + 's_reopen.png');

// 14. 내려받기 경로(파일 선택을 못 쓰는 브라우저)
const dl = here + 'dl';
fs.rmSync(dl, {recursive: true, force: true});
fs.mkdirSync(dl);
await b.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: dl});
await b.nav(COPY, '#15');
await b.ev(`window.showSaveFilePicker=undefined;document.querySelector('#save').click();1`);
for (let i = 0; i < 60 && !fs.readdirSync(dl).some((f) => f.endsWith('.html')); i++) await sleep(100);
const got = fs.readdirSync(dl);
check('내려받기로 저장', got.length === 1 && got[0] === 'work.html', got.join(','));

// 15. 임시 저장 되살리기
await b.nav(COPY, '#15');
const p2 = findHost('연간 실적');
await caretEnd(p2);
await b.type('임시저장시험');
await sleep(1100);
check('입력 뒤 임시 저장', await b.ev(`localStorage.getItem('ax2030-edit-draft:'+location.pathname)!==null`));
const reload = async () => {
  const n = b.events.length;
  await b.send('Page.reload', {ignoreCache: true});
  for (let i = 0; i < 200 && !b.events.slice(n).some((e) => e.method === 'Page.loadEventFired'); i++) await sleep(50);
  await sleep(500);
};
await reload();
check('다시 열면 불러오기 안내', await b.ev(`document.querySelector('.ed-banner')!=null`));
await b.shot(here + 's_banner.png');
await b.ev(`document.querySelector('.ed-banner [data-a=load]').click();1`);
await sleep(100);
check('불러오기로 되살림', await b.ev(`${findHost('임시저장시험')}!=null&&${findHost('임시저장시험')}.isContentEditable`));
check('되살린 뒤 저장 안 됨 표시', (await b.ev(`document.querySelector('#ed-status').textContent`)) === '저장 안 됨');
await reload();
await b.ev(`document.querySelector('.ed-banner [data-a=drop]').click();1`);
await reload();
check('버리기 뒤 안내 없음', await b.ev(`document.querySelector('.ed-banner')==null&&${findHost('임시저장시험')}==null`));

// 16. 표지 그림 바꾸기(버튼까지)
await b.ev('go(0);1');
await b.ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const img = await rectOf(`document.querySelector('.slide.active img')`);
await b.click(img.x, img.y);
await sleep(80);
check('표지 그림을 누르면 그림 바꾸기 버튼', await b.ev(`[...document.querySelectorAll('.ed-bar:not([hidden]) button')].some(x=>x.textContent==='그림 바꾸기')`));
await b.shot(here + 's_img.png');

clearInterval(autoDialog);
await b.close();
console.log(fails ? `\n실패 ${fails}건` : '\n모두 통과');
process.exit(fails ? 1 : 0);
