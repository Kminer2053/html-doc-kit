// 본문 → 완성 문서. 뷰어·편집기는 여기서 넣으며 모델이 관여하지 않는다
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {marked} from 'marked';
import {addClass, attr, bodyOf, byId, classes, delAttr, find, findAll, findOuter, hasAttr, headOf, htmlOf, inner, isEl, isScriptAnimation, isScriptAttr, parse, readHtml, remove, serialize, setAttr, textOf, walk} from './html.mjs';
import {fixViewportUnits, scopeCss} from './css.mjs';
import {BASE_CSS, FONT_CSS, KIT_CSS, KIT_JS, VERSION} from './assets.gen.mjs';

export const SIZES = {
  slide: {w: 1920, h: 1080},
  a4: {w: 794, h: 1123},
  'a4-landscape': {w: 1123, h: 794},
  auto: {w: 794, h: 0},
};
const DROP = new Set(['script', 'iframe', 'object', 'embed', 'base', 'noscript', 'frame', 'frameset', 'applet']);
const MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.bmp': 'image/bmp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf'};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 주소 글자에서 실제 파일을 찾는다. 경로가 이상하거나 폴더이면 null이다
function localFile(ref, baseDir) {
  const clean = ref.trim().split(/[?#]/)[0];
  if (!clean || !baseDir) return null;
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {} // 파일 이름의 %는 그대로 쓴다
  // .doc-kit/ 안의 본문 파일에서 쓴 경로는 문서 폴더 기준으로도 찾는다
  const dirs = path.basename(path.resolve(baseDir)) === '.doc-kit' ? [baseDir, path.dirname(path.resolve(baseDir))] : [baseDir];
  for (const dir of dirs) {
    for (const name of [decoded, clean]) {
      const file = path.resolve(dir, name);
      try {
        if (fs.statSync(file).isFile()) return file;
      } catch {}
    }
  }
  return null;
}
// 로컬 그림·글꼴을 data URI로 바꾼다. 못 하면 경고하고 원래 값을 둔다. 파일 하나 때문에 문서 전체가 실패하지 않게 한다
function inlineRef(ref, baseDir, warn) {
  if (!ref || /^\s*(data:|#|about:|blob:)/i.test(ref)) return ref;
  if (/^\s*(https?:)?\/\//i.test(ref)) {
    warn(`인터넷 그림은 파일 안에 넣지 못했습니다: ${ref}`);
    return ref;
  }
  if (!baseDir) return ref;
  const file = localFile(ref, baseDir);
  if (!file) {
    warn(`그림을 찾지 못했습니다: ${ref}`);
    return ref;
  }
  try {
    const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  } catch (e) {
    warn(`그림을 읽지 못했습니다: ${ref} (${e.message})`);
    return ref;
  }
}
// CSS의 url(...)을 파일 안으로 넣는다. @import는 어차피 빠지므로 읽지 않는다
export function inlineCssUrls(css, baseDir, warn) {
  if (!/url\(/i.test(css)) return css;
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(@import\s+)?url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]+))\s*\)/gi, (all, imp, a, b, c) => {
    if (imp) return all;
    const ref = a ?? b ?? c;
    const to = inlineRef(ref, baseDir, warn);
    return to === ref ? all : `url("${to}")`;
  });
}

