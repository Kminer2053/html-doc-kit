// 시험 4: 재검증에서 나온 지적이 고쳐졌는지
import fs from 'node:fs';
import {open, sleep} from './cdp.mjs';
const here = new URL('.', import.meta.url).pathname;
const EDIT = '/Users/hoonsbook/AX2030/outputs/AX2030_본부장회의_요약기반_15p_v6_편집용.html';
const COPY = here + 'work4.html';
fs.copyFileSync(EDIT, COPY);
let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== '' ? '  → ' + extra : ''));
};
const b = await open(1920, 1160);
const auto = setInterval(async () => {
  const hit = b.events.findLast((e) => e.method === 'Page.javascriptDialogOpening' && !e.done);
  if (hit) {
    hit.done = true;
    await b.send('Page.handleJavaScriptDialog', {accept: true}).catch(() => {});
  }
}, 50);
const reload = async () => {
  const n = b.events.length;
  await b.send('Page.reload', {ignoreCache: true});
  for (let i = 0; i < 200 && !b.events.slice(n).some((e) => e.method === 'Page.loadEventFired'); i++) await sleep(50);
  await sleep(500);
};
const findHost = (txt) => `[...document.querySelectorAll('.slide.active [data-ed]')].find(h=>h.innerText.includes(${JSON.stringify(txt)}))`;
const caretEnd = (sel) => b.ev(`(()=>{const h=${sel};h.focus();const r=document.createRange();r.selectNodeContents(h);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);return 1})()`);
const rectOf = (sel) => b.ev(`(()=>{const r=(${sel}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,left:r.left,top:r.top}})()`);
const statusText = () => b.ev(`document.querySelector('#ed-status').textContent`);
const selectAll = () => b.key('a', 'KeyA', 65, 4);
const backspace = () => b.key('Backspace', 'Backspace', 8);

await b.nav(COPY, '#12');
await sleep(300);
// 12쪽 표 거짓 경고
const d3 = findHost('외부연계 데이터 자산화');
await caretEnd(d3);
await b.type(' 및 표준화 작업 강화');
await sleep(250);
check('12쪽 표 둘째 행이 두 줄이 돼도 거짓 경고 없음', !(await statusText()).includes('넘침'), await statusText());
await b.shot(here + 's4_12.png');
await b.key('Escape', 'Escape', 27);
await b.ev(`document.execCommand('undo');1`);

// 3쪽 아이콘
await b.ev('go(2);1');
await sleep(100);
const icon = `document.querySelector('.slide.active svg[data-ed-deco]').parentElement`;
await b.ev(`(${icon}).focus();1`);
await selectAll();
await backspace();
check('3쪽 글자 지워도 아이콘 유지', await b.ev(`(()=>{const h=[...document.querySelectorAll('.slide.active [data-ed][data-ed-empty]')][0];return !!h&&!!h.querySelector('svg')})()`));
await b.type('새 이름');
const iconHtml = await b.ev(`[...document.querySelectorAll('.slide.active [data-ed]')].find(h=>h.innerText.includes('새 이름')).innerHTML`);
check('3쪽 다시 쓰면 아이콘 + 글자', iconHtml.includes('<svg') && iconHtml.includes('새 이름'), iconHtml.replace(/<svg.*<\/svg>/s, '<svg/>').slice(0, 80));
await b.key('Escape', 'Escape', 27);
await reload();
await b.ev(`document.querySelector('.ed-banner [data-a=drop]').click();1`);

// 14쪽 화살표
await b.ev('go(13);1');
await sleep(100);
const arrow = await rectOf(`[...document.querySelectorAll('.slide.active [data-ed-deco]')].find(e=>e.textContent.includes('↔'))`);
await b.click(arrow.x, arrow.y);
await b.type('Q글');
const arrowHost = await b.ev(`(()=>{const h=${findHost('Q글')};return h?h.innerHTML:''})()`);
check('14쪽 화살표를 눌러도 글자가 버려지지 않음', arrowHost.includes('Q글') && arrowHost.includes('↔'), arrowHost.slice(0, 90));
await b.key('Escape', 'Escape', 27);
await reload();
await b.ev(`document.querySelector('.ed-banner [data-a=drop]').click();1`);

// 라벨 + 문단 칸: 비운 뒤 불러오기
await b.ev('go(3);1');
await sleep(100);
const para = `[...document.querySelectorAll('.slide.active [data-ed]')].find(h=>h.tagName==='P')`;
const hostsBefore = await b.ev(`document.querySelectorAll('.slide.active [data-ed]').length`);
await b.ev(`(${para}).focus();1`);
await selectAll();
await backspace();
await sleep(1000);
await reload();
await b.ev(`document.querySelector('.ed-banner [data-a=load]').click();1`);
await sleep(200);
const hostsAfter = await b.ev(`document.querySelectorAll('.slide.active [data-ed]').length`);
check('비운 문단을 불러와도 칸 수 그대로', hostsAfter === hostsBefore, hostsBefore + ' → ' + hostsAfter);
const emptyP = `document.querySelector('.slide.active p[data-ed-empty]')`;
const er = await rectOf(emptyP);
await b.click(er.x, er.y);
await b.type('되살림');
check('그 자리에 다시 쓰기', await b.ev(`(()=>{const p=[...document.querySelectorAll('.slide.active p')].find(x=>x.innerText.includes('되살림'));return !!p&&!p.hasAttribute('data-ed-empty')})()`));
await b.key('Escape', 'Escape', 27);
await reload();
await b.ev(`document.querySelector('.ed-banner [data-a=drop]').click();1`);

