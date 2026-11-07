// 시험용: Chrome 헤드리스를 띄워 CDP로 조작한다
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const CHROME = process.env.DOC_KIT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function open(width = 1920, height = 1166) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ax2030-ed-'));
  const proc = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0', 'about:blank'], {stdio: 'ignore'});
  let port = null;
  for (let i = 0; i < 200 && !port; i++) {
    try {
      port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf-8').split('\n')[0];
    } catch {
      await sleep(100);
    }
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const {resolve, reject} = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      // 응답이 없으면 시험 전체가 멈추지 않고 그 시험만 실패하게 한다
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP 응답 없음: ${method} ${String(params.expression || '').slice(0, 120)}`));
      }, 60000);
      timer.unref();
      pending.set(id, {resolve: (v) => (clearTimeout(timer), resolve(v)), reject: (e) => (clearTimeout(timer), reject(e))});
      ws.send(JSON.stringify({id, method, params}));
    });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, userGesture: true});
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.setBypassCSP', {enabled: true}).catch(() => {});
  await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
  // 저장 전 확인 창이 시험을 막지 않게 자동으로 넘긴다
  const nav = async (file, hash = '') => {
    const n = events.length;
    await send('Page.navigate', {url: (file.startsWith('http') || file.startsWith('file:') ? file : pathToFileURL(path.resolve(file)).href) + hash});
    for (let i = 0; i < 400; i++) {
      if (events.slice(n).some((e) => e.method === 'Page.loadEventFired')) break;
      await sleep(50);
    }
    await ev('document.fonts.ready.then(()=>true)');
    await sleep(250);
  };
  const shot = async (out, clip) => {
    const r = await send('Page.captureScreenshot', {format: 'png', ...(clip ? {clip: {...clip, scale: 1}} : {})});
    fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
  };
  const key = async (k, code, vk, modifiers = 0, text) => {
    await send('Input.dispatchKeyEvent', {type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, ...(text ? {text, unmodifiedText: text} : {})});
    await send('Input.dispatchKeyEvent', {type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers});
    await sleep(40);
  };
  const type = async (text) => {
    await send('Input.insertText', {text});
    await sleep(40);
  };
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y});
    await send('Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount: 1});
    await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', clickCount: 1});
    await sleep(60);
  };
  const close = async () => {
    ws.close();
    const exited = new Promise((r) => proc.once('exit', r));
    proc.kill();
    await Promise.race([exited, sleep(4000)]);
    fs.rmSync(profile, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  };
  return {send, ev, nav, shot, key, type, click, close, events};
}
export const CAPTURE_CSS = `.controls,.app-footer,.speaker{display:none!important}html,body{margin:0;background:#fff;overflow:hidden}#workspace{display:block!important;height:auto!important;padding:0!important}#viewport{display:block!important;overflow:visible!important}#canvas{zoom:1!important}.slide{box-shadow:none!important}`;
