// build·ensure·check·extract·apply·upgrade
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {browserCheck} from './browser.mjs';
import {inspect, isOff} from './check.mjs';
import {assetsFile, extractBody, pageTitleOf, readSource, readSourceText, render, VERSION} from './core.mjs';
import {hidesEverything} from './css.mjs';
import {bodyOf, delAttr, findAll, hasAttr, inner, parse, readHtml} from './html.mjs';

const MD = /\.(md|markdown)$/i;
const dirOf = (file) => path.dirname(path.resolve(file));
const samePath = (a, b) => {
  const real = (f) => {
    try {
      return fs.realpathSync(f);
    } catch {
      return path.resolve(f);
    }
  };
  return real(a) === real(b);
};
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf-8')) || {};
  } catch {
    return {};
  }
};
// 기록은 편의 자료다. 쓰지 못해도 문서 작업을 막지 않는다
const writeJson = (f, v) => {
  try {
    fs.mkdirSync(path.dirname(f), {recursive: true});
    fs.writeFileSync(f, JSON.stringify(v, null, 1));
  } catch {}
};
const hashOf = (data) => crypto.createHash('sha256').update(data).digest('hex');

// 키트가 마지막으로 쓴 내용의 해시. 이것과 다르면 사용자(브라우저 저장 등)가 고친 파일이다
const generatedFile = (file) => path.join(dirOf(file), '.doc-kit', 'generated.json');
function remember(file, html) {
  const f = generatedFile(file);
  writeJson(f, {...readJson(f), [path.basename(file)]: hashOf(html)});
}
const isOurs = (file) => readJson(generatedFile(file))[path.basename(file)] === hashOf(fs.readFileSync(file));

// 사본·결과 파일을 쓸 경로를 정한다. 있던 파일은 항상 백업하고, 사용자가 고친 파일은 덮어쓰지 않고 새 이름을 쓴다
function placeOutput(output, notices, opts) {
  if (!fs.existsSync(output)) return output;
  const keep = (f) => (opts.backup === false ? '건너뜀' : backup(f));
  if (isOurs(output)) {
    notices.push(`${output}을 새로 만들었습니다. 이전 판: ${keep(output)}`);
    return output;
  }
  const saved = keep(output);
  const ext = path.extname(output);
  const stem = output.slice(0, output.length - ext.length);
  for (let n = 2; ; n++) {
    const to = `${stem}_${n}${ext}`;
    if (fs.existsSync(to) && !isOurs(to)) continue;
    if (fs.existsSync(to)) keep(to);
    notices.push(`${output}에 사용자가 고친 내용이 있어 그대로 두고 ${to}를 새로 만들었습니다. 원본이 바뀐 내용은 새 파일에 있으니 필요하면 옮겨 주세요. 백업: ${saved}`);
    return to;
  }
}

// build·apply의 입력 HTML을 적어 둔다. 훅과 판정은 이 파일을 결과물로 치지 않는다
const inputsFile = (file) => path.join(dirOf(file), '.doc-kit', 'inputs.json');
function recordInput(input, output) {
  if (MD.test(input) || samePath(input, output) || path.basename(dirOf(input)) === '.doc-kit') return;
  const f = inputsFile(input);
  writeJson(f, {...readJson(f), [path.basename(input)]: path.resolve(output)});
}
// 입력으로 기록된 파일이면 결과 파일 경로를 돌려준다. 결과가 사라졌으면 더는 입력으로 보지 않는다
export function inputOf(file) {
  const to = readJson(inputsFile(file))[path.basename(file)];
  return to && fs.existsSync(to) ? to : null;
}

export function backup(file) {
  const dir = path.join(path.dirname(path.resolve(file)), '.doc-kit', 'backup');
  fs.mkdirSync(dir, {recursive: true});
  const to = path.join(dir, `${path.basename(file)}.${Date.now()}`);
  fs.copyFileSync(file, to);
  return to;
}

// 쪽 본문의 인라인 style을 뺀다. 복구 사다리에서만 쓴다
function withoutInlineStyles(src) {
  const pages = src.pages.map((p) => {
    const body = bodyOf(parse(`<body>${p.html}</body>`));
    findAll(body, (c) => hasAttr(c, 'style')).forEach((c) => delAttr(c, 'style'));
    return {...p, html: inner(body)};
  });
  return {...src, pages};
}

