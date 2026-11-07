// 에이전트 훅. 끝날 때까지 기준 시각을 유지하고, 저장 뒤에는 경로만 적어 두고, 끝날 때 모델 없이 직접 복구한다.
// 어떤 오류도 작업을 막지 않는다. 대신 사용자에게 보이게 알린다
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspect, isOff} from './check.mjs';
import {attr, isEl, isScriptAttr, parse, readHtml, walk} from './html.mjs';
import {ensure, inputOf} from './ops.mjs';

const HOME = () => process.env.DOC_KIT_HOME || os.homedir();
const stateDir = () => path.join(HOME(), '.doc-kit', 'state');
// 앱 신호로 치는 폴더. 프로젝트 안에서만 본다. out, target, vendor는 문서가 있을 수 있어 신호가 아니다
const APP_DIRS = new Set(['node_modules', 'bower_components', 'src', 'public', 'dist', 'build', 'static', 'views', 'templates', 'partials', 'emails', '_build', '_site', 'site', 'coverage', 'htmlcov', 'lcov-report', 'test-results', 'playwright-report', 'storybook-static', 'venv', '__pycache__', '.next', '.nuxt', '.svelte-kit', '.venv', '.git', '.doc-kit']);
// 스캔이 내려가지 않는 폴더. 앱 폴더와 함께 점 폴더, 다른 앱의 자료 폴더를 뺀다
const SCAN_SKIP = new Set([...APP_DIRS, 'Library', 'AppData', 'Applications']);
const WEB_DEPS = new Set(['react', 'vue', 'svelte', 'next', 'nuxt', 'vite', 'webpack', 'astro', 'gatsby', 'parcel', 'solid-js', 'remix', 'electron', 'express', 'koa', 'fastify', 'hono', 'preact', 'lit', 'tailwindcss', 'ember-source', 'vuepress', 'vitepress', 'hexo', 'nest', 'polka', 'restify', 'hapi']);
const WEB_DEP_SCOPES = /^@(angular|sveltejs|11ty|remix-run|nestjs|docusaurus|hono|hapi|nuxt|tanstack)\//;
const BUILD_CONFIG = /^(?:(?:vite|vitest|next|nuxt|astro|webpack|svelte|remix|rollup|parcel|gatsby|tailwind|eleventy|quasar|vue|docusaurus|rspack|rsbuild)\.config\.[cm]?[jt]sx?|\.eleventy\.[cm]?js|angular\.json|manage\.py|Gemfile|mkdocs\.ya?ml|_config\.ya?ml|hugo\.(?:toml|ya?ml|json)|artisan|vercel\.json|netlify\.toml|firebase\.json)$/;
// 문서도 함께 있을 수 있는 애매한 신호: 건너뛰지도 제자리에서 입히지도 않고 사본을 만든다
const MAYBE_APP = /^(?:go\.mod|pyproject\.toml|setup\.py|requirements\.txt|composer\.json|conf\.py|Cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?|mix\.exs)$/;
const SCAN_FILES_MAX = 5; // 스캔으로만 찾은 파일이 이보다 많으면 입히지 않고 목록만 알린다
const SCAN_ENTRIES_MAX = 20000; // 폴더 항목을 이만큼 봤으면 스캔을 멈춘다
const SKIP_NOTES_MAX = 8; // 제외 알림 줄 수
const WARNINGS_PER_FILE = 5;
const STALE_MS = 12 * 3600 * 1000; // 이보다 오래된 기준 시각은 이어 쓰지 않는다(며칠 뒤 재개한 세션)
const budgetMs = () => Number(process.env.DOC_KIT_HOOK_BUDGET_MS) || 60000; // 훅 제한 120초 안에 끝내려는 처리 시간
const isHtml = (f) => /\.html?$/i.test(f);
const statOf = (f) => {
  try {
    return fs.statSync(f);
  } catch {
    return null;
  }
};