// 위험 요소를 빼고, 스타일을 모으고, 로컬 그림을 파일 안에 넣는다
export function sanitize(root, baseDir, warn) {
  const css = [];
  let scripts = 0;
  const dropped = new Map(); // 스크립트 밖에 지운 요소와 개수. 말없이 지우지 않고 알린다
  walk(root, (n) => {
    if (!isEl(n)) return true;
    if (n.tagName === 'plaintext') {
      // plaintext는 닫히지 않아 뒤에 붙는 키트 전체를 글자로 만든다
      n.tagName = 'pre';
      n.nodeName = 'pre';
    }
    const tag = n.tagName;
    if (isScriptAnimation(n)) {
      remove(n);
      return false;
    }
    if (DROP.has(tag)) {
      if (tag === 'script' && !(attr(n, 'id') || '').startsWith('dk-')) scripts++;
      if (tag !== 'script') dropped.set(tag, (dropped.get(tag) || 0) + 1);
      remove(n);
      return false;
    }
    if (tag === 'meta' && (attr(n, 'http-equiv') || '').toLowerCase() === 'refresh') {
      remove(n);
      return false;
    }
    if (tag === 'style') {
      css.push(inlineCssUrls(n.childNodes.map((c) => c.value || '').join(''), baseDir, warn));
      remove(n);
      return false;
    }
    if (tag === 'link') {
      const href = attr(n, 'href') || '';
      if ((attr(n, 'rel') || '').toLowerCase().includes('stylesheet')) {
        const file = !/^\s*(https?:)?\/\//i.test(href) ? localFile(href, baseDir) : null;
        let text = null;
        try {
          if (file) text = readHtml(file, {sniff: false});
        } catch (e) {
          warn(`스타일 파일을 읽지 못했습니다: ${href} (${e.message})`);
        }
        if (text !== null) css.push(inlineCssUrls(text, path.dirname(file), warn));
        else warn(`외부 스타일을 뺐습니다: ${href}`);
      }
      remove(n);
      return false;
    }
    n.attrs = (n.attrs || []).filter((a) => {
      const k = a.name.toLowerCase();
      if (k.startsWith('on')) return false;
      if (isScriptAttr(k, a.value)) return false;
      // 이름 붙은 img·form은 document.body, document.createElement 같은 값을 가려 키트를 망가뜨린다
      if (k === 'name' && (tag === 'img' || tag === 'form')) return false;
      // 그림 번호는 키트가 새로 매긴다. 남기면 끼워 넣은 그림과 번호가 겹쳐 임시 저장에서 옛 그림으로 바뀐다
      return !['contenteditable', 'data-dk-host', 'data-dk-deco', 'data-dk-img', 'spellcheck'].includes(k);
    });
    const inlineStyle = attr(n, 'style');
    if (inlineStyle) setAttr(n, 'style', fixViewportUnits(inlineCssUrls(inlineStyle, baseDir, warn)));
    if (tag === 'image') {
      for (const a of n.attrs) if (a.name === 'href' || a.name === 'xlink:href') a.value = inlineRef(a.value, baseDir, warn);
    }
    const id = attr(n, 'id');
    if (id && id.startsWith('dk-')) setAttr(n, 'id', 'x-' + id);
    if (hasAttr(n, 'class')) {
      const cs = classes(n).filter((c) => !['dk-over', 'dk-bad', 'dk-active'].includes(c));
      if (cs.length) setAttr(n, 'class', cs.join(' '));
      else delAttr(n, 'class');
    }
    if (tag === 'img') {
      const src = attr(n, 'src') || '';
      delAttr(n, 'srcset');
      if (src) setAttr(n, 'src', inlineRef(src, baseDir, warn));
      else warn('src가 없는 그림이 있습니다');
    }
    return true;
  });
  if (scripts) warn(`스크립트 ${scripts}개를 뺐습니다. 차트는 SVG나 표로 넣어 주세요`);
  if (dropped.size) warn(`지운 요소: ${[...dropped].map(([t, k]) => `${t} ${k}개`).join(', ')}(뷰어 안에서 외부 내용을 띄우지 않습니다)`);
  return css.join('\n');
}

function metaOf(head, name) {
  const m = head && find(head, (c) => c.tagName === 'meta' && attr(c, 'name') === name);
  return m ? attr(m, 'content') : undefined;
}

// 페이지 후보: data-page → .slide/.page → 맨 위 section 2개 이상 → 전체 한 쪽
function pickPages(body) {
  let found = findOuter(body, (c) => hasAttr(c, 'data-page'));
  if (found.length) return {nodes: found, how: 'mark'};
  found = findOuter(body, (c) => ['slide', 'page'].some((x) => classes(c).includes(x)));
  if (found.length) return {nodes: found, how: classes(found[0]).includes('slide') ? 'slide' : 'page'};
  const top = find(body, (c) => c.tagName === 'main') || body;
  found = top.childNodes.filter((c) => c.tagName === 'section' || c.tagName === 'article');
  if (found.length >= 2) return {nodes: found, how: 'section'};
  return {nodes: [], how: 'whole'};
}

function notesOf(node) {
  let notes = attr(node, 'data-notes') || '';
  const aside = find(node, (c) => hasAttr(c, 'data-notes-block') || (c.tagName === 'aside' && (classes(c).includes('notes') || hasAttr(c, 'data-notes'))));
  if (aside) {
    notes = notes || textOf(aside).trim();
    remove(aside);
  }
  return notes;
}

