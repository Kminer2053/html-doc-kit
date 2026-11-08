// C6 브라우저 시험. Chrome을 임시 프로필로 띄워 DevTools로 조작한다. 띄울 수 없으면 "미실행"으로 보고한다
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspect} from './check.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 다른 일과 경주시키는 타이머. 끄지 않으면 판정이 끝나도 프로세스가 시간만큼 살아 있다
function deadline(ms, value) {
  let t;
  const done = new Promise((r) => {
    t = setTimeout(() => r(value), ms);
  });
  return {done, cancel: () => clearTimeout(t)};
}
export function findChrome() {
  const list = [
    process.env.DOC_KIT_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return list.find((p) => p && fs.existsSync(p)) || null;
}

// 예전에 지우지 못한 임시 프로필을 치운다. 한 시간 넘게 지났고 Chrome 프로필 모양인 doc-kit-* 폴더만 지운다
export function sweepProfiles({dir = os.tmpdir(), now = Date.now()} = {}) {
  let list = [];
  try {
    list = fs.readdirSync(dir, {withFileTypes: true});
  } catch {
    return;
  }
  for (const d of list) {
    if (!d.isDirectory() || !d.name.startsWith('doc-kit-')) continue;
    const f = path.join(dir, d.name);
    try {
      if (now - fs.statSync(f).mtimeMs < 3600000) continue;
      const chromeMade = fs.existsSync(path.join(f, 'Local State')) || fs.existsSync(path.join(f, 'DevToolsActivePort')) || fs.statSync(path.join(f, 'Default'), {throwIfNoEntry: false})?.isDirectory();
      // Windows에서는 안쪽 파일만 지워지고 빈 폴더가 남기도 한다. mkdtemp 이름 꼴의 빈 폴더도 치운다
      if (chromeMade) fs.rmSync(f, {recursive: true, force: true});
      else if (/^doc-kit-[A-Za-z0-9]{6}$/.test(d.name) && !fs.readdirSync(f).length) fs.rmdirSync(f);
    } catch {}
  }
}

async function openChrome(chrome) {
  sweepProfiles();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-kit-'));
  const proc = spawn(chrome, ['--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0', '--window-size=1440,900', 'about:blank'], {stdio: 'ignore'});
  proc.unref(); // Chrome이 끝나지 않아도 명령은 끝난다
  let failed = null;
  proc.on('error', (e) => {
    failed = e;
  });
  let sock = null;
  const wait = async (ms) => {
    const exited = new Promise((r) => proc.once('exit', r));
    if (proc.exitCode !== null || proc.signalCode !== null) return true;
    const limit = deadline(ms, 'late');
    const r = await Promise.race([exited, limit.done]);
    limit.cancel();
    return r !== 'late';
  };
  // 먼저 Chrome에게 스스로 닫으라고 한다. 자식 프로세스까지 끝나야 Windows에서 프로필 파일이 풀린다
  const close = async () => {
    if (proc.exitCode === null && proc.signalCode === null && !failed) {
      let asked = false;
      if (sock && sock.readyState === 1) {
        try {
          sock.send(JSON.stringify({id: 0x7fffffff, method: 'Browser.close'}));
          asked = true;
        } catch {}
      }
      if (!asked || !(await wait(3000))) {
        // Windows에서는 kill이 본 프로세스만 끝낸다. 자식까지 함께 끝낸다
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true});
        else proc.kill();
        if (!(await wait(4000))) proc.kill('SIGKILL');
      }
    }
    // 지우지 못하면 잠깐 뒤 다시 해 본다. 그래도 남으면 다음 실행의 정리에 맡긴다
    for (let i = 0; i < 3; i++) {
      try {
        fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
        return;
      } catch {
        await sleep(500);
      }
    }
  };
  try {
    let port = null;
    for (let i = 0; i < 150 && !port; i++) {
      if (failed) throw failed;
      try {
        port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf-8').split('\n')[0];
      } catch {
        await sleep(100);
      }
    }
    if (!port) throw new Error('DevTools 포트 없음');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ws.onopen = r;
      ws.onerror = () => j(new Error('DevTools 연결 실패'));
    });
    sock = ws;
    let seq = 0;
    const pending = new Map();
    const errors = [];
    const events = [];
    let closed = false;
    ws.onclose = () => {
      closed = true;
      for (const {reject} of pending.values()) reject(new Error('브라우저 연결이 끊겼습니다'));
      pending.clear();
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        if (closed) return reject(new Error('브라우저 연결이 끊겼습니다'));
        const id = ++seq;
        pending.set(id, {resolve, reject});
        ws.send(JSON.stringify({id, method, params}));
      });
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) {
        const {resolve, reject} = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      else if (msg.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', {accept: true}).catch(() => {});
      else if (msg.method) events.push(msg.method);
    };
    await send('Page.enable');
    await send('Runtime.enable');
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const nav = async (file) => {
      const n = events.length;
      await send('Page.navigate', {url: pathToFileURL(path.resolve(file)).href});
      for (let i = 0; i < 300 && !closed && !events.slice(n).includes('Page.loadEventFired'); i++) await sleep(50);
      for (let i = 0; i < 300 && !closed; i++) {
        if (await ev(`document.documentElement.dataset.dkReady==='1'`).catch(() => false)) return true;
        await sleep(50);
      }
      return false;
    };
    return {send, ev, nav, errors, close: async () => {
      closed = true;
      await close();
      ws.close();
    }};
  } catch (e) {
    await close();
    throw e;
  }
}

