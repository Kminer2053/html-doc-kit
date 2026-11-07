// 세 에이전트에 스킬·지침·훅을 넣고 뺀다. 사용자의 기존 설정은 보존한다
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
- 만들기: 본문만 마크다운이나 HTML 조각으로 쓰고 \`node "${cli}" build 본문파일 -o 결과.html\`을 실행한다. 뷰어와 편집기 코드를 직접 쓰지 않는다.
- 이미 있는 HTML: \`node "${cli}" ensure 파일.html\`
- 키트 파일 고치기: 통째로 읽지 말고 \`node "${cli}" extract 파일.html\`로 본문을 꺼내 고친 뒤 \`node "${cli}" apply 본문파일 파일.html\`을 실행한다.
- 끝나면 \`node "${cli}" check 결과.html\`로 확인한다. 웹앱의 HTML 파일에는 쓰지 않는다.`;
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
const CURSOR_EXTRA = `- HTML 코드를 대화창에 출력하지 말고 작업 폴더의 파일로 쓴다. 셸 명령이 거절돼 build를 못 하면 묻지 말고 완성 HTML 파일을 직접 쓴다. 작업이 끝날 때 훅이 뷰어·편집기를 넣는다.`;
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

export function install({home = os.homedir(), agents = ALL_AGENTS} = {}) {
  checkAgents(agents);
  const p = paths(home);
  const src = findSource(p);
  const node = process.execPath;
  fs.mkdirSync(path.dirname(p.bin), {recursive: true});
  if (!samePath(path.join(src, 'scripts', 'doc-kit.mjs'), p.bin)) fs.copyFileSync(path.join(src, 'scripts', 'doc-kit.mjs'), p.bin);
  const cmd = (a, e) => `"${node}" "${p.bin}" hook ${a} ${e}`;
  const done = [];
  if (agents.includes('claude')) {
    copySkill(src, p.claudeSkill);
    const c = readJson(p.claudeSettings, {});
    mergeNested(c, 'UserPromptSubmit', nestedHook(cmd('claude', 'prompt')));
    mergeNested(c, 'PostToolUse', nestedHook(cmd('claude', 'post'), 'Write|Edit|MultiEdit|Bash'));
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
const codexTrusted = (conf, event) => new RegExp(`\\[hooks\\.state\\."[^"]*\\.codex/hooks\\.json:${event}:[^"]*"\\]\\s*\\n\\s*trusted_hash`, 'i').test(conf);

// agents를 주지 않으면 설치 흔적이 있는 에이전트를 본다. 흔적이 하나도 없으면 전부 본다
export function doctor({home = os.homedir(), agents} = {}) {
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
  const nodeOk = (f) => {
    const m = /"([^"]+)" "[^"]*doc-kit\.mjs"/.exec(fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').replace(/\\"/g, '"') : '');
    return !m || fs.existsSync(m[1]);
  };
  for (const a of targets) {
    const f = hookFile(p, a);
    say(isSkill(skillDir(p, a)), `${AGENT_NAMES[a]} 스킬 ${skillDir(p, a)}`);
    const hooks = hooksOf(p, a);
    const missing = HOOK_EVENTS[a].filter((e) => !hasOurs(hooks[e]));
    const lost = nodeOk(f) ? '' : ', Node 경로 없음';
    say(!missing.length && !lost, `${AGENT_NAMES[a]} 훅 ${f}${missing.length ? ` (없음: ${missing.join(', ')})` : ''}${lost}`);
    say(hasRules(a), `${AGENT_NAMES[a]} 지침 ${instructionFile(p, a)}`);
  }
  if (targets.includes('codex')) {
    const conf = fs.existsSync(p.codexConfig) ? fs.readFileSync(p.codexConfig, 'utf-8') : '';
    const waiting = Object.entries(CODEX_EVENTS).filter(([, event]) => !codexTrusted(conf, event)).map(([name]) => name);
    say(waiting.length === 0, waiting.length ? `Codex 훅 승인 필요(${waiting.join(', ')}): 터미널에서 codex를 실행해 훅 승인 안내를 따르세요. 승인 전에는 Codex에서 자동 복구가 돌지 않습니다. Codex를 쓰지 않으면 uninstall --agents codex로 빼세요` : 'Codex 훅 승인됨(prompt, post, stop)');
  }
  return lines;
}
