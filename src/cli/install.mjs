// 세 에이전트에 스킬·지침·훅을 넣고 뺀다. 사용자의 기존 설정은 보존한다
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findChrome} from './browser.mjs';
import {VERSION} from './core.mjs';

const START = '<!-- html-doc-kit:start -->';
const END = '<!-- html-doc-kit:end -->';
const ALL_AGENTS = ['claude', 'codex', 'cursor'];
const AGENT_NAMES = {claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor'};
// 우리가 넣은 훅 명령의 모양. 같은 실행 파일을 쓰는 사용자 명령(check 등)은 건드리지 않는다
const OUR_COMMAND = /doc-kit\.mjs"?\s+hook\s/;
const isOurCommand = (c) => typeof c === 'string' && OUR_COMMAND.test(c);
// 그룹이 아니라 항목 단위로 뺀다. 같은 그룹의 사용자 훅은 남는다
function stripOurs(list) {
  if (!Array.isArray(list)) return [];
  return list.flatMap((h) => {
    if (isOurCommand(h?.command)) return [];
    if (!Array.isArray(h?.hooks)) return [h];
    const hooks = h.hooks.filter((x) => !isOurCommand(x?.command));
    return hooks.length === h.hooks.length ? [h] : hooks.length ? [{...h, hooks}] : [];
  });
}
const hasOurs = (list) => Array.isArray(list) && list.some((h) => isOurCommand(h?.command) || (Array.isArray(h?.hooks) && h.hooks.some((x) => isOurCommand(x?.command))));
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
// Windows PowerShell은 따옴표로 시작하는 줄을 식으로 읽어 훅이 깨진다. 그래서 Windows에서는 PATH의 node를 맨 이름으로 부른다
const envGet = (env, k) => env[Object.keys(env).find((x) => x.toUpperCase() === k)];
// node 파일의 주 판 번호. 못 돌리면 NaN
export function probeNode(file) {
  const r = spawnSync(file, ['--version'], {encoding: 'utf-8', timeout: 10000, windowsHide: true});
  return r.status === 0 ? Number(/^v(\d+)\./.exec(String(r.stdout).trim())?.[1]) : NaN;
}
// 주어진 PATH에서 셸이 고를 node를 찾는다. .exe이고 Node 22 이상일 때만 쓴다
function findNode(pathStr, {platform, env, execPath, probe}) {
  const sep = platform === 'win32' ? ';' : ':';
  const exts = platform === 'win32' ? (envGet(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of (pathStr || '').split(sep).filter(Boolean)) {
    const hit = exts.map((x) => path.join(dir.replace(/^"|"$/g, ''), 'node' + x.toLowerCase())).find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
    if (!hit) continue;
    if (platform === 'win32' && !hit.endsWith('.exe')) return null;
    if (samePath(hit, execPath)) return hit;
    return probe(hit) >= 22 ? hit : null;
  }
  return null;
}
// reg query 출력에서 Path 값을 꺼낸다
export function parseRegPath(out) {
  return /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(String(out || ''))?.[1].trim() ?? null;
}
// reg.exe는 콘솔 코드 페이지(한국어 Windows는 CP949)로 출력해 한글 경로가 깨진다. 먼저 PowerShell에서 UTF-8로 받고, 안 되면 reg로 읽는다
const readRegPath = (key) => {
  const target = key.startsWith('HKLM') ? 'Machine' : 'User';
  const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $v=[Environment]::GetEnvironmentVariable('Path','${target}'); if ($null -eq $v) { exit 3 }; [Console]::Out.Write($v)`;
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {encoding: 'utf-8', timeout: 15000, windowsHide: true});
  if (ps.status === 0) return ps.stdout.trim();
  const r = spawnSync('reg', ['query', key, '/v', 'Path'], {encoding: 'utf-8', timeout: 10000, windowsHide: true});
  return r.status === 0 ? parseRegPath(r.stdout) : null;
};
// 시작 메뉴로 켠 앱이 받는 PATH. 시스템 값 뒤에 사용자 값을 붙이고 %VAR%를 푼다. 시스템 값을 못 읽으면 null
export function persistentPath({env = process.env, readReg = readRegPath} = {}) {
  const sys = readReg('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment');
  if (sys == null) return null;
  const user = readReg('HKCU\\Environment') || '';
  const expand = (s) => s.replace(/%([^%;]+)%/g, (m, k) => envGet(env, k.toUpperCase()) ?? m);
  return [sys, user].filter(Boolean).map(expand).join(';');
}
// Windows에서는 시작 메뉴로 켠 앱이 받는 영구 PATH에서 찾은 node만 쓴다. fnm 세션 폴더 안의 것은 버린다
// 지금 셸 PATH가 고르는 node도 쓸 만해야 한다(셸에서 켠 에이전트용)
export function pathNode({platform = process.platform, env = process.env, execPath = process.execPath, probe = probeNode, readReg} = {}) {
  const o = {platform, env, execPath, probe};
  if (platform !== 'win32') return findNode(envGet(env, 'PATH'), o);
  const persist = persistentPath({env, readReg});
  const hit = persist == null ? null : findNode(persist, o);
  if (!hit) return null;
  const fnm = envGet(env, 'FNM_MULTISHELL_PATH');
  const rel = fnm ? path.relative(fnm, hit) : '..';
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return null;
  return findNode(envGet(env, 'PATH'), o) ? hit : null;
}
// Homebrew의 버전 폴더(.../Cellar/node/26.13.0_2/bin/node)는 brew upgrade 때 지워져 훅이 끊긴다.
// 판이 바뀌어도 그 formula를 가리키는 opt 링크(.../opt/node/bin/node)가 있으면 그것을 쓴다. 매번 같은 글자가 나와 Codex 승인도 유지된다
const CELLAR_NODE = /^(.*)[\\/]Cellar[\\/]([^\\/]+)[\\/][^\\/]+[\\/]bin[\\/]node$/;
export const isCellarNode = (p) => CELLAR_NODE.test(p);
export function stableNode(execPath, exists = fs.existsSync) {
  const m = CELLAR_NODE.exec(execPath);
  const opt = m && path.join(m[1], 'opt', m[2], 'bin', 'node');
  return opt && exists(opt) ? opt : execPath;
}
// 훅 명령의 첫 낱말. Windows에서 쓸 만한 node가 PATH에 없을 때만 따옴표 경로로 둔다. 다른 OS는 따옴표 경로다
export function nodeToken({platform = process.platform, env = process.env, execPath = process.execPath, probe, readReg, exists} = {}) {
  if (platform === 'win32' && pathNode({platform, env, execPath, probe, readReg})) return 'node';
  return `"${stableNode(execPath, exists)}"`;
}
const isSkill = (d) => fs.existsSync(path.join(d, 'SKILL.md')) && fs.existsSync(path.join(d, 'scripts', 'doc-kit.mjs'));
const readJson = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`${f}를 읽지 못해 건드리지 않았습니다: ${e.message}`);
  }
};
// 처음 고칠 때 .doc-kit-bak을, 그 뒤로 내용이 바뀔 때마다 시각을 붙인 백업을 남긴다
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), {recursive: true});
  const text = JSON.stringify(v, null, 2) + '\n';
  if (fs.existsSync(f)) {
    if (fs.readFileSync(f, 'utf-8') === text) return;
    fs.copyFileSync(f, fs.existsSync(f + '.doc-kit-bak') ? `${f}.doc-kit-bak.${Date.now()}` : f + '.doc-kit-bak');
  }
  fs.writeFileSync(f, text);
};
function rules(cli) {
  return `HTML 문서(보고서, 장표, 회의록, 소개 자료 등 사람이 읽는 HTML 파일)를 만들거나 고칠 때는 html-doc-kit 스킬을 쓴다. Artifact나 다른 게시 기능이 아니라 작업 폴더의 파일로 만든다.
- 문서가 분명하면 묻지 않고 쓴다. 문서인지 애매하면 뷰어·편집기를 넣을지 먼저 한 번 묻는다. 게임·계산기 같은 단독 실행 프로그램과 웹앱·웹사이트의 HTML에는 쓰지 않는다. 끝날 때 훅이 넣을지 물어보라고 하면 사용자에게 묻고, 원하면 알려 준 명령을 실행한다.
- 만들기: 본문만 마크다운이나 HTML 조각으로 쓰고 \`node "${cli}" build 본문파일 -o 결과.html\`을 실행한다. 뷰어와 편집기 코드를 직접 쓰지 않는다.
- 이미 있는 HTML: \`node "${cli}" ensure 파일.html\`
- 키트 파일 고치기: 통째로 읽지 말고 \`node "${cli}" extract 파일.html\`로 본문을 꺼내 고친 뒤 \`node "${cli}" apply 본문파일 파일.html\`을 실행한다.
- 끝나면 \`node "${cli}" check 결과.html\`로 확인한다.`;
}
function upsertBlock(file, text) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  let s = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const block = `${START}\n${text}\n${END}\n`;
  if (s.includes(START)) s = s.replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`), () => block);
  else s = s + (s && !s.endsWith('\n') ? '\n' : '') + (s ? '\n' : '') + block;
  fs.writeFileSync(file, s);
}
function dropBlock(file) {
  if (!fs.existsSync(file)) return;
  const s = fs.readFileSync(file, 'utf-8');
  if (s.includes(START)) fs.writeFileSync(file, s.replace(new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`), ''));
}
const nestedHook = (cmd, matcher) => ({...(matcher ? {matcher} : {}), hooks: [{type: 'command', command: cmd, timeout: 120}]});
function mergeNested(cfg, event, entry) {
  cfg.hooks = cfg.hooks || {};
  cfg.hooks[event] = [...stripOurs(cfg.hooks[event]), entry];
}
function paths(home) {
  return {
    bin: path.join(home, '.doc-kit', 'bin', 'doc-kit.mjs'),
    claudeSkill: path.join(home, '.claude', 'skills', 'html-doc-kit'),
    agentsSkill: path.join(home, '.agents', 'skills', 'html-doc-kit'),
    claudeSettings: path.join(home, '.claude', 'settings.json'),
    codexHooks: path.join(home, '.codex', 'hooks.json'),
    cursorHooks: path.join(home, '.cursor', 'hooks.json'),
    claudeMd: path.join(home, '.claude', 'CLAUDE.md'),
    codexMd: path.join(home, '.codex', 'AGENTS.md'),
    cursorRule: path.join(home, '.cursor', 'rules', 'html-doc-kit.mdc'),
    codexConfig: path.join(home, '.codex', 'config.toml'),
  };
}
const HOOK_EVENTS = {
  claude: ['UserPromptSubmit', 'PostToolUse', 'Stop'],
  codex: ['UserPromptSubmit', 'PostToolUse', 'Stop'],
  cursor: ['beforeSubmitPrompt', 'afterFileEdit', 'afterShellExecution', 'stop', 'sessionStart', 'sessionEnd'],
};
// Cursor 이벤트와 doc-kit 훅 처리 이름. Cursor CLI의 -p(print) 실행에서는 beforeSubmitPrompt·stop이 오지 않고
// sessionStart·afterFileEdit·afterShellExecution·sessionEnd는 온다. 그래서 세션 시작·끝에도 같은 처리를 건다
const CURSOR_HOOKS = [['beforeSubmitPrompt', 'prompt'], ['afterFileEdit', 'post'], ['afterShellExecution', 'post'], ['stop', 'stop'], ['sessionStart', 'start'], ['sessionEnd', 'end']];
// Cursor 지침에만 덧붙인다. Cursor CLI는 승인 목록 밖의 셸 명령을 거절해 build를 못 하는 일이 있다
const CURSOR_EXTRA = `- HTML 코드를 대화창에 출력하지 말고 작업 폴더의 파일로 쓴다. 문서 요청인데 셸 명령이 거절돼 build를 못 하면 묻지 말고 완성 HTML 파일을 직접 쓴다. 작업이 끝날 때 훅이 뷰어·편집기를 넣는다.`;
const hookFile = (p, a) => ({claude: p.claudeSettings, codex: p.codexHooks, cursor: p.cursorHooks})[a];
const instructionFile = (p, a) => ({claude: p.claudeMd, codex: p.codexMd, cursor: p.cursorRule})[a];
const skillDir = (p, a) => (a === 'claude' ? p.claudeSkill : p.agentsSkill);
// 설정 파일을 못 읽어도 점검과 제거는 계속한다. 이 에이전트에 우리 훅이 있는지만 본다
function hooksOf(p, a) {
  try {
    return readJson(hookFile(p, a), {}).hooks || {};
  } catch {
    return {};
  }
}
const isInstalled = (p, a) => Object.values(hooksOf(p, a)).some(hasOurs);
function checkAgents(agents) {
  const bad = agents.filter((a) => !ALL_AGENTS.includes(a));
  if (bad.length) throw new Error(`알 수 없는 에이전트입니다: ${bad.join(', ')} (${ALL_AGENTS.join(', ')} 중에서 고르세요)`);
}