// 시험 파일에 써 보고 브라우저 시험을 통과하는 판을 고른다(복구 사다리).
// 스타일을 버린 판은 시험을 실제로 통과할 때만 쓴다. 그래도 안 되면 스타일 탓이 아니므로 원래 판을 그대로 둔다
async function renderChecked(src, opts, warn) {
  const tmp = path.join(os.tmpdir(), `doc-kit-try-${process.pid}-${Date.now()}.html`);
  const attempt = async (s, o) => {
    const html = render(s, o);
    fs.writeFileSync(tmp, html);
    return {html, c6: await browserCheck(tmp)};
  };
  // 브라우저 없이는 볼 수 없으므로, 문서 전체를 숨기는 규칙만 글자로 판정해 뺀다
  const withoutBrowser = (html, c6) => {
    if (!hidesEverything(src.css || '')) return {html, c6};
    warn('문서 전체를 숨기는 스타일이 있어 문서 스타일을 버리고 다시 만들었습니다');
    return {html: render(src, {...opts, dropCss: true}), c6};
  };
  try {
    if (opts.noBrowser) return withoutBrowser(render(src, opts), {status: 'skip', reason: '--no-browser', warnings: []});
    const first = await attempt(src, opts);
    if (first.c6.status === 'skip') return withoutBrowser(first.html, first.c6);
    // 브라우저 쪽 오류는 문서 탓이 아니다. 스타일을 버리지 않는다
    if (first.c6.status === 'pass' || first.c6.blame === 'env') return first;
    const bare = withoutInlineStyles(src);
    const steps = [
      [bare, opts, '인라인 스타일을 버리고'],
      [src, {...opts, dropCss: true}, '문서 스타일을 버리고'],
      [bare, {...opts, dropCss: true}, '문서 스타일과 인라인 스타일을 버리고'],
    ];
    for (const [s, o, what] of steps) {
      const next = await attempt(s, o);
      if (next.c6.status === 'pass') {
        warn(`${what} 다시 만들었습니다(${first.c6.reason})`);
        return next;
      }
    }
    return first;
  } finally {
    fs.rmSync(tmp, {force: true});
  }
}

export async function build(input, output, opts = {}) {
  const warnings = [];
  const warn = (m) => warnings.push(m);
  if (MD.test(input) && samePath(input, output)) throw new Error('결과 파일이 입력 마크다운과 같습니다. -o로 .html 경로를 지정하세요');
  const src = readSource(input, opts, warn);
  const {html, c6} = await renderChecked(src, opts, warn);
  if (fs.existsSync(output) && opts.backup !== false) {
    const edited = !isOurs(output);
    const saved = backup(output);
    if (edited) {
      const isKit = /data-doc-kit=/.test(fs.readFileSync(saved, 'latin1'));
      warn(isKit ? `기존 파일을 새로 만들었습니다. 브라우저에서 고친 내용은 새 파일에 없습니다. 키트 파일을 고칠 때는 extract와 apply를 쓰세요. 백업: ${saved}` : `기존 파일을 덮어썼습니다. 백업: ${saved}`);
    }
  }
  fs.writeFileSync(output, html);
  remember(output, html);
  recordInput(input, output);
  return {file: output, warnings: [...warnings, ...c6.warnings], notices: [], c6, changed: true};
}

// 어떤 HTML이 와도 완성 파일로 만든다. 이미 완성이면 손대지 않는다. 입력 마크다운은 절대 쓰지 않는다
export async function ensure(file, opts = {}) {
  const warnings = [];
  const notices = [];
  const warn = (m) => warnings.push(m);
  const isMd = MD.test(file);
  const wanted = opts.output || (isMd ? file.replace(MD, '.html') : file);
  const inPlace = samePath(wanted, file);
  if (isMd && inPlace) throw new Error('결과 파일이 입력 마크다운과 같습니다. -o로 .html 경로를 지정하세요');
  const source = readHtml(file, {sniff: !isMd, warn});
  if (isOff(source)) return {file, excluded: true, warnings, notices, c6: {status: 'skip', reason: '제외 표식', warnings: []}, changed: false};
  const report = isMd ? {errors: ['입력이 마크다운입니다']} : inspect(source);
  if (report.newer) {
    warn(`파일의 키트(${report.version})가 설치된 키트(${VERSION})보다 새것이라 건드리지 않았습니다`);
    return {file, warnings, notices, c6: {status: 'skip', reason: '더 새 버전', warnings: []}, changed: false};
  }
  let c6 = null;
  if (!report.errors.length && !opts.force && !opts.noBrowser) c6 = await browserCheck(file);
  if (!report.errors.length && !opts.force && (opts.noBrowser || c6.status !== 'fail' || c6.blame === 'env')) {
    let to = wanted;
    if (!inPlace) {
      to = placeOutput(wanted, notices, opts);
      fs.copyFileSync(file, to);
      remember(to, fs.readFileSync(to));
    }
    return {file: to, warnings: [...warnings, ...(c6 ? c6.warnings : [])], notices, c6: c6 || {status: 'skip', reason: '--no-browser', warnings: []}, changed: !inPlace};
  }
  const src = readSourceText(source, dirOf(file), isMd, opts, warn);
  const done = await renderChecked(src, opts, warn); // 문서 CSS는 새로 만든 판도 실패할 때만 버린다
  let to = wanted;
  if (!inPlace) to = placeOutput(wanted, notices, opts);
  const saved = inPlace && opts.backup !== false ? backup(file) : null;
  fs.writeFileSync(to, done.html);
  remember(to, done.html);
  return {file: to, warnings: [...warnings, ...done.c6.warnings], notices, c6: done.c6, changed: true, repaired: report.errors, backup: saved};
}

