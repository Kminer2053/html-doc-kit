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
// 나눠 얻은 쓰기 대상(>, >>, tee, 출력 옵션으로 알려진 프로그램과 스크립트의 -o/--output, cp·mv·rsync 원본 이름을 대상에 붙인 경로 등).
// (나) 쓰기가 있었던 턴에 작업 폴더를 훑어 이번 턴 구간에 바뀐 파일.
// 그 밖은 고치지 않고, 이번 턴에 생긴 것으로 보이면 '확인 필요'로 알리기만 한다.
// 바탕화면·다운로드·문서 폴더는 명령에 이름이 나와도 훑어서 고치지 않는다(사용자가 받은 파일이 섞이므로).
// 스크립트를 돌린 턴에 바로 아래를 훑어 알리기만 한다
const OUTSIDE_DIRS = ['Desktop', 'Downloads', 'Documents'];
const SCAN_FILES_MAX = 5; // 스캔으로만 찾은 파일이 이보다 많으면 입히지 않고 목록만 알린다
const scanEntriesMax = () => Number(process.env.DOC_KIT_SCAN_ENTRIES_MAX) || 20000; // 폴더 항목을 이만큼 봤으면 스캔을 멈추고 알린다
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
const cwdOf = (i) => fromMsys(i.cwd || (i.workspace_roots && i.workspace_roots[0])) || process.cwd();
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
// -o/--output 뒤를 출력 파일로 받는 것으로 알려진 프로그램. wget은 -O만 출력이다(-o는 기록 파일)
const OUTPUT_PROGS = new Set(['curl', 'pandoc', 'gcc', 'g++', 'cc', 'c++', 'clang', 'clang++', 'rustc', 'go', 'sort', 'quarto', 'asciidoctor', 'asciidoc', 'marp', 'mmdc', 'jupyter', 'sass', 'esbuild', 'typst', 'markdown-it', 'marked', 'showdown', 'md2html', 'pdf2htmlEX', 'wkhtmltopdf', 'weasyprint', 'xsltproc', 'protoc']);
// 스크립트를 돌리는 프로그램. 넘긴 -o/--output은 그 스크립트의 출력으로 본다
const RUNNERS = new Set(['node', 'deno', 'bun', 'bunx', 'tsx', 'ts-node', 'npx', 'pnpm', 'yarn', 'npm', 'ruby', 'perl', 'php', 'Rscript', 'sh', 'bash', 'zsh', 'uv', 'uvx', 'poetry', 'pipx', 'pipenv', 'conda']);
const isRunner = (prog, arg0) => RUNNERS.has(prog) || /^python[\d.]*$|^py$/.test(prog) || /\.(?:py|[cm]?js|ts|sh|rb|pl|php|R)$/.test(prog) || /^\.\.?\//.test(arg0); // ./gen, ../tools/make 같은 상대 경로 실행 파일도 스크립트로 본다
const TREE_MAX = 500; // cp -r 폴더에서 기록할 HTML 수 상한
const SCAN_DEPTH_MAX = 12; // 작업 폴더를 내려가는 깊이 상한
const hasGlob = (s) => /[*?[]/.test(s);
// 한 폴더 안의 글롭(이름 부분만)을 펼친다. 폴더 부분에 글롭이 있으면 null
function expandGlob(absPattern) {
  const dir = path.dirname(absPattern);
  const base = path.basename(absPattern);
  if (hasGlob(dir)) return null;
  const re = new RegExp(`^${base.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`);
  try {
    return fs.readdirSync(dir).filter((n) => re.test(n) && (base.startsWith('.') || !n.startsWith('.'))).map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}
// 폴더 안 HTML의 상대 경로. 점 폴더와 의존성 폴더는 내려가지 않는다
function htmlTree(root) {
  const out = [];
  let cut = false;
  const walkDir = (d, rel, depth) => {
    if (depth > SCAN_DEPTH_MAX) return void (cut = true);
    let list;
    try {
      list = fs.readdirSync(d, {withFileTypes: true});
    } catch {
      return;
    }
    for (const e of list) {
      if (out.length >= TREE_MAX) return void (cut = true);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !SCAN_SKIP.has(e.name)) walkDir(path.join(d, e.name), path.join(rel, e.name), depth + 1);
      } else if (e.isFile() && isHtml(e.name)) out.push(path.join(rel, e.name));
    }
  };
  walkDir(root, '', 0);
  return {rels: out, cut};
}

// Git Bash(MSYS) 경로를 윈도 경로로 바꾼다. /c/... 와 Cursor 앱이 넘기는 /c:/... 는 C:\..., /tmp 는 사용자 임시 폴더다. 윈도가 아니면 그대로 둔다
export function fromMsys(s, {platform = process.platform, tmp = os.tmpdir()} = {}) {
  if (platform !== 'win32' || typeof s !== 'string') return s;
  const d = /^\/([A-Za-z]):?(?=\/|$)(.*)$/s.exec(s);
  if (d) return path.win32.normalize(`${d[1].toUpperCase()}:\\${d[2]}`);
  const t = /^\/tmp(?=\/|$)(.*)$/s.exec(s);
  if (t) return path.win32.join(tmp, t[1]);
  return s;
}

