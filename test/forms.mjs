// A7: 장표가 아닌 형태(a4, auto, custom)와 긴 문서에서 뷰어·편집기가 도는지 본다
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {open, sleep} from './lib/cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '../skill/html-doc-kit/scripts/doc-kit.mjs');
const OUT = path.join(here, 'out', 'forms');
fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(OUT, {recursive: true});
let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra !== '' ? ' → ' + extra : ''}`);
};
const build = (name, md, ...args) => {
  const src = path.join(OUT, name + '.md');
  const to = path.join(OUT, name + '.html');
  fs.writeFileSync(src, md);
  const r = spawnSync('node', [CLI, 'build', src, '-o', to, ...args], {encoding: 'utf-8'});
  if (r.status) console.log(r.stdout, r.stderr);
  return to;
};
const long = Array.from({length: 400}, (_, i) => `문단 ${i + 1}: 아주 긴 문서의 내용입니다. 글자를 쳐도 느려지면 안 됩니다.\n`).join('\n');
const b = await open(1440, 900);
const auto = setInterval(async () => {
  const hit = b.events.findLast((e) => e.method === 'Page.javascriptDialogOpening' && !e.done);
  if (hit) {
    hit.done = true;
    await b.send('Page.handleJavaScriptDialog', {accept: true}).catch(() => {});
  }
}, 50);

// auto: 긴 문서
const f1 = build('auto', `# 긴 문서\n\n${long}\n\n---\n\n# 둘째 쪽\n둘째`, '--type', 'auto');
await b.nav(f1);
await sleep(300);
const st = await b.ev(`(()=>{const p=document.querySelector('.dk-page.dk-active');const v=document.querySelector('#dk-viewport');const s=getComputedStyle(p);return {zoom:parseFloat(s.getPropertyValue('--dk-scale')),h:p.getBoundingClientRect().height,vh:v.clientHeight,sh:v.scrollHeight,w:p.getBoundingClientRect().width,vw:v.clientWidth}})()`);
ok('auto: 폭에 맞추고 배율이 바닥까지 줄지 않음', st.zoom >= 0.9 && st.w <= st.vw, JSON.stringify(st));
ok('auto: 내용이 길면 세로로 스크롤', st.sh > st.vh * 3);
await b.key(' ', 'Space', 32, 0, ' ');
await sleep(80);
ok('auto: Space는 먼저 스크롤', (await b.ev(`document.querySelector('#dk-viewport').scrollTop`)) > 100 && (await b.ev(`dkKit.state().index`)) === 0);
await b.ev(`(()=>{const v=document.querySelector('#dk-viewport');v.scrollTop=v.scrollHeight;return 1})()`);
await sleep(60);
await b.key(' ', 'Space', 32, 0, ' ');
await sleep(80);
ok('auto: 끝까지 내리면 Space로 다음 쪽', (await b.ev(`dkKit.state().index`)) === 1);
await b.ev(`dkKit.go(0);1`);
const cost = await b.ev(`(async()=>{const h=[...document.querySelectorAll('.dk-page.dk-active [data-dk-host]')][5];h.focus();const t0=performance.now();for(let i=0;i<5;i++){document.execCommand('insertText',false,'가');await new Promise(r=>setTimeout(r,160))}return (performance.now()-t0-800)/5})()`);
ok('auto: 긴 문서에서 입력이 느려지지 않음(글자당 50ms 미만)', cost < 50, cost.toFixed(1) + 'ms');
ok('auto: 글이 늘어도 거짓 넘침 경고 없음', !(await b.ev(`document.querySelector('#dk-status').textContent`)).includes('넘침'));