// 비운 가로 배치 칸의 줄바꿈 막기
await b.ev('go(1);1');
await sleep(100);
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
await b.key('Escape', 'Escape', 27);
await reload();
await b.ev(`document.querySelector('.ed-banner [data-a=drop]').click();1`);

// 임시 저장 창 뒤로 키가 새지 않음
await b.ev('go(2);1');
await caretEnd(`document.querySelector('.slide.active .page-header h1')`);
await b.type('임시');
await sleep(1000);
await reload();
const i0 = await b.ev('index');
await b.key('ArrowRight', 'ArrowRight', 39);
await b.key('ㅜ', 'KeyN', 78, 0, 'ㅜ');
await b.key('ㄱ', 'KeyR', 82, 0, 'ㄱ');
check('임시 저장 창이 떠 있으면 단축키 막힘', (await b.ev('index')) === i0 && (await b.ev(`document.querySelector('#speaker').hidden&&!document.body.classList.contains('reading')`)));
await b.ev(`document.querySelector('.ed-banner [data-a=drop]').click();1`);
await reload();

// 연속 읽기: 메모 열고 닫기, 세로로 긴 창
await b.ev('go(6);toggleRead();1');
await sleep(200);
await b.key('ㅜ', 'KeyN', 78, 0, 'ㅜ');
await sleep(300);
const seen = await b.ev(`(()=>{const t=document.querySelector('#viewport').getBoundingClientRect().top;return sheets.findIndex(s=>s.getBoundingClientRect().bottom>t+50)})()`);
check('연속 읽기에서 메모를 열어도 보이는 쪽과 메모가 같음', seen === (await b.ev('index')) && (await b.ev('index')) === 6, `${seen} / ${await b.ev('index')}`);
await b.key('ㅜ', 'KeyN', 78, 0, 'ㅜ');
await sleep(200);
await b.key('ArrowRight', 'ArrowRight', 39);
await sleep(300);
check('→ 는 다음 쪽으로', (await b.ev('index')) === 7, String(await b.ev('index')));
await b.ev('toggleRead();go(0);1');
await b.send('Emulation.setDeviceMetricsOverride', {width: 800, height: 1000, deviceScaleFactor: 1, mobile: false});
await sleep(200);
await b.ev('toggleRead();1');
await sleep(300);
const seq = [];
for (let i = 0; i < 5; i++) {
  await b.key('ArrowRight', 'ArrowRight', 39);
  await sleep(250);
  seq.push((await b.ev('index')) + 1);
}
check('세로로 긴 창에서 → 가 한 쪽씩', seq.join() === '2,3,4,5,6', seq.join());
await b.ev('toggleRead();1');
await b.send('Emulation.setDeviceMetricsOverride', {width: 1920, height: 1160, deviceScaleFactor: 1, mobile: false});
await sleep(200);

// 진짜 넘침은 잡는다
await b.ev('go(4);1');
await sleep(100);
const circle = `[...document.querySelectorAll('.slide.active [data-ed]')].find(h=>h.innerText.trim()==='1')`;
await caretEnd(circle);
await b.type(' 1 1');
await sleep(250);
check('5쪽 숫자 원을 벗어나면 경고', (await statusText()).includes('넘침'), await statusText());
await b.key('Escape', 'Escape', 27);
await b.ev('go(5);1');
await sleep(150);
check('다른 쪽에 있어도 넘친 쪽을 알림', (await statusText()).includes('5쪽 넘침'), await statusText());
await b.ev('go(4);1');
await sleep(150);
await b.ev(`(()=>{const h=[...document.querySelectorAll('.slide.active [data-ed]')].find(h=>h.innerText.includes('1 1 1'));h.textContent='1';h.dispatchEvent(new InputEvent('input',{bubbles:true}));return 1})()`);
await sleep(250);

// 15쪽 표지·아래 상자
await b.ev('go(14);1');
await sleep(150);
check('손대지 않은 쪽 경고 없음', !(await statusText()).includes('넘침'), await statusText());

// 지우기는 되돌릴 수 있음
const band = findHost('외부 전문성으로');
await b.ev(`(()=>{const h=${band};h.focus();const n=[...h.childNodes].find(x=>x.nodeType===3&&x.nodeValue.length>8)||h.firstChild;const r=document.createRange();r.setStart(n,2);r.setEnd(n,6);const s=getSelection();s.removeAllRanges();s.addRange(r);return 1})()`);
await sleep(120);
const clickBar = async (sel) => {
  const r = await rectOf(`document.querySelector('.ed-bar ${sel}')`);
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
check('메모 단추를 눌러도 막대 안 남음', await (async () => {
  await b.ev(`document.querySelector('#notes').click();1`);
  await sleep(100);
  const hidden = await b.ev(`[...document.querySelectorAll('.ed-bar')].every(x=>x.hidden)`);
  await b.ev(`document.querySelector('#notes').click();1`);
  return hidden;
})());
await b.key('Escape', 'Escape', 27);

clearInterval(auto);
await b.close();
console.log(fails ? `\n실패 ${fails}건` : '\n모두 통과');
process.exit(fails ? 1 : 0);