// 셸 명령이 쓴 HTML을 찾는다. 위치를 알 수 없는 쓰기는 unknown으로, 출력 파일인지 모르는 것은 maybe로 돌려준다.
// wrote: 리디렉션·tee처럼 무엇이든 파일에 쓴 흔적
function readShell(cmd, cwd) {
  const home = HOME();
  const out = {written: new Set(), removed: new Set(), unknown: new Set(), maybe: new Set(), notes: new Set(), ran: false, wrote: false};
  const vars = {HOME: home};
  let dir = cwd;
  const expand = (w) => {
    let s = w.replace(/\$\{(\w+)\}|\$(\w+)/g, (all, a, b) => (Object.hasOwn(vars, a || b) ? vars[a || b] : all));
    const unresolved = s.includes('$') || s.includes('`');
    s = s.replaceAll(LITERAL_DOLLAR, '$');
    if (!unresolved) s = s.replace(/^~(?=\/|$)/, home);
    return {s, unresolved};
  };
  const abs = (raw) => {
    const s = fromMsys(raw);
    return path.isAbsolute(s) ? path.normalize(s) : dir ? path.resolve(dir, s) : null;
  };
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
        if (typeof words[i + 1] === 'string') {
          if (words[i + 1] !== '/dev/null') out.wrote = true;
          addFile(words[++i]);
        }
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
    // find -exec·-execdir·-ok 뒤의 명령은 따로 읽는다(find -exec pandoc {} -o out.html \;)
    if (prog === 'find') {
      for (let i = 1; i < a.length; i++) {
        if (!['-exec', '-execdir', '-ok', '-okdir'].includes(a[i])) continue;
        const sub = [];
        for (i++; i < a.length && a[i] !== ';' && a[i] !== '+'; i++) sub.push(a[i]);
        if (!sub.length) continue;
        const r = readShell(sub.map((w) => `"${w.replace(/["\\`]/g, '\\$&')}"`).join(' '), dir);
        for (const key of ['written', 'removed', 'unknown', 'maybe', 'notes']) r[key].forEach((v) => out[key].add(v));
        out.ran ||= r.ran;
        out.wrote ||= r.wrote;
      }
    }
    // 읽기 전용 프로그램이지만 출력 파일 옵션이 있는 것: tree -o, git diff·log·show --output
    for (let i = 1; i < a.length; i++) {
      const gitOut = prog === 'git' && READ_ONLY_GIT.has(a[1]);
      if (prog === 'tree' && a[i] === '-o' && a[i + 1]) (out.ran = true), addFile(a[i + 1]);
      else if (gitOut && a[i] === '--output' && a[i + 1]) (out.ran = true), addFile(a[i + 1]);
      else if (gitOut && a[i].startsWith('--output=')) (out.ran = true), addFile(a[i].slice(9));
    }
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
    if (prog === 'tee') {
      const files = a.slice(1).filter((w) => !w.startsWith('-'));
      if (files.length) out.wrote = true;
      files.forEach(addFile);
    }
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
      // 폴더째 복사하는지. mv와 ditto는 늘 폴더째 옮긴다
      let recursive = prog === 'mv' || prog === 'ditto';
      for (let i = 1; i < a.length; i++) {
        if (a[i] === '-t' || a[i] === '--target-directory') target = a[++i];
        else if (a[i].startsWith('--target-directory=')) target = a[i].slice(19);
        else if (a[i] === '--recursive' || a[i] === '--archive' || (/^-[A-Za-z]+$/.test(a[i]) && /[rRa]/.test(a[i]) && prog !== 'install')) recursive = true;
        else if (!a[i].startsWith('-')) pos.push(a[i]);
      }
      const dest = target ?? pos.pop();
      if (dest && pos.length) {
        const d = expand(dest);
        const to = d.unresolved ? null : abs(d.s);
        const toDir = to && (d.s.endsWith('/') || target !== null || statOf(to)?.isDirectory());
        if (!toDir) addFile(dest);
        // 대상 폴더는 훑지 않는다. 원본 인자의 이름을 대상 폴더에 붙인 경로만 기록한다
        const putTree = (srcDir, s) => {
          const into = path.join(to, path.basename(srcDir));
          if (prog === 'mv') {
            // 옮긴 뒤에는 원본이 없다. 대상 아래 같은 이름 폴더가 옮겨 온 폴더이고, 없으면 대상 자체가 이름만 바뀐 그 폴더다
            const moved = statOf(into)?.isDirectory() ? into : to;
            const t = htmlTree(moved);
            t.rels.forEach((r) => out.written.add(path.join(moved, r)));
            if (t.cut) out.notes.add(`${moved} 안의 HTML은 ${TREE_MAX}개까지만 기록했습니다. 옮긴 HTML이 더 있으면 ensure를 실행하세요`);
            return;
          }
          const t = htmlTree(srcDir);
          // rsync의 원본 끝 /는 폴더 안의 내용만 옮긴다. cp는 대상이 이미 있던 폴더면 그 아래에 원본 이름 폴더를 만든다
          const bases = prog === 'rsync' && s.endsWith('/') ? [to] : [into, to];
          for (const r of t.rels) out.written.add(path.join(bases.find((b) => statOf(path.join(b, r))) ?? bases[0], r));
          if (t.cut) out.notes.add(`${srcDir} 안의 HTML은 ${TREE_MAX}개까지만 기록했습니다. 복사한 HTML이 더 있으면 ensure를 실행하세요`);
        };
        for (const w of pos) {
          const {s, unresolved} = expand(w);
          if (/^[\w.-]+@?[\w.-]*:/.test(s) && prog === 'rsync') continue; // 원격 경로
          if (toDir) {
            if (unresolved) {
              if (isHtml(s) || hasGlob(s) || !path.extname(s)) out.unknown.add(`${prog} ${s} → ${d.s}`);
            } else if (hasGlob(s)) {
              // 글롭은 지금 작업 폴더 기준으로 펼친다. mv는 원본이 사라졌으니 펼쳐지지 않으면 알린다
              const names = expandGlob(abs(s));
              if (names === null || (!names.length && prog === 'mv')) out.unknown.add(`${prog} ${s} → ${d.s}`);
              for (const n of names || []) {
                const st = statOf(n);
                if (st?.isFile() && isHtml(n)) out.written.add(path.join(to, path.basename(n)));
                else if (st?.isDirectory() && recursive) putTree(n, s);
              }
            } else if (isHtml(s)) out.written.add(path.join(to, path.basename(s)));
            else if (recursive) {
              const into = statOf(path.join(to, path.basename(s)));
              // mv: 대상 아래 같은 이름 폴더가 생겼거나, 원본 하나를 새 이름 폴더로 바꾼 경우만
              const isDir = prog === 'mv' ? !statOf(abs(s)) && (into?.isDirectory() || (!into && pos.length === 1 && !d.s.endsWith('/'))) : statOf(abs(s))?.isDirectory();
              if (isDir) putTree(abs(s), s);
            }
          } else if (!to && !isHtml(d.s) && isHtml(s)) out.unknown.add(s);
          const from = !unresolved && abs(s);
          if (prog === 'mv' && from) out.removed.add(from);
        }
      }
    }
    // -o/--output: 출력 옵션으로 알려진 프로그램과 스크립트에서만 쓰기 대상이다. 읽기 전용 프로그램(ls -o, grep -o)은 보지 않는다.
    // 그 밖의 프로그램은 출력 파일인지 몰라 maybe로 돌려 '확인 필요'로만 알린다
    if (!READ_ONLY.has(prog) && !(prog === 'git' && READ_ONLY_GIT.has(a[1]))) {
      const known = OUTPUT_PROGS.has(prog) || isRunner(prog, a[0]);
      const take = (w) => {
        if (known) return addFile(w);
        const {s, unresolved} = expand(w);
        if (isHtml(s) && !unresolved && abs(s)) out.maybe.add(abs(s));
      };
      for (let i = 1; i < a.length; i++) {
        if (prog === 'wget') {
          if (a[i] === '-O' || a[i] === '--output-document') a[i + 1] && addFile(a[i + 1]);
          else if (a[i].startsWith('--output-document=')) addFile(a[i].slice(18));
        } else if (a[i] === '-o' || a[i] === '--output') {
          if (a[i + 1]) take(a[i + 1]);
        } else if (a[i].startsWith('--output=')) take(a[i].slice(9));
      }
    }
  }
  return out;
}