// a4 고정: 넘침 경고, 인쇄 크기
const f2 = build('a4', `# 보고서\n\n첫 문단입니다.\n\n---\n\n# 둘째\n\n둘째 문단입니다.`, '--type', 'a4');
await b.nav(f2);
await sleep(300);
const a4 = await b.ev(`(()=>{const p=document.querySelector('.dk-page.dk-active');const r=p.getBoundingClientRect();const v=document.querySelector('#dk-viewport');return {ratio:r.height/r.width,fit:r.height<=v.clientHeight}})()`);
ok('a4: 비율 유지, 창 안에 들어옴', Math.abs(a4.ratio - 1123 / 794) < 0.01 && a4.fit, JSON.stringify(a4));
ok('a4: 처음에는 경고 없음', !(await b.ev(`document.querySelector('#dk-status').textContent`)).includes('넘침'));
await b.ev(`(()=>{const h=document.querySelector('.dk-page.dk-active p');h.focus();const r=document.createRange();r.selectNodeContents(h);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);return 1})()`);
await b.type(' 아주 긴 글을 넣어 쪽을 넘치게 합니다.'.repeat(250));
await sleep(350);
ok('a4: 쪽을 넘치면 경고', (await b.ev(`document.querySelector('#dk-status').textContent`)).includes('넘침'), await b.ev(`document.querySelector('#dk-status').textContent`));
ok('a4: 넘친 칸에 빨간 표시', await b.ev(`document.querySelectorAll('.dk-page.dk-active .dk-bad').length>0`));
const saved = await b.ev(`dkKit.cleanHtml()`);
const f2s = path.join(OUT, 'a4_saved.html');
fs.writeFileSync(f2s, saved);
await b.nav(f2s);
await sleep(300);
ok('a4: 넘친 채 저장해 다시 열어도 경고 유지', (await b.ev(`document.querySelector('#dk-status').textContent`)).includes('넘침'), await b.ev(`document.querySelector('#dk-status').textContent`));

// 메모·제목이 없는 문서, 표지 없는 custom
const f3 = path.join(OUT, 'custom.html');
fs.writeFileSync(f3, '<section data-page data-w="1024" data-h="768" data-notes="메모"><h1>사대삼</h1><p>글</p></section><section data-page data-w="500" data-h="700"><p>제목 없음</p></section>');
spawnSync('node', [CLI, 'ensure', f3], {encoding: 'utf-8'});
await b.nav(f3);
await sleep(300);
const c1 = await b.ev(`(()=>{const r=document.querySelector('.dk-page.dk-active').getBoundingClientRect();return r.height/r.width})()`);
ok('custom: 첫 쪽 비율', Math.abs(c1 - 768 / 1024) < 0.01, c1);
await b.ev(`dkKit.go(1);1`);
const c2 = await b.ev(`(()=>{const r=document.querySelector('.dk-page.dk-active').getBoundingClientRect();return r.height/r.width})()`);
ok('custom: 둘째 쪽 비율', Math.abs(c2 - 700 / 500) < 0.01, c2);
ok('제목 없는 쪽도 목록에 이름', (await b.ev(`document.querySelector('#dk-picker').options[1].textContent`)).includes('쪽 2'));
await b.ev(`document.querySelector('#dk-read').click();1`);
await sleep(100);
ok('custom: 연속 읽기에서 두 쪽 다 보임', await b.ev(`[...document.querySelectorAll('.dk-page')].every(p=>p.getClientRects().length)`));
await b.ev(`document.querySelector('#dk-read').click();1`);

// 인쇄: 쪽 크기가 섞인 문서와 a4
for (const [name, file, pages] of [['custom', f3, 2], ['a4', f2, 2]]) {
  await b.nav(file);
  await sleep(200);
  await b.send('Emulation.setEmulatedMedia', {media: 'print'});
  const pdf = await b.send('Page.printToPDF', {printBackground: true, preferCSSPageSize: true});
  await b.send('Emulation.setEmulatedMedia', {media: ''});
  const out = path.join(OUT, name + '.pdf');
  fs.writeFileSync(out, Buffer.from(pdf.data, 'base64'));
  const info = spawnSync('pdfinfo', ['-l', '2', out], {encoding: 'utf-8'}).stdout || '';
  const n = /Pages:\s+(\d+)/.exec(info);
  ok(`인쇄 ${name}: ${pages}쪽`, n && Number(n[1]) === pages, info.split('\n').filter((l) => /Pages|size/.test(l)).join(' / '));
}
// 56: 100vw·100vh로 짠 슬라이드는 창이 아니라 쪽을 채운다
const f56 = path.join(OUT, 'vw.html');
fs.writeFileSync(f56, '<!doctype html><title>t</title><meta name="doc-type" content="slide"><style>.slide{width:100vw;height:100vh;box-sizing:border-box}.slide h1{font-size:6vw;margin:-1vh 0 0}.m{width:50vmin;background:url("a100vw.png")}</style><section class="slide"><h1>창 크기 단위</h1><div class="m" style="height:10vh">칸</div></section>');
spawnSync('node', [CLI, 'ensure', f56], {encoding: 'utf-8'});
await b.nav(f56);
await sleep(300);
const vw = async () => b.ev(`(()=>{const s=document.querySelector('.slide');const h=s.querySelector('h1');const m=s.querySelector('.m');return {w:s.offsetWidth,h:s.offsetHeight,f:parseFloat(getComputedStyle(h).fontSize),mw:m.offsetWidth,mh:m.offsetHeight}})()`);
const vw1 = await vw();
ok('56 vw·vh·vmin이 쪽 크기 기준', vw1.w === 1920 && vw1.h === 1080 && Math.abs(vw1.f - 115.2) < 0.2 && vw1.mw === 540 && vw1.mh === 108, JSON.stringify(vw1));
await b.send('Emulation.setDeviceMetricsOverride', {width: 1000, height: 700, deviceScaleFactor: 1, mobile: false});
await sleep(200);
const vw2 = await vw();
ok('56 창을 줄여도 쪽 안 크기가 그대로', vw2.w === vw1.w && vw2.f === vw1.f, JSON.stringify(vw2));
await b.send('Emulation.clearDeviceMetricsOverride');
ok('56 문자열·url 안의 100vw는 건드리지 않음', fs.readFileSync(f56, 'utf-8').includes('a100vw.png'));