// 설치할 스킬 원본을 찾는다. 설치된 실행 파일(~/.doc-kit/bin)에서 돌려도 찾을 수 있어야 한다
function findSource(p) {
  const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const src = [here, p.claudeSkill, p.agentsSkill].find(isSkill);
  if (!src) throw new Error('스킬 원본을 찾지 못해 아무것도 바꾸지 않았습니다. skill/html-doc-kit/scripts/doc-kit.mjs로 설치하세요');
  return src;
}
// 임시 폴더에 다 복사한 뒤 바꿔 넣는다. 복사가 실패해도 있던 스킬은 남는다. 설치된 위치에서 돌리면 그대로 둔다
function copySkill(src, to) {
  if (samePath(src, to)) return;
  fs.mkdirSync(path.dirname(to), {recursive: true});
  const tmp = `${to}.tmp-${process.pid}`;
  fs.rmSync(tmp, {recursive: true, force: true});
  fs.cpSync(src, tmp, {recursive: true});
  fs.rmSync(to, {recursive: true, force: true});
  fs.renameSync(tmp, to);
}

export function install({home = os.homedir(), agents = ALL_AGENTS, platform = process.platform, env = process.env, probe, readReg} = {}) {
  checkAgents(agents);
  const p = paths(home);
  const src = findSource(p);
  const node = nodeToken({platform, env, probe, readReg});
  fs.mkdirSync(path.dirname(p.bin), {recursive: true});
  if (!samePath(path.join(src, 'scripts', 'doc-kit.mjs'), p.bin)) fs.copyFileSync(path.join(src, 'scripts', 'doc-kit.mjs'), p.bin);
  const cmd = (a, e) => `${node} "${p.bin}" hook ${a} ${e}`;
  const done = [];
  if (agents.includes('claude')) {
    copySkill(src, p.claudeSkill);
    const c = readJson(p.claudeSettings, {});
    mergeNested(c, 'UserPromptSubmit', nestedHook(cmd('claude', 'prompt')));
    mergeNested(c, 'PostToolUse', nestedHook(cmd('claude', 'post'), 'Write|Edit|MultiEdit|Bash|PowerShell'));
    mergeNested(c, 'Stop', nestedHook(cmd('claude', 'stop')));
    writeJson(p.claudeSettings, c);
    upsertBlock(p.claudeMd, rules(p.bin));
    done.push(AGENT_NAMES.claude);
  }
  if (agents.includes('codex') || agents.includes('cursor')) copySkill(src, p.agentsSkill);
  if (agents.includes('codex')) {
    const c = readJson(p.codexHooks, {});
    mergeNested(c, 'UserPromptSubmit', nestedHook(cmd('codex', 'prompt')));
    mergeNested(c, 'PostToolUse', nestedHook(cmd('codex', 'post'), 'apply_patch|Edit|Write|Bash'));
    mergeNested(c, 'Stop', nestedHook(cmd('codex', 'stop')));
    writeJson(p.codexHooks, c);
    upsertBlock(p.codexMd, rules(p.bin));
    done.push(AGENT_NAMES.codex);
  }
  if (agents.includes('cursor')) {
    const c = readJson(p.cursorHooks, {version: 1, hooks: {}});
    c.version = c.version || 1;
    c.hooks = c.hooks || {};
    for (const [event, name] of CURSOR_HOOKS) {
      c.hooks[event] = [...stripOurs(c.hooks[event]), {command: cmd('cursor', name)}];
    }
    writeJson(p.cursorHooks, c);
    fs.mkdirSync(path.dirname(p.cursorRule), {recursive: true});
    fs.writeFileSync(p.cursorRule, `---\ndescription: HTML 문서를 만들 때 html-doc-kit을 쓴다\nalwaysApply: true\n---\n${rules(p.bin)}\n${CURSOR_EXTRA}\n`);
    done.push(AGENT_NAMES.cursor);
  }
  return done;
}