// PowerShell 명령을 단순 명령과 낱말로 나눈다. 홑따옴표('' 이스케이프), 겹따옴표(` 이스케이프), 여기 문자열(@' '@)을 처리하고 \는 글자로 둔다
const PS_SEP = '\u0002'; // 쉼표로 이은 값들의 경계
const PS_UNRES = '\u0003'; // 괄호 식처럼 값을 알 수 없는 부분
function psCommands(src) {
  const cmds = [];
  let cur = [];
  let word = null;
  const flush = () => {
    if (word !== null) cur.push(word);
    word = null;
  };
  const end = () => {
    flush();
    if (cur.length) cmds.push(cur);
    cur = [];
  };
  // 여는 괄호에 짝이 맞는 닫는 괄호의 위치. 따옴표 안의 괄호는 세지 않는다
  const close = (i) => {
    let depth = 0;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (c === "'") j = src.indexOf("'", j + 1) < 0 ? src.length : src.indexOf("'", j + 1);
      else if (c === '"') {
        for (j++; j < src.length && src[j] !== '"'; j++) if (src[j] === '`') j++;
      } else if (c === '`') j++;
      else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return j;
    }
    return src.length;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '@' && (src[i + 1] === "'" || src[i + 1] === '"') && /^[ \t]*\r?\n/.test(src.slice(i + 2, i + 40))) {
      const q = src[i + 1];
      const nl = src.indexOf('\n', i + 2);
      const stop = src.indexOf(`\n${q}@`, nl);
      const body = src.slice(nl + 1, stop < 0 ? src.length : stop).replace(/\r$/, '');
      word = (word ?? '') + (q === "'" ? body.replaceAll('$', LITERAL_DOLLAR) : body);
      i = stop < 0 ? src.length : stop + 2;
    } else if (c === "'") {
      let s = '';
      for (i++; i < src.length; i++) {
        if (src[i] !== "'") s += src[i];
        else if (src[i + 1] === "'") (s += "'"), i++;
        else break;
      }
      word = (word ?? '') + s.replaceAll('$', LITERAL_DOLLAR);
    } else if (c === '"') {
      let s = '';
      for (i++; i < src.length; i++) {
        if (src[i] === '`') {
          i++;
          s += src[i] === '$' ? LITERAL_DOLLAR : src[i] ?? '';
        } else if (src[i] === '"') {
          if (src[i + 1] !== '"') break;
          s += '"';
          i++;
        } else if (src[i] === '$' && src[i + 1] === '(') {
          const j = close(i + 1);
          s += PS_UNRES + src.slice(i, j + 1);
          i = j;
        } else s += src[i];
      }
      word = (word ?? '') + s;
    } else if (c === '`') {
      i++;
      if (src[i] === '\r' && src[i + 1] === '\n') i++;
      if (src[i] !== '\n') word = (word ?? '') + (src[i] === '$' ? LITERAL_DOLLAR : src[i] ?? '');
    } else if (c === '\n' || c === ';' || c === '|' || c === '{' || c === '}') end();
    else if (c === ' ' || c === '\t' || c === '\r') flush();
    else if (c === ',') {
      // a.html, b.html 은 값 하나(배열)다
      if (word === null && typeof cur.at(-1) === 'string') word = cur.pop();
      word = (word ?? '') + PS_SEP;
      while (/[ \t]/.test(src[i + 1] || '')) i++;
    } else if (c === '&') {
      // && 는 명령의 끝, & 하나는 호출 연산자
      if (src[i + 1] === '&') (end(), i++);
      else flush();
    } else if (c === '>') {
      if (word !== null && /^[\d*]$/.test(word)) word = null; // 2> *> 의 2 *
      flush();
      if (src[i + 1] === '>') i++;
      if (src[i + 1] === '&') {
        i++;
        while (/\d/.test(src[i + 1] || '')) i++; // 2>&1
      } else cur.push(REDIR);
    } else if (c === '<' && src[i + 1] === '#') {
      const j = src.indexOf('#>', i + 2);
      i = j < 0 ? src.length : j + 1;
    } else if (c === '#' && word === null) {
      const nl = src.indexOf('\n', i);
      i = (nl < 0 ? src.length : nl) - 1;
    } else if ((c === '$' || c === '@') && src[i + 1] === '(') {
      // 식의 값은 알 수 없다. 안의 명령은 따로 읽는다
      const j = close(i + 1);
      cmds.push(...psCommands(src.slice(i + 2, j)));
      word = (word ?? '') + PS_UNRES + src.slice(i, j + 1);
      i = j;
    } else if (c === '$' && src[i + 1] === '{') {
      const j = src.indexOf('}', i);
      word = (word ?? '') + src.slice(i, j < 0 ? src.length : j + 1);
      i = j < 0 ? src.length : j;
    } else if (c === '@' && src[i + 1] === '{') continue;
    else if (c === '(') {
      const j = close(i);
      const inner = src.slice(i + 1, j);
      if (word === null) {
        // (Get-Content a) 같은 묶음. 안의 명령은 따로 읽는다
        cmds.push(...psCommands(inner));
        word = PS_UNRES + src.slice(i, j + 1);
      } else {
        // [IO.File]::WriteAllText(...) 같은 메서드 호출. 인자를 이 명령의 낱말로 넣는다
        flush();
        cur.call = true;
        // 마지막이 인자 목록이고, 그 앞은 인자 안 괄호 식의 명령이다
        const parts = psCommands(inner);
        const args = parts.pop() || [];
        cmds.push(...parts);
        cur.push(...args.filter((w) => typeof w === 'string').flatMap((w) => w.split(PS_SEP)).filter(Boolean));
      }
      i = j;
    } else word = (word ?? '') + c;
  }
  end();
  return cmds;
}