// 53: 본문의 예약 클래스가 쪽 목록을 흐트리지 않는다(저장본에 직접 끼운 경우도 쪽은 직접 자식만 센다)
const f53 = build('nested', '---\ntype: slide\n---\n# 하나\n\n---\n# 둘\n');
const nested = fs.readFileSync(f53, 'utf-8').replace('</h1>', '</h1><div class="dk-page"><p>안쪽</p></div>');
fs.writeFileSync(f53, nested);
await b.nav(f53);
await sleep(300);
ok('53 안쪽 .dk-page는 쪽으로 세지 않음', (await b.ev(`dkKit.state().pages`)) === 2);
ok('53 check도 직접 자식만 셈', spawnSync('node', [CLI, 'check', f53, '--no-browser'], {encoding: 'utf-8'}).status === 0);

// 아래 시험은 검증에서 재현된 지적의 회귀 시험이다
const ready = async () => {
  for (let i = 0; i < 200 && !(await b.ev(`document.documentElement.dataset.dkReady==='1'`)); i++) await sleep(50);
};
const open2 = async (file, hash = '') => {
  await b.nav('about:blank');
  await b.nav(file, hash);
  await ready();
  await b.ev(`document.querySelector('.dk-banner [data-a=drop]')?.click();1`);
  await sleep(60);
};
const rect = (sel) => b.ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}})()`);
const clickOn = async (sel) => {
  const r = await rect(sel);
  await b.click(r.x, r.y);
};
const statusText = () => b.ev(`document.querySelector('#dk-status').textContent`);

// 54: 입력칸에 들어갈 수 있고, 채운 값이 저장된다
const f54 = path.join(OUT, 'fields.html');
fs.writeFileSync(f54, '<!doctype html><title>폼</title><meta name="doc-type" content="a4"><section data-page><h1>점검표</h1><form action=""><p>이름 <input id="t" value="기본"></p><textarea id="ta">원래</textarea><select id="s"><option>가</option><option>나</option></select><select id="s2"><option>첫째</option><option>둘째</option></select><p><label><input id="c" type="checkbox"> 동의</label></p><p><input id="pw" type="password"></p></form></section>');
const r54 = spawnSync('node', [CLI, 'ensure', f54], {encoding: 'utf-8'});
ok('54 입력칸 위주 문서도 완성으로 판정', r54.status === 0, r54.stdout + r54.stderr);
await open2(f54);
await b.ev(`localStorage.clear();1`); // 앞 시험의 임시 저장과 섞이지 않게 한다
ok('54 선택칸 항목은 편집 칸이 아님', await b.ev(`document.querySelectorAll('select [data-dk-host],select[data-dk-host]').length===0`));
await clickOn('#t');
ok('54 편집 켜짐에서 눌러 입력칸에 들어감', (await b.ev(`document.activeElement.id`)) === 't');
await b.type('추가');
ok('54 입력하면 값이 바뀜', (await b.ev(`document.querySelector('#t').value`)).includes('추가'));
ok('54 입력하면 저장 안 됨으로 표시', (await b.ev(`dkKit.state().dirty`)) && (await statusText()).includes('저장 안 됨'), await statusText());
await clickOn('#ta');
ok('54 글상자에 들어감', (await b.ev(`document.activeElement.id`)) === 'ta');
await b.type('추가글');
await clickOn('#c');
ok('54 체크칸을 누르면 체크됨', await b.ev(`document.querySelector('#c').checked`));
await b.ev(`(()=>{const s=document.querySelector('#s');s.selectedIndex=1;s.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
await b.ev(`document.querySelector('#pw').value='비밀';1`);
const html54 = await b.ev(`dkKit.cleanHtml()`);
ok('54 저장본에 입력값', /value="[^"]*추가"/.test(html54), (/id="t"[^>]*>/.exec(html54) || [''])[0]);
ok('54 저장본에 글상자 값', />[^<]*추가글<\/textarea>/.test(html54));
ok('54 저장본에 고른 항목', /<option selected="">나<\/option>/.test(html54));
ok('54 고르지 않은 선택칸은 그대로', !/selected="">첫째/.test(html54));
ok('54 저장본에 체크', /id="c"[^>]*checked/.test(html54));
ok('54 비밀번호는 파일에 남기지 않음', !html54.includes('비밀"'));
// 임시 저장에도 값이 남는다
await sleep(900);
ok('54 임시 저장에 입력값', await b.ev(`(()=>{const k=Object.keys(localStorage).find(x=>x.startsWith('dk-draft:'));return !!k&&localStorage.getItem(k).includes('추가글')})()`));
await b.ev(`localStorage.clear();1`);
const f54s = path.join(OUT, 'fields_saved.html');
fs.writeFileSync(f54s, html54);
await open2(f54s);
const back54 = await b.ev(`({t:document.querySelector('#t').value,ta:document.querySelector('#ta').value,s:document.querySelector('#s').value,c:document.querySelector('#c').checked})`);
ok('54 다시 열어도 값이 그대로', back54.t.includes('추가') && back54.ta.includes('추가글') && back54.s === '나' && back54.c, JSON.stringify(back54));
ok('54 다시 저장해도 파일이 그대로', (await b.ev(`dkKit.cleanHtml()`)) === html54);
await clickOn('#t');
await b.key('Enter', 'Enter', 13, 0, '\r');
await sleep(300);
ok('54 편집 중 Enter로 폼이 전송되어 페이지가 다시 열리지 않음', await b.ev(`document.activeElement.id==='t'&&document.querySelector('#t').value.includes('추가')&&!location.search`));
await b.ev(`document.querySelector('#t').blur();1`);

// 55: auto 쪽의 넓은 표는 가로로 스크롤해 본다
const cols55 = Array.from({length: 14}, (_, i) => `열이름${i + 1}번항목`);
const f55 = path.join(OUT, 'wide.html');
fs.writeFileSync(f55, `<!doctype html><title>넓은 표</title><meta name="doc-type" content="auto"><style>table{white-space:nowrap;border-collapse:collapse}td,th{padding:6px 20px}</style><h1>표</h1><table><tr>${cols55.map((c) => `<th>${c}</th>`).join('')}</tr><tr>${cols55.map((c) => `<td>${c}값</td>`).join('')}</tr></table>`);
spawnSync('node', [CLI, 'ensure', f55], {encoding: 'utf-8'});
await open2(f55);
const INNER = `document.querySelector('.dk-page.dk-active .dk-page-inner')`;
const wide = await b.ev(`({sw:${INNER}.scrollWidth,cw:${INNER}.clientWidth,x:getComputedStyle(${INNER}).overflowX})`);
ok('55 폭을 넘는 표를 가로로 스크롤할 수 있음', wide.sw > wide.cw + 2 && wide.x === 'auto', JSON.stringify(wide));
await b.ev(`${INNER}.scrollLeft=200;1`);
await b.ev(`(()=>{const h=document.querySelectorAll('.dk-page.dk-active td')[6];h.focus();const r=document.createRange();r.selectNodeContents(h);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);return 1})()`);
await b.type('가');
await sleep(250);
const left55 = await b.ev(`${INNER}.scrollLeft`);
ok('55 입력해도 가로 스크롤이 왼쪽으로 튀지 않음', left55 > 0, left55);
ok('55 넓은 칸에 입력해도 넘침 경고 없음', !(await statusText()).includes('넘침'), await statusText());
await b.ev(`document.activeElement.blur();1`);
await sleep(60);
ok('55 칸에서 나와도 스크롤 유지', (await b.ev(`${INNER}.scrollLeft`)) > 0);
await b.send('Emulation.setEmulatedMedia', {media: 'print'});
const printX = await b.ev(`getComputedStyle(${INNER}).overflowX`);
await b.send('Emulation.setEmulatedMedia', {media: ''});
ok('55 인쇄 때는 visible', printX === 'visible', printX);
await open2(f2);
ok('55 고정 쪽은 그대로', (await b.ev(`getComputedStyle(${INNER}).overflowX`)) === 'visible');

// 57: 인쇄 창의 배경 그래픽이 꺼져 있어도 배경이 찍힌다
const f57 = path.join(OUT, 'print.html');
fs.writeFileSync(f57, '<!doctype html><title>인쇄</title><meta name="doc-type" content="a4"><style>.cover{background:linear-gradient(#123456,#0f93be);color:#fff;height:300px}.box{background:#ffd283;padding:20px}th{background:#1b5790;color:#fff}</style><section data-page><div class="cover"><h1>표지</h1></div><div class="box">상자</div><table><tr><th>머리</th></tr><tr><td>값</td></tr></table></section>');
spawnSync('node', [CLI, 'ensure', f57], {encoding: 'utf-8'});
await open2(f57);
const inkOf = async (printBackground) => {
  await b.send('Emulation.setEmulatedMedia', {media: 'print'});
  const pdf = await b.send('Page.printToPDF', {printBackground, preferCSSPageSize: true});
  await b.send('Emulation.setEmulatedMedia', {media: ''});
  const file = path.join(OUT, `print_${printBackground}.pdf`);
  fs.writeFileSync(file, Buffer.from(pdf.data, 'base64'));
  const ppm = spawnSync('pdftoppm', ['-r', '40', '-f', '1', '-l', '1', file], {maxBuffer: 1e8}).stdout;
  // P6 머리 세 줄(형식, 가로 세로, 최댓값)을 건너뛰고 색이 있는 점을 센다
  let at = 0;
  for (let n = 0; n < 3; n++) at = ppm.indexOf(10, at) + 1;
  let ink = 0;
  for (let i = at; i + 2 < ppm.length; i += 3) if (ppm[i] < 240 || ppm[i + 1] < 240 || ppm[i + 2] < 240) ink++;
  return ink;
};
const inkOff = await inkOf(false);
const inkOn = await inkOf(true);
ok('57 배경 그래픽을 꺼도 배경이 켠 것과 같게 찍힘', inkOff > 2000 && Math.abs(inkOff - inkOn) <= inkOn * 0.01, `${inkOff} / ${inkOn}`);

// 59: 그림 옮기기·바꾸기 되돌리기
const svgA = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#1b5790"/></svg>');
const f59 = path.join(OUT, 'pics.html');
fs.writeFileSync(f59, `<!doctype html><title>그림</title><meta name="doc-type" content="a4"><style>.frame{overflow:hidden;height:300px}</style><section data-page><p id="para">원래 문단</p><div class="frame"><img id="pic" alt="그림" src="${svgA}"></div></section>`);
spawnSync('node', [CLI, 'ensure', f59], {encoding: 'utf-8'});
await open2(f59);
const IMG = `document.querySelector('#pic')`;
const undo = async (mods = 4, cmd = 'undo') => {
  await b.send('Input.dispatchKeyEvent', {type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: mods, commands: [cmd]});
  await b.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: mods});
  await sleep(80);
};
const redo = () => undo(12, 'redo');
const dragPic = async (dx, dy) => {
  const r = await rect('#pic');
  await b.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: r.x, y: r.y});
  await b.send('Input.dispatchMouseEvent', {type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1});
  await b.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: r.x + dx / 2, y: r.y + dy / 2, button: 'left', buttons: 1});
  await b.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: r.x + dx, y: r.y + dy, button: 'left', buttons: 1});
  await b.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: r.x + dx, y: r.y + dy, button: 'left', buttons: 0, clickCount: 1});
  await sleep(60);
};
const translate = () => b.ev(`${IMG}.style.translate`);
const para = () => b.ev(`document.querySelector('#para').innerText`);
const caretPara = () => b.ev(`(()=>{const h=document.querySelector('#para');h.focus();const r=document.createRange();r.selectNodeContents(h);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);return 1})()`);
await caretPara();
await b.type('글자수정');
await dragPic(80, 40);
ok('59 그림이 옮겨짐', (await translate()) !== '', await translate());
ok('59 끌 때 상위 틀의 overflow를 풂', await b.ev(`${IMG}.parentElement.style.overflow==='visible'`));
await undo();
ok('59 ⌘Z는 방금 옮긴 그림을 되돌림', (await translate()) === '', await translate());
ok('59 앞서 고친 글자는 그대로', (await para()).includes('글자수정'), await para());
ok('59 상위 틀의 overflow도 되돌림', await b.ev(`${IMG}.parentElement.getAttribute('style')===null`));
await redo();
ok('59 ⌘⇧Z는 다시 옮김', (await translate()) !== '', await translate());
await undo();
await undo();
ok('59 그림 기록이 끝나면 ⌘Z는 글자로', !(await para()).includes('글자수정'), await para());
await dragPic(60, 30);
await caretPara();
await b.type('뒤에고침');
await undo();
ok('59 그림 뒤에 글자를 고쳤으면 칸 안의 ⌘Z는 글자만', !(await para()).includes('뒤에고침') && (await translate()) !== '', `${await para()} / ${await translate()}`);
await b.ev(`document.activeElement.blur();1`);
await undo();
ok('59 칸 밖의 ⌘Z는 그림을 되돌림', (await translate()) === '', await translate());
// 바꾸기와 원래 그림
const pickPic = async () => {
  await clickOn('#pic');
  await sleep(60);
};
const swapPic = () => b.ev(`(()=>{const i=[...document.querySelectorAll('.dk-float input[type=file]')][0];const dt=new DataTransfer();dt.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="red"/></svg>'],'b.svg',{type:'image/svg+xml'}));i.files=dt.files;i.dispatchEvent(new Event('change'));return 1})()`);
const srcOf = () => b.ev(`${IMG}.getAttribute('src')`);
const ORIG_BTN = `document.querySelector('.dk-float [data-a=orig]')`;
await pickPic();
ok('59 안 바꾼 그림에는 원래 그림 단추가 없음', await b.ev(`${ORIG_BTN}.hidden`));
const src0 = await srcOf();
await swapPic();
for (let i = 0; i < 40 && (await srcOf()) === src0; i++) await sleep(50);
const src1 = await srcOf();
ok('59 그림 바꾸기', src1 !== src0);
await undo();
ok('59 ⌘Z는 바꾼 그림을 되돌림', (await srcOf()) === src0);
await redo();
ok('59 ⌘⇧Z는 다시 바꿈', (await srcOf()) === src1);
await pickPic();
ok('59 바꾼 그림에는 원래 그림 단추', await b.ev(`!${ORIG_BTN}.hidden`));
await b.ev(`${ORIG_BTN}.click();1`);
ok('59 원래 그림 단추로 돌아감', (await srcOf()) === src0);
await undo();
ok('59 원래 그림도 ⌘Z로 되돌림', (await srcOf()) === src1);
await b.ev(`localStorage.clear();dkKit.state();1`);

