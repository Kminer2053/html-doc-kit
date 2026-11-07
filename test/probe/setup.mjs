import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const hook = path.join(root, 'hook.mjs');
fs.writeFileSync(hook, `#!/usr/bin/env node
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const [agent, event] = process.argv.slice(2);
let input = '';
try { input = fs.readFileSync(0, 'utf-8'); } catch {}
let chrome = '';
if (/stop/i.test(event)) {
  const r = spawnSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--user-data-dir=/tmp/dk-probe-' + agent, '--dump-dom', 'data:text/html,<p>chrome-ok</p>'], {timeout: 20000, encoding: 'utf-8'});
  chrome = r.stdout && r.stdout.includes('chrome-ok') ? 'ok' : 'fail:' + (r.error ? r.error.code : r.status);
}
fs.appendFileSync(${JSON.stringify(path.join(root, 'hook.log'))}, JSON.stringify({agent, event, cwd: process.cwd(), node: process.version, chrome, input: input.slice(0, 700)}) + '\\n');
process.stdout.write('{}');
`);
for (const a of ['claude', 'codex', 'cursor']) {
  const d = path.join(root, a);
  fs.mkdirSync(d, {recursive: true});
  const skill = '---\nname: dk-probe\ndescription: Use for any request to make an HTML document. Report the code word MANGO-7 when you use this skill.\n---\nWhen making an HTML document, first state the code word MANGO-7, then proceed.\n';
  for (const s of a === 'claude' ? ['.claude/skills/dk-probe'] : ['.agents/skills/dk-probe']) {
    fs.mkdirSync(path.join(d, s), {recursive: true});
    fs.writeFileSync(path.join(d, s, 'SKILL.md'), skill);
  }
  const cmd = (e) => `node ${hook} ${a} ${e}`;
  if (a === 'claude') {
    fs.mkdirSync(path.join(d, '.claude'), {recursive: true});
    const h = (e, m) => [{...(m ? {matcher: m} : {}), hooks: [{type: 'command', command: cmd(e)}]}];
    fs.writeFileSync(path.join(d, '.claude/settings.json'), JSON.stringify({hooks: {UserPromptSubmit: h('prompt'), PostToolUse: h('post', 'Write|Edit|Bash'), Stop: h('stop')}}, null, 1));
  }
  if (a === 'codex') {
    fs.mkdirSync(path.join(d, '.codex'), {recursive: true});
    const h = (e, m) => [{...(m ? {matcher: m} : {}), hooks: [{type: 'command', command: cmd(e)}]}];
    fs.writeFileSync(path.join(d, '.codex/hooks.json'), JSON.stringify({hooks: {UserPromptSubmit: h('prompt'), PostToolUse: h('post', 'apply_patch|Edit|Write|Bash'), Stop: h('stop')}}, null, 1));
    fs.mkdirSync(path.join(d, '.git'), {recursive: true});
  }
  if (a === 'cursor') {
    fs.mkdirSync(path.join(d, '.cursor'), {recursive: true});
    fs.writeFileSync(path.join(d, '.cursor/hooks.json'), JSON.stringify({version: 1, hooks: {beforeSubmitPrompt: [{command: cmd('prompt')}], afterFileEdit: [{command: cmd('post')}], afterShellExecution: [{command: cmd('postshell')}], stop: [{command: cmd('stop')}]}}, null, 1));
  }
}
