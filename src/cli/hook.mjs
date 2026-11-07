// 에이전트 훅. 턴 시작에 시각을 남기고, 저장 뒤에는 경로만 적어 두고, 끝날 때 모델 없이 직접 복구한다.
// 어떤 오류도 작업을 막지 않는다. 대신 사용자에게 보이게 알린다
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspect, isOff} from './check.mjs';
import {readHtml} from './html.mjs';
import {ensure, inputOf} from './ops.mjs';

const HOME = () => process.env.DOC_KIT_HOME || os.homedir();
const stateDir = () => path.join(HOME(), '.doc-kit', 'state');
const SKIP_DIRS = new Set(['node_modules', '.git', '.doc-kit', 'src', 'public', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'coverage', 'htmlcov', 'playwright-report', 'storybook-static', 'vendor', 'venv', '.venv', '__pycache__', 'target']);
const WEB_DEPS = ['react', 'vue', 'svelte', 'next', 'nuxt', 'vite', 'webpack', '@angular/core', 'astro', 'gatsby', 'parcel', 'solid-js', 'remix', 'electron'];
const BUILD_CONFIGS = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'webpack.config.js', 'next.config.js', 'next.config.mjs', 'next.config.ts', 'angular.json', 'svelte.config.js', 'astro.config.mjs', 'nuxt.config.ts', 'nuxt.config.js', 'manage.py', 'Gemfile', 'mkdocs.yml', '_config.yml'];
const isHtml = (f) => /\.html?$/i.test(f);

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
  fs.writeFileSync(f, JSON.stringify(s));
};

// 도구 입력에서 HTML 경로를 꺼낸다(편집 도구, apply_patch, 리디렉션)
export function pathsFromInput(i) {
  const out = new Set();
  const cwd = cwdOf(i);
  const add = (p) => {
    if (p && isHtml(p)) out.add(path.resolve(cwd, p.replace(/^~(?=\/)/, os.homedir())));
  };
  add(i.file_path);
  const t = i.tool_input || i.input || {};
  add(t.file_path);
  add(t.path);
  add(t.notebook_path);
  const cmd = [t.command, t.patch, t.input, i.command].filter((x) => typeof x === 'string').join('\n');
  for (const m of cmd.matchAll(/\*\*\* (?:Add|Update) File: (.+)/g)) add(m[1].trim());
  for (const m of cmd.matchAll(/(?:>>?|\btee(?:\s+-a)?|-o|--output(?:=|\s))\s*["']?([^\s"'<>|;&]+\.html?)/gi)) add(m[1]);
  return [...out];
}

function scan(dir, since, found = [], depth = 0) {
  if (depth > 6 || found.length > 500) return found;
  let list;
  try {
    list = fs.readdirSync(dir, {withFileTypes: true});
  } catch {
    return found;
  }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) scan(p, since, found, depth + 1);
    } else if (e.isFile() && isHtml(e.name)) {
      try {
        if (fs.statSync(p).mtimeMs >= since) found.push(p);
      } catch {}
    }
  }
  return found;
}

