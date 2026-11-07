// 문서의 CSS를 쪽 안으로 가둔다. 뷰어·편집기(#dk-document 밖, dk- 이름)는 건드리지 못하게 된다
const PREFIX = '#dk-document .dk-page-inner';

function matching(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < css.length && css[i] !== c) i += css[i] === '\\' ? 2 : 1;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return css.length; // 잘린 CSS
}

function splitTop(sel) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of sel) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function scopeSelector(sel) {
  if (sel.startsWith(PREFIX)) return sel;
  let rest = sel;
  let rooted = false;
  for (;;) {
    const m = /^(html|body|:root)(?![\w-])/.exec(rest);
    if (!m) break;
    rooted = true;
    rest = rest.slice(m[0].length);
    if (!/^\s+(html|body)(?![\w-])/.test(rest)) break;
    rest = rest.trimStart();
  }
  if (!rooted) return `${PREFIX} ${sel}`;
  if (!rest) return PREFIX;
  return /^\s/.test(rest) ? `${PREFIX} ${rest.trim()}` : PREFIX + rest;
}

const PAGE_UNIT = {
  vw: 'var(--dk-w)',
  vh: 'var(--dk-h,1123px)',
  vmin: 'min(var(--dk-w),var(--dk-h,1123px))',
  vmax: 'max(var(--dk-w),var(--dk-h,1123px))',
};
// 창 크기 단위를 쪽 크기 기준으로 바꾼다. 안 그러면 쪽이 창 크기에 묶인다. 문자열과 url() 안은 건드리지 않는다
export function fixViewportUnits(value) {
  return value
    .split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\))/i)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/(?<![\w.#-])(-?(?:\d+\.?\d*|\.\d+))[sdl]?(vw|vh|vmin|vmax)\b/gi, (all, n, unit) => `calc(${n}*${PAGE_UNIT[unit.toLowerCase()]}/100)`),
    )
    .join('');
}

function fixDeclarations(body) {
  // 새로 친 글자도 같은 모양으로 보이게 글꼴 목록에 예비 글꼴을 잇는다
  return fixViewportUnits(body).replace(/font-family\s*:\s*([^;}]+)/gi, (all, list) => {
    if (list.includes('DocKitFull')) return all;
    const important = /!important/i.test(list);
    const clean = list.replace(/!important/i, '').trim();
    const parts = clean.split(',').map((s) => s.trim());
    const last = parts[parts.length - 1];
    if (/^(sans-serif|serif|monospace|cursive|fantasy|system-ui|inherit|initial|unset)$/i.test(last)) parts.splice(parts.length - 1, 0, 'DocKitFull');
    else parts.push('DocKitFull');
    return `font-family:${parts.join(',')}${important ? '!important' : ''}`;
  });
}

export function scopeCss(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    const semi = css.indexOf(';', i);
    if (semi !== -1 && (open === -1 || semi < open) && css.slice(i, semi).trim().startsWith('@')) {
      i = semi + 1; // @import, @charset, @namespace: 외부 불러오기를 막는다
      continue;
    }
    if (open === -1) break;
    const prelude = css.slice(i, open).trim();
    const close = matching(css, open);
    const body = css.slice(open + 1, close);
    i = close + 1;
    if (/^@(media|supports|layer|container)\b/i.test(prelude)) out += `${prelude}{${scopeCss(body)}}`;
    else if (/^@font-face/i.test(prelude)) {
      if (!/url\(\s*['"]?(https?:)?\/\//i.test(body)) out += `${prelude}{${body}}`;
    } else if (/^@(-\w+-)?keyframes/i.test(prelude)) out += `${prelude}{${fixViewportUnits(body)}}`;
    else if (prelude.startsWith('@')) continue; // @page 등: 쪽 크기는 키트가 정한다
    else if (prelude) out += `${splitTop(prelude).map(scopeSelector).join(',')}{${fixDeclarations(body)}}`;
  }
  return out;
}

const HIDING = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|color\s*:\s*transparent|opacity\s*:\s*0*\.?0*\s*(?:!important\s*)?(?:;|$))/i;
const WHOLE_PAGE = /^(?:(?:html|body|:root)\s*>?\s*)*\*?$/i;
// 문서 전체를 숨기는 규칙이 있는가. 브라우저 시험을 못 돌릴 때 쓰는 최소한의 정적 판정이다
export function hidesEverything(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let i = 0; i < text.length; ) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const close = matching(text, open);
    const prelude = text.slice(i, open).replace(/^[^{}]*;/, '').trim();
    const body = text.slice(open + 1, close);
    i = close + 1;
    // 나타나는 애니메이션과 함께 쓴 경우는 실제로 숨는 것이 아니다
    if (prelude.startsWith('@') || !HIDING.test(body) || /animation/i.test(body)) continue;
    if (splitTop(prelude).some((s) => WHOLE_PAGE.test(s.replace(PREFIX, '').trim()))) return true;
  }
  return false;
}