// 쪽마다 글자·그림이 실제로 보이는지 본다.
// 아래로 넘친 글자는 W1 경고이고, auto 쪽의 오른쪽 넘침도 경고다. 왼쪽·위로 사라진 글자와 고정 쪽의 가로 이탈만 안 보이는 것으로 친다.
// 색과 가림은 확실할 때만 안 보이는 것으로 친다(틀리게 판정하면 멀쩡한 문서의 스타일을 버리게 된다)
const VISIBLE = `(()=>{
  const out=[];const warnings=[];
  const pages=[...document.querySelectorAll('#dk-document > .dk-page')];
  const view=document.querySelector('#dk-viewport');
  const rgba=(s)=>{const m=/^rgba?\\(([^)]+)\\)/.exec(s);if(!m)return null;const v=m[1].split(/[\\s,\\/]+/).filter(Boolean).map(parseFloat);return {r:v[0],g:v[1],b:v[2],a:v.length>3?v[3]:1}};
  const opacity=(e,stop)=>{let op=1;for(let x=e;x&&x!==stop;x=x.parentElement)op*=parseFloat(getComputedStyle(x).opacity);return op};
  // 글자 아래에 실제로 칠해진 단색. 그림·그라데이션·장식 요소가 있으면 알 수 없으므로 null
  const paper=(e,stack)=>{
    const at=stack.indexOf(e);if(at<0)return null;
    for(const x of stack.slice(at)){
      if(/^(IMG|CANVAS|VIDEO|svg|PICTURE|OBJECT)$/.test(x.tagName))return null;
      const c=getComputedStyle(x);if(c.backgroundImage!=='none')return null;
      for(const w of ['::before','::after'])if(getComputedStyle(x,w).content!=='none')return null;
      const k=rgba(c.backgroundColor);if(!k)return null;
      if(k.a>=0.99)return k;if(k.a>0.02)return null;
    }
    return null;
  };
  const sameColor=(a,b)=>Math.abs(a.r-b.r)+Math.abs(a.g-b.g)+Math.abs(a.b-b.b)<12;
  // 문서가 스스로 숨긴 글(hidden 속성, 닫힌 dialog·details, aria-hidden, noscript, template). 문서 CSS 없이도 안 보이므로 보이는 비율의 분모에 넣지 않는다
  const selfHidden=(e)=>{
    if(e.closest('[hidden],dialog:not([open]),[aria-hidden="true"],noscript,template'))return true;
    const d=e.closest('details:not([open])');if(!d)return false;
    const s=e.closest('summary');return !(s&&s.parentElement===d);
  };
  // 글자를 칠하는 다른 방법: 외곽선·그림자, 배경을 글자 모양으로 자르기(그라데이션 글자)
  const decorated=(c)=>c.textShadow!=='none'||parseFloat(c.webkitTextStrokeWidth||0)>0;
  const clipped=(e)=>{
    for(let x=e;x;x=x.parentElement){
      const s=getComputedStyle(x);
      if((s.backgroundClip==='text'||s.webkitBackgroundClip==='text')&&(s.backgroundImage!=='none'||(rgba(s.backgroundColor)||{a:0}).a>=0.05))return true;
      if(x.classList&&x.classList.contains('dk-page'))break;
    }
    return false;
  };
  pages.forEach((p,i)=>{
    dkKit.go(i);
    const fixed=p.hasAttribute('data-dk-fixed');
    const inner=p.querySelector('.dk-page-inner');
    const q=p.getBoundingClientRect();const vr=view.getBoundingClientRect();
    const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let all=0,seen=0,sampled=0,covered=0,probes=0,below=false;
    for(let n=w.nextNode();n;n=w.nextNode()){
      const t=n.nodeValue.trim();if(!t||n.parentElement.closest('style,script,svg,select,textarea,datalist'))continue;
      if(selfHidden(n.parentElement)){const r=document.createRange();r.selectNodeContents(n);if(!r.getClientRects().length)continue}
      all+=t.length;
      const e=n.parentElement;const c=getComputedStyle(e);
      if(c.visibility!=='visible')continue;
      // 실제로 칠하는 글자색은 -webkit-text-fill-color다(따로 정하지 않으면 color와 같다)
      const fill=rgba(c.webkitTextFillColor||'')||rgba(c.color);
      const deco=decorated(c);
      if(fill&&fill.a<0.05&&!deco&&!clipped(e))continue;
      const color=fill&&fill.a>=0.05&&!deco?fill:null;
      if(opacity(e,p)<0.05)continue;
      if(parseFloat(c.fontSize)<3)continue;
      const r=document.createRange();r.selectNodeContents(n);const b=r.getBoundingClientRect();
      if(!b.width||!b.height||b.bottom<q.top||b.right<q.left||(fixed&&b.left>q.right))continue;
      if(b.top>q.bottom)below=true;
      const f=[...r.getClientRects()].find(x=>x.width&&x.height);
      const cx=f.left+f.width/2,cy=f.top+f.height/2;
      // 크기가 0인 칸에 갇힌 글자는 안 보인다. 크기가 있는 칸 밖으로 넘친 글자는 넘침이지 숨김이 아니다
      let squeezed=false,inside=true;
      for(let x=e;x&&x!==p;x=x.parentElement){
        const s=getComputedStyle(x);if(s.overflowX==='visible'&&s.overflowY==='visible')continue;
        const o=x.getBoundingClientRect();
        if(o.width<2||o.height<2){squeezed=true;break}
        if(x!==inner&&(cx<o.left||cx>o.right||cy<o.top||cy>o.bottom))inside=false;
      }
      if(squeezed)continue;
      // 화면 안의 글자는 실제로 눌러 보고(clip-path 등), 바탕색과 같은지도 본다
      if(inside&&probes<300&&cx>=Math.max(q.left,vr.left)&&cx<=Math.min(q.right,vr.right)&&cy>=Math.max(q.top,vr.top)&&cy<=Math.min(q.bottom,vr.bottom)){
        probes++;sampled+=t.length;
        const stack=document.elementsFromPoint(cx,cy);
        if(c.pointerEvents!=='none'&&!stack.includes(e)){covered+=t.length;continue}
        if(color){
          const k=paper(e,stack);if(k&&sameColor(color,k)){covered+=t.length;continue}
        }
      }
      seen+=t.length;
    }
    // 그림: 깨진 그림과 아이콘 묶음(symbol)은 치지 않는다
    const media=[...p.querySelectorAll('img,svg')].filter(m=>{
      if(m.tagName==='IMG')return m.complete&&m.naturalWidth;
      return !m.parentElement.closest('svg')&&[...m.children].some(k=>!/^(defs|symbol|title|desc|style)$/i.test(k.tagName));
    });
    const shown=media.filter(m=>{const r=m.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(m).visibility==='visible'&&opacity(m,p)>=0.05});
    const blank=media.length>0&&!shown.length&&!seen;
    if(media.length&&!shown.length&&seen)warnings.push((i+1)+'쪽 그림이 보이지 않습니다');
    out.push({page:i+1,all,seen,sampled,covered,blank});
    if(fixed&&inner.scrollHeight>inner.clientHeight+2)warnings.push((i+1)+'쪽 내용이 쪽 높이를 '+(inner.scrollHeight-inner.clientHeight)+'px 넘습니다');
    else if(below)warnings.push((i+1)+'쪽 내용이 쪽 아래로 넘칩니다');
    if(!fixed&&inner.scrollWidth>inner.clientWidth+2)warnings.push((i+1)+'쪽 내용이 쪽 폭을 '+(inner.scrollWidth-inner.clientWidth)+'px 넘습니다');
    if(!all&&!p.querySelector('img,svg,table'))warnings.push((i+1)+'쪽이 비어 있습니다');
    p.querySelectorAll('img').forEach(im=>{if(im.complete&&!im.naturalWidth&&!/^https?:/.test(im.src))warnings.push((i+1)+'쪽 그림을 읽지 못했습니다')});
  });
  dkKit.go(0);
  return {out,warnings};
})()`;

