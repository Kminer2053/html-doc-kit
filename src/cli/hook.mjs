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
// 늘 건드리지 않는 폴더: 받아 온 의존성, 가상 환경, 도구가 만든 시험 리포트. 프로젝트 안에서만 본다
const SYSTEM_DIRS = new Set(['node_modules', 'bower_components', 'venv', '__pycache__', '.next', '.nuxt', '.svelte-kit', '.venv', '.git', '.doc-kit', 'coverage', 'htmlcov', 'lcov-report', 'test-results', 'playwright-report', 'storybook-static']);
// 코드 프로젝트일 때만 앱 폴더로 치는 이름. 프로젝트 신호가 없는 평범한 폴더에서는 문서 폴더로 본다.
// out, target, vendor는 문서가 있을 수 있어 넣지 않는다
const APP_DIRS = new Set(['src', 'public', 'dist', 'build', 'static', 'views', 'templates', 'partials', 'emails', 'layouts', '_build', '_site', 'site']);
// 스캔이 내려가지 않는 폴더. 점 폴더, 다른 앱의 자료 폴더도 뺀다. 앱 폴더 이름은 내려가서 찾고 제외할 때 알린다
const SCAN_SKIP = new Set([...SYSTEM_DIRS, 'Library', 'AppData', 'Applications']);
const WEB_DEPS = new Set(['react', 'vue', 'svelte', 'next', 'nuxt', 'vite', 'webpack', 'astro', 'gatsby', 'parcel', 'solid-js', 'remix', 'electron', 'express', 'koa', 'fastify', 'hono', 'preact', 'lit', 'tailwindcss', 'ember-source', 'vuepress', 'vitepress', 'hexo', 'nest', 'polka', 'restify', 'hapi']);
const WEB_DEP_SCOPES = /^@(angular|sveltejs|11ty|remix-run|nestjs|docusaurus|hono|hapi|nuxt|tanstack)\//;
const BUILD_CONFIG = /^(?:(?:vite|vitest|next|nuxt|astro|webpack|svelte|remix|rollup|parcel|gatsby|tailwind|eleventy|quasar|vue|docusaurus|rspack|rsbuild)\.config\.[cm]?[jt]sx?|\.eleventy\.[cm]?js|angular\.json|manage\.py|mkdocs\.ya?ml|_config\.ya?ml|hugo\.(?:toml|ya?ml|json)|artisan|vercel\.json|netlify\.toml|firebase\.json)$/;
// 언어 프로젝트 파일. 이것만으로는 앱이 아니다. 의존성 선언 자리에 서버 웹 프레임워크가 있으면 앱 폴더(templates/ 등) 안은 빼고,
// 그 밖의 HTML은 덮어쓰지 않고 _편집용 사본을 만든다. 없으면 코드 프로젝트로만 쳐서 앱 폴더 안의 HTML만 뺀다.
// 이름은 설명·주석이 아니라 의존성을 적는 자리에서만 찾는다(requirements의 줄 첫머리, pyproject의 dependencies 배열,
// Cargo.toml의 [dependencies] 키, Gemfile의 gem, go.mod의 require, composer.json의 require 키, pom·gradle의 좌표, mix.exs의 deps).
// 템플릿 엔진·문서 생성기·노트북(jinja2, tornado, sphinx, markupsafe, jupyter, jekyll 등)과 HTTP 클라이언트로 흔한 aiohttp는 신호로 보지 않는다
const PY_WEB = new Set(['flask', 'django', 'fastapi', 'starlette', 'bottle', 'pyramid', 'sanic', 'quart', 'falcon', 'cherrypy', 'litestar']);
const pyName = (s) => (/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(s)?.[1] ?? '');
const pyWeb = (names) => names.map(pyName).find((n) => PY_WEB.has(n.toLowerCase().replace(/[._]+/g, '-')));
const quoted = (s) => [...s.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
// TOML을 표·키·값으로 대강 나눈다. 여러 줄 배열과 주석을 처리한다
function tomlEntries(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let table = '';
  const depth = (s) => {
    let d = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'") {
        const j = s.indexOf(c, i + 1);
        i = j < 0 ? s.length : j;
      } else if (c === '#') break;
      else if (c === '[' || c === '{') d++;
      else if (c === ']' || c === '}') d--;
    }
    return d;
  };
  for (let i = 0; i < lines.length; i++) {
    const h = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/.exec(lines[i]);
    if (h) {
      table = h[1].replace(/["'\s]/g, '');
      continue;
    }
    const kv = /^\s*("[^"]*"|'[^']*'|[\w.-]+)\s*=\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2];
    for (let d = depth(value); d > 0 && i + 1 < lines.length; d = depth(value)) value += '\n' + lines[++i];
    out.push({table, key: kv[1].replace(/^["']|["']$/g, ''), value});
  }
  return out;
}
const tomlStrings = (value) => quoted(value.replace(/#[^\n"']*$/gm, ''));
const GO_WEB = ['gin-gonic', 'labstack/echo', 'gofiber', 'go-chi', 'gorilla/mux', 'beego', 'revel', 'gobuffalo'];
const RUST_WEB = new Set(['actix-web', 'axum', 'rocket', 'warp', 'tide', 'poem', 'leptos']);
const RUBY_WEB = new Set(['rails', 'sinatra', 'hanami', 'roda', 'padrino']);
const PHP_WEB = /^(?:laravel\/(?:framework|lumen-framework)|symfony\/(?:framework-bundle|http-kernel)|slim\/slim|cakephp\/cakephp|yiisoft\/yii2|codeigniter4?\/framework|laminas\/laminas-mvc)$/i;
const JVM_WEB = /^(?:spring-boot-starter-web(?:flux)?|spring-web(?:mvc|flux)?|quarkus-[\w.-]+|micronaut-[\w.-]+|jakarta\.servlet-api|javax\.servlet-api)$/;
const JVM_PLUGIN = /^(?:org\.springframework\.boot|io\.quarkus|io\.micronaut\.[\w.-]+)$/;
const ELIXIR_WEB = new Set(['phoenix', 'plug', 'plug_cowboy']);
const LANG_FILES = [
  [/^requirements[\w.-]*\.txt$/, (t) => pyWeb(t.split(/\r?\n/).filter((l) => /^\s*[A-Za-z0-9]/.test(l)))],
  [/^pyproject\.toml$/, (t) => {
    const e = tomlEntries(t);
    const pep = e.filter((x) => (x.table === 'project' && x.key === 'dependencies') || x.table === 'project.optional-dependencies').flatMap((x) => tomlStrings(x.value));
    const poetry = e.filter((x) => x.table === 'tool.poetry.dependencies').map((x) => x.key);
    return pyWeb([...pep, ...poetry]);
  }],
  [/^Pipfile$/, (t) => pyWeb(tomlEntries(t).filter((x) => x.table === 'packages').map((x) => x.key))],
  [/^setup\.py$/, (t) => pyWeb([...t.matchAll(/install_requires\s*=\s*\[([^\]]*)\]/g)].flatMap((m) => quoted(m[1])))],
  [/^setup\.cfg$/, (t) => {
    const m = /^install_requires\s*=([^\n]*(?:\n[ \t]+[^\n]*)*)/m.exec(t);
    return m && pyWeb(m[1].split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean));
  }],
  [/^Cargo\.toml$/, (t) => {
    const deps = (tb) => tb === 'dependencies' || tb === 'workspace.dependencies' || /^target\..+\.dependencies$/.test(tb);
    const names = tomlEntries(t).filter((x) => deps(x.table)).map((x) => x.key);
    for (const m of t.matchAll(/^\s*\[\s*(?:workspace\.|target\.[^\]]+\.)?dependencies\.([\w-]+)\s*\]/gm)) names.push(m[1]);
    return names.find((n) => RUST_WEB.has(n));
  }],
  [/^Gemfile$/, (t) => [...t.matchAll(/^\s*gem\s+['"]([\w-]+)['"]/gm)].map((m) => m[1]).find((n) => RUBY_WEB.has(n))],
  [/^go\.mod$/, (t) => {
    const paths = [];
    for (const m of t.matchAll(/^\s*require\s*\(([\s\S]*?)^\s*\)/gm)) m[1].split('\n').forEach((l) => paths.push(l.trim().split(/\s+/)[0]));
    for (const m of t.matchAll(/^\s*require\s+([^\s(]+)/gm)) paths.push(m[1]);
    return paths.find((p) => p && GO_WEB.some((n) => new RegExp(`(?:^|/)${n}(?:/|$)`).test(p)));
  }],
  [/^composer\.json$/, (t) => {
    try {
      return Object.keys(JSON.parse(t).require || {}).find((k) => PHP_WEB.test(k));
    } catch {
      return null;
    }
  }],
  [/^pom\.xml$/, (t) => [...t.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<artifactId>\s*([\w.-]+)\s*<\/artifactId>/g)].map((m) => m[1]).find((a) => JVM_WEB.test(a))],
  [/^build\.gradle(?:\.kts)?$/, (t) => {
    const s = t.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    const coords = [...s.matchAll(/['"]([\w.-]+):([\w.-]+)(?::[^'"]*)?['"]/g)].map((m) => `${m[1]}:${m[2]}`);
    const plugins = [...s.matchAll(/\bid\s*\(?\s*['"]([\w.-]+)['"]/g)].map((m) => m[1]);
    return coords.find((c) => JVM_WEB.test(c.split(':')[1])) || plugins.find((p) => JVM_PLUGIN.test(p));
  }],
  [/^mix\.exs$/, (t) => [...t.matchAll(/\{\s*:(\w+)\s*,/g)].map((m) => m[1]).find((n) => ELIXIR_WEB.has(n))],
];
// 훅이 파일을 고치는 근거는 둘뿐이다. (가) 에이전트가 그 경로에 썼다는 직접 증거: 도구의 file_path, 셸 명령을 낱말로
// 나눠 얻은 쓰기 대상(>, >>, tee, -o/--output, cp·mv·rsync 대상 등). (나) 작업 폴더를 훑어 이번 턴 구간에 바뀐 파일.
// 그 밖은 고치지 않고, 이번 턴에 생긴 것으로 보이면 '확인 필요'로 알리기만 한다.
// 바탕화면·다운로드·문서 폴더는 명령에 이름이 나와도 훑어서 고치지 않는다(사용자가 받은 파일이 섞이므로).
// 스크립트를 돌린 턴에 바로 아래를 훑어 알리기만 한다
const OUTSIDE_DIRS = ['Desktop', 'Downloads', 'Documents'];
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

// 파일을 쓰지 않는 명령. 이것만 돌린 턴은 스크립트 실행으로 치지 않는다
const READ_ONLY = new Set(['ls', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'rg', 'find', 'fd', 'wc', 'pwd', 'echo', 'printf', 'which', 'type', 'stat', 'file', 'du', 'df', 'tree', 'diff', 'true', 'false', 'test', '[', 'sleep', 'date', 'whoami', 'uname', 'env', 'printenv']);
const READ_ONLY_GIT = new Set(['status', 'log', 'diff', 'show', 'branch', 'remote', 'rev-parse', 'ls-files', 'blame', 'describe']);
const SHELL_WORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}', 'sudo', 'command', 'nohup', 'time', 'env', 'exec', 'export']);
const ASSIGN = /^[A-Za-z_]\w*=/;

// 셸 명령이 쓴 HTML을 찾는다. 위치를 알 수 없는 쓰기는 unknown으로 돌려준다
function readShell(cmd, cwd) {
  const home = HOME();
  const out = {written: new Set(), removed: new Set(), dirs: new Set(), unknown: new Set(), ran: false};
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
    if (!['cd', 'pushd', 'popd'].includes(prog) && !READ_ONLY.has(prog) && !(prog === 'git' && READ_ONLY_GIT.has(a[1]))) out.ran = true;
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
  const out = {written: new Set(), removed: new Set(), dirs: new Set(), unknown: new Set(), ran: false};
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
    out.ran ||= r.ran;
  }
  return out;
}
export const pathsFromInput = (i) => [...effectsOf(i).written];

// fresh(수정 시각): 훑을 구간에 드는지
function scan(dir, fresh, found = [], depth = 0, budget = {left: SCAN_ENTRIES_MAX}) {
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
      if (!e.name.startsWith('.') && !SCAN_SKIP.has(e.name)) scan(p, fresh, found, depth + 1, budget);
    } else if (e.isFile() && isHtml(e.name)) {
      if (fresh(statOf(p)?.mtimeMs ?? 0)) found.push(p);
    }
  }
  return found;
}
// 작업 폴더 밖에 저장하기 쉬운 곳은 바로 아래만 본다
function scanShallow(dir, fresh) {
  try {
    return fs
      .readdirSync(dir, {withFileTypes: true})
      .filter((e) => e.isFile() && isHtml(e.name))
      .map((e) => path.join(dir, e.name))
      .filter((p) => fresh(statOf(p)?.mtimeMs ?? 0));
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
// 그 파일을 마지막으로 바꾼 커밋. 해시, 작성 시각·커미터 시각(초), 이 저장소에서 git commit으로 만든 커밋인지.
// rebase·pull·cherry-pick은 커미터 시각을 지금으로 바꾸거나 남이 만든 커밋을 들여오므로 reflog로 가린다. 모르면 null
function lastCommit(file) {
  const dir = path.dirname(path.resolve(file));
  const r = spawnSync('git', ['-C', dir, 'log', '-1', '--format=%H %at %ct', '--', path.basename(file)], {encoding: 'utf-8', timeout: 5000});
  const [hash, at, ct] = (r.status === 0 ? r.stdout.trim() : '').split(' ');
  if (!hash || !(Number(at) > 0) || !(Number(ct) > 0)) return null;
  const g = spawnSync('git', ['-C', dir, 'reflog', '-n', '500', '--format=%H %gs'], {encoding: 'utf-8', timeout: 5000});
  const lines = g.status === 0 ? g.stdout.split('\n').filter(Boolean) : [];
  // reflog가 없으면(꺼 둔 저장소) 시각만으로 본다
  const local = !lines.length || lines.some((l) => l.startsWith(`${hash} commit`));
  return {at: Number(at), ct: Number(ct), local};
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
const readHead = (f) => {
  try {
    const fd = fs.openSync(f, 'r');
    const buf = Buffer.alloc(200000);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.subarray(0, n).toString('utf-8');
  } catch {
    return '';
  }
};
// 파일에서 프로젝트 맨 위까지 폴더 항목을 본다. 프로젝트 밖의 package.json은 이 문서의 신호가 아니다.
// 앱으로 보는 것: 웹 프레임워크 의존성·빌드 설정, 의존성·시험 리포트 폴더, 코드 프로젝트 안의 앱 폴더(templates/ 등).
// 언어 프로젝트 파일(requirements.txt, Cargo.toml 등)만 있으면 그 밖의 HTML은 문서다.
// 그 파일에 서버 웹 프레임워크가 있으면 앱 폴더 밖의 HTML은 web으로 돌려준다(사본 대상)
function projectSignals(file, cwd) {
  const root = projectRoot(file, cwd);
  const res = {app: null, web: null};
  // 폴더 이름은 프로젝트 안에서만 본다(프로젝트가 ~/src 아래 있어도 문서는 문서다)
  const segs = path.relative(root, path.resolve(file)).split(path.sep).slice(0, -1);
  const sys = segs.find((x) => SYSTEM_DIRS.has(x));
  if (sys) {
    res.app = `의존성·리포트 폴더 ${sys}/`;
    return res;
  }
  let project = null; // 웹 프레임워크가 없는 코드 프로젝트 파일
  let web = null; // 언어 프로젝트 파일 속 서버 웹 프레임워크
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
      else project ||= 'package.json';
    }
    // Sphinx 설정은 코드 프로젝트로만 친다. 출력 폴더 _build/는 앱 폴더 규칙으로 뺀다
    if (!res.app && names.includes('conf.py') && /\bsphinx\b|^\s*html_theme\s*=/m.test(readHead(path.join(d, 'conf.py')))) project ||= 'conf.py';
    for (const n of res.app || web ? [] : names) {
      const rule = LANG_FILES.find(([re]) => re.test(n));
      if (!rule) continue;
      const m = rule[1](readHead(path.join(d, n)));
      if (m) {
        web = `웹 프레임워크 ${m}(${n})`;
        break;
      }
      project ||= n;
    }
    if (d === root || d === path.dirname(d)) break;
  }
  const hit = !res.app && (web || project) && segs.find((x) => APP_DIRS.has(x));
  if (hit) res.app = web ? `${web}의 앱 폴더 ${hit}/` : `코드 프로젝트(${project})의 앱 폴더 ${hit}/`;
  // 서버 웹 프레임워크 프로젝트의 앱 폴더 밖 HTML: 제자리 대신 사본을 만든다
  else if (!res.app && web) res.web = web;
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
  // 웹 프레임워크 프로젝트에서는 앱 폴더 밖이어도 앱이 쓰는 파일일 수 있어 덮어쓰지 않는다
  if (scripted || (!isKit && signals.web)) {
    const copy = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}_편집용.html`);
    if (fs.existsSync(copy) && fs.statSync(copy).mtimeMs >= fs.statSync(file).mtimeMs) return {file, kind: 'ok'};
    const r = await ensure(file, {output: copy});
    return {file: r.file, kind: 'copied', source: file, reason: scripted ? '자체 스크립트나 삽입 요소가 있어' : `${signals.web}가 있는 프로젝트라 앱 파일일 수 있어`, result: r};
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
  // 훑을 구간: 이번 턴(시작부터 지금까지)과, 끝날 때 훅이 돌지 못한 지난 턴들(시작부터 마지막 도구 사용까지).
  // 정상으로 끝난 턴 사이에 사용자나 다른 프로그램이 바꾼 파일은 훑지 않는다
  const ranges = [...(state.gaps || []).map((g) => ({from: g.from - 1500, to: g.to + 1500, cwd: g.cwd})), {from: base - 1500, to: Infinity, cwd}];
  const fresh = (ms) => ranges.some((r) => ms >= r.from && ms <= r.to);
  // 커밋 시각은 초 단위라 여유를 두지 않는다. 작성 시각과 커미터 시각이 모두 턴이 시작된 초 이후이고
  // 이 저장소에서 git commit으로 만든 커밋만 이번 턴의 커밋으로 본다(rebase·pull로 들어온 커밋은 아니다)
  const inRange = (sec) => ranges.some((r) => sec >= Math.floor((r.from + 1500) / 1000) && sec * 1000 <= r.to);
  const committedInTurn = (c) => c !== null && c.local && inRange(c.at) && inRange(c.ct);
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

  const scanned = new Set();
  for (const d of new Set(ranges.map((r) => r.cwd).filter(Boolean))) if (!isHomeOrRoot(d)) scan(d, fresh).forEach((p) => scanned.add(p));
  const isKitFile = (p) => {
    try {
      return fs.readFileSync(p, 'latin1').includes('data-doc-kit=');
    } catch {
      return true;
    }
  };
  // 중단된 턴의 마지막 도구 사용 뒤부터 다음 prompt까지 작업 폴더에서 바뀐 HTML: 중단 직전 스크립트가 썼을 수도,
  // 사용자가 턴 사이에 저장했을 수도 있어 고치지 않고 알린다
  const late = new Set();
  for (const g of state.gaps || []) {
    if (!g.cwd || !g.next || isHomeOrRoot(g.cwd)) continue;
    const lateFresh = (ms) => ms > g.to + 1500 && ms <= g.next && !fresh(ms);
    for (const p of scan(g.cwd, lateFresh)) {
      const st = statOf(p);
      if (scanned.has(p) || !st || already(p, st) || isKitFile(p) || excludedByConfig(p) || projectSignals(p, cwd).app) continue;
      late.add(p);
    }
  }
  const lateList = [...late].filter((p) => !explicit.includes(p));
  lateList.slice(0, SKIP_NOTES_MAX).forEach((p) => extra.push(`확인 필요: ${p} (중단된 작업의 마지막 도구 사용 뒤에 바뀐 HTML이라 사용자가 저장한 파일일 수 있어 그대로 두었습니다. 문서이면 ensure를 실행하세요)`));
  if (lateList.length > SKIP_NOTES_MAX) extra.push(`확인 필요: 중단된 작업 뒤에 바뀐 HTML ${lateList.length - SKIP_NOTES_MAX}개 더`);
  for (const d of state.dirs || []) (isHomeOrRoot(d) ? scanShallow(d, fresh) : scan(d, fresh)).forEach((p) => scanned.add(p));
  // 스크립트만 돌린 턴: 바탕화면·다운로드·문서 폴더에 이번 턴에 바뀐 HTML은 고치지 않고 알린다
  if (state.scriptSince) {
    const scriptFresh = (ms) => ms >= state.scriptSince - 1500 && fresh(ms);
    const seen = new Set([...scanned, ...explicit, ...late]);
    const looks = OUTSIDE_DIRS.flatMap((d) => scanShallow(path.join(HOME(), d), scriptFresh)).filter((p) => {
      const st = statOf(p);
      return !seen.has(p) && st && !already(p, st) && !isKitFile(p);
    });
    looks.slice(0, SKIP_NOTES_MAX).forEach((p) => extra.push(`확인 필요: ${p} (이번 작업 중 생긴 HTML로 보이나 사용자 폴더라 그대로 두었습니다. 문서이면 ensure를 실행하세요)`));
    if (looks.length > SKIP_NOTES_MAX) extra.push(`확인 필요: 사용자 폴더의 HTML ${looks.length - SKIP_NOTES_MAX}개 더`);
  }
  const skipNotes = [];
  const passThrough = []; // 상한에 세지 않는다: 이미 키트 파일이거나 제외될 파일
  const candidates = [];
  for (const p of scanned) {
    const st = statOf(p);
    if (!st || already(p, st) || explicit.includes(p)) continue;
    const git = gitState(p);
    // HEAD와 같아도 이번 턴에 커밋한 파일이면 이번 작업의 결과다. 그 밖은 checkout·pull·rebase 등으로 바뀐 것으로 보고 알린다
    if (git === 'same' && !committedInTurn(lastCommit(p))) {
      skipNotes.push({file: p, kind: 'skip', note: `제외: ${p} (git 커밋과 같고 이번 작업에서 커밋한 파일이 아니라 checkout·pull·rebase 등으로 바뀐 것으로 봄. 문서이면 ensure를 실행하세요)`});
      continue;
    }
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
      // 새 턴의 기준 시각은 지금이다. 지난 턴이 끝날 때 훅 없이 끝났으면(중단 등) 그 턴의 구간을
      // 미처리 구간으로 남겨 다음 끝날 때 함께 훑는다. 마지막 도구 사용 뒤부터 이 prompt까지는 알리기만 하려고 지금 시각도 적는다.
      // 도구로 쓴 경로 기록은 그대로 둔다
      const s = load(f);
      const now = Date.now();
      const cwd = cwdOf(input);
      if (!s) store(f, {start: now, turnAt: now, cwd, paths: [], open: true});
      else {
        const gaps = (s.gaps || []).filter((g) => g.to >= now - STALE_MS);
        if (s.open && s.start) {
          const to = Math.max(s.lastPost ?? 0, s.turnAt ?? s.start);
          if (to >= now - STALE_MS) gaps.push({from: s.start, to, next: now, cwd: s.cwd});
        }
        const keep = gaps.length > 0;
        const paths = s.paths || [];
        store(f, {...s, start: now, turnAt: now, cwd, open: true, lastPost: null, gaps: gaps.slice(-5), paths, pathsStart: paths.length ? (s.pathsStart ?? s.start) : null, dirs: keep ? s.dirs : [], scriptSince: keep ? s.scriptSince : null});
      }
    } else if (event === 'post') {
      const s = load(f) || {start: Date.now(), cwd: cwdOf(input), paths: []};
      const e = effectsOf(input);
      const merge = (old, add) => [...new Set([...(old || []), ...add])];
      s.paths = merge(s.paths, e.written).filter((p) => !e.removed.has(p) || e.written.has(p));
      if (e.dirs.size) s.dirs = merge(s.dirs, e.dirs);
      if (e.unknown.size) s.unknown = merge(s.unknown, e.unknown).slice(0, 10);
      if (e.ran) s.scriptSince ||= s.turnAt ?? s.start;
      s.lastPost = Date.now();
      store(f, s);
    } else if (event === 'stop') {
      const s = load(f) || {start: Date.now() - 600000, paths: []};
      const cwd = s.cwd || cwdOf(input);
      const {lines, urgent, failed, pending, handled} = await runStop(s, cwd);
      // 모두 처리한 뒤에야 기준 시각을 옮긴다. 처리 못 한 파일이 있으면 그대로 두어 다음에 다시 찾는다
      store(f, pending.length ? {...s, cwd, open: false, gaps: [], paths: pending, unknown: [], done: {...s.done, ...handled}} : {start: Date.now(), turnAt: s.turnAt, cwd, open: false, paths: [], done: handled});
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
