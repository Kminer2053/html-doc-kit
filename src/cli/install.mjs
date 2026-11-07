// 세 에이전트에 스킬·지침·훅을 넣고 뺀다. 사용자의 기존 설정은 보존한다
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findChrome} from './browser.mjs';
import {VERSION} from './core.mjs';

const START = '<!-- html-doc-kit:start -->';
const END = '<!-- html-doc-kit:end -->';
const MARK = 'doc-kit.mjs';
const skillSource = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`${f}를 읽지 못해 건드리지 않았습니다: ${e.message}`);
  }
};
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), {recursive: true});
  if (fs.existsSync(f) && !fs.existsSync(f + '.doc-kit-bak')) fs.copyFileSync(f, f + '.doc-kit-bak');
  fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
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
  if (s.includes(START)) s = s.replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`), block);
  else s = s + (s && !s.endsWith('\n') ? '\n' : '') + (s ? '\n' : '') + block;
  fs.writeFileSync(file, s);
}
function dropBlock(file) {
  if (!fs.existsSync(file)) return;
  const s = fs.readFileSync(file, 'utf-8');
  if (s.includes(START)) fs.writeFileSync(file, s.replace(new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`), ''));
}
const nestedHook = (cmd, matcher) => ({...(matcher ? {matcher} : {}), hooks: [{type: 'command', command: cmd, timeout: 120}]});
const isOurs = (h) => JSON.stringify(h).includes(MARK);
function mergeNested(cfg, event, entry) {
  cfg.hooks = cfg.hooks || {};
  cfg.hooks[event] = [...(cfg.hooks[event] || []).filter((h) => !isOurs(h)), entry];
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

export function install({home = os.homedir(), agents = ['claude', 'codex', 'cursor']} = {}) {
  const p = paths(home);
  const src = skillSource();
  const node = process.execPath;
  fs.mkdirSync(path.dirname(p.bin), {recursive: true});
  fs.copyFileSync(path.join(src, 'scripts', 'doc-kit.mjs'), p.bin);
  const cmd = (a, e) => `"${node}" "${p.bin}" hook ${a} ${e}`;
  const copySkill = (to) => {
    fs.rmSync(to, {recursive: true, force: true});
    fs.cpSync(src, to, {recursive: true});
  };
  const done = [];
  if (agents.includes('claude')) {
    copySkill(p.claudeSkill);
    const c = readJson(p.claudeSettings, {});
    mergeNested(c, 'UserPromptSubmit', nestedHook(cmd('claude', 'prompt')));
    mergeNested(c, 'PostToolUse', nestedHook(cmd('claude', 'post'), 'Write|Edit|MultiEdit|Bash'));
    mergeNested(c, 'Stop', nestedHook(cmd('claude', 'stop')));
    writeJson(p.claudeSettings, c);
    upsertBlock(p.claudeMd, rules(p.bin));
    done.push('Claude Code');
  }
  if (agents.includes('codex') || agents.includes('cursor')) copySkill(p.agentsSkill);
  if (agents.includes('codex')) {
    const c = readJson(p.codexHooks, {});
    mergeNested(c, 'UserPromptSubmit', nestedHook(cmd('codex', 'prompt')));
    mergeNested(c, 'PostToolUse', nestedHook(cmd('codex', 'post'), 'apply_patch|Edit|Write|Bash'));
    mergeNested(c, 'Stop', nestedHook(cmd('codex', 'stop')));
    writeJson(p.codexHooks, c);
    upsertBlock(p.codexMd, rules(p.bin));
    done.push('Codex');
  }
  if (agents.includes('cursor')) {
    const c = readJson(p.cursorHooks, {version: 1, hooks: {}});
    c.version = c.version || 1;
    c.hooks = c.hooks || {};
    for (const [event, name] of [['beforeSubmitPrompt', 'prompt'], ['afterFileEdit', 'post'], ['afterShellExecution', 'post'], ['stop', 'stop']]) {
      c.hooks[event] = [...(c.hooks[event] || []).filter((h) => !isOurs(h)), {command: cmd('cursor', name)}];
    }
    writeJson(p.cursorHooks, c);
    fs.mkdirSync(path.dirname(p.cursorRule), {recursive: true});
    fs.writeFileSync(p.cursorRule, `---\ndescription: HTML 문서를 만들 때 html-doc-kit을 쓴다\nalwaysApply: true\n---\n${rules(p.bin)}\n`);
    done.push('Cursor');
  }
  return done;
}

export function uninstall({home = os.homedir()} = {}) {
  const p = paths(home);
  [p.claudeSkill, p.agentsSkill].forEach((d) => fs.rmSync(d, {recursive: true, force: true}));
  for (const f of [p.claudeSettings, p.codexHooks]) {
    if (!fs.existsSync(f)) continue;
    const c = readJson(f, {});
    for (const e of Object.keys(c.hooks || {})) {
      c.hooks[e] = c.hooks[e].filter((h) => !isOurs(h));
      if (!c.hooks[e].length) delete c.hooks[e];
    }
    writeJson(f, c);
  }
  if (fs.existsSync(p.cursorHooks)) {
    const c = readJson(p.cursorHooks, {});
    for (const e of Object.keys(c.hooks || {})) c.hooks[e] = c.hooks[e].filter((h) => !isOurs(h));
    writeJson(p.cursorHooks, c);
  }
  dropBlock(p.claudeMd);
  dropBlock(p.codexMd);
  fs.rmSync(p.cursorRule, {force: true});
  fs.rmSync(p.bin, {force: true});
}

export function doctor({home = os.homedir()} = {}) {
  const p = paths(home);
  const lines = [];
  const say = (ok, m) => lines.push(`${ok === true ? '정상' : ok === false ? '문제' : '주의'}  ${m}`);
  const major = Number(process.versions.node.split('.')[0]);
  say(major >= 22, `Node ${process.version} (22 이상 필요)`);
  const chrome = findChrome();
  say(chrome ? true : null, chrome ? `브라우저 시험: ${chrome}` : '브라우저를 찾지 못해 C6이 미실행됩니다');
  say(fs.existsSync(p.bin), `실행 파일 ${p.bin} (키트 ${VERSION})`);
  const hooked = (f) => fs.existsSync(f) && fs.readFileSync(f, 'utf-8').includes(MARK);
  const nodeOk = (f) => {
    const m = /"([^"]+)" "[^"]*doc-kit\.mjs"/.exec(fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').replace(/\\"/g, '"') : '');
    return !m || fs.existsSync(m[1]);
  };
  for (const [name, skill, hooks, md] of [['Claude Code', p.claudeSkill, p.claudeSettings, p.claudeMd], ['Codex', p.agentsSkill, p.codexHooks, p.codexMd], ['Cursor', p.agentsSkill, p.cursorHooks, p.cursorRule]]) {
    say(fs.existsSync(path.join(skill, 'SKILL.md')), `${name} 스킬 ${skill}`);
    say(hooked(hooks) && nodeOk(hooks), `${name} 훅 ${hooks}`);
    say(fs.existsSync(md) && fs.readFileSync(md, 'utf-8').includes('html-doc-kit'), `${name} 지침 ${md}`);
  }
  const conf = fs.existsSync(p.codexConfig) ? fs.readFileSync(p.codexConfig, 'utf-8') : '';
  const trusted = /hooks\.state\."[^"]*\.codex\/hooks\.json[^"]*stop[^"]*"\]\s*\n\s*trusted_hash/i.test(conf);
  say(trusted ? true : null, trusted ? 'Codex 훅 승인됨' : 'Codex 훅 승인 필요: 터미널에서 codex를 실행해 훅 승인 안내를 따르세요. 승인 전에는 Codex에서 자동 복구가 돌지 않습니다');
  return lines;
}