// 60: 쪽을 넘는 목차 링크와 처음 열 때의 hash
const f60 = path.join(OUT, 'toc.html');
const para60 = Array.from({length: 120}, (_, i) => `<p>문단 ${i + 1}</p>`).join('');
fs.writeFileSync(f60, `<!doctype html><title>목차</title><meta name="doc-type" content="auto"><section data-page data-title="목차"><h1>목차</h1><p><a id="l2" href="#sec2">2장으로</a> <a id="l3" href="#deep">깊은 곳</a> <a id="ln" href="#named">이름 앵커</a> <a id="lx" href="#없는곳">없는 곳</a> <a id="lk" href="#%ED%95%9C%EA%B8%80">한글</a></p></section><section data-page id="sec2" data-title="2장"><h1>2장</h1>${para60}<h2 id="deep">깊은 곳</h2><p>끝</p></section><section data-page data-title="3장"><h1>3장</h1><p><a name="named">이름</a></p><p id="한글">한글 자리</p></section>`);
const r60 = spawnSync('node', [CLI, 'ensure', f60], {encoding: 'utf-8'});
if (r60.status) console.log(r60.stdout, r60.stderr);
const indexNow = () => b.ev(`dkKit.state().index`);
const scrollNow = () => b.ev(`document.querySelector('#dk-viewport').scrollTop`);
await open2(f60);
await clickOn('#l2');
ok('60 편집 켜짐에서 그냥 누르면 쪽이 바뀌지 않음', (await indexNow()) === 0);
await b.ev(`document.querySelector('#l2').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,metaKey:true}));1`);
ok('60 편집 켜짐에서 ⌘를 누르고 누르면 이동', (await indexNow()) === 1);
await b.ev(`dkKit.go(0);1`);
await b.key('e', 'KeyE', 69, 0, 'e');
await clickOn('#l2');
ok('60 편집을 끄면 쪽을 넘어 이동', (await indexNow()) === 1 && (await b.ev(`document.querySelector('.dk-page.dk-active').id`)) === 'dk-p2', String(await indexNow()));
await b.ev(`dkKit.go(0);1`);
await clickOn('#l3');
ok('60 쪽 안 깊은 곳까지 스크롤', (await indexNow()) === 1 && (await scrollNow()) > 500, String(await scrollNow()));
await b.ev(`dkKit.go(0);1`);
await clickOn('#ln');
ok('60 a name 앵커', (await indexNow()) === 2);
await b.ev(`dkKit.go(0);1`);
await clickOn('#lk');
ok('60 한글 앵커', (await indexNow()) === 2);
await b.ev(`dkKit.go(0);1`);
await clickOn('#lx');
ok('60 없는 대상은 쪽이 그대로', (await indexNow()) === 0);
await open2(f60, '#sec2');
ok('60 처음 열 때 #이름 쪽으로', (await indexNow()) === 1);
await open2(f60, '#deep');
ok('60 처음 열 때 쪽 안 대상까지 스크롤', (await indexNow()) === 1 && (await scrollNow()) > 500, String(await scrollNow()));
await open2(f60, '#3');
ok('60 처음 열 때 #쪽번호', (await indexNow()) === 2);
await open2(f60, '#없는곳');
ok('60 없는 hash는 첫 쪽', (await indexNow()) === 0);
await open2(f60, '#99');
ok('60 넘는 쪽번호는 끝 쪽', (await indexNow()) === 2);