// 고른 에이전트 몫만 지운다. 함께 쓰는 스킬 폴더와 실행 파일은 쓰는 에이전트가 남아 있지 않을 때만 지운다
export function uninstall({home = os.homedir(), agents = ALL_AGENTS} = {}) {
  checkAgents(agents);
  const p = paths(home);
  for (const a of agents) {
    const f = hookFile(p, a);
    if (!fs.existsSync(f)) continue;
    const c = readJson(f, {});
    for (const e of Object.keys(c.hooks || {})) {
      if (!Array.isArray(c.hooks[e])) continue;
      c.hooks[e] = stripOurs(c.hooks[e]);
      if (!c.hooks[e].length) delete c.hooks[e];
    }
    writeJson(f, c);
  }
  if (agents.includes('claude')) {
    dropBlock(p.claudeMd);
    fs.rmSync(p.claudeSkill, {recursive: true, force: true});
  }
  if (agents.includes('codex')) dropBlock(p.codexMd);
  if (agents.includes('cursor')) fs.rmSync(p.cursorRule, {force: true});
  if (!isInstalled(p, 'codex') && !isInstalled(p, 'cursor')) fs.rmSync(p.agentsSkill, {recursive: true, force: true});
  if (!ALL_AGENTS.some((a) => isInstalled(p, a))) fs.rmSync(p.bin, {force: true});
  return agents.map((a) => AGENT_NAMES[a]);
}