// 웹앱 신호: 가까운 package.json의 프레임워크, 빌드 설정
function projectRoot(file, cwd) {
  const abs = path.resolve(file);
  for (let d = path.dirname(abs); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (d === path.dirname(d)) break;
  }
  return cwd && abs.startsWith(path.resolve(cwd) + path.sep) ? path.resolve(cwd) : path.dirname(abs);
}
function appSignal(file, cwd) {
  // 폴더 이름은 프로젝트 안에서만 본다(프로젝트가 ~/src 아래 있어도 문서는 문서다)
  const parts = path.relative(projectRoot(file, cwd), path.resolve(file)).split(path.sep).slice(0, -1);
  if (parts.some((s) => SKIP_DIRS.has(s))) return '앱·빌드 폴더';
  for (let d = path.dirname(path.resolve(file)), i = 0; i < 8; i++) {
    if (BUILD_CONFIGS.some((c) => fs.existsSync(path.join(d, c)))) return '빌드 설정';
    const pj = load(path.join(d, 'package.json'));
    if (pj) {
      const deps = {...pj.dependencies, ...pj.devDependencies};
      if (WEB_DEPS.some((k) => k in deps)) return '웹앱 프로젝트';
    }
    if (fs.existsSync(path.join(d, '.git'))) break;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}
function excludedByConfig(file) {
  for (let d = path.dirname(path.resolve(file)), i = 0; i < 8; i++) {
    const c = load(path.join(d, '.doc-kit.json'));
    if (c && Array.isArray(c.exclude)) {
      const rel = path.relative(d, file).split(path.sep).join('/');
      if (c.exclude.some((x) => rel === x || rel.startsWith(x.replace(/\/$/, '') + '/'))) return true;
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return false;
}
const hasOwnScript = (s) => /<script\b/i.test(s.replace(/<script id="dk-[\s\S]*?<\/script>/g, ''));

export async function handleFile(file, cwd) {
  const source = readHtml(file);
  const name = path.basename(file);
  if (isOff(source)) return {file, kind: 'excluded', note: `${name}: 제외 표식이 있어 키트를 넣지 않았습니다`};
  if (excludedByConfig(file)) return {file, kind: 'skip'};
  const signal = appSignal(file, cwd);
  if (signal) return {file, kind: 'skip', note: null};
  if (source.startsWith('<!-- html-doc-kit 본문 파일')) return {file, kind: 'skip'};
  if (inputOf(file)) return {file, kind: 'skip'}; // build·apply의 입력. 결과 파일이 따로 있다
  if (/\{\{|\{%|<%/.test(source.slice(0, 20000))) return {file, kind: 'skip'}; // 템플릿
  const report = inspect(source);
  if (!report.errors.length && report.version) {
    const r = await ensure(file, {});
    return {file, kind: r.changed ? 'repaired' : 'ok', result: r};
  }
  const isKit = /data-doc-kit=/.test(source);
  if (!isKit && hasOwnScript(source)) {
    const copy = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}_편집용.html`);
    if (fs.existsSync(copy) && fs.statSync(copy).mtimeMs >= fs.statSync(file).mtimeMs) return {file, kind: 'ok'};
    const r = await ensure(file, {output: copy});
    return {file: r.file, kind: 'copied', source: file, result: r};
  }
  const r = await ensure(file, {});
  return {file, kind: 'wrapped', result: r};
}

export async function runStop(state, cwd) {
  const since = (state.start || Date.now()) - 1500;
  const list = new Set([...(state.paths || []).filter((p) => fs.existsSync(p) && fs.statSync(p).mtimeMs >= since), ...scan(cwd, since)]);
  const results = [];
  for (const f of list) {
    try {
      results.push(await handleFile(f, cwd));
    } catch (e) {
      results.push({file: f, kind: 'error', note: `${f}: 키트를 넣지 못했습니다(${e.message})`});
    }
  }
  const lines = [];
  for (const r of results) {
    if (r.kind === 'wrapped' || r.kind === 'repaired') lines.push(`${r.file}에 뷰어·편집기를 넣었습니다`);
    if (r.kind === 'copied') lines.push(`${r.source}에 자체 스크립트가 있어 그대로 두고 ${r.file}을 만들었습니다`);
    if (r.note) lines.push(r.note);
    if (r.result?.notices) lines.push(...r.result.notices);
    const c6 = r.result && r.result.c6;
    if (c6 && c6.status === 'fail') lines.push(`미완성: ${r.file} (${c6.reason})`);
  }
  return {results, lines, failed: results.filter((r) => r.kind === 'error' || r.result?.c6?.status === 'fail')};
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
      store(f, {start: Date.now(), cwd: cwdOf(input), paths: []});
    } else if (event === 'post') {
      const s = load(f) || {start: Date.now(), cwd: cwdOf(input), paths: []};
      s.paths = [...new Set([...(s.paths || []), ...pathsFromInput(input)])];
      store(f, s);
    } else if (event === 'stop') {
      const s = load(f) || {start: Date.now() - 600000, paths: []};
      const {lines, failed} = await runStop(s, s.cwd || cwdOf(input));
      store(f, {start: Date.now(), cwd: s.cwd || cwdOf(input), paths: []});
      if (lines.length) note(lines.join(' / '));
      if (lines.length) {
        const message = 'html-doc-kit: ' + lines.join('\n');
        if (agent === 'cursor') {
          // Cursor는 끝날 때 사용자에게 바로 보여 줄 길이 없어 실패만 메시지로 남긴다
          if (failed.length) process.stdout.write(JSON.stringify({followup_message: `${message}\n위 내용을 사용자에게 그대로 알려 주세요. 파일을 직접 고치지 마세요.`}));
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