// 37: 파일 핸들로 저장할 때 밖에서 바뀐 파일을 덮어쓰지 않는다
const f37 = path.join(OUT, 'handle.html');
fs.writeFileSync(f37, '<!doctype html><title>핸들</title><meta name="doc-type" content="a4"><section data-page><p id="q">글자</p></section>');
spawnSync('node', [CLI, 'ensure', f37], {encoding: 'utf-8'});
await open2(f37);
const fake = (disk = '') => b.ev(`(()=>{window.__fs={disk:${JSON.stringify(disk)},mod:1000,writes:0,picks:0};const h={getFile:async()=>({lastModified:__fs.mod,slice:(a,z)=>({text:async()=>__fs.disk.slice(a,z)})}),createWritable:async()=>{let got='';return {write:async(x)=>{got=x},close:async()=>{__fs.disk=got;__fs.mod++;__fs.writes++}}}};window.showSaveFilePicker=async()=>{__fs.picks++;return h};return 1})()`);
const fsState = () => b.ev(`({writes:__fs.writes,picks:__fs.picks,kept:__fs.disk==='밖에서 고침',banner:!!document.querySelector('.dk-banner')})`);
const pressSave = async () => {
  await b.ev(`document.querySelector('#dk-save').click();1`);
  await sleep(120);
};
const answer = async (a) => {
  await b.ev(`document.querySelector('.dk-banner [data-a=${a}]').click();1`);
  await sleep(120);
};
const external = () => b.ev(`(()=>{__fs.disk='밖에서 고침';__fs.mod=9999;return 1})()`);
await fake();
await pressSave();
let s37 = await fsState();
ok('37 처음 저장은 묻지 않음', s37.writes === 1 && !s37.banner, JSON.stringify(s37));
ok('37 저장 뒤 저장됨', (await statusText()).includes('저장됨'), await statusText());
await pressSave();
s37 = await fsState();
ok('37 안 바뀌었으면 묻지 않고 저장', s37.writes === 2 && !s37.banner, JSON.stringify(s37));
await external();
await pressSave();
s37 = await fsState();
ok('37 밖에서 바뀌었으면 쓰기 전에 물음', s37.writes === 2 && s37.banner && s37.kept, JSON.stringify(s37));
await answer('cancel');
s37 = await fsState();
ok('37 취소하면 파일이 그대로', s37.writes === 2 && s37.kept && !s37.banner, JSON.stringify(s37));
await pressSave();
await answer('saveas');
s37 = await fsState();
ok('37 다른 이름으로 저장은 파일 고르기로', s37.picks === 2 && s37.writes === 3, JSON.stringify(s37));
await external();
await pressSave();
await answer('overwrite');
s37 = await fsState();
ok('37 덮어쓰기를 고르면 씀', s37.writes === 4 && !s37.kept, JSON.stringify(s37));
await pressSave();
s37 = await fsState();
ok('37 덮어쓴 뒤에는 다시 묻지 않음', s37.writes === 5 && !s37.banner, JSON.stringify(s37));
const idRev = await b.ev(`({id:document.documentElement.dataset.docId,rev:Number(document.documentElement.dataset.docRev)})`);
await open2(f37);
await fake(`<!doctype html><html data-doc-id="${idRev.id}" data-doc-rev="${idRev.rev + 1}">`);
await pressSave();
s37 = await fsState();
ok('37 처음 고른 파일이 같은 문서의 더 새 판이면 물음', s37.writes === 0 && s37.banner, JSON.stringify(s37));
await answer('cancel');
await open2(f37);
await fake(`<!doctype html><html data-doc-id="다른문서" data-doc-rev="99">`);
await pressSave();
s37 = await fsState();
ok('37 다른 문서를 고르면 판 번호로 묻지 않음', s37.writes === 1 && !s37.banner, JSON.stringify(s37));

