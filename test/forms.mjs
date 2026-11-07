// A7: 장표가 아닌 형태(a4, auto, custom)와 긴 문서에서 뷰어·편집기가 도는지 본다
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
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

clearInterval(auto);
await b.close();
console.log(fails ? `\n실패 ${fails}건` : '\n모두 통과');
process.exit(fails ? 1 : 0);