const readStdin = () => {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf-8') || '{}');
  } catch {
    return {};
  }
};
const cwdOf = (i) => i.cwd || (i.workspace_roots && i.workspace_roots[0]) || process.cwd();
const stateFile = (i) => {
  const key = i.session_id || i.conversation_id || cwdOf(i);
  return path.join(stateDir(), crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 16) + '.json');
};
const load = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {
    return null;
  }
};
const store = (f, s) => {
  fs.mkdirSync(path.dirname(f), {recursive: true});
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, f);
};

// 셸 명령을 단순 명령과 낱말로 나눈다. 따옴표, 이스케이프, 여기 문서(<<EOF)를 처리한다
const REDIR = {op: '>'};
const STDIN = {op: '<'};
const LITERAL_DOLLAR = '\u0001'; // 홑따옴표 안의 $는 변수가 아니다
function shellCommands(src) {
  const cmds = [];
  let cur = [];
  let word = null;
  const heredocs = [];
  const flush = () => {
    if (word !== null) cur.push(word);
    word = null;
  };
  const end = () => {
    flush();
    if (cur.length) cmds.push(cur);
    cur = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      const stop = j < 0 ? src.length : j;
      word = (word ?? '') + src.slice(i + 1, stop).replaceAll('$', LITERAL_DOLLAR);
      i = stop;
    } else if (c === '"') {
      let s = '';
      for (i++; i < src.length && src[i] !== '"'; i++) {
        if (src[i] === '\\' && '"\\$`'.includes(src[i + 1])) {
          i++;
          s += src[i] === '$' ? LITERAL_DOLLAR : src[i];
        } else s += src[i];
      }
      word = (word ?? '') + s;
    } else if (c === '\\') {
      i++;
      if (src[i] !== '\n') word = (word ?? '') + (src[i] === '$' ? LITERAL_DOLLAR : src[i] ?? '');
    } else if (c === '\n') {
      end();
      for (const {tag, dash} of heredocs.splice(0)) {
        for (;;) {
          const nl = src.indexOf('\n', i + 1);
          const line = src.slice(i + 1, nl < 0 ? src.length : nl);
          i = nl < 0 ? src.length : nl;
          if (nl < 0 || (dash ? line.trim() : line) === tag) break;
        }
      }
    } else if (c === ' ' || c === '\t') flush();
    else if (c === ';' || c === '(' || c === ')' || c === '|') end();
    else if (c === '&') {
      if (src[i + 1] === '>') {
        flush();
        i += src[i + 2] === '>' ? 2 : 1;
        cur.push(REDIR);
      } else end();
    } else if (c === '>') {
      if (word !== null && /^\d+$/.test(word)) word = null; // 2> 의 2
      flush();
      if (src[i + 1] === '>') i++;
      if (src[i + 1] === '&') {
        i++;
        while (/[\d-]/.test(src[i + 1] || '')) i++; // >&2
      } else cur.push(REDIR);
    } else if (c === '<') {
      flush();
      const m = /^<<(-?)\s*(['"]?)([\w.-]+)\2/.exec(src.slice(i, i + 200));
      if (src.startsWith('<<<', i)) {
        i += 2;
        cur.push(STDIN);
      } else if (m) {
        heredocs.push({tag: m[3], dash: !!m[1]});
        i += m[0].length - 1;
      } else cur.push(STDIN);
    } else if (c === '#' && word === null) {
      const nl = src.indexOf('\n', i);
      i = (nl < 0 ? src.length : nl) - 1;
    } else if (c === '$' && src[i + 1] === '(') {
      // 명령 치환은 값을 알 수 없다. 글자로 두어 '위치 미상'이 되게 한다
      let depth = 0;
      let j = i + 1;
      for (; j < src.length; j++) {
        if (src[j] === '(') depth++;
        if (src[j] === ')' && --depth === 0) break;
      }
      word = (word ?? '') + src.slice(i, j + 1);
      i = j;
    } else word = (word ?? '') + c;
  }
  end();
  return cmds;
}

const SCRIPT_RUNNER = /^(?:python[\d.]*|node|deno|bun|ruby|perl|php|bash|sh|zsh|npx|uv|npm|pnpm|yarn|make|osascript)$/;
const SCRIPT_FILE = /\.(?:py|sh|js|mjs|cjs|ts|rb|pl|php)$/;
const SHELL_WORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}', 'sudo', 'command', 'nohup', 'time', 'env', 'exec', 'export']);
const ASSIGN = /^[A-Za-z_]\w*=/;

