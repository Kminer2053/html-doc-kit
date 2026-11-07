// "완성"의 판정. 모델의 판단에 맡기지 않는다
import crypto from 'node:crypto';
import {attr, byId, classes, find, findAll, htmlOf, isScriptAnimation, isScriptAttr, parse, walk} from './html.mjs';
import {HASHES, VERSION} from './assets.gen.mjs';

export const sha = (s) => crypto.createHash('sha256').update(s.replace(/\r\n?/g, '\n')).digest('hex').slice(0, 32);
const textIn = (n) => (n ? n.childNodes.map((c) => c.value || '').join('') : null);
const KIT_TAGS = ['dk-book', 'dk-base', 'dk-kit-code'];
const KIT_STYLES = ['dk-kit-style', 'dk-font-style', 'dk-base-style'];
const DOC_STYLES = ['dk-doc-style', 'dk-page-sizes'];
// 겹치면 먼저 나온 것과 나중 것이 서로 다른 일을 하게 되는 id
const ONLY_ONE = [...KIT_TAGS, ...KIT_STYLES, 'dk-doc-style', 'dk-document', 'dk-workspace', 'dk-viewport'];
const BANNED = ['iframe', 'object', 'embed', 'base', 'frame', 'frameset', 'applet'];

export function isOff(source) {
  return /<meta[^>]+name=["']?doc-kit["']?[^>]+content=["']?off/i.test(source);
}
export const newerThan = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

// CSS 이스케이프(@\69mport)와 주석을 풀어 브라우저가 읽는 글자로 본다
const plainCss = (css) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (all, hex) => {
      const code = parseInt(hex, 16);
      return code && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/\\(.)/g, '$1');
function cssErrors(css) {
  const out = [];
  const text = plainCss(css);
  if (/@import/i.test(text.replace(/"[^"]*"|'[^']*'/g, '""'))) out.push('C4 외부 스타일 불러오기(@import)');
  for (const face of text.match(/@font-face\s*\{[^}]*\}/gi) || []) {
    if (/url\(\s*['"]?\s*(https?:)?\/\//i.test(face)) out.push('C4 외부 글꼴(@font-face)');
  }
  return out;
}

// C1~C5: 브라우저 없이 판정한다
export function inspect(source) {
  const tree = parse(source);
  const errors = [];
  const root = htmlOf(tree);
  const version = root && attr(root, 'data-doc-kit');
  if (!version || !find(tree, (c) => c.tagName === 'meta' && attr(c, 'name') === 'doc-kit-version')) errors.push('C1 키트 표식이 없습니다');
  const hashes = HASHES[version];
  // 설치된 키트보다 새 파일: 해시로 판정할 수 없다. 부품이 다 있을 때만 온전한 것으로 본다(가짜 표식 방지)
  const future = !!version && !hashes && newerThan(version, VERSION);
  const parts = {code: 'dk-kit-code', style: 'dk-kit-style', font: 'dk-font-style', base: 'dk-base-style'};
  if (version && !hashes && !future) errors.push(`C2 알 수 없는 키트 버전입니다: ${version}`);
  for (const [k, id] of Object.entries(parts)) {
    const t = textIn(byId(tree, id));
    if (t === null || (future && !t.trim())) errors.push(`C2 키트 부품이 없습니다: ${id}`);
    else if (hashes && sha(t) !== hashes[k]) errors.push(`C2 키트 코드가 바뀌었습니다: ${id}`);
  }
  if (!byId(tree, 'dk-book') || !byId(tree, 'dk-base') || !byId(tree, 'dk-document') || !byId(tree, 'dk-viewport')) errors.push('C3 필수 요소가 없습니다');
  // 부품이 겹치면 해시가 맞아도 뒤의 부품이 앞의 것을 덮어쓴다
  for (const id of ONLY_ONE) if (findAll(tree, (c) => attr(c, 'id') === id).length > 1) errors.push(`C3 키트 요소가 겹칩니다: ${id}`);
  // 쪽은 #dk-document의 직접 자식만 센다(kit.js와 같은 기준)
  const pages = byId(tree, 'dk-document') ? byId(tree, 'dk-document').childNodes.filter((c) => classes(c).includes('dk-page')) : [];
  if (!pages.length) errors.push('C3 쪽이 없습니다');
  const book = byId(tree, 'dk-book');
  if (book) {
    try {
      const b = JSON.parse(textIn(book) || '{}');
      if ((b.pages || []).length !== pages.length) errors.push('C3 메모 자료와 쪽 수가 다릅니다');
    } catch {
      errors.push('C3 메모 자료가 깨졌습니다');
    }
  }
  walk(tree, (n) => {
    if (!n.tagName) return true;
    const id = attr(n, 'id');
    if (n.tagName === 'link' && /stylesheet/i.test(attr(n, 'rel') || '')) errors.push(`C4 외부 스타일: ${attr(n, 'href')}`);
    if (n.tagName === 'script') {
      if (attr(n, 'src')) errors.push(`C4 외부 스크립트: ${attr(n, 'src')}`);
      else if (!KIT_TAGS.includes(id)) errors.push('C5 키트 밖 스크립트가 있습니다');
      // 설치된 키트 기준의 모양 검사다. 더 새 키트의 모양은 알 수 없다
      else if (!future && (n.attrs.length !== (id === 'dk-kit-code' ? 1 : 2) || (id !== 'dk-kit-code' && attr(n, 'type') !== 'application/json'))) errors.push(`C5 키트 부품의 속성이 바뀌었습니다: ${id}`);
    }
    if (n.tagName === 'style') {
      const known = [...KIT_STYLES, ...DOC_STYLES].includes(id);
      if (!known && !future) errors.push('C5 키트 밖 스타일이 있습니다');
      // media, disabled 같은 속성으로 키트 CSS를 끌 수 있다
      if (known && !future && n.attrs.length !== 1) errors.push(`C5 키트 부품의 속성이 바뀌었습니다: ${id}`);
      // 키트 부품 글자는 해시로 이미 확인했다
      if (!(hashes && KIT_STYLES.includes(id))) errors.push(...cssErrors(textIn(n)));
    }
    if (n.tagName === 'meta' && (attr(n, 'http-equiv') || '').trim().toLowerCase() === 'refresh') errors.push('C5 자동 이동(meta refresh)');
    if (BANNED.includes(n.tagName)) errors.push(`C5 허용하지 않는 요소: ${n.tagName}`);
    if (isScriptAnimation(n)) errors.push('C5 javascript: 주소');
    for (const a of n.attrs || []) {
      if (a.name.toLowerCase().startsWith('on')) errors.push(`C5 실행 속성: ${a.name}`);
      if (isScriptAttr(a.name, a.value)) errors.push('C5 javascript: 주소');
    }
    return true;
  });
  return {errors: [...new Set(errors)], version, pages: pages.length, newer: future && !errors.length};
}
export {VERSION};