export async function check(file, opts = {}) {
  const readWarnings = [];
  const source = readHtml(file, {warn: (m) => readWarnings.push(m)});
  if (isOff(source)) return {file, status: 'excluded', errors: [], warnings: [], c6: {status: 'skip', reason: '제외 표식'}};
  const report = inspect(source);
  if (report.newer) return {file, status: 'complete', errors: [], warnings: [`파일의 키트(${report.version})가 설치된 키트(${VERSION})보다 새것이라 부품이 있는지만 보았습니다`], c6: {status: 'skip', reason: '더 새 버전', warnings: []}, pages: report.pages, version: report.version};
  const c6 = report.errors.length || opts.noBrowser ? {status: 'skip', reason: report.errors.length ? 'C1~C5 실패' : '--no-browser', warnings: []} : await browserCheck(file);
  const errors = [...report.errors];
  if (c6.status === 'fail') errors.push(`C6 ${c6.reason}`);
  const inputFor = errors.length ? inputOf(file) : null;
  return {file, status: errors.length ? 'incomplete' : 'complete', errors, warnings: [...readWarnings, ...(c6.warnings || [])], c6, pages: report.pages, version: report.version, ...(inputFor ? {inputFor} : {})};
}

export function extract(file, output) {
  const warnings = [];
  const to = output || path.join(dirOf(file), '.doc-kit', `${path.basename(file, path.extname(file))}.body.html`);
  if (samePath(file, to)) throw new Error('본문을 원래 파일에 쓰면 뷰어·편집기가 사라집니다. -o를 빼면 .doc-kit 폴더에 저장합니다');
  const {body, assets} = extractBody(readHtml(file), (m) => warnings.push(m), dirOf(file));
  fs.mkdirSync(path.dirname(to), {recursive: true});
  if (fs.existsSync(to)) backup(to);
  fs.writeFileSync(to, body);
  if (assets.length) fs.writeFileSync(assetsFile(to), JSON.stringify(assets));
  return {file: to, warnings};
}

// 본문 파일을 완성 파일로 되돌린다. 문서 id를 잇고 판 번호를 올린다
export async function apply(bodyFile, file, opts = {}) {
  const warnings = [];
  const warn = (m) => warnings.push(m);
  const src = readSource(bodyFile, opts, warn);
  let oldCount = null;
  if (fs.existsSync(file)) {
    const old = readSourceText(readHtml(file), dirOf(file), false, {}, () => {});
    if (!old.kit) throw new Error(`${file}은 키트 파일이 아니라 덮어쓰지 않았습니다. 새로 만들려면 build를 쓰세요`);
    src.kit = {...old.kit, base: ''};
    oldCount = old.pages.length;
    if (!src.docTitle) src.docTitle = old.docTitle;
    // 문서 제목이 첫 쪽 제목에서 온 경우에는 첫 쪽 제목을 고치면 함께 바뀐다
    const before = old.pages[0] ? pageTitleOf(old.pages[0]) : '';
    const after = src.pages[0] ? pageTitleOf(src.pages[0]) : '';
    if (src.docTitle === old.docTitle && old.docTitle === before && after && after !== before) src.docTitle = after;
  }
  const {html, c6} = await renderChecked(src, opts, warn);
  const saved = fs.existsSync(file) ? backup(file) : null;
  fs.writeFileSync(file, html);
  remember(file, html);
  recordInput(bodyFile, file);
  const shrunk = oldCount !== null && src.pages.length < oldCount;
  if (shrunk) warn(`${oldCount}쪽이 ${src.pages.length}쪽으로 줄었습니다. 일부 쪽만 담은 본문이었다면 extract로 전체를 꺼내 다시 apply 하세요(일부러 지운 것이면 --shrink). 백업: ${saved}`);
  return {file, warnings: [...warnings, ...c6.warnings], notices: [], c6, changed: true, shrunk: shrunk && !opts.shrink};
}

export async function upgrade(file, opts = {}) {
  const warnings = [];
  const report = inspect(readHtml(file));
  if (report.newer) return {file, warnings: [`파일의 키트(${report.version})가 더 새것입니다`], notices: [], changed: false, c6: {status: 'skip', warnings: []}};
  if (report.version === VERSION && !report.errors.length) return {file, warnings, notices: [], changed: false, c6: {status: 'skip', reason: '이미 최신', warnings: []}};
  // 옛 버전은 해시가 맞아도 다시 입힌다(ensure는 온전한 옛 파일을 그대로 둔다)
  return ensure(file, {...opts, force: true});
}