// 셸 명령이 쓴 HTML을 찾는다. 위치를 알 수 없는 쓰기는 unknown으로 돌려준다
function readShell(cmd, cwd) {
  const home = HOME();
  const out = {written: new Set(), removed: new Set(), dirs: new Set(), unknown: new Set(), outside: /\.html?\b/i.test(cmd)};
  const vars = {HOME: home};
  let dir = cwd;
  const expand = (w) => {
    let s = w.replace(/\$\{(\w+)\}|\$(\w+)/g, (all, a, b) => (Object.hasOwn(vars, a || b) ? vars[a || b] : all));
    const unresolved = s.includes('$') || s.includes('`');
    s = s.replaceAll(LITERAL_DOLLAR, '$');
    if (!unresolved) s = s.replace(/^~(?=\/|$)/, home);
    return {s, unresolved};
  };
  const abs = (s) => (path.isAbsolute(s) ? path.normalize(s) : dir ? path.resolve(dir, s) : null);
  const addFile = (w) => {
    const {s, unresolved} = expand(w);
    if (!isHtml(s)) return;
    const p = unresolved ? null : abs(s);
    if (p) out.written.add(p);
    else out.unknown.add(s);
  };
  for (const words of shellCommands(cmd)) {
    const args = [];
    for (let i = 0; i < words.length; i++) {
      if (words[i] === REDIR) {
        if (typeof words[i + 1] === 'string') addFile(words[++i]);
      } else if (words[i] === STDIN) i++;
      else args.push(words[i]);
    }
    let k = 0;
    while (k < args.length && (SHELL_WORDS.has(args[k]) || ASSIGN.test(args[k]))) {
      const m = ASSIGN.test(args[k]) && /^([A-Za-z_]\w*)=(.*)$/s.exec(args[k]);
      if (m) {
        const v = expand(m[2]);
        if (v.unresolved) delete vars[m[1]];
        else vars[m[1]] = v.s;
      }
      k++;
    }
    const a = args.slice(k);
    if (!a.length) continue;
    const prog = path.basename(a[0]);
    if (SCRIPT_RUNNER.test(prog) || SCRIPT_FILE.test(a[0])) out.outside = true;
    if (prog === 'cd' || prog === 'pushd') {
      const {s, unresolved} = expand(a[1] ?? '~');
      dir = unresolved || s === '-' ? null : abs(s);
      continue;
    }
    if (prog === 'popd') {
      dir = null;
      continue;
    }
    if (prog === 'tee') a.slice(1).filter((w) => !w.startsWith('-')).forEach(addFile);
    if (prog === 'rm' || prog === 'unlink') {
      for (const w of a.slice(1)) {
        const {s, unresolved} = expand(w);
        const p = !w.startsWith('-') && !unresolved && abs(s);
        if (p) out.removed.add(p);
      }
    }
    if (['mv', 'cp', 'rsync', 'install', 'ditto'].includes(prog)) {
      const pos = [];
      let target = null;
      for (let i = 1; i < a.length; i++) {
        if (a[i] === '-t' || a[i] === '--target-directory') target = a[++i];
        else if (a[i].startsWith('--target-directory=')) target = a[i].slice(19);
        else if (!a[i].startsWith('-')) pos.push(a[i]);
      }
      const dest = target ?? pos.pop();
      if (dest && pos.length) {
        const d = expand(dest);
        const to = d.unresolved ? null : abs(d.s);
        const toDir = to && (d.s.endsWith('/') || target !== null || statOf(to)?.isDirectory());
        if (!toDir) addFile(dest);
        for (const w of pos) {
          const {s, unresolved} = expand(w);
          if (toDir) {
            if (unresolved || /[*?[]/.test(s) || !path.extname(s)) out.dirs.add(to); // 글롭이나 폴더 복사는 대상 폴더를 훑는다
            else if (isHtml(s)) out.written.add(path.join(to, path.basename(s)));
          } else if (!to && !isHtml(d.s) && isHtml(s)) out.unknown.add(s);
          const from = !unresolved && abs(s);
          if (prog === 'mv' && from) out.removed.add(from);
        }
      }
    }
    for (let i = 1; i < a.length; i++) {
      if (a[i] === '-o' || a[i] === '--output' || (prog === 'wget' && (a[i] === '-O' || a[i] === '--output-document'))) {
        if (a[i + 1]) addFile(a[i + 1]);
      } else if (a[i].startsWith('--output=')) addFile(a[i].slice(9));
    }
  }
  return out;
}

// 도구 입력에서 HTML 쓰기를 꺼낸다(편집 도구, apply_patch, 셸 명령)
function effectsOf(i) {
  const cwd = cwdOf(i);
  const out = {written: new Set(), removed: new Set(), dirs: new Set(), unknown: new Set(), outside: false};
  const add = (p) => {
    if (typeof p === 'string' && isHtml(p)) out.written.add(path.resolve(cwd, p.replace(/^~(?=\/)/, HOME())));
  };
  const t = i.tool_input || i.input || {};
  [i.file_path, t.file_path, t.path, t.notebook_path].forEach(add);
  for (const text of [t.command, t.patch, t.input, i.command]) {
    if (typeof text !== 'string') continue;
    if (text.includes('*** Begin Patch') || text.includes('*** Add File:') || text.includes('*** Update File:')) {
      for (const m of text.matchAll(/\*\*\* (?:Add File|Update File|Move to): (.+)/g)) add(m[1].trim());
      continue;
    }
    const r = readShell(text, cwd);
    for (const k of ['written', 'removed', 'dirs', 'unknown']) r[k].forEach((v) => out[k].add(v));
    out.outside ||= r.outside;
  }
  return out;
}
export const pathsFromInput = (i) => [...effectsOf(i).written];

function scan(dir, since, found = [], depth = 0, budget = {left: SCAN_ENTRIES_MAX}) {
  if (depth > 6 || found.length > 500 || budget.left <= 0) return found;
  let list;
  try {
    list = fs.readdirSync(dir, {withFileTypes: true});
  } catch {
    return found;
  }
  budget.left -= list.length;
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && !SCAN_SKIP.has(e.name)) scan(p, since, found, depth + 1, budget);
    } else if (e.isFile() && isHtml(e.name)) {
      if ((statOf(p)?.mtimeMs ?? 0) >= since) found.push(p);
    }
  }
  return found;
}
// 작업 폴더 밖에 저장하기 쉬운 곳은 바로 아래만 본다
function scanShallow(dir, since) {
  try {
    return fs
      .readdirSync(dir, {withFileTypes: true})
      .filter((e) => e.isFile() && isHtml(e.name))
      .map((e) => path.join(dir, e.name))
      .filter((p) => (statOf(p)?.mtimeMs ?? 0) >= since);
  } catch {
    return [];
  }
}
const isHomeOrRoot = (cwd) => {
  const d = path.resolve(cwd);
  return d === path.dirname(d) || d === path.resolve(HOME()) || d === path.resolve(os.homedir());
};
// git 저장소에서의 상태. same: HEAD와 같음, ignored: 무시 대상, changed: 바뀜, none: 저장소 아님
function gitState(file) {
  let d = path.dirname(path.resolve(file));
  for (; !fs.existsSync(path.join(d, '.git')); d = path.dirname(d)) if (d === path.dirname(d)) return 'none';
  const r = spawnSync('git', ['-C', path.dirname(path.resolve(file)), 'status', '--porcelain', '--ignored', '--', path.basename(file)], {encoding: 'utf-8', timeout: 5000});
  if (r.error || r.status !== 0) return 'none';
  if (!r.stdout.trim()) return 'same';
  return r.stdout.startsWith('!!') ? 'ignored' : 'changed';
}