// Codex 승인 키는 설정 파일 경로:이벤트:번호 꼴이다. 전역 훅 키는 실제 승인으로 아직 확인하지 못했다
const CODEX_EVENTS = {prompt: 'user_prompt_submit', post: 'post_tool_use', stop: 'stop'};
// Windows의 Codex는 키를 작은따옴표 리터럴과 역슬래시 경로로 쓴다('C:\\Users\\...\\.codex\\hooks.json:stop:0:0')
export const codexTrusted = (conf, event) => new RegExp(`\\[hooks\\.state\\.(["'])[^"'\\n]*\\.codex[\\\\/]+hooks\\.json:${event}:[^"'\\n]*\\1\\]\\s*\\n\\s*trusted_hash`, 'i').test(conf);

// agents를 주지 않으면 설치 흔적이 있는 에이전트를 본다. 흔적이 하나도 없으면 전부 본다
// 설치된 우리 훅 명령들. 앞부분(node와 실행 파일)이 같은지 보고 시험하는 데 쓴다
const ourCommands = (hooks) => Object.values(hooks).flatMap((l) => (Array.isArray(l) ? l : [])).flatMap((h) => [h?.command, ...(Array.isArray(h?.hooks) ? h.hooks.map((x) => x?.command) : [])]).filter(isOurCommand);
// 훅 명령을 cmd.exe와 PowerShell로 직접 돌려 본다. 실행 파일 뒤에 --version만 붙인다
// PATH는 시작 메뉴로 켠 앱이 받는 영구 PATH로 바꿔 돌린다. 못 읽으면 지금 환경 그대로다
function smoke(prefix, env, persist) {
  const want = (r) => r.status === 0 && r.stdout.trim() === VERSION;
  const line = `${prefix} --version`;
  const base = Object.fromEntries(Object.entries(env).filter(([k]) => k.toUpperCase() !== 'PATH'));
  const opts = {encoding: 'utf-8', timeout: 30000, windowsHide: true, env: persist == null ? env : {...base, Path: persist}};
  const cmd = spawnSync(line, {...opts, shell: true});
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(line, 'utf16le').toString('base64')], opts);
  return [['cmd.exe', want(cmd)], ['PowerShell', want(ps)]];
}