function markTitle(fragmentRoot) {
  if (find(fragmentRoot, (c) => hasAttr(c, 'data-dk-title'))) return;
  const h = find(fragmentRoot, (c) => ['h1', 'h2'].includes(c.tagName));
  if (h) setAttr(h, 'data-dk-title', '');
}
const titleText = (root) => findAll(root, (c) => hasAttr(c, 'data-dk-title')).map((t) => textOf(t).replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
// 쪽 본문의 제목 글자(h1·h2)
const headingOf = (html) => {
  const b = bodyOf(parse(`<body>${html}</body>`));
  markTitle(b);
  return titleText(b);
};
export const pageTitleOf = (p) => p.title || headingOf(p.html);

// HTML 입력을 쪽 목록으로 바꾼다
export function pagesFromHtml(source, baseDir, opts, warn) {
  const tree = parse(source);
  const head = headOf(tree);
  const body = bodyOf(tree);
  const css = sanitize(tree, baseDir, warn);
  const type = opts.type || metaOf(head, 'doc-type');
  const titleTag = head && find(head, (c) => c.tagName === 'title');
  let docTitle = opts.title || (titleTag ? textOf(titleTag).trim() : '');
  const {nodes, how} = pickPages(body);
  const out = [];
  const kind = type || (how === 'slide' ? 'slide' : 'auto');
  if (how === 'whole') {
    if (!textOf(body).trim() && !find(body, (c) => ['img', 'svg', 'table'].includes(c.tagName))) warn('본문이 비어 있습니다');
    out.push({html: inner(body), kind, notes: '', key: '', fromSource: false});
  } else {
    for (const n of nodes) {
      const notes = notesOf(n);
      const key = attr(n, 'data-key') || '';
      const seconds = Number(attr(n, 'data-seconds')) || undefined;
      const title = attr(n, 'data-title');
      const w = Number(attr(n, 'data-w')) || undefined;
      const h = Number(attr(n, 'data-h')) || undefined;
      const own = attr(n, 'data-type');
      const wrapper = hasAttr(n, 'data-dk-src');
      if (!wrapper) addClass(n, 'dk-source-page', 'active');
      remove(n);
      out.push({html: wrapper ? inner(n) : serialize({nodeName: '#document-fragment', childNodes: [n]}), kind: own || kind, notes, key, seconds, title, w, h, fromSource: !wrapper});
    }
    // 쪽 밖에 남은 글자는 버리지 않고 마지막 쪽으로 둔다
    findAll(body, (c) => ['nav', 'button', 'select'].includes(c.tagName)).forEach(remove);
    if (textOf(body).trim()) {
      warn('쪽 밖에 있던 내용을 마지막 쪽에 모았습니다');
      out.push({html: inner(body), kind: 'auto', notes: '', key: '', fromSource: false});
    }
  }
  return {pages: out, css, docTitle};
}

// 마크다운: 앞머리(--- title/type ---), 쪽 구분(--- 줄), 쪽 끝의 "Notes:" 이후는 메모
export function pagesFromMarkdown(source, baseDir, opts, warn) {
  let text = source.replace(/\r\n?/g, '\n');
  const meta = {};
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (fm && /^\w[\w-]*:/m.test(fm[1])) {
    fm[1].split('\n').forEach((l) => {
      const m = /^(\w[\w-]*):\s*(.*)$/.exec(l);
      if (m) meta[m[1]] = m[2].trim();
    });
    text = text.slice(fm[0].length);
  }
  const chunks = text.split(/^\s*(?:---|<!--\s*page\s*-->)\s*$/m).map((c) => c.trim()).filter(Boolean);
  // --- 는 수평선으로도 흔히 쓴다. 장표는 type: slide나 --type slide로만 정한다
  const kind = opts.type || meta.type || 'auto';
  const parts = [];
  let cssAll = '';
  for (const chunk of chunks.length ? chunks : ['']) {
    const nm = /^(?:Notes|메모):\s*$/m.exec(chunk);
    const bodyMd = nm ? chunk.slice(0, nm.index) : chunk;
    const notes = nm ? chunk.slice(nm.index + nm[0].length).trim() : '';
    const tree = parse(`<body>${marked.parse(bodyMd)}</body>`);
    cssAll += sanitize(tree, baseDir, warn);
    parts.push({html: inner(bodyOf(tree)), kind, notes, key: '', fromSource: false});
  }
  return {pages: parts, css: cssAll, docTitle: opts.title || meta.title || ''};
}

const pageSize = (p) => {
  if (p.w) return {w: p.w, h: p.h || 0, name: 'custom'};
  const s = SIZES[p.kind] || SIZES.auto;
  return {...s, name: SIZES[p.kind] ? p.kind : 'auto'};
};

export function assemble({pages, css, docTitle, docId, rev, base, extraBook}) {
  const sizes = new Map();
  const bookPages = [];
  const sections = pages.map((p, i) => {
    const size = pageSize(p);
    const named = size.h ? `dk-${size.w}x${size.h}` : 'dk-auto';
    sizes.set(named, size);
    const tree = parse(`<body>${p.html}</body>`);
    const b = bodyOf(tree);
    // 본문에 쓴 키트 예약 클래스(dk-page 등)는 뷰어를 망가뜨린다. 원래 쪽 표시만 남긴다
    findAll(b, (c) => hasAttr(c, 'class')).forEach((c) => {
      const cs = classes(c);
      const kept = cs.filter((x) => !x.startsWith('dk-') || x === 'dk-source-page');
      if (kept.length === cs.length) return;
      if (kept.length) setAttr(c, 'class', kept.join(' '));
      else delAttr(c, 'class');
    });
    markTitle(b);
    const title = p.title || titleText(b) || `쪽 ${i + 1}`;
    bookPages.push({id: p.id || String(i + 1).padStart(2, '0'), title, notes: p.notes || '', key: p.key || '', ...(p.seconds ? {seconds: p.seconds} : {})});
    const style = `--dk-w:${size.w}px;${size.h ? `--dk-h:${size.h}px;` : ''}page:${named}`;
    return `<section class="dk-page" id="dk-p${i + 1}" data-dk-size="${esc(size.name)}"${size.h ? ' data-dk-fixed=""' : ''} style="${style}"><div class="dk-page-inner">${inner(b)}</div></section>`;
  });
  const title = docTitle || bookPages[0]?.title || '문서';
  const plain = !css.replace(/@font-face\s*\{[^}]*\}/gi, '').trim();
  const pageCss = [...sizes].map(([n, s]) => (s.h ? `@page ${n}{size:${s.w}px ${s.h}px;margin:0}` : `@page ${n}{size:A4;margin:0}`)).join('');
  const book = JSON.stringify({title, pages: bookPages, ...(extraBook || {})}).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ko" data-doc-kit="${VERSION}" data-doc-id="${esc(docId)}" data-doc-rev="${rev}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="doc-kit-version" content="${VERSION}"><style id="dk-page-sizes">${pageCss}</style><style id="dk-doc-style">${css}</style></head>
<body><div id="dk-workspace"><div id="dk-viewport"><main id="dk-document"${plain ? ' data-dk-plain=""' : ''}>${sections.join('')}</main></div></div>
<script id="dk-book" type="application/json">${book}</script><script id="dk-base" type="application/json">${base || ''}</script>
<style id="dk-base-style">${BASE_CSS}</style><style id="dk-kit-style">${KIT_CSS}</style><style id="dk-font-style">${FONT_CSS}</style><script id="dk-kit-code">${KIT_JS}</script>
</body></html>
`;
}

export const newId = () => crypto.randomBytes(6).toString('hex');

// 입력 파일(마크다운·HTML·키트 파일) → 쪽 구조
export function readSource(file, opts, warn) {
  const baseDir = path.dirname(path.resolve(file));
  const isMd = /\.(md|markdown)$/i.test(file);
  const source = restoreAssets(readHtml(file, {sniff: !isMd, warn}), file);
  return readSourceText(source, baseDir, isMd, opts, warn);
}
export const assetsFile = (bodyFile) => `${bodyFile}.assets.json`;
// extract가 뺀 큰 자료(dk-asset:N)를 되돌린다. 못 찾으면 그림을 잃지 않도록 멈춘다
function restoreAssets(text, file) {
  if (!/dk-asset:\d/.test(text)) return text;
  let assets = null;
  try {
    assets = JSON.parse(fs.readFileSync(assetsFile(file), 'utf-8'));
  } catch {}
  return text.replace(/dk-asset:(\d+)/g, (all, n) => {
    if (!assets || !assets[n]) throw new Error(`본문의 ${all} 자료를 찾지 못했습니다(${assetsFile(file)}). 파일을 고치지 않았습니다. extract를 다시 실행하세요`);
    return assets[n];
  });
}
export function readSourceText(source, baseDir, isMd, opts, warn) {
  if (isMd) return {...pagesFromMarkdown(source, baseDir, opts, warn), kit: null};
  if (byId(parse(source), 'dk-document')) return readKit(source, baseDir, opts, warn); // 본문 글자에 든 id= 는 키트가 아니다
  return {...pagesFromHtml(source, baseDir, opts, warn), kit: null};
}

// 키트 파일에서 내용을 꺼낸다. 코드가 빠졌거나 잘렸거나 쪽을 덧붙인 파일도 받는다
export function readKit(source, baseDir, opts, warn) {
  const tree = parse(source);
  const docEl = byId(tree, 'dk-document');
  const root = htmlOf(tree);
  const bookEl = byId(tree, 'dk-book');
  let book = {};
  try {
    book = JSON.parse(bookEl ? bookEl.childNodes.map((c) => c.value || '').join('') : '{}');
  } catch {
    warn('메모 자료가 깨져 있어 새로 만듭니다');
  }
  const styleEl = byId(tree, 'dk-doc-style');
  let css = inlineCssUrls(styleEl ? styleEl.childNodes.map((c) => c.value || '').join('') : '', baseDir, warn);
  const baseEl = byId(tree, 'dk-base');
  const base = baseEl ? baseEl.childNodes.map((c) => c.value || '').join('') : '';
  const body = bodyOf(tree);
  // 키트 부품을 떼어 내고 남은 것이 내용이다
  // 부품을 겹쳐 넣은 파일도 있으므로 같은 id를 모두 뗀다
  ['dk-book', 'dk-base', 'dk-base-style', 'dk-kit-style', 'dk-font-style', 'dk-kit-code', 'dk-page-sizes'].forEach((id) => {
    findAll(tree, (c) => attr(c, 'id') === id).forEach(remove);
  });
  if (styleEl) remove(styleEl);
  // head에 직접 넣은 <style>도 문서 스타일이다. 버리지 않고 옮긴다
  if (headOf(tree)) css += '\n' + sanitize(headOf(tree), baseDir, warn);
  findAll(tree, (c) => classes(c).includes('dk-ui')).forEach(remove);
  const pageEls = findOuter(docEl, (c) => classes(c).includes('dk-page'));
  const pages = [];
  const bookPages = book.pages || [];
  const sizeOf = (el) => {
    const style = attr(el, 'style') || '';
    const w = /--dk-w:\s*([\d.]+)px/.exec(style);
    const h = /--dk-h:\s*([\d.]+)px/.exec(style);
    const named = attr(el, 'data-dk-size');
    return SIZES[named] ? {kind: named} : {kind: 'custom', w: w ? Number(w[1]) : undefined, h: h ? Number(h[1]) : undefined};
  };
  css += '\n' + sanitize(docEl, baseDir, warn);
  pageEls.forEach((el, i) => {
    const innerEl = find(el, (c) => classes(c).includes('dk-page-inner')) || el;
    const b = bookPages[i] || {};
    pages.push({html: inner(innerEl), ...sizeOf(el), notes: b.notes || '', key: b.key || '', seconds: b.seconds, id: b.id, title: b.title, fromSource: false});
    remove(el);
  });
  // #dk-document 안팎에 덧붙은 내용(쪽을 더하거나 파일 끝에 이어 쓴 경우)
  const rest = parse('<body></body>');
  const leftover = bodyOf(rest);
  const wrap = byId(tree, 'dk-workspace');
  const gather = (from) => from.childNodes.forEach((c) => {
    if (attr(c, 'id') !== 'dk-workspace') leftover.childNodes.push(c);
  });
  if (docEl) gather(docEl);
  if (wrap) {
    const vp = byId(wrap, 'dk-viewport');
    (vp ? vp.childNodes : []).filter((c) => c !== docEl).forEach((c) => leftover.childNodes.push(c));
  }
  gather(body);
  css += '\n' + sanitize(leftover, baseDir, warn);
  const added = pickPages(leftover);
  if (added.how !== 'whole') {
    for (const n of added.nodes) {
      const notes = notesOf(n);
      remove(n);
      addClass(n, 'dk-source-page', 'active');
      pages.push({html: serialize({nodeName: '#document-fragment', childNodes: [n]}), kind: pages[pages.length - 1]?.kind || 'auto', notes, key: '', fromSource: true});
    }
  } else if (textOf(leftover).trim() || find(leftover, (c) => ['img', 'svg', 'table'].includes(c.tagName))) {
    pages.push({html: inner(leftover), kind: pages[pages.length - 1]?.kind === 'slide' ? 'slide' : 'auto', notes: '', key: '', fromSource: false});
  }
  return {
    pages,
    css,
    docTitle: book.title || '',
    kit: {version: root ? attr(root, 'data-doc-kit') : null, id: root ? attr(root, 'data-doc-id') : null, rev: Number(root ? attr(root, 'data-doc-rev') : 0) || 0, base, extraBook: book.minutes ? {minutes: book.minutes} : undefined},
  };
}

export function render(src, opts = {}) {
  const css = opts.dropCss ? '' : scopeCss(src.css || '');
  // 스타일을 버려도 글꼴은 남기되, 외부 글꼴은 scopeCss가 뺀다
  const fontFaces = scopeCss(((src.css || '').match(/@font-face\s*\{[^}]*\}/gi) || []).join(''));
  return assemble({
    pages: src.pages,
    css: opts.dropCss ? fontFaces : css,
    docTitle: opts.title || src.docTitle,
    docId: src.kit?.id || newId(),
    rev: (src.kit?.rev || 0) + 1,
    base: '',
    extraBook: {...(src.kit?.extraBook || {}), ...(opts.minutes ? {minutes: opts.minutes} : {})},
  });
}

// 본문만 꺼내기: 모델이 고치고 apply나 build로 되돌릴 수 있는 파일
const BIG_DATA = 1024; // 이보다 긴 base64 자료는 본문 파일에서 빼고 자리표시자를 둔다
export function extractBody(source, warn, baseDir = '.') {
  if (!byId(parse(source), 'dk-document')) throw new Error('키트 파일이 아닙니다. 먼저 ensure를 실행하세요');
  const src = readKit(source, baseDir, {}, warn);
  const bits = src.pages.map((p) => {
    const a = [`data-page=""`, `data-dk-src=""`, `data-type="${esc(p.kind)}"`];
    if (p.w) a.push(`data-w="${p.w}"`);
    if (p.h) a.push(`data-h="${p.h}"`);
    // 제목 글자에서 나온 쪽 제목은 적지 않는다. 적으면 제목을 고쳐도 옛 제목이 남는다
    if (p.title && p.title !== headingOf(p.html) && !/^쪽 \d+$/.test(p.title)) a.push(`data-title="${esc(p.title)}"`);
    if (p.key) a.push(`data-key="${esc(p.key)}"`);
    if (p.seconds) a.push(`data-seconds="${p.seconds}"`);
    const notes = p.notes ? `\n<aside data-notes-block="">${esc(p.notes)}</aside>` : '';
    return `<section ${a.join(' ')}>\n${p.html}${notes}\n</section>`;
  });
  const text = `<!-- html-doc-kit 본문 파일. 고친 뒤 apply로 되돌립니다. dk-asset:번호는 그림 자리이니 그대로 두세요 -->\n<title>${esc(src.docTitle)}</title>\n<style>${src.css}</style>\n${bits.join('\n')}\n`;
  const assets = [];
  const seen = new Map();
  const body = text.replace(/data:[^;,"'\s)]+(?:;[^;,"'\s)]+)*;base64,[A-Za-z0-9+/=]+/g, (uri) => {
    if (uri.length < BIG_DATA) return uri;
    if (!seen.has(uri)) {
      seen.set(uri, assets.length);
      assets.push(uri);
    }
    return `dk-asset:${seen.get(uri)}`;
  });
  return {body, assets};
}
export {VERSION, KIT_JS, KIT_CSS, FONT_CSS, BASE_CSS, delAttr};