// 프로젝트 맨 위: 가까운 .git. 없으면 작업 폴더(파일이 그 안에 있을 때), 그것도 아니면 파일의 폴더
function projectRoot(file, cwd) {
  const abs = path.resolve(file);
  for (let d = path.dirname(abs); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (d === path.dirname(d)) break;
  }
  return cwd && abs.startsWith(path.resolve(cwd) + path.sep) ? path.resolve(cwd) : path.dirname(abs);
}
// 파일에서 프로젝트 맨 위까지 폴더 항목을 본다. 프로젝트 밖의 package.json은 이 문서의 신호가 아니다
function projectSignals(file, cwd) {
  const root = projectRoot(file, cwd);
  const res = {app: null, maybe: null};
  // 폴더 이름은 프로젝트 안에서만 본다(프로젝트가 ~/src 아래 있어도 문서는 문서다)
  const hit = path.relative(root, path.resolve(file)).split(path.sep).slice(0, -1).find((s) => APP_DIRS.has(s));
  if (hit) res.app = `앱·빌드 폴더 ${hit}/`;
  for (let d = path.dirname(path.resolve(file)); !res.app; d = path.dirname(d)) {
    let names = [];
    try {
      names = fs.readdirSync(d);
    } catch {}
    const config = names.find((n) => BUILD_CONFIG.test(n));
    if (config) res.app = `빌드 설정 ${config}`;
    const pj = names.includes('package.json') ? load(path.join(d, 'package.json')) : null;
    if (pj && !res.app) {
      const dep = Object.keys({...pj.dependencies, ...pj.devDependencies, ...pj.peerDependencies}).find((k) => WEB_DEPS.has(k) || WEB_DEP_SCOPES.test(k));
      if (dep) res.app = `웹앱 의존성 ${dep}`;
    }
    res.maybe ||= names.find((n) => MAYBE_APP.test(n)) || null;
    if (d === root || d === path.dirname(d)) break;
  }
  return res;
}
// .doc-kit.json의 exclude: 경로(out2/), 글롭(out2/**, *.html). 슬래시 없는 글롭은 폴더 깊이와 상관없이 이름에 맞춘다
const globToRe = (glob) => {
  const body = glob.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*\*\/|\*\*|\*|\?/g, (t) => (t === '**/' ? '(?:.*/)?' : t === '**' ? '.*' : t === '*' ? '[^/]*' : '[^/]'));
  return new RegExp(`^${body}$`);
};
function matchesExclude(rel, pattern) {
  const p = pattern.replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!p) return false;
  if (!p.includes('/')) return rel.split('/').some((seg) => globToRe(p).test(seg));
  return globToRe(p).test(rel) || globToRe(`${p}/**`).test(rel);
}
function excludedByConfig(file) {
  for (let d = path.dirname(path.resolve(file)), i = 0; i < 8; i++) {
    const c = load(path.join(d, '.doc-kit.json'));
    if (c && Array.isArray(c.exclude)) {
      const rel = path.relative(d, path.resolve(file)).split(path.sep).join('/');
      if (c.exclude.some((x) => typeof x === 'string' && matchesExclude(rel, x))) return true;
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return false;
}
// 키트가 빼 버리면 기능이 사라지는 것이 있는 문서. 제자리 대신 사본으로 보낸다
function hasOwnScript(source) {
  let hit = false;
  walk(parse(source), (n) => {
    if (hit) return false;
    if (!isEl(n)) return true;
    if (n.tagName === 'script') hit = !/^dk-/.test(attr(n, 'id') || '');
    else if (['iframe', 'object', 'embed'].includes(n.tagName)) hit = true;
    else hit = (n.attrs || []).some((a) => /^on/i.test(a.name) || isScriptAttr(a.name, a.value));
    return !hit;
  });
  return hit;
}
// 지시문이 쌍으로 있어야 템플릿이다. CSS의 {{와 빈칸 표시 {{회사명}}은 문서로 본다
function hasTemplateDirective(source) {
  const s = source.slice(0, 200000).replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '');
  return /\{%[\s\S]{0,500}?%\}|<%[\s\S]{0,2000}?%>|\{\{[#>/^][\s\S]{0,200}?\}\}/.test(s);
}
const newerThanFile = (a, b) => (statOf(a)?.mtimeMs ?? 0) > (statOf(b)?.mtimeMs ?? Infinity);

export async function handleFile(file, cwd) {
  const parts = path.resolve(file).split(path.sep);
  if (parts.includes('.doc-kit')) {
    // 키트의 작업 파일은 입히지 않는다. 본문을 고치고 apply를 잊었으면 알린다
    const m = /^(.+)\.body\.html$/.exec(path.basename(file));
    const target = m && path.join(path.dirname(path.dirname(path.resolve(file))), `${m[1]}.html`);
    const stale = target && fs.existsSync(target) && newerThanFile(file, target);
    return {file, kind: 'skip', note: stale ? `apply가 필요합니다: ${file}의 수정이 ${target}에 아직 없습니다` : null};
  }
  const source = readHtml(file);
  const name = path.basename(file);
  if (isOff(source)) return {file, kind: 'excluded', note: `${name}: 제외 표식이 있어 키트를 넣지 않았습니다`};
  const skip = (why) => ({file, kind: 'skip', note: `제외: ${file} (${why})`});
  if (excludedByConfig(file)) return skip('.doc-kit.json의 exclude');
  const signals = projectSignals(file, cwd);
  if (signals.app) return skip(signals.app);
  const resultFile = inputOf(file);
  // build·apply의 입력. 결과 파일이 따로 있다
  if (resultFile) return {file, kind: 'skip', note: newerThanFile(file, resultFile) ? `${file}을 고친 뒤 ${resultFile}에 반영하지 않았습니다. apply나 build를 다시 실행하세요` : null};
  if (source.startsWith('<!-- html-doc-kit 본문 파일')) return {file, kind: 'skip', note: `apply가 필요합니다: ${file}은 본문 파일이라 뷰어·편집기가 없습니다. apply로 완성 파일에 되돌리세요`};
  const isKit = /data-doc-kit=/.test(source);
  if (!isKit && hasTemplateDirective(source)) return {file, kind: 'skip', note: `템플릿으로 보여 넣지 않았습니다: ${file}`};
  const report = inspect(source);
  if (!report.errors.length && report.version) {
    const r = await ensure(file, {});
    return {file, kind: r.changed ? 'repaired' : 'ok', result: r};
  }
  const scripted = !isKit && hasOwnScript(source);
  if (scripted || (!isKit && signals.maybe)) {
    const copy = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}_편집용.html`);
    if (fs.existsSync(copy) && fs.statSync(copy).mtimeMs >= fs.statSync(file).mtimeMs) return {file, kind: 'ok'};
    const r = await ensure(file, {output: copy});
    return {file: r.file, kind: 'copied', source: file, reason: scripted ? '자체 스크립트나 삽입 요소가 있어' : `프로젝트 신호(${signals.maybe})가 있어`, result: r};
  }
  const r = await ensure(file, {});
  return {file, kind: 'wrapped', result: r};
}

// 사람에게 보여 줄 줄을 만든다. urgent는 그냥 넘어가면 안 되는 내용이다(Cursor는 이것만 메시지로 낸다)
function describe(results, state, extra) {
  const lines = [];
  let urgent = 0;
  const important = (m) => {
    lines.push(m);
    urgent++;
  };
  const skips = results.filter((r) => r.kind === 'skip' && r.note).map((r) => r.note);
  for (const r of results) {
    const res = r.result;
    if ((r.kind === 'wrapped' || r.kind === 'repaired') && res?.changed !== false) lines.push(`${r.file}에 뷰어·편집기를 넣었습니다${res?.backup ? `. 원본: ${res.backup}` : ''}`);
    if (r.kind === 'copied') important(`${r.source}에 ${r.reason} 그대로 두고 ${r.file}을 만들었습니다`);
    if (r.note && r.kind !== 'skip') important(r.note);
    (res?.notices || []).forEach(important);
    const warnings = [...new Set(res?.warnings || [])];
    warnings.slice(0, WARNINGS_PER_FILE).forEach((w) => important(`경고(${path.basename(r.file)}): ${w}`));
    if (warnings.length > WARNINGS_PER_FILE) important(`경고(${path.basename(r.file)}): 외 ${warnings.length - WARNINGS_PER_FILE}건`);
    const c6 = res?.c6;
    if (c6?.status === 'fail') important(`미완성: ${r.file} (${c6.reason})`);
    if (c6?.status === 'skip' && c6.reason && !['제외 표식', '--no-browser', '더 새 버전'].includes(c6.reason)) important(`브라우저 시험 미실행: ${r.file} (${c6.reason})`);
  }
  skips.slice(0, SKIP_NOTES_MAX).forEach(important);
  if (skips.length > SKIP_NOTES_MAX) important(`그 밖에 넣지 않은 파일 ${skips.length - SKIP_NOTES_MAX}개`);
  extra.forEach(important);
  for (const w of state.unknown || []) important(`위치를 찾지 못한 HTML 쓰기가 있습니다: ${w}. 뷰어가 없으면 그 파일에 ensure를 실행하세요`);
  return {lines, urgent};
}

export async function runStop(state, cwd) {
  const began = Date.now();
  const base = state.start ?? began;
  const since = base - 1500;
  const pathSince = (state.pathsStart ?? base) - 1500;
  const done = state.done || {};
  const already = (p, st) => done[p] === st.mtimeMs; // 지난번에 처리한 뒤 바뀌지 않았다
  const extra = [];
  const explicit = [];
  const missing = [];
  for (const p of new Set(state.paths || [])) {
    const st = statOf(p);
    if (!st) missing.push(p);
    // mv는 수정 시각을 그대로 두고 변경 시각만 바꾼다
    else if (st.isFile() && Math.max(st.mtimeMs, st.ctimeMs) >= pathSince && !already(p, st)) explicit.push(p);
  }
  if (missing.length) extra.push(`기록된 파일을 찾지 못했습니다(옮겼거나 지웠을 수 있습니다): ${missing.slice(0, SKIP_NOTES_MAX).join(', ')}. 옮겼다면 새 위치에서 ensure를 실행하세요`);

  const scanned = new Set(isHomeOrRoot(cwd) ? [] : scan(cwd, since));
  if (state.outsideSince) for (const d of ['Desktop', 'Downloads', 'Documents']) scanShallow(path.join(HOME(), d), state.outsideSince - 1500).forEach((p) => scanned.add(p));
  for (const d of state.dirs || []) (isHomeOrRoot(d) ? scanShallow(d, since) : scan(d, since)).forEach((p) => scanned.add(p));
  const skipNotes = [];
  const passThrough = []; // 상한에 세지 않는다: 이미 키트 파일이거나 제외될 파일
  const candidates = [];
  for (const p of scanned) {
    const st = statOf(p);
    if (!st || already(p, st) || explicit.includes(p)) continue;
    const git = gitState(p);
    if (git === 'same') continue;
    if (git === 'ignored') {
      skipNotes.push({file: p, kind: 'skip', note: `제외: ${p} (git이 무시하는 파일. 문서이면 ensure를 실행하세요)`});
      continue;
    }
    let kit = false;
    try {
      kit = fs.readFileSync(p, 'latin1').includes('data-doc-kit=');
    } catch {}
    if (kit || excludedByConfig(p) || projectSignals(p, cwd).app) passThrough.push(p);
    else candidates.push(p);
  }
  let chosen = candidates;
  if (candidates.length > SCAN_FILES_MAX) {
    const shown = candidates.slice(0, SKIP_NOTES_MAX).join(', ');
    extra.push(`이번 작업과 관련이 불분명한 HTML ${candidates.length}개가 바뀌어 입히지 않았습니다: ${shown}${candidates.length > SKIP_NOTES_MAX ? ` 외 ${candidates.length - SKIP_NOTES_MAX}개` : ''}. 문서이면 ensure를 실행하세요`);
    chosen = [];
  }

  const results = [...skipNotes];
  const list = [...explicit, ...chosen, ...passThrough];
  const pending = [];
  const handled = {};
  for (const f of list) {
    if (Date.now() - began > budgetMs()) {
      pending.push(f);
      continue;
    }
    try {
      const r = await handleFile(f, cwd);
      results.push(r);
      for (const p of [f, r.file]) {
        const st = statOf(p);
        if (st) handled[p] = st.mtimeMs;
      }
    } catch (e) {
      results.push({file: f, kind: 'error', note: `${f}: 키트를 넣지 못했습니다(${e.message})`});
    }
  }
  if (pending.length) extra.push(`시간이 모자라 다음 턴 끝에 다시 봅니다: ${pending.slice(0, SKIP_NOTES_MAX).join(', ')}${pending.length > SKIP_NOTES_MAX ? ` 외 ${pending.length - SKIP_NOTES_MAX}개` : ''}`);
  const {lines, urgent} = describe(results, state, extra);
  return {results, lines, urgent, pending, handled, failed: results.filter((r) => r.kind === 'error' || r.result?.c6?.status === 'fail')};
}

export async function hook(agent, event) {
  const input = readStdin();
  const log = path.join(HOME(), '.doc-kit', 'hook.log');
  const note = (m) => {
    try {
      fs.mkdirSync(path.dirname(log), {recursive: true});
      fs.appendFileSync(log, `${new Date().toISOString()} ${agent} ${event} ${m}\n`);
    } catch {}
  };
  try {
    const f = stateFile(input);
    if (event === 'prompt') {
      // 끝날 때 훅이 돌지 못한 턴(중단 등)의 파일을 잃지 않도록 기준 시각과 경로를 그대로 둔다.
      // 기준 시각은 끝날 때 훅이 처리를 마친 뒤에만 옮긴다
      const s = load(f);
      const now = Date.now();
      if (!s) store(f, {start: now, turnAt: now, cwd: cwdOf(input), paths: []});
      else if (now - (s.start ?? 0) > STALE_MS) store(f, {...s, pathsStart: s.pathsStart ?? s.start, start: now, turnAt: now, cwd: cwdOf(input), dirs: [], outsideSince: null});
      else store(f, {...s, turnAt: now, cwd: cwdOf(input)});
    } else if (event === 'post') {
      const s = load(f) || {start: Date.now(), cwd: cwdOf(input), paths: []};
      const e = effectsOf(input);
      const merge = (old, add) => [...new Set([...(old || []), ...add])];
      s.paths = merge(s.paths, e.written).filter((p) => !e.removed.has(p) || e.written.has(p));
      if (e.dirs.size) s.dirs = merge(s.dirs, e.dirs);
      if (e.unknown.size) s.unknown = merge(s.unknown, e.unknown).slice(0, 10);
      if (e.outside && !s.outsideSince) s.outsideSince = s.turnAt ?? s.start;
      store(f, s);
    } else if (event === 'stop') {
      const s = load(f) || {start: Date.now() - 600000, paths: []};
      const cwd = s.cwd || cwdOf(input);
      const {lines, urgent, failed, pending, handled} = await runStop(s, cwd);
      // 모두 처리한 뒤에야 기준 시각을 옮긴다. 처리 못 한 파일이 있으면 그대로 두어 다음에 다시 찾는다
      store(f, pending.length ? {...s, cwd, paths: pending, unknown: [], done: {...s.done, ...handled}} : {start: Date.now(), turnAt: s.turnAt, cwd, paths: [], done: handled});
      if (lines.length) note(lines.join(' / '));
      if (lines.length) {
        const message = 'html-doc-kit: ' + lines.join('\n');
        if (agent === 'cursor') {
          // Cursor는 끝날 때 사용자에게 바로 보여 줄 길이 없어 모델을 거쳐 전한다. 평범한 완료는 조용히 넘긴다
          if (urgent || failed.length) process.stdout.write(JSON.stringify({followup_message: `${message}\n위 내용을 사용자에게 그대로 알려 주세요. 파일을 직접 고치지 마세요.`}));
          else process.stdout.write('{}');
        } else process.stdout.write(JSON.stringify({systemMessage: message}));
        return;
      }
    }
    process.stdout.write('{}');
  } catch (e) {
    note(`오류 ${e.stack || e.message}`);
    if (agent === 'cursor') process.stdout.write('{}');
    else process.stdout.write(JSON.stringify({systemMessage: `html-doc-kit 훅 오류: ${e.message}`}));
  }
}
