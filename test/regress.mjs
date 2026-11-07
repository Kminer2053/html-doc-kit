// 회귀 목록 중 따로 시험이 없던 항목의 자동 시험. 실제 마우스·키보드 입력(CDP)으로 옛 증상이 재현되지 않음을 본다.
// 시험 이름 앞의 번호는 reference/regression-cases.md의 항목 번호다. 같은 증상으로 묶인 항목은 한 시험이 함께 맡는다.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {open, sleep} from './lib/cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'regress');
fs.mkdirSync(out, {recursive: true});
const SRC = path.join(here, 'out', 'golden', 'kit.html');
if (!fs.existsSync(SRC)) {
  console.log('SKIP 시험 대상 ' + SRC + ' 없음 (test/golden.mjs 먼저)');
  process.exit(0);
}
const COPY = path.join(out, 'work.html'); // 임시 저장 키가 문서 번호를 쓰므로 복사본으로 시험한다
const MOVED = path.join(out, 'moved.html'); // 같은 문서를 다른 경로에 둔 것
fs.copyFileSync(SRC, COPY);
fs.copyFileSync(SRC, MOVED);

let fails = 0;
let passes = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  else passes++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== '' ? '  → ' + extra : ''));
};

// 시험에 쓸 그림 파일: 잘 압축되지 않는 PNG(크기를 맞추려고 무작위 화소를 쓴다)
const crcTable = Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const noisePng = (size) => {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size * 3; x++) raw[row + 1 + x] = (Math.imul(y * 7919 + x * 104729, 2654435761) >>> 13) & 255;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, {level: 0})), chunk('IEND', Buffer.alloc(0))]);
};
const BIG_PNG = path.join(out, 'big.png');
fs.writeFileSync(BIG_PNG, noisePng(900)); // 약 2.4MB, 문자열로는 3MB 이상
const BAD_PNG = path.join(out, 'bad.png');
fs.writeFileSync(BAD_PNG, '이것은 그림이 아닙니다');

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
const esc = () => b.key('Escape', 'Escape', 27);
const keyN = () => b.key('ㅜ', 'KeyN', 78, 0, 'ㅜ');
const settle = () => b.settle();
// 임시 저장(0.8초 뒤)에 글이 들어갈 때까지 최대 5초 기다린다. 고정 대기는 느린 기계에서 간헐 실패한다
const draftHas = (...txts) => b.until(`(()=>{const d=localStorage.getItem(${DRAFT})||'';return ${JSON.stringify(txts)}.every(t=>d.includes(t))})()`);
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
const load = async () => {
  await b.ev(`document.querySelector('.dk-banner [data-a=load]').click();1`);
  await sleep(200);
};
// 새 상태로 시작: 다른 곳으로 나갔다 들어와 임시 저장을 버린다
const fresh = async (hash = '', file = COPY) => {
  await b.send('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false}).catch(() => {});
  await b.send('Browser.setDownloadBehavior', {behavior: 'default'}).catch(() => {});
  await b.nav('about:blank');
  await b.nav(file, hash);
  await ready();
  await drop();
  await b.ev(`localStorage.clear();1`);
};
const recover = async () => {
  try {
    await esc();
  } catch {}
  try {
    await fresh();
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
// 굵게(⌘B)를 실제 편집 명령으로 보낸다. execCommand 호출은 beforeinput을 거치지 않아 시험이 되지 않는다
const boldKey = async () => {
  await b.send('Input.dispatchKeyEvent', {type: 'rawKeyDown', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66, modifiers: 4, commands: ['toggleBold']});
  await b.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66, modifiers: 4});
  await sleep(80);
};
// 고른 칸을 나중에도 가리킬 수 있게 이름을 붙여 둔다(글이 바뀌면 글로는 못 찾는다)
const pin = (sel) => b.ev(`(()=>{window.__h=${sel};return !!window.__h})()`);
// 사이를 나눠 끈다(한 번에 옮기면 선택이 늘지 않는다)
const dragSteps = async (x1, y1, x2, y2) => {
  await b.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: x1, y: y1});
  await b.send('Input.dispatchMouseEvent', {type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1});
  for (let i = 1; i <= 6; i++) {
    await b.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / 6, y: y1 + ((y2 - y1) * i) / 6, button: 'left', buttons: 1});
    await sleep(20);
  }
  await b.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1});
  await sleep(100);
};
const draftText = () => b.ev(`localStorage.getItem(${DRAFT})`);
// 임시 저장에서 시각을 뺀 내용(닫을 때 다시 쓰면 시각만 바뀐다)
const draftSig = async () => {
  const d = JSON.parse((await draftText()) || 'null');
  return d ? JSON.stringify([d.pages, d.book.pages.map((x) => x.notes + '|' + x.key)]) : null;
};
const floatsOpen = () => b.ev(`[...document.querySelectorAll('.dk-float')].filter(x=>!x.hidden).length`);
// 글자 일부를 골라 서식 막대를 띄운다
const selectPart = async (host) => {
  await b.ev(`(()=>{const h=${host};const n=[...h.childNodes].find(x=>x.nodeType===3&&x.nodeValue.length>8)||h.firstChild.firstChild||h.firstChild;h.focus();const r=document.createRange();r.setStart(n,2);r.setEnd(n,6);const s=getSelection();s.removeAllRanges();s.addRange(r);return s.toString()})()`);
  await sleep(150);
};
// 저장 위치 고르기를 흉내 낸다. fail: 던질 오류 이름, pickDelay·writeDelay: 느린 응답(ms)
const mockPicker = ({fail, pickDelay = 0, writeDelay = 0} = {}) =>
  b.ev(`(()=>{window.__picks=0;window.__w=[];window.showSaveFilePicker=async()=>{window.__picks++;await new Promise(r=>setTimeout(r,${pickDelay}));${fail ? `throw Object.assign(new Error('x'),{name:${JSON.stringify(fail)}});` : ''}return {createWritable:async()=>({write:async(x)=>{await new Promise(r=>setTimeout(r,${writeDelay}));window.__w.push(x)},close:async()=>{}})}};return 1})()`);