// 파일을 쓰지 않는 cmdlet과 별칭
const PS_READ = new Set(['get-content', 'gc', 'cat', 'type', 'get-childitem', 'gci', 'ls', 'dir', 'select-string', 'sls', 'test-path', 'get-item', 'gi', 'write-output', 'echo', 'write', 'write-host', 'resolve-path', 'rvpa', 'get-location', 'gl', 'pwd', 'get-date', 'get-command', 'gcm', 'get-help', 'help', 'measure-object', 'measure', 'select-object', 'select', 'where-object', 'where', '?', 'foreach-object', 'foreach', '%', 'sort-object', 'sort', 'format-table', 'ft', 'format-list', 'fl', 'out-string', 'out-host', 'out-null', 'convertto-json', 'convertfrom-json', 'convertto-html', 'get-process', 'get-filehash', 'get-itemproperty', 'join-path', 'split-path', 'write-verbose', 'write-warning', 'write-error', 'get-variable', 'get-member', 'gm', 'compare-object', 'group-object', 'start-sleep', 'sleep']);
const PS_KEYWORDS = new Set(['if', 'elseif', 'else', 'foreach', 'for', 'while', 'do', 'until', 'try', 'catch', 'finally', 'switch', 'function', 'filter', 'param', 'begin', 'process', 'end', 'return', 'throw', 'break', 'continue', 'trap', 'exit', '.']);
const PS_WRITE = new Set(['set-content', 'sc', 'add-content', 'ac', 'out-file', 'tee-object', 'tee', 'new-item', 'ni']);
const PS_COPY = new Set(['copy-item', 'copy', 'cp', 'cpi']);
const PS_MOVE = new Set(['move-item', 'move', 'mv', 'mi']);
const PS_REMOVE = new Set(['remove-item', 'del', 'rm', 'ri', 'erase', 'rd', 'rmdir']);
const PS_CD = new Set(['set-location', 'cd', 'sl', 'chdir', 'push-location', 'pushd']);
const PS_PATHS = ['path', 'literalpath', 'pspath', 'lp', 'filepath'];
// 값을 받지 않는 스위치. 값 매개변수와 앞부분이 겹치는 줄임은 값으로 본다
const PS_SWITCH = ['force', 'nonewline', 'passthru', 'whatif', 'confirm', 'asbytestream', 'append', 'noclobber', 'recurse', 'container', 'verbose', 'debug'];
const PS_VALUE = [...PS_PATHS, 'destination', 'name', 'value', 'encoding', 'itemtype', 'type', 'include', 'exclude', 'filter', 'credential', 'stream', 'width', 'inputobject', 'variable', 'delimiter', 'target', 'erroraction'];
const isPsCmdlet = (w) => /^[a-z]+-[a-z]+$/i.test(w);
// 동사로 보아 파일을 쓰지 않는 cmdlet. 출력 파일 매개변수가 있으면 쓰기일 수 있다
const PS_READ_VERBS = new Set(['get', 'test', 'find', 'show', 'measure', 'select', 'format', 'resolve', 'compare', 'convertfrom', 'read', 'search', 'wait']);
const PS_READ_WRITES = new Set(['write-host', 'write-output', 'write-verbose', 'write-information', 'write-debug', 'write-progress', 'write-warning', 'write-error']);
const PS_OUT_PARAMS = ['outfile', 'outputfile', 'outpath', 'outputpath', 'filepath', 'destination'];
// [IO.File]의 쓰기 메서드와 StreamWriter. 첫 인자가 쓰는 파일이다
const PS_NET_WRITE = /^\[(?:System\.)?IO\.(?:File\]::(?:WriteAllText|WriteAllLines|WriteAllBytes|AppendAllText|AppendAllLines|Create|CreateText|OpenWrite)|StreamWriter\]::new)$/i;
const PS_STREAMWRITER = /^(?:System\.)?IO\.StreamWriter$/i;
const psLike = (w) => isPsCmdlet(w) || [PS_READ, PS_WRITE, PS_COPY, PS_MOVE, PS_REMOVE, PS_CD].some((set) => set.has(w.toLowerCase()));
// 다른 셸 도구로 온 명령이 PowerShell로 보이는지
export const looksPowerShell = (cmd) =>
  /(?:^|[\s;|({])(?:Set-Content|Add-Content|Out-File|New-Item|Copy-Item|Move-Item|Remove-Item|Tee-Object|Set-Location)\b|\$env:|\[(?:System\.)?IO\.(?:File|StreamWriter)\]::|New-Object\s+(?:-TypeName\s+)?(?:System\.)?IO\.StreamWriter\b/i.test(cmd) ||
  // 별칭은 명령 자리에 온 낱말만 본다
  /(?:^|[\n;|&({])[ \t]*(?:sc|ni|ac)[ \t]+\S/i.test(cmd);

// PowerShell 명령이 쓴 HTML을 찾는다. readShell과 같은 모양을 돌려준다
export function readPowerShell(cmd, cwd) {
  const home = HOME();
  const out = {written: new Set(), removed: new Set(), unknown: new Set(), maybe: new Set(), notes: new Set(), ran: false, wrote: false};
  const vars = {};
  let dir = cwd;
  const lookup = (name) => {
    const n = name.toLowerCase();
    if (Object.hasOwn(vars, n)) return vars[n];
    if (n === 'home' || n === 'env:userprofile' || n === 'env:home') return home;
    if (n === 'env:temp' || n === 'env:tmp') return os.tmpdir();
    if (n === 'pwd' && dir) return dir;
  };
  const expand = (w) => {
    let s = w.replace(/\$(?:\{([^}]+)\}|((?:env:)?\w+))/gi, (all, a, b) => lookup(a ?? b) ?? all);
    const unresolved = s.includes('$') || s.includes(PS_UNRES);
    s = s.replaceAll(LITERAL_DOLLAR, '$').replaceAll(PS_UNRES, '').replace(/^(?:[\w.]+\\)?FileSystem::/i, '');
    if (!unresolved) s = s.replace(/^~(?=[\\/]|$)/, home);
    return {s, unresolved};
  };
  const abs = (s) => (path.isAbsolute(s) ? path.normalize(s) : dir ? path.resolve(dir, s) : null);
  const vals = (w) => (typeof w === 'string' ? w.split(PS_SEP).filter(Boolean) : []);
  const addFile = (w) => {
    const {s, unresolved} = expand(w);
    if (!isHtml(s) && !(unresolved && /\.html?\b/i.test(s))) return;
    const p = unresolved ? null : abs(s);
    if (p) out.written.add(p);
    else out.unknown.add(s);
  };
  // 쓰기 명령의 대상. 값을 모르는 경로는 HTML이 아니라고 확인되지 않으면 위치 미상으로 둔다
  const addTarget = (w) => {
    const {s, unresolved} = expand(w);
    if (unresolved && !/\.html?\b/i.test(s) && path.extname(s)) return;
    addFile(w);
    if (unresolved && !/\.html?\b/i.test(s)) out.unknown.add(s);
  };
  // 무엇을 하는지 모르는 명령에 나온 HTML은 확인 필요로만 알린다
  const htmlWords = (a) => {
    for (const w of a.flatMap(vals)) {
      const {s, unresolved} = expand(w.replace(/^-[A-Za-z][\w-]*:/, ''));
      if (!isHtml(s)) continue;
      if (unresolved || !abs(s)) out.unknown.add(s);
      else out.maybe.add(abs(s));
    }
  };
  const params = (a) => {
    const named = {};
    const pos = [];
    for (let i = 1; i < a.length; i++) {
      const m = /^-([A-Za-z][\w-]*)(?::(.*))?$/s.exec(a[i]);
      if (!m) {
        pos.push(a[i]);
        continue;
      }
      const n = m[1].toLowerCase();
      if (m[2] !== undefined) named[n] = m[2];
      else if (PS_SWITCH.some((s) => s.startsWith(n)) && !PS_VALUE.some((v) => v.startsWith(n))) named[n] = true;
      else if (i + 1 < a.length) named[n] = a[++i];
    }
    const pick = (names) => names.map((n) => named[n]).find((v) => typeof v === 'string');
    return {named, pos, pick};
  };
  const run = (a, call) => {
    // $x = 값 은 변수로 기억한다. 오른쪽이 명령이면 그 명령을 읽는다
    const asg = /^\$(\w+)(=(.*))?$/s.exec(a[0]);
    if (asg && (asg[2] !== undefined || /^[-+*/]?=$/.test(a[1] || ''))) {
      const name = asg[1].toLowerCase();
      const rest = asg[2] !== undefined ? [asg[3], ...a.slice(1)].filter((w) => w !== '') : a.slice(2);
      // 값을 알 수 없으면 모르는 변수로 표시해 뒤의 쓰기를 위치 미상으로 돌린다
      vars[name] = PS_UNRES + '$' + asg[1];
      if (rest.length === 1 && !psLike(rest[0]) && !call && a[1] !== '+=') {
        const v = expand(rest[0]);
        if (!v.unresolved) vars[name] = v.s;
      } else if (/^join-path$/i.test(rest[0] || '') && a[1] !== '+=') {
        // Join-Path a b 는 두 부분을 알면 이어 붙인다
        const {pos, pick} = params(rest);
        const parts = [pick(['path']) ?? pos.shift(), pick(['childpath']) ?? pos.shift()].map((w) => (typeof w === 'string' && !w.includes(PS_SEP) ? expand(w) : null));
        if (parts.every((v) => v && !v.unresolved)) vars[name] = path.join(parts[0].s, parts[1].s);
      } else if (rest.length) run(rest, call);
      return;
    }
    let k = 0;
    while (k < a.length && PS_KEYWORDS.has(a[k].toLowerCase())) k++;
    if (k) a = a.slice(k).filter((w, i) => i > 0 || !w.startsWith(PS_UNRES));
    if (!a.length) return;
    const name = a[0].toLowerCase();
    const {named, pos, pick} = params(a);
    if (PS_CD.has(name)) {
      const w = pick(PS_PATHS) ?? pos[0];
      if (w === undefined) return;
      const {s, unresolved} = expand(w);
      dir = unresolved || s === '-' ? null : abs(s);
      return;
    }
    if (name === 'pop-location' || name === 'popd') {
      dir = null;
      return;
    }
    if (PS_READ.has(name)) return;
    if (PS_NET_WRITE.test(a[0]) || (name === 'new-object' && PS_STREAMWRITER.test(pick(['typename']) ?? pos[0] ?? ''))) {
      out.ran = true;
      out.wrote = true;
      const first = name === 'new-object' ? (typeof named.argumentlist === 'string' ? named.argumentlist : pos[named.typename === undefined ? 1 : 0]) : a[1];
      const w = vals(first)[0];
      if (w === undefined) out.unknown.add(a.slice(0, 2).join(' '));
      else addTarget(w);
      return;
    }
    if (isPsCmdlet(name) && (PS_READ_VERBS.has(name.split('-')[0]) || PS_READ_WRITES.has(name)) && !PS_OUT_PARAMS.some((n) => n in named)) {
      // 읽기 동사. 쓰기 턴으로 치지 않고 HTML 낱말만 확인 필요로 알린다
      htmlWords(a.slice(1));
      return;
    }
    if (/^[$[@\d]|^\u0003/.test(a[0])) {
      // 식. 메서드 호출([IO.File]::WriteAllText 등)이 있으면 쓰기일 수 있다
      if (call) (out.ran = true), htmlWords(a);
      return;
    }
    if (PS_WRITE.has(name)) {
      out.ran = true;
      out.wrote = true;
      const target = pick(PS_PATHS) ?? pos[0];
      if ((name === 'new-item' || name === 'ni') && typeof named.name === 'string') vals(target ?? '.').forEach((p) => addFile(path.join(p, named.name)));
      else if (name === 'new-item' || name === 'ni') vals(target).forEach(addFile);
      else vals(target).forEach(addTarget);
      return;
    }
    if (PS_REMOVE.has(name)) {
      out.ran = true;
      for (const w of vals(pick(PS_PATHS) ?? pos[0])) {
        const {s, unresolved} = expand(w);
        const p = !unresolved && abs(s);
        if (p) out.removed.add(p);
      }
      return;
    }
    if (PS_COPY.has(name) || PS_MOVE.has(name)) {
      out.ran = true;
      const move = PS_MOVE.has(name);
      const literal = pick(['literalpath', 'lp', 'pspath']) !== undefined;
      const srcW = pick(PS_PATHS) ?? pos.shift();
      const destW = typeof named.destination === 'string' ? named.destination : pos.shift();
      const recurse = move || Object.keys(named).some((n) => 'recurse'.startsWith(n));
      const d = destW === undefined ? {s: dir ?? '', unresolved: !dir} : expand(destW);
      const to = d.unresolved ? null : abs(d.s);
      const toDir = !!to && (destW === undefined || /[\\/]$/.test(d.s) || !!statOf(to)?.isDirectory());
      const tree = (srcDir, root) => {
        const t = htmlTree(srcDir);
        t.rels.forEach((r) => out.written.add(path.join(root, r)));
        if (t.cut) out.notes.add(`${srcDir} 안의 HTML은 ${TREE_MAX}개까지만 기록했습니다. 옮긴 HTML이 더 있으면 ensure를 실행하세요`);
      };
      for (const w of vals(srcW)) {
        const {s, unresolved} = expand(w);
        const from = !unresolved && abs(s);
        if (!toDir) {
          if (isHtml(d.s)) to ? out.written.add(to) : out.unknown.add(d.s);
          else if (!to && isHtml(s)) out.unknown.add(`${a[0]} ${s} → ${d.s}`);
          else if (to && recurse && (move ? statOf(to)?.isDirectory() : from && statOf(from)?.isDirectory())) tree(move ? to : from, to);
        } else if (unresolved) {
          if (isHtml(s) || hasGlob(s)) out.unknown.add(`${a[0]} ${s} → ${d.s}`);
        } else if (hasGlob(s) && !literal) {
          const names = expandGlob(from);
          if (names === null || (!names.length && move)) out.unknown.add(`${a[0]} ${s} → ${d.s}`);
          for (const n of names || []) {
            const st = statOf(n);
            const into = path.join(to, path.basename(n));
            if (st?.isFile() && isHtml(n)) out.written.add(into);
            else if (st?.isDirectory() && recurse) tree(n, into);
          }
        } else if (isHtml(s)) out.written.add(path.join(to, path.basename(s)));
        else if (recurse) {
          // 옮긴 뒤에는 원본이 없으니 대상 아래 같은 이름 폴더를 본다
          const into = path.join(to, path.basename(s));
          if (move ? statOf(into)?.isDirectory() : statOf(from)?.isDirectory()) tree(move ? into : from, into);
        }
        if (move && from && !hasGlob(s)) out.removed.add(from);
      }
      return;
    }
    if (isPsCmdlet(a[0])) {
      // 모르는 cmdlet은 쓰기일 수 있다
      out.ran = true;
      htmlWords(a.slice(1));
      return;
    }
    // 외부 프로그램(node, pandoc 등)은 셸 읽기에 맡긴다
    const words = a.map((w) => {
      const v = w.replace(/\$(?:\{([^}]+)\}|((?:env:)?\w+))/gi, (all, x, y) => lookup(x ?? y) ?? all).replaceAll(PS_SEP, ',');
      return v.includes(PS_UNRES) ? '$' + v.replaceAll(PS_UNRES, '') : v;
    });
    const r = readShell(words.map((w) => `"${w.replace(/["\\`]/g, '\\$&')}"`).join(' '), dir);
    for (const key of ['written', 'removed', 'unknown', 'maybe', 'notes']) r[key].forEach((v) => out[key].add(v));
    out.ran ||= r.ran;
    out.wrote ||= r.wrote;
  };
  for (const words of psCommands(cmd)) {
    const a = [];
    for (let i = 0; i < words.length; i++) {
      if (words[i] === REDIR) {
        if (typeof words[i + 1] === 'string') {
          if (!/^\$null$/i.test(words[i + 1])) out.wrote = true;
          addFile(words[++i]);
        }
      } else a.push(words[i]);
    }
    if (a.length) run(a, !!words.call);
  }
  return out;
}

// 도구 입력에서 HTML 쓰기를 꺼낸다(편집 도구, apply_patch, 셸 명령)
// 쓰지 않는 도구. 설치한 훅은 쓰기 도구에만 걸리지만, 다른 설정에서 이런 도구가 와도 쓰기로 치지 않는다
const READ_TOOLS = /^(?:Read|Glob|Grep|LS|NotebookRead|WebFetch|WebSearch|TodoWrite|TodoRead|Task|view|read_file|list_files|search)$/;
// active: 이번 도구 사용이 쓰기였는지(쓰기 도구의 경로, 패치, 읽기 전용이 아닌 셸 명령, 리디렉션). 쓰기가 하나도 없는 턴은 작업 폴더를 훑어 고치지 않는다
// PowerShell 도구는 PowerShell로 읽는다. 윈도에서 다른 셸 도구로 온 PowerShell 명령은 두 방식으로 읽어 합친다
export function effectsOf(i, platform = process.platform) {
  const cwd = cwdOf(i);
  const out = {written: new Set(), removed: new Set(), unknown: new Set(), maybe: new Set(), notes: new Set(), ran: false, active: false};
  const add = (p) => {
    if (typeof p === 'string' && isHtml(p)) out.written.add(path.resolve(cwd, fromMsys(p, {platform}).replace(platform === 'win32' ? /^~(?=[\/\\])/ : /^~(?=\/)/, HOME())));
  };
  const powershell = /^powershell$/i.test(i.tool_name || '');
  const t = i.tool_input || i.input || {};
  const readTool = READ_TOOLS.test(i.tool_name || '');
  const paths = [i.file_path, t.file_path, t.path, t.notebook_path].filter((p) => typeof p === 'string' && p);
  if (!readTool) {
    paths.forEach(add);
    if (paths.length) out.active = true;
  }
  for (const text of readTool ? [] : [t.command, t.patch, t.input, i.command]) {
    if (typeof text !== 'string') continue;
    if (text.includes('*** Begin Patch') || text.includes('*** Add File:') || text.includes('*** Update File:')) {
      out.active = true;
      for (const m of text.matchAll(/\*\*\* (?:Add File|Update File|Move to): (.+)/g)) add(m[1].trim());
      continue;
    }
    const readers = powershell ? [readPowerShell] : platform === 'win32' && looksPowerShell(text) ? [readShell, readPowerShell] : [readShell];
    for (const read of readers) {
      const r = read(text, cwd);
      // 둘로 읽을 때 셸 읽기는 \를 이스케이프로 보아 경로가 틀릴 수 있다. 실제로 있는 파일만 받는다
      if (readers.length > 1 && read === readShell) for (const p of r.written) if (!statOf(p)) r.written.delete(p);
      for (const k of ['written', 'removed', 'unknown', 'maybe', 'notes']) r[k].forEach((v) => out[k].add(v));
      out.ran ||= r.ran;
      out.active ||= r.ran || r.wrote || r.written.size > 0;
    }
  }
  return out;
}
export const pathsFromInput = (i) => [...effectsOf(i).written];

// fresh(수정 시각): 훑을 구간에 드는지. notes를 주면 상한에 걸려 멈췄을 때 알릴 줄을 넣는다
function scan(dir, fresh, notes = null) {
  const max = scanEntriesMax();
  const budget = {left: max, cut: false, deep: false};
  const found = [];
  const walkDir = (d, depth) => {
    if (found.length > 500 || budget.left <= 0) return void (budget.cut = true);
    let list;
    try {
      list = fs.readdirSync(d, {withFileTypes: true});
    } catch {
      return;
    }
    budget.left -= list.length;
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || SCAN_SKIP.has(e.name)) continue;
        if (depth >= SCAN_DEPTH_MAX) budget.deep = true;
        else walkDir(p, depth + 1);
      } else if (e.isFile() && isHtml(e.name)) {
        if (fresh(statOf(p)?.mtimeMs ?? 0)) found.push(p);
      }
    }
  };
  walkDir(dir, 0);
  if (budget.left <= 0 || found.length > 500) budget.cut = true;
  if (notes && budget.cut) notes.add(`스캔을 ${max}개에서 멈췄습니다(${dir}). 이번 작업에서 만든 HTML이 더 있으면 ensure를 실행하세요`);
  if (notes && budget.deep) notes.add(`${dir} 아래 ${SCAN_DEPTH_MAX}단계보다 깊은 폴더는 훑지 않았습니다. 이번 작업에서 만든 HTML이 더 있으면 ensure를 실행하세요`);
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
// 지시문이 쌍으로 있어야 템플릿이다. CSS의 {{와 빈칸 표시 {{회사명}}은 문서로 본다.
// pre·code·textarea·script·style 안의 글은 예시나 코드라 보지 않는다(템플릿 문법을 설명하는 보고서)
function hasTemplateDirective(source) {
  const s = source.slice(0, 200000).replace(/<(style|script|pre|code|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  return /\{%[\s\S]{0,500}?%\}|<%[\s\S]{0,2000}?%>|\{\{[#>/^][\s\S]{0,200}?\}\}/.test(s);
}
const newerThanFile = (a, b) => (statOf(a)?.mtimeMs ?? 0) > (statOf(b)?.mtimeMs ?? Infinity);

export async function handleFile(file, cwd) {
  const parts = path.resolve(file).split(path.sep);
  if (parts.includes('.doc-kit')) {
    // 키트의 작업 파일은 입히지 않는다. 본문을 고치고 apply를 잊었으면 알린다
    const m = /^(.+)\.body\.html$/.exec(path.basename(file));
    const target = inputOf(file) || (m && path.join(path.dirname(path.dirname(path.resolve(file))), `${m[1]}.html`));
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
  // active: 그 구간에 쓰기 도구나 읽기 전용이 아닌 셸 명령이 있었는지. 없으면 작업 폴더를 훑어 고치지 않고 알리기만 한다.
  // 기록이 없는 옛 상태는 쓰기가 있었던 것으로 본다
  const ranges = [...(state.gaps || []).map((g) => ({from: g.from - 1500, to: g.to + 1500, cwd: g.cwd, active: g.active !== false})), {from: base - 1500, to: Infinity, cwd, active: state.active !== false}];
  const fresh = (ms) => ranges.some((r) => ms >= r.from && ms <= r.to);
  const freshIn = (rs) => (ms) => rs.some((r) => ms >= r.from && ms <= r.to);
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
  const scanNotes = new Set();
  const activeRanges = ranges.filter((r) => r.active);
  for (const d of new Set(activeRanges.map((r) => r.cwd).filter(Boolean))) if (!isHomeOrRoot(d)) scan(d, freshIn(activeRanges), scanNotes).forEach((p) => scanned.add(p));
  scanNotes.forEach((m) => extra.push(m));
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
  // 쓰기가 하나도 없던 구간(ls만 돌린 턴 등)에 작업 폴더에서 바뀐 HTML: 사용자가 그 사이 저장한 파일일 수 있어 고치지 않고 알린다
  const idleRanges = ranges.filter((r) => !r.active);
  const idle = [];
  for (const d of new Set(idleRanges.map((r) => r.cwd).filter(Boolean))) {
    if (isHomeOrRoot(d)) continue;
    for (const p of scan(d, (ms) => freshIn(idleRanges)(ms) && !freshIn(activeRanges)(ms))) {
      const st = statOf(p);
      if (scanned.has(p) || late.has(p) || explicit.includes(p) || idle.includes(p) || !st || already(p, st) || isKitFile(p) || excludedByConfig(p) || projectSignals(p, cwd).app) continue;
      if (['same', 'ignored'].includes(gitState(p))) continue;
      idle.push(p);
    }
  }
  idle.slice(0, SKIP_NOTES_MAX).forEach((p) => extra.push(`확인 필요: ${p} (이번 작업에 쓰기 도구나 쓰기 명령이 없었는데 바뀐 HTML이라 사용자가 저장한 파일일 수 있어 그대로 두었습니다. 문서이면 ensure를 실행하세요)`));
  if (idle.length > SKIP_NOTES_MAX) extra.push(`확인 필요: 쓰기 없이 바뀐 HTML ${idle.length - SKIP_NOTES_MAX}개 더`);
  // 출력 옵션인지 모르는 프로그램의 -o 뒤 HTML: 이번 턴에 바뀌었으면 알리기만 한다
  const maybe = [...new Set(state.maybe || [])].filter((p) => {
    const st = statOf(p);
    return st?.isFile() && !explicit.includes(p) && !scanned.has(p) && Math.max(st.mtimeMs, st.ctimeMs) >= pathSince && !already(p, st) && !isKitFile(p);
  });
  maybe.slice(0, SKIP_NOTES_MAX).forEach((p) => extra.push(`확인 필요: ${p} (명령의 -o 뒤에 나왔지만 그 프로그램의 출력 파일인지 알 수 없어 그대로 두었습니다. 문서이면 ensure를 실행하세요)`));
  (state.notes || []).forEach((m) => extra.push(m));
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
      if (!s) store(f, {start: now, turnAt: now, cwd, paths: [], open: true, active: false});
      else {
        const gaps = (s.gaps || []).filter((g) => g.to >= now - STALE_MS);
        if (s.open && s.start) {
          const to = Math.max(s.lastPost ?? 0, s.turnAt ?? s.start);
          // 미처리 구간도 그 턴에 쓰기가 있었는지를 함께 적어 둔다
          if (to >= now - STALE_MS) gaps.push({from: s.start, to, next: now, cwd: s.cwd, active: s.active !== false});
        }
        const keep = gaps.length > 0;
        const paths = s.paths || [];
        const {dirs, ...rest} = s;
        void dirs;
        store(f, {...rest, start: now, turnAt: now, cwd, open: true, active: false, lastPost: null, gaps: gaps.slice(-5), paths, pathsStart: paths.length ? (s.pathsStart ?? s.start) : null, scriptSince: keep ? s.scriptSince : null, maybe: keep ? s.maybe : [], notes: keep ? s.notes : []});
      }
    } else if (event === 'post') {
      const s = load(f) || {start: Date.now(), cwd: cwdOf(input), paths: []};
      const e = effectsOf(input);
      const merge = (old, add) => [...new Set([...(old || []), ...add])];
      s.paths = merge(s.paths, e.written).filter((p) => !e.removed.has(p) || e.written.has(p));
      if (e.unknown.size) s.unknown = merge(s.unknown, e.unknown).slice(0, 10);
      if (e.maybe.size) s.maybe = merge(s.maybe, e.maybe).slice(0, 20);
      if (e.notes.size) s.notes = merge(s.notes, e.notes).slice(0, 10);
      if (e.ran) s.scriptSince ||= s.turnAt ?? s.start;
      if (e.active) s.active = true;
      s.lastPost = Date.now();
      store(f, s);
    } else if (event === 'start') {
      // 세션 시작(Cursor sessionStart). prompt 훅이 오지 않는 실행(Cursor CLI의 -p)에서 기준 시각을 잡는다.
      // 이미 기록이 있으면(대화형에서 prompt가 먼저 온 경우 등) 건드리지 않는다
      if (!load(f)) {
        const now = Date.now();
        store(f, {start: now, turnAt: now, cwd: cwdOf(input), paths: [], open: true, active: false});
      }
    } else if (event === 'stop' || event === 'end') {
      // end: 세션 끝(Cursor sessionEnd). stop이 오지 않는 실행(Cursor CLI의 -p)에서 같은 복구를 한다.
      // stop이 이미 처리했으면(open:false) 또는 이 세션에 기록이 없으면 아무것도 하지 않는다.
      // 결과를 모델이나 사용자에게 넘길 길이 없어 hook.log에만 남긴다
      const loaded = load(f);
      if (event === 'end' && (!loaded || loaded.open === false)) {
        process.stdout.write('{}');
        return;
      }
      const s = loaded || {start: Date.now() - 600000, paths: []};
      const cwd = s.cwd || cwdOf(input);
      const {lines, urgent, failed, pending, handled} = await runStop(s, cwd);
      // 모두 처리한 뒤에야 기준 시각을 옮긴다. 처리 못 한 파일이 있으면 그대로 두어 다음에 다시 찾는다
      store(f, pending.length ? {...s, cwd, open: false, gaps: [], paths: pending, unknown: [], maybe: [], notes: [], done: {...s.done, ...handled}} : {start: Date.now(), turnAt: s.turnAt, cwd, open: false, active: false, paths: [], done: handled});
      if (lines.length) note(lines.join(' / '));
      if (event === 'end') {
        process.stdout.write('{}');
        return;
      }
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