// 42: 응답 없는 그림 서버가 있어도 뷰어는 상한 안에 준비된다
const hang = http.createServer(() => {});
await new Promise((r) => hang.listen(0, '127.0.0.1', r));
const f42 = build('hang', '---\ntype: a4\n---\n# 그림 대기\n\n본문\n');
fs.writeFileSync(f42, fs.readFileSync(f42, 'utf-8').replace('</h1>', `</h1><img alt="늦는 그림" src="http://127.0.0.1:${hang.address().port}/slow.png">`));
await b.nav('about:blank');
const t42 = Date.now();
await b.send('Page.navigate', {url: pathToFileURL(f42).href});
let ready42 = false;
while (!ready42 && Date.now() - t42 < 9000) {
  await sleep(100);
  ready42 = await b.ev(`document.documentElement.dataset.dkReady==='1'`).catch(() => false);
}
const took42 = Date.now() - t42;
ok('42 응답 없는 그림이 있어도 약 5초 안에 준비', ready42 && took42 < 7500, took42 + 'ms');
ok('42 준비 뒤 편집 가능', await b.ev(`dkKit.state().editing`));
await b.send('Page.stopLoading').catch(() => {});
await b.nav('about:blank');
// 응답 없는 글꼴 서버도 같다
const f42b = build('hangfont', '---\ntype: a4\n---\n# 글꼴 대기\n\n본문\n');
fs.writeFileSync(f42b, fs.readFileSync(f42b, 'utf-8').replace('</h1>', `</h1><style>@font-face{font-family:Slow;src:url(http://127.0.0.1:${hang.address().port}/slow.woff2)}.dk-page p{font-family:Slow}</style>`));
const t42b = Date.now();
await b.send('Page.navigate', {url: pathToFileURL(f42b).href});
let ready42b = false;
while (!ready42b && Date.now() - t42b < 9000) {
  await sleep(100);
  ready42b = await b.ev(`document.documentElement.dataset.dkReady==='1'`).catch(() => false);
}
ok('42 응답 없는 글꼴이 있어도 약 5초 안에 준비', ready42b && Date.now() - t42b < 7500, Date.now() - t42b + 'ms');
await b.send('Page.stopLoading').catch(() => {});
await b.nav('about:blank');
hang.closeAllConnections();
hang.close();

// 53: 저장본에 끼어든 .dk-page가 쪽 처리를 흐트리지 않는다
await open2(f53);
ok('53 안쪽 .dk-page가 숨지 않음', await b.ev(`document.querySelector('.dk-page .dk-page').getClientRects().length>0`));
await b.ev(`(()=>{const h=document.querySelector('.dk-page .dk-page p');h.focus();const r=document.createRange();r.selectNodeContents(h);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);return 1})()`);
await b.type('고침');
await sleep(900);
const keys53 = await b.ev(`(()=>{const k=Object.keys(localStorage).find(x=>x.startsWith('dk-draft:'));return k?Object.keys(JSON.parse(localStorage.getItem(k)).pages).join(','):''})()`);
ok('53 안쪽에서 고쳐도 바깥 쪽 번호로 임시 저장', keys53 === '0' && (await b.ev(`document.querySelector('.dk-page .dk-page p').innerText`)).includes('고침'), keys53);
await b.ev(`localStorage.clear();1`);

clearInterval(auto);
await b.close();
console.log(fails ? `\n실패 ${fails}건` : '\n모두 통과');
process.exit(fails ? 1 : 0);