const clickSave = async () => {
  const r = await rectOf(`document.querySelector('#dk-save')`);
  await b.click(r.x, r.y);
};
const pickFile = async (file) => {
  await b.send('DOM.enable');
  const d = await b.send('DOM.getDocument', {depth: 0});
  const n = await b.send('DOM.querySelector', {nodeId: d.root.nodeId, selector: '.dk-float input[type=file]'});
  await b.send('DOM.setFileInputFiles', {files: [file], nodeId: n.nodeId});
};
const clickCoverImage = async () => {
  await b.ev('dkKit.go(0);1');
  await settle();
  const img = await rectOf(`document.querySelector('${ACTIVE} img')`);
  await b.click(img.x, img.y);
  await sleep(100);
};
// 쪽 안에서 칸·그림·조작 막대가 아닌 빈 자리 하나를 찾는다
const emptySpot = () =>
  b.ev(`(()=>{const page=document.querySelector('${ACTIVE}');const r=page.getBoundingClientRect();for(let y=r.top+6;y<r.bottom-6;y+=6)for(let x=r.left+6;x<r.right-6;x+=6){const t=document.elementFromPoint(x,y);if(t&&t.closest('.dk-page')&&!t.closest('[data-dk-host],.dk-ui,img,svg,[data-dk-deco]'))return {x,y,tag:t.tagName+'.'+t.className}}return null})()`);

// ───────────── 임시 저장 안내 ─────────────
await scenario('1차-1·12·44 안내를 고르기 전 저장·고치기 막힘', '#4', async () => {
  const p = `[...document.querySelectorAll('${ACTIVE} [data-dk-host]')].find(h=>h.tagName==='P')`;
  await caretEnd(p);
  await b.type(' 본문고침A');
  await esc();
  await keyN();
  await caretEnd(`document.querySelector('#dk-note-text')`);
  await b.type(' 메모고침A');
  await esc();
  await draftHas('본문고침A', '메모고침A');
  const before = await draftSig();
  check('1차-1 준비: 본문·메모 고침이 임시 저장됨', before !== null && before.includes('본문고침A') && before.includes('메모고침A'));
  await reload();
  check('1차-1 다시 열면 안내가 뜸', await b.ev(`document.querySelector('.dk-banner')!=null`));
  await mockPicker();
  await b.key('s', 'KeyS', 83, 4); // ⌘S
  await clickSave();
  await sleep(200);
  check('1차-1 안내 중 ⌘S·저장 단추가 저장하지 않음', (await b.ev(`window.__picks`)) === 0 && (await b.ev(`document.querySelector('.dk-banner')!=null`)) && (await draftSig()) === before, String(await b.ev(`window.__picks`)));
  const h = await rectOf(p);
  await b.click(h.x, h.y);
  await b.type(' 막힘B');
  await b.key('x', 'KeyX', 88, 0, 'x');
  await sleep(1000);
  check('1차-12 안내 중에는 글자를 고칠 수 없고 임시 저장도 그대로', (await b.ev(`${p}.innerText.includes('막힘B')`)) === false && (await draftSig()) === before);
  await load();
  check('1차-44 불러오면 안내 전에 저장해 둔 본문·메모가 모두 살아남', (await b.ev(`${p}.innerText.includes('본문고침A')`)) && (await b.ev(`dkKit.state().book.pages[3].notes.includes('메모고침A')`)));
  await b.ev(`window.__picks=0;1`);
  await mockPicker();
  await b.key('s', 'KeyS', 83, 4);
  await sleep(250);
  check('1차-1 안내를 고른 뒤에는 저장됨', (await b.ev(`window.__picks`)) === 1 && (await status()).startsWith('저장됨'), await status());
});