// 업데이트가 쓰는 정보. 설치된 실행 파일·스킬 위치, 우리 훅이 있는 에이전트, 훅 명령이 부르는 node
export const binPath = (home = os.homedir()) => paths(home).bin;
export const skillDirs = (home = os.homedir()) => [paths(home).claudeSkill, paths(home).agentsSkill];
export const installedAgents = (home = os.homedir()) => ALL_AGENTS.filter((a) => isInstalled(paths(home), a));
// 같은 node로 다시 설치해야 훅 명령 글자가 그대로라 Codex 승인이 유지된다. 따옴표 경로가 아니면(Windows의 맨 node) null
export function hookNode(home = os.homedir()) {
  const p = paths(home);
  for (const a of ALL_AGENTS) {
    for (const c of ourCommands(hooksOf(p, a))) {
      const m = /^"([^"]+)"\s/.exec(c);
      if (m && fs.existsSync(m[1])) return m[1];
    }
  }
  return null;
}

export function doctor({home = os.homedir(), agents, platform = process.platform, env = process.env, probe, readReg} = {}) {
  if (agents) checkAgents(agents);
  const p = paths(home);
  const lines = [];
  const say = (ok, m) => lines.push(`${ok === true ? '정상' : ok === false ? '문제' : '주의'}  ${m}`);
  const major = Number(process.versions.node.split('.')[0]);
  say(major >= 22, `Node ${process.version} (22 이상 필요)`);
  const chrome = findChrome();
  say(chrome ? true : null, chrome ? `브라우저 시험: ${chrome}` : '브라우저를 찾지 못해 C6이 미실행됩니다');
  say(fs.existsSync(p.bin), `실행 파일 ${p.bin} (키트 ${VERSION})`);
  const hasRules = (a) => {
    const f = instructionFile(p, a);
    return fs.existsSync(f) && fs.readFileSync(f, 'utf-8').includes('html-doc-kit');
  };
  const traced = ALL_AGENTS.filter((a) => isInstalled(p, a) || hasRules(a));
  const targets = agents || (traced.length ? traced : ALL_AGENTS);
  // 따옴표 경로는 그 파일이 있는지, 맨 node는 PATH에서 찾히는지 본다
  const nodeOk = (cmds) =>
    cmds.every((c) => {
      const m = /^"([^"]+)"/.exec(c);
      if (m) return fs.existsSync(m[1]);
      return !/^node\s/.test(c) || !!pathNode({platform, env, probe, readReg});
    });
  const cellar = [...new Set(targets.flatMap((a) => ourCommands(hooksOf(p, a))).map((c) => /^"([^"]+)"/.exec(c)?.[1]).filter((n) => n && isCellarNode(n)))];
  if (cellar.length) say(null, `훅이 Homebrew 버전 폴더의 node(${cellar.join(', ')})를 부릅니다. brew upgrade로 node가 올라가면 훅이 끊기니 install을 다시 실행하세요(판이 바뀌어도 그대로인 경로로 바꿉니다. Codex는 훅을 한 번 다시 승인해야 합니다)`);
  for (const a of targets) {
    const f = hookFile(p, a);
    say(isSkill(skillDir(p, a)), `${AGENT_NAMES[a]} 스킬 ${skillDir(p, a)}`);
    const hooks = hooksOf(p, a);
    const missing = HOOK_EVENTS[a].filter((e) => !hasOurs(hooks[e]));
    const lost = nodeOk(ourCommands(hooks)) ? '' : ', Node 경로 없음';
    say(!missing.length && !lost, `${AGENT_NAMES[a]} 훅 ${f}${missing.length ? ` (없음: ${missing.join(', ')})` : ''}${lost}`);
    say(hasRules(a), `${AGENT_NAMES[a]} 지침 ${instructionFile(p, a)}`);
  }
  if (platform === 'win32') {
    const cmds = targets.flatMap((a) => ourCommands(hooksOf(p, a)));
    if (cmds.some((c) => c.startsWith('"'))) say(null, '영구 PATH(시스템·사용자 환경 변수)에서 Node 22 이상의 node.exe를 찾지 못해 훅 명령이 따옴표 경로로 시작합니다. PowerShell로 훅을 돌리는 에이전트에서는 훅이 실패할 수 있습니다. 환경 변수 Path에 node를 넣고 install을 다시 실행하세요');
    const prefix = cmds.map((c) => /^.*?doc-kit\.mjs"/.exec(c)?.[0]).find(Boolean);
    if (prefix && fs.existsSync(p.bin)) for (const [shell, ok] of smoke(prefix, env, persistentPath({env, readReg}))) say(ok, `훅 명령 시험(${shell}): ${prefix}`);
  }
  if (targets.includes('codex')) {
    const conf = fs.existsSync(p.codexConfig) ? fs.readFileSync(p.codexConfig, 'utf-8') : '';
    const waiting = Object.entries(CODEX_EVENTS).filter(([, event]) => !codexTrusted(conf, event)).map(([name]) => name);
    say(waiting.length === 0, waiting.length ? `Codex 훅 승인 필요(${waiting.join(', ')}): 터미널에서 codex를 실행해 훅 승인 안내를 따르세요${platform === 'win32' ? '(Codex 앱만 설치해 codex 명령이 없으면 PowerShell에서 & "$env:LOCALAPPDATA\\OpenAI\\Codex\\bin\\<폴더>\\codex.exe" --no-daemon)' : ''}. 승인 전에는 Codex에서 자동 복구가 돌지 않습니다. Codex를 쓰지 않으면 uninstall --agents codex로 빼세요` : 'Codex 훅 승인됨(prompt, post, stop)');
  }
  return lines;
}
