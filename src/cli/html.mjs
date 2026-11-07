// parse5 나무를 다루는 작은 도구들
import fs from 'node:fs';
import {parse, serialize, serializeOuter} from 'parse5';

export {parse, serialize, serializeOuter};

const strict = (label, buf) => new TextDecoder(label, {fatal: true}).decode(buf);
// 파일 끝에서 멀티바이트 글자가 잘린 UTF-8(쓰다 만 파일 등)은 그 잘린 조각만 빼고 푼다.
// 끝의 1~3바이트가 '시작 바이트 + 모자란 이어지는 바이트'일 때만이다. 중간에 깨진 바이트가 있으면 그대로 오류다
function utf8(buf, warn) {
  try {
    return strict('utf-8', buf);
  } catch (e) {
    for (let k = 1; k <= 3 && k < buf.length; k++) {
      const lead = buf[buf.length - k];
      if (lead < 0xc2 || lead > 0xf4) {
        if (lead >= 0x80 && lead <= 0xbf) continue; // 이어지는 바이트: 한 칸 더 앞을 본다
        break;
      }
      const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : 2;
      if (k >= need) break; // 글자가 다 있다. 끝이 잘린 것이 아니다
      let text;
      try {
        text = strict('utf-8', buf.subarray(0, buf.length - k));
      } catch {
        break;
      }
      if (warn) warn(`파일 끝에서 잘린 글자 조각(${k}바이트)을 빼고 읽었습니다. 파일이 끝까지 저장되었는지 확인하세요`);
      return text;
    }
    throw e;
  }
}
// 바이트를 글자로 푼다. 어떤 인코딩으로도 깨끗이 풀리지 않으면 깨진 글자로 덮어쓰지 않도록 오류를 낸다
export function decodeHtml(buf, {sniff = true, warn} = {}) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return utf8(buf, warn);
  if (buf[0] === 0xff && buf[1] === 0xfe) return strict('utf-16le', buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return strict('utf-16be', buf);
  if (buf[0] === 0x3c && buf[1] === 0) return strict('utf-16le', buf); // 표식 없는 UTF-16
  if (buf[0] === 0 && buf[1] === 0x3c) return strict('utf-16be', buf);
  try {
    return utf8(buf, warn); // 선언이 틀린 UTF-8도 있으므로 먼저 본다
  } catch {}
  const head = buf.subarray(0, 4096).toString('latin1');
  const label = sniff && /<meta\b[^>]*?charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1];
  if (label) {
    try {
      return strict(label, buf);
    } catch {
      throw new Error(`글자를 ${label}로 풀 수 없어 파일을 고치지 않았습니다. UTF-8로 저장한 뒤 다시 실행하세요`);
    }
  }
  throw new Error('글자 인코딩을 알 수 없어 파일을 고치지 않았습니다. UTF-8로 저장하거나 <meta charset>을 넣은 뒤 다시 실행하세요');
}
// HTML·마크다운을 읽는 유일한 길. ensure, apply, check, 훅이 모두 이 함수를 쓴다
export const readHtml = (file, opts) => {
  try {
    return decodeHtml(fs.readFileSync(file), opts);
  } catch (e) {
    throw new Error(e.code ? e.message : `${file}: ${e.message}`);
  }
};
// 브라우저는 주소의 탭·줄바꿈을 지우고 앞쪽 제어 문자를 건너뛴다. javascript: 판정은 그 뒤의 글자로 한다
const SCRIPT_URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'background']);
export const isScriptUrl = (v) => /^javascript:/i.test(String(v).replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+/, ''));
export const isScriptAttr = (name, value) => SCRIPT_URL_ATTRS.has(name.toLowerCase()) && isScriptUrl(value);
// SVG 애니메이션은 href를 javascript:로 바꿀 수 있다(<animate attributeName=href to=javascript:...>)
export const isScriptAnimation = (n) => ['animate', 'set'].includes(n.tagName) && (n.attrs || []).some((a) => ['to', 'from', 'by', 'values'].includes(a.name.toLowerCase()) && a.value.split(';').some(isScriptUrl));
export const isEl = (n) => n && n.tagName !== undefined;
export const attr = (n, k) => n.attrs && (n.attrs.find((a) => a.name === k) || {}).value;
export const hasAttr = (n, k) => !!(n.attrs && n.attrs.some((a) => a.name === k));
export const setAttr = (n, k, v) => {
  const a = n.attrs.find((x) => x.name === k);
  if (a) a.value = v;
  else n.attrs.push({name: k, value: v});
};
export const delAttr = (n, k) => {
  n.attrs = n.attrs.filter((a) => a.name !== k);
};
export const classes = (n) => (attr(n, 'class') || '').split(/\s+/).filter(Boolean);
export const addClass = (n, ...cs) => setAttr(n, 'class', [...new Set([...classes(n), ...cs])].join(' '));
export function walk(n, fn) {
  for (const c of [...(n.childNodes || [])]) {
    if (fn(c) === false) continue;
    walk(c, fn);
  }
  if (n.content) walk(n.content, fn);
}
export function find(n, pred) {
  let hit = null;
  walk(n, (c) => {
    if (hit) return false;
    if (isEl(c) && pred(c)) {
      hit = c;
      return false;
    }
    return true;
  });
  return hit;
}
export function findAll(n, pred) {
  const out = [];
  walk(n, (c) => {
    if (isEl(c) && pred(c)) out.push(c);
  });
  return out;
}
// 바깥쪽만: 찾은 요소 안은 더 들어가지 않는다
export function findOuter(n, pred) {
  const out = [];
  walk(n, (c) => {
    if (isEl(c) && pred(c)) {
      out.push(c);
      return false;
    }
    return true;
  });
  return out;
}
export const byId = (n, id) => find(n, (c) => attr(c, 'id') === id);
export const textOf = (n) => {
  let s = '';
  walk(n, (c) => {
    if (c.nodeName === '#text') s += c.value;
    if (c.tagName === 'style' || c.tagName === 'script') return false;
    return true;
  });
  return s;
};
export const remove = (n) => {
  const p = n.parentNode;
  if (p) p.childNodes = p.childNodes.filter((c) => c !== n);
};
export const inner = (n) => serialize(n);
export const htmlOf = (doc) => find(doc, (c) => c.tagName === 'html');
export const headOf = (doc) => find(doc, (c) => c.tagName === 'head');
export const bodyOf = (doc) => find(doc, (c) => c.tagName === 'body');