// ───────────── 입력 ─────────────
await scenario('1차-3 빈 곳을 눌러도 커서가 튀지 않음', '#4', async () => {
  const spot = await emptySpot();
  check('1차-3 준비: 쪽 안에 빈 자리가 있음', !!spot, JSON.stringify(spot));
  if (!spot) return;
  const text0 = await b.ev(`document.querySelector('${ACTIVE}').innerText`);
  await b.click(spot.x, spot.y);
  check('1차-3 빈 곳을 누르면 어떤 칸에도 커서가 없음', await b.ev(`(()=>{const a=document.activeElement;const s=getSelection();return !(a&&a.closest&&a.closest('[data-dk-host]'))&&(!s.rangeCount||!(s.anchorNode&&(s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentElement).closest('[data-dk-host]')))})()`), JSON.stringify(spot));
  await b.key('ArrowRight', 'ArrowRight', 39);
  check('1차-3 이어 누른 → 가 쪽을 넘김', (await state('index')) === 4, String(await state('index')));
  await b.key('ArrowLeft', 'ArrowLeft', 37);
  await keyN();
  check('1차-3 이어 누른 N 이 메모를 엶(글자로 안 들어감)', !(await b.ev(`document.querySelector('.dk-speaker').hidden`)));
  check('1차-3 장표 글자가 바뀌지 않음', (await b.ev(`document.querySelector('${ACTIVE}').innerText`)) === text0);
});

await scenario('1차-5·41 가로 배치 칸은 일부 글자 서식이 막힘', '#2', async () => {
  const flex = findHost('대내외 환경');
  const before = await b.ev(`${flex}.innerHTML`);
  await selectPart(flex);
  check('1차-5 가로 배치 칸은 글자를 골라도 서식 막대가 안 뜸', (await floatsOpen()) === 0);
  await boldKey();
  check('1차-41 굵게(⌘B)가 먹지 않아 글자가 조각나지 않음', (await b.ev(`${flex}.innerHTML`)) === before, (await b.ev(`${flex}.innerHTML`)).slice(0, 100));
  // 대조: 가로 배치가 아닌 칸에서는 같은 명령이 먹는다
  const normal = findHost('AI 도입·활용');
  await selectPart(normal);
  await boldKey();
  check('1차-5 대조: 일반 칸에서는 같은 ⌘B 가 먹음', /font-weight|<b/.test(await b.ev(`${normal}.innerHTML`)));
});