// 저장·편집·이동·메모 단추가 실제로 보이고 눌리는가
const CONTROLS = `['dk-edit','dk-save','dk-next','dk-notes'].filter((id)=>{
  const e=document.querySelector('#'+id);if(!e)return true;
  const r=e.getBoundingClientRect();if(!r.width||!r.height||getComputedStyle(e).visibility!=='visible')return true;
  let op=1;for(let x=e;x;x=x.parentElement)op*=parseFloat(getComputedStyle(x).opacity);if(op<0.05)return true;
  const t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
  return !t||!(t===e||e.contains(t));
})`;

export async function browserCheck(file, {timeout = 45000} = {}) {
  const chrome = findChrome();
  if (!chrome) return {status: 'skip', reason: 'Chrome을 찾지 못했습니다', warnings: []};
  if (typeof WebSocket === 'undefined') return {status: 'skip', reason: `Node ${process.version}에는 내장 WebSocket이 없습니다(22 이상 필요)`, warnings: []};
  let b;
  try {
    b = await openChrome(chrome);
  } catch (e) {
    return {status: 'skip', reason: `브라우저를 띄우지 못했습니다: ${e.message}`, warnings: []};
  }
  let tmp = null;
  const fail = (reason, warnings = []) => ({status: 'fail', reason, warnings});
  // 준비 시간 초과는 문서 탓이 아닐 수 있다(늦는 인터넷 그림, 스크립트가 꺼진 환경). 키트 코드가 사라진 경우만 실패다
  const notReady = async (label, warnings = []) => {
    if (b.errors[0]) return fail(`${label}스크립트 오류: ${b.errors[0]}`, warnings);
    if (!(await b.ev(`!!document.querySelector('script#dk-kit-code')&&!!document.querySelector('#dk-document')`))) return fail(`${label}뷰어가 준비되지 않았습니다`, warnings);
    return {status: 'skip', reason: `${label}뷰어 준비 시간 초과`, warnings};
  };
  const body = async () => {
    if (!(await b.nav(file))) return notReady('');
    if (b.errors.length) return fail(`스크립트 오류: ${b.errors[0]}`);
    // 문서 내용이 document.body를 가리거나 틀을 무너뜨리면 조작 막대가 눌려도 뷰어는 망가진 것이다
    if (!(await b.ev(`(()=>{const w=document.querySelector('#dk-workspace');return document.body.tagName==='BODY'&&!!w&&getComputedStyle(w).position==='fixed'})()`))) return fail('뷰어 틀이 망가졌습니다');
    const broken = await b.ev(CONTROLS);
    if (broken.length) return fail(`조작 막대가 보이지 않거나 눌리지 않습니다: ${broken.join(', ')}`);
    const {out, warnings} = await b.ev(VISIBLE);
    const dark = out.filter((p) => (p.all >= 2 && p.seen / p.all < 0.5) || (p.sampled >= 2 && p.covered === p.sampled) || p.blank);
    if (dark.length) return fail(`본문이 보이지 않는 쪽이 있습니다: ${dark.map((p) => p.page).join(', ')}쪽`, warnings);
    const pages = await b.ev(`dkKit.state().pages`);
    if (pages > 1) {
      await b.ev(`document.querySelector('#dk-next').click();1`);
      if ((await b.ev(`dkKit.state().index`)) !== 1) return fail('쪽 이동이 되지 않습니다', warnings);
      await b.ev(`dkKit.go(0);1`);
    }
    // 글자 칸이 없는 문서(그림만 있음)는 메모 칸으로 시험한다
    await b.ev(`(()=>{const h=[...document.querySelectorAll('.dk-page.dk-active [data-dk-host]')].find(x=>x.getClientRects().length);if(h){h.focus();const r=document.createRange();r.selectNodeContents(h);r.collapse(false);const s=getSelection();s.removeAllRanges();s.addRange(r);return 1}document.querySelector('#dk-notes').click();document.querySelector('#dk-note-text').focus();return 2})()`);
    await b.send('Input.insertText', {text: '시'});
    await sleep(60);
    if (!(await b.ev(`dkKit.state().dirty`))) return fail('글자 입력이 되지 않습니다', warnings);
    const saved = await b.ev(`dkKit.cleanHtml()`);
    const leftovers = inspect(saved).errors;
    if (leftovers.length) return fail(`저장본이 온전하지 않습니다: ${leftovers[0]}`, warnings);
    tmp = path.join(os.tmpdir(), `doc-kit-roundtrip-${process.pid}-${Date.now()}.html`);
    fs.writeFileSync(tmp, saved);
    b.errors.length = 0;
    if (!(await b.nav(tmp))) return notReady('저장본 ', warnings);
    if (b.errors.length) return fail(`저장본 스크립트 오류: ${b.errors[0]}`, warnings);
    return {status: 'pass', warnings};
  };
  const limit = deadline(timeout, {status: 'skip', reason: '브라우저 시험 시간 초과', warnings: []});
  try {
    return await Promise.race([body(), limit.done]);
  } catch (e) {
    // 띄운 뒤의 오류는 통과로 넘기지 않는다. 다만 문서 스타일 탓은 아니므로 스타일을 버리지 않는다
    return {status: 'fail', reason: `브라우저 시험을 끝내지 못했습니다: ${e.message}`, warnings: [], blame: 'env'};
  } finally {
    limit.cancel();
    if (tmp) fs.rmSync(tmp, {force: true});
    await b.close().catch(() => {});
  }
}