await scenario('1차-6·22·38 메모를 열거나 창을 줄여도 거짓 경고 없음', '#1', async () => {
  const bad = async (label) => {
    const rows = [];
    for (let i = 0; i < 15; i++) {
      await b.ev(`dkKit.go(${i});1`);
      await sleep(70);
      const st = await status();
      const marks = await b.ev(`document.querySelectorAll('.dk-over,.dk-bad').length`);
      if (st.includes('넘침') || marks) rows.push(`${i + 1}쪽 ${st} ${marks}`);
    }
    check('1차-6·22·38 ' + label + ' 거짓 넘침 경고 없음', rows.length === 0, rows.join(' / '));
  };
  await keyN();
  check('1차-6 준비: 메모가 열림', !(await b.ev(`document.querySelector('.dk-speaker').hidden`)));
  await bad('메모를 연 채 15쪽 모두');
  await b.send('Emulation.setDeviceMetricsOverride', {width: 900, height: 600, deviceScaleFactor: 1, mobile: false});
  await sleep(300);
  await bad('창을 줄인 채 15쪽 모두');
  await b.send('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false});
  await sleep(300);
  await keyN();
  await bad('메모를 닫고 15쪽 모두');
});

// R12: 화면 그리기(requestAnimationFrame)가 멈춰도 시험 도우미가 60초씩 멈추지 않는다
await scenario('시험 도우미: 화면 그리기가 멈춰도 settle이 넘어감', '#11', async () => {
  check('R12 Chrome을 배경 멈춤 없이 띄움', ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'].every((f) => b.args.includes(f)), b.args.join(' '));
  await b.ev(`window.__raf0=window.requestAnimationFrame;window.requestAnimationFrame=()=>0;1`);
  const t0 = Date.now();
  let ok = false;
  try {
    ok = (await b.settle()) === true;
  } finally {
    await b.ev(`window.requestAnimationFrame=window.__raf0;1`);
  }
  const took = Date.now() - t0;
  check('R12 rAF가 멈춰도 settle이 1초 안에 끝남', ok && took < 1000, `${took}ms`);
  const t1 = Date.now();
  await settle();
  check('R12 평소 settle도 빨리 끝남', Date.now() - t1 < 1000, `${Date.now() - t1}ms`);
});

await scenario('1차-7 ⌘A 덮어쓰기에도 색 표시·화살표 유지', '#11', async () => {
  await pin(findHost('체류 인구'));
  const r = await rectOf(`window.__h`);
  await b.click(r.x, r.y);
  await selectAll();
  await b.type('새범례');
  const v = await b.ev(`(()=>{const h=window.__h;const s=h.parentElement;const i=s.querySelector('i');return {txt:h.innerText,iTxt:i?i.textContent:null,iStyle:i?i.getAttribute('style'):null,kids:s.children.length}})()`);
  check('11쪽 범례: 새 글자가 색 표시 밖의 칸으로 들어감', v.txt === '새범례' && v.iTxt === '' && v.kids === 2, JSON.stringify(v));
  await b.ev('dkKit.go(13);1');
  await settle();
  await pin(findHost('기획 · 측정'));
  const r2 = await rectOf(`window.__h`);
  await b.click(r2.x, r2.y);
  await selectAll();
  await b.type('새글');
  const w = await b.ev(`(()=>{const h=window.__h;const s=h.parentElement;return {txt:h.innerText,arrow:s.querySelector('i').textContent,kids:s.children.length}})()`);
  check('1차-7 14쪽: 새 글자가 화살표 밖의 칸으로 들어가고 ↔ 유지', w.txt === '새글' && w.arrow === '↔' && w.kids === 2, JSON.stringify(w));
});

await scenario('1차-8 끝에 줄바꿈이 붙은 붙여넣기에 빈 줄이 안 생김', '#12', async () => {
  const d3 = findHost('외부연계 데이터 자산화');
  await caretEnd(d3);
  const brs = () => b.ev(`(${d3}.innerHTML.match(/<br>/g)||[]).length`);
  const n0 = await brs();
  for (const tail of ['\\n', '\\r\\n', '\\n\\n']) {
    await b.ev(`(()=>{const dt=new DataTransfer();dt.setData('text/plain','추가문구${tail.replace(/\\/g, '\\\\')}');${d3}.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));return 1})()`);
  }
  await sleep(300);
  const html = await b.ev(`${d3}.innerHTML`);
  check('1차-8 끝 줄바꿈이 빈 줄(<br>)이 되지 않음', (await brs()) === n0 && !html.endsWith('<br>') && html.includes('추가문구'), html.slice(-60));
  check('1차-8 거짓 넘침 경고 없음', !(await status()).includes('넘침'), await status());
});

// ───────────── 큰 그림·읽을 수 없는 그림 ─────────────
await scenario('1차-11·42·2차-10·25 큰 그림을 넣어도 임시 저장이 이어지고 안내가 뜸', '#1', async () => {
  await clickCoverImage();
  check('큰 그림 준비: 그림 막대가 뜸', await b.ev(`[...document.querySelectorAll('.dk-float:not([hidden]) button')].some(x=>x.textContent==='그림 바꾸기')`));
  await pickFile(BIG_PNG);
  await sleep(2500);
  const swapped = await b.ev(`document.querySelector('${ACTIVE} img').src.startsWith('data:image/png')&&document.querySelector('${ACTIVE} img').src.length>200000`);
  check('큰 그림 준비: 그림이 바뀜', swapped);
  const d1 = JSON.parse((await draftText()) || 'null');
  check('1차-11 그림을 바꾸면 임시 저장에 큰 그림은 빼고 알림 표시를 남김', !!d1 && d1.bigImage === true && JSON.stringify(d1).length < 300000, d1 ? String(JSON.stringify(d1).length) : 'null');
  check('1차-42 임시 저장이 실패로 표시되지 않음', !(await status()).includes('임시 저장 안 됨'), await status());
  const host = findHost('AI혁신추진단TF');
  await caretEnd(host);
  await b.type('큰그림뒤글');
  await draftHas('큰그림뒤글');
  check('1차-11 큰 그림 뒤에 고친 글도 임시 저장됨', ((await draftText()) || '').includes('큰그림뒤글'));
  await reload();
  const banner = await b.ev(`document.querySelector('.dk-banner')?.innerText||''`);
  check('2차-10·25 다시 열면 안내에 큰 그림이 빠졌다고 알림', banner.includes('크기가 커서'), banner);
  await load();
  check('2차-10 불러온 글은 살아 있고 그림은 원래 그림', (await b.ev(`${findHost('큰그림뒤글')}!=null`)) && (await b.ev(`document.querySelector('${ACTIVE} img').src.startsWith('data:image/webp')`)));
});

await scenario('1차-52 읽을 수 없는 그림은 바꾸지 않고 알림', '#1', async () => {
  await clickCoverImage();
  const src0 = await b.ev(`document.querySelector('${ACTIVE} img').src`);
  await pickFile(BAD_PNG);
  await sleep(600);
  check('1차-52 그림은 그대로', (await b.ev(`document.querySelector('${ACTIVE} img').src`)) === src0);
  check('1차-52 읽을 수 없다는 알림', (await status()).includes('열 수 없습니다'), await status());
  check('1차-52 고친 것으로 치지 않음', (await b.ev('dkKit.state().dirty')) === false);
});

// ───────────── 닫을 때·깨진 임시 저장·파일 옮김 ─────────────
await scenario('1차-14·45 입력 직후 새로고침해도 마지막 입력이 임시 저장됨', '#15', async () => {
  const p = findHost('연간 실적');
  const r = await rectOf(p);
  await b.click(r.x, r.y);
  await caretEnd(p);
  await b.type('닫기직전글');
  check('1차-14 준비: 아직 0.8초가 안 지나 임시 저장이 없음', (await draftText()) === null);
  await reload();
  check('1차-14·45 다시 열면 안내가 뜸', await b.ev(`document.querySelector('.dk-banner')!=null`));
  await load();
  check('1차-45 닫기 직전에 친 글이 들어 있음', await b.ev(`${findHost('닫기직전글')}!=null`));
});

await scenario('1차-46 깨진 임시 저장이 이후 임시 저장을 막지 않음', '#15', async () => {
  await b.ev(`localStorage.setItem(${DRAFT},'{깨진 값');1`);
  await reload();
  check('1차-46 깨진 값이면 안내 없이 열림', await b.ev(`document.querySelector('.dk-banner')==null`));
  const p = findHost('연간 실적');
  await caretEnd(p);
  await b.type('깨진뒤입력');
  await draftHas('깨진뒤입력');
  let ok = false;
  try {
    ok = JSON.parse(await draftText()).pages != null;
  } catch {}
  check('1차-46 이어서 고친 글이 정상 임시 저장으로 덮어씀', ok && ((await draftText()) || '').includes('깨진뒤입력'));
  check('1차-46 임시 저장 안 됨 표시가 없음', !(await status()).includes('임시 저장 안 됨'), await status());
});

await scenario('1차-47 파일을 다른 경로에 두어도 같은 문서의 임시 저장 안내', '#15', async () => {
  const p = findHost('연간 실적');
  await caretEnd(p);
  await b.type('경로옮김글');
  await draftHas('경로옮김글');
  await b.nav('about:blank');
  await b.nav(MOVED, '#15');
  await ready();
  const hit = await b.ev(`document.querySelector('.dk-banner')!=null`);
  check('1차-47 다른 경로의 같은 문서에도 안내가 뜸', hit);
  if (hit) {
    await load();
    check('1차-47 불러오면 글이 살아 있음', await b.ev(`${findHost('경로옮김글')}!=null`));
  }
});

// ───────────── 쪽 제목 ─────────────
await scenario('1차-16·33·49 표지에 보이는 제목을 고치면 쪽 목록·메모 제목이 바뀜', '#1', async () => {
  // 표지에는 숨은 머리줄 제목과 눈에 보이는 큰 제목이 따로 있다. 눈에 보이는 쪽을 눌러 고친다
  const vis = `[...document.querySelectorAll('${ACTIVE} h1[data-dk-host]')].find(h=>h.getBoundingClientRect().height>20)`;
  const r = await rectOf(vis);
  await b.click(r.x, r.y);
  await caretEnd(vis);
  await b.type('(표지수정)');
  await sleep(200);
  const got = await b.ev(`({opt:document.querySelector('#dk-picker').options[0].textContent,book:dkKit.state().book.pages[0].title,note:document.querySelector('#dk-note-title').textContent,tab:document.title})`);
  check('1차-16 쪽 목록에 반영', got.opt.includes('(표지수정)'), JSON.stringify(got));
  check('1차-33 메모 제목에 반영', got.note.includes('(표지수정)'), got.note);
  check('1차-49 자료(book)의 쪽 제목에 반영', got.book.includes('(표지수정)'), got.book);
  check('1차-16 탭 제목에 반영', got.tab.includes('(표지수정)'), got.tab);
});

await scenario('2차-14 제목을 고치면 쪽을 옮기기 전에 탭 제목이 바뀜', '#2', async () => {
  const h1 = `document.querySelector('${ACTIVE} .page-header h1')`;
  await caretEnd(h1);
  await b.type('(탭수정)');
  await sleep(200);
  check('2차-14 쪽을 옮기지 않아도 탭 제목이 바뀜', (await b.ev(`document.title`)).includes('(탭수정)'), await b.ev(`document.title`));
  check('2차-14 쪽 목록·메모 제목도 함께 바뀜', await b.ev(`document.querySelector('#dk-picker').options[1].textContent.includes('(탭수정)')&&document.querySelector('#dk-note-title').textContent.includes('(탭수정)')`));
});

// ───────────── 메모 핵심 문장 ─────────────
await scenario('1차-18·50 핵심 문장에 Enter·붙여넣기로 줄바꿈이 들어가지 않음', '#4', async () => {
  await keyN();
  const key = `document.querySelector('#dk-note-key')`;
  await caretEnd(key);
  await b.key('Enter', 'Enter', 13, 0, '\r');
  await b.type('이어쓴말');
  await b.ev(`(()=>{const dt=new DataTransfer();dt.setData('text/plain','첫줄\\n둘째줄');${key}.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));return 1})()`);
  await esc();
  await b.ev('dkKit.go(2);dkKit.go(3);1');
  const v = await b.ev(`({html:${key}.innerHTML,text:${key}.textContent,book:dkKit.state().book.pages[3].key})`);
  check('1차-18 핵심 문장 안에 줄바꿈 태그가 없음', !/<br|<div|<p/.test(v.html) && v.text.includes('이어쓴말') && v.text.includes('첫줄 둘째줄'), v.html.slice(-60));
  check('1차-50 쪽을 다녀온 뒤에도 화면과 자료가 같음', !v.book.includes('\n') && v.book === v.text, JSON.stringify(v.book.slice(-30)));
});

// ───────────── 넘침 경고: 표지·띠·옆 칸·쪽 안 겹침 ─────────────
await scenario('1차-19(후반)·21·54 표지 아래 띠가 길어져 위 내용을 덮으면 경고', '#1', async () => {
  const st0 = await status();
  check('1차-21 준비: 손대기 전에는 경고 없음', !st0.includes('넘침'), st0);
  const band = findHost('AI와 함께, 국민의 공간으로');
  await caretEnd(band);
  await b.type(' 띠 글이 길어져 위로 자라며 표지 내용을 덮습니다.'.repeat(14));
  await sleep(350);
  const st = await status();
  check('1차-19·21·54 띠가 위 칸을 덮으면 넘침 경고', st.includes('넘침') && (await b.ev(`document.querySelector('${ACTIVE}').classList.contains('dk-over')`)), st);
  await b.ev(`document.execCommand('undo');1`);
  await sleep(350);
  check('1차-21 되돌리면 경고가 사라짐', !(await status()).includes('넘침'), await status());
});

await scenario('1차-21 고정 높이 띠에 글이 넘치면 경고', '#15', async () => {
  const band = findHost('외부 전문성으로');
  await caretEnd(band);
  await b.type(' 띠 안에 아주 긴 글을 계속 넣어 칸 밖으로 넘치게 합니다.'.repeat(30));
  await sleep(350);
  check('1차-21 띠 칸을 넘치면 경고', (await status()).includes('넘침'), await status());
});

await scenario('1차-21·54 옆 칸·그림과 겹치면 경고', '#14', async () => {
  const side = findHost('전략기획·성과관리');
  await caretEnd(side);
  await b.type(' 옆 칸을 밀고 들어가도록 아주 긴 글을 넣습니다.'.repeat(25));
  await sleep(350);
  check('1차-21·54 길어진 칸이 다른 칸·상자를 넘으면 경고', (await status()).includes('넘침'), await status());
});

await scenario('1차-29·2차-19 상자가 쪽번호 선을 덮으면 경고, 선 위 여유는 허용 안에서만', '#13', async () => {
  // 쪽 안에 글자 없는 상자를 두고 바닥을 쪽번호 선에서 d만큼 내려 놓는다(1배 상태로 맞춘다)
  const put = async (d) => {
    await b.ev(`(()=>{const doc=document.querySelector('#dk-document');doc.classList.add('dk-measuring');
      const page=document.querySelector('${ACTIVE}');const footer=page.querySelector('.page-footer,[data-dk-footer],footer');const lim=footer.getBoundingClientRect().top;
      let m=document.getElementById('__box');if(!m){m=document.createElement('div');m.id='__box';m.style.cssText='position:absolute;left:30px;width:80px;height:8px;background:#c00';page.querySelector('.dk-page-inner').append(m)}
      m.style.top='0px';const r0=m.getBoundingClientRect();m.style.top=(lim+${d}-8-r0.top)+'px';
      doc.classList.remove('dk-measuring');
      const h=page.querySelector('[data-dk-host]');h.dispatchEvent(new InputEvent('input',{bubbles:true}));return 1})()`);
    await sleep(400);
  };
  await put(-30);
  check('1차-29 준비: 선 위에 있으면 경고 없음', !(await status()).includes('넘침'), await status());
  await put(2);
  check('1차-29 허용 3px 안(2px)은 경고 없음', !(await status()).includes('넘침'), await status());
  await put(10);
  check('1차-29·2차-19 선을 10px 덮으면 경고(예전의 16px 여유는 쓰지 않음)', (await status()).includes('넘침'), await status());
  await put(-30);
  check('2차-19 선 위로 되돌리면 경고가 사라짐', !(await status()).includes('넘침'), await status());
});

// ───────────── 막대 ─────────────
await scenario('1차-15·25·26·27·48 서식 막대·그림 막대가 남지 않음', '#15', async () => {
  const band = findHost('외부 전문성으로');
  await selectPart(band);
  check('1차-15 준비: 글자를 고르면 서식 막대가 뜸', (await floatsOpen()) === 1);
  await esc();
  check('1차-15 고른 글자가 풀리면(Esc) 서식 막대가 사라짐', (await floatsOpen()) === 0);
  await selectPart(band);
  const spot = await emptySpot();
  if (spot) {
    await b.click(spot.x, spot.y);
    check('1차-15 빈 곳을 눌러 선택이 풀리면 서식 막대가 사라짐', (await floatsOpen()) === 0 && (await b.ev(`getSelection().isCollapsed`)));
  } else check('1차-15 빈 곳 찾기', false);

  await selectPart(band);
  check('1차-25 준비: 서식 막대가 뜸', (await floatsOpen()) === 1);
  const prev = await rectOf(`document.querySelector('#dk-prev')`);
  await b.click(prev.x, prev.y);
  check('1차-25 쪽을 넘기면 서식 막대·선택이 사라짐', (await floatsOpen()) === 0 && (await state('index')) === 13 && (await b.ev(`getSelection().isCollapsed`)), String(await floatsOpen()));
  await b.ev('dkKit.go(14);1');

  await clickCoverImage();
  check('1차-27 준비: 그림 막대가 뜸', (await floatsOpen()) === 1);
  await b.key('ArrowRight', 'ArrowRight', 39);
  check('1차-27·48 키보드로 쪽을 넘기면 그림 막대가 사라짐', (await floatsOpen()) === 0 && (await state('index')) === 1, `${await floatsOpen()} / ${await state('index')}`);
  await b.ev('dkKit.go(0);1');
  await settle();
  const img = await rectOf(`document.querySelector('${ACTIVE} img')`);
  await b.click(img.x, img.y);
  await sleep(80);
  const txt = await rectOf(findHost('AI혁신추진단TF'));
  await b.click(txt.x, txt.y);
  check('1차-48 그림 막대가 뜬 뒤 글자를 누르면 그림 막대가 사라짐', (await b.ev(`[...document.querySelectorAll('.dk-float:not([hidden]) button')].some(x=>x.textContent==='그림 바꾸기')`)) === false);
});

await scenario('1차-26 연속 읽기에서 글자를 고른 채 스크롤하면 서식 막대가 사라짐', '#3', async () => {
  await b.ev(`document.querySelector('#dk-read').click();1`);
  await sleep(300);
  await selectPart(findHost('지향점'));
  check('1차-26 준비: 서식 막대가 뜸', (await floatsOpen()) === 1);
  const v = await rectOf(`document.querySelector('#dk-viewport')`);
  await b.send('Input.dispatchMouseEvent', {type: 'mouseWheel', x: v.x, y: v.y, deltaX: 0, deltaY: 500});
  await sleep(400);
  check('1차-26 스크롤하면 서식 막대가 사라짐', (await floatsOpen()) === 0, String(await floatsOpen()));
});

// ───────────── 저장 ─────────────
await scenario('1차-24·51 경고가 떠 있어도 저장됨 표시가 나옴', '#5', async () => {
  const circle = `[...document.querySelectorAll('${ACTIVE} [data-dk-host]')].find(h=>h.innerText.trim()==='1')`;
  await caretEnd(circle);
  await b.type(' 1 1');
  await sleep(300);
  check('1차-24 준비: 넘침 경고가 떠 있음', (await status()).includes('넘침'), await status());
  await mockPicker();
  await clickSave();
  await sleep(300);
  const st = await status();
  check('1차-24·51 경고와 저장됨이 한 줄에 함께 나옴', st.includes('넘침') && st.includes('저장됨'), st);
});

await scenario('1차-34 편집을 끄면 아래 안내가 바뀜', '#15', async () => {
  const foot = () => b.ev(`document.querySelector('.dk-foot').textContent`);
  const on = await foot();
  await b.key('e', 'KeyE', 69, 0, 'e');
  const off = await foot();
  check('1차-34 편집이 켜진 안내는 편집 끄기', on.includes('E 편집 끄기') && on.includes('바로 고칩니다'), on.slice(-30));
  check('1차-34 편집을 끄면 안내가 편집 켜기로 바뀜', off.includes('E 편집 켜기') && !off.includes('편집 끄기') && !off.includes('바로 고칩니다'), off);
  await b.key('ㄷ', 'KeyE', 69, 0, 'ㄷ');
  check('1차-34 다시 켜면 처음 안내로 돌아옴', (await foot()) === on);
});

await scenario('1차-35 내려받기는 취소돼도 알 수 없으므로 임시 저장을 남김', '#15', async () => {
  const p = findHost('연간 실적');
  await caretEnd(p);
  await b.type('내려받기시험');
  await b.send('Browser.setDownloadBehavior', {behavior: 'deny'});
  await b.ev(`window.showSaveFilePicker=undefined;1`);
  await clickSave();
  await sleep(500);
  check('1차-35 내려받음 표시', (await status()).startsWith('내려받음'), await status());
  check('1차-35 임시 저장은 지워지지 않음', ((await draftText()) || '').includes('내려받기시험'));
  await reload();
  check('1차-35 거부된 뒤 다시 열면 불러오기 안내', await b.ev(`document.querySelector('.dk-banner')!=null`));
});

await scenario('1차-36 저장 위치 오류는 내려받기로 넘어가되 임시 저장을 남김', '#15', async () => {
  const p = findHost('연간 실적');
  await caretEnd(p);
  await b.type('오류시험');
  await draftHas('오류시험');
  await b.send('Browser.setDownloadBehavior', {behavior: 'deny'});
  await mockPicker({fail: 'NotAllowedError'});
  await clickSave();
  await sleep(500);
  check('1차-36 다른 오류면 내려받음으로 표시', (await status()).startsWith('내려받음') || (await status()).includes('내려받음'), await status());
  check('1차-36 임시 저장은 남음', ((await draftText()) || '').includes('오류시험'));
});

await scenario('1차-36 저장을 취소하면 저장됨으로 치지 않음', '#15', async () => {
  const p = findHost('연간 실적');
  await caretEnd(p);
  await b.type('취소시험');
  await draftHas('취소시험');
  await mockPicker({fail: 'AbortError'});
  await clickSave();
  await sleep(400);
  const st = await status();
  check('1차-36 취소하면 저장 안 됨 그대로', st.includes('저장 안 됨') && !st.includes('저장됨'), st);
  check('1차-36 취소해도 임시 저장 유지', ((await draftText()) || '').includes('취소시험'));
});

await scenario('1차-36 저장 단추를 연달아 눌러도 한 번만 저장', '#15', async () => {
  const p = findHost('연간 실적');
  await caretEnd(p);
  await b.type('이중클릭');
  await mockPicker({pickDelay: 500});
  await clickSave();
  await clickSave();
  await clickSave();
  await sleep(900);
  check('1차-36 저장 위치 묻기는 한 번', (await b.ev(`window.__picks`)) === 1 && (await b.ev(`window.__w.length`)) === 1, `${await b.ev(`window.__picks`)}/${await b.ev(`window.__w.length`)}`);
  check('1차-36 저장됨 표시', (await status()).startsWith('저장됨'), await status());
});

await scenario('1차-43 쓰는 사이에 더 친 글자는 저장 안 됨으로 남음', '#15', async () => {
  const p = findHost('연간 실적');
  await caretEnd(p);
  await b.type('먼저');
  await mockPicker({writeDelay: 600});
  await clickSave();
  await caretEnd(p);
  await b.type('쓰는중글');
  await sleep(1500);
  const st = await status();
  check('1차-43 파일에는 쓰는 중에 친 글자가 없음', (await b.ev(`window.__w.length`)) === 1 && !(await b.ev(`window.__w[0]`)).includes('쓰는중글'));
  check('1차-43 그래도 저장 안 됨으로 남음', st.includes('저장 안 됨'), st);
  check('1차-43 임시 저장이 남아 더 친 글자를 지키고 있음', ((await draftText()) || '').includes('쓰는중글'));
});

// ───────────── 메모 패널 ─────────────
await scenario('2차-28 메모에서 ⌘B 가 먹지 않고, 제목·근거 줄을 끌어 고를 수 있음', '#4', async () => {
  await keyN();
  const note = `document.querySelector('#dk-note-text')`;
  const r = await rectOf(note);
  await b.click(r.x, r.y);
  await caretEnd(note);
  await b.type('굵게시험');
  await selectAll();
  await boldKey();
  check('2차-28 메모에서 ⌘B 가 먹지 않음', !/<b|<strong|font-weight/.test(await b.ev(`${note}.innerHTML`)), await b.ev(`${note}.innerHTML`));
  await esc();
  await b.ev('dkKit.go(3);1');
  const t = await rectOf(`document.querySelector('#dk-note-title')`);
  await dragSteps(t.left + 6, t.top + 10, t.left + 150, t.top + 10);
  const sel = await b.ev(`getSelection().toString()`);
  check('2차-28 편집이 켜진 채로도 메모 제목을 끌어 고를 수 있음', sel.length > 1, JSON.stringify(sel));
});

clearInterval(autoDialog);
await b.close();
console.log(fails ? `\n실패 ${fails}건 (통과 ${passes}건)` : `\n모두 통과 (${passes}건)`);
process.exit(fails ? 1 : 0);
