import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {apply, build, check, ensure, extract, upgrade} from './ops.mjs';
import {doctor, install, uninstall} from './install.mjs';
import {selfUpdate} from './update.mjs';
import {hook} from './hook.mjs';
import {VERSION} from './core.mjs';

const USAGE = `html-doc-kit ${VERSION}: HTML 문서에 뷰어와 편집기를 넣습니다

  build <본문.md|본문.html> -o <결과.html> [--type slide|a4|a4-landscape|auto] [--title 제목]
  ensure <파일.html> [-o 결과.html]    어떤 HTML이든 완성 파일로 만듭니다(이미 완성이면 그대로). 마크다운은 같은 이름의 .html로 냅니다
  check <파일.html>                    완성 여부 판정. 0 완성, 1 미완성, 2 입력 문제
  extract <파일.html> [-o 본문.html]   완성 파일에서 본문만 꺼냅니다(기본 위치 .doc-kit/)
  apply <본문.html> <파일.html> [--shrink]  고친 본문을 완성 파일로 되돌립니다. 쪽을 일부러 줄였으면 --shrink
  upgrade <파일.html>                  키트를 최신으로 바꿉니다
  install | uninstall | doctor         에이전트 설치·제거·점검(--home 경로, --agents claude,codex,cursor)
  update                               새 버전이 있으면 받아 다시 설치합니다
공통: --no-browser 브라우저 시험 생략
설치된 키트는 위 문서 명령을 실행할 때 한 시간에 한 번 새 버전을 확인해 스스로 업데이트합니다(DOC_KIT_NO_UPDATE=1이면 끔)`;

function parseArgs(argv) {
  const pos = [];
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') o.output = argv[++i];
    else if (a === '--type') o.type = argv[++i];
    else if (a === '--title') o.title = argv[++i];
    else if (a === '--minutes') o.minutes = Number(argv[++i]);
    else if (a === '--home') o.home = argv[++i];
    else if (a === '--agents') o.agents = argv[++i].split(',');
    else if (a === '--no-browser') o.noBrowser = true;
    else if (a === '--no-backup') o.backup = false;
    else if (a === '--shrink') o.shrink = true;
    else if (a === '--json') o.json = true;
    else pos.push(a);
  }
  return {pos, o};
}
function need(file) {
  if (!file || !fs.existsSync(file)) {
    console.error(`파일을 찾지 못했습니다: ${file || '(없음)'}`);
    process.exit(2);
  }
}
function report(r) {
  for (const w of r.warnings || []) console.log(`경고: ${w}`);
  for (const n of r.notices || []) console.log(`알림: ${n}`);
  if (r.shrunk) process.exitCode = 1;
  if (r.c6 && r.c6.status === 'skip' && r.c6.reason) console.log(`브라우저 시험 미실행: ${r.c6.reason}`);
  if (r.c6 && r.c6.status === 'fail') {
    console.error(`미완성: ${r.file} (${r.c6.reason})`);
    process.exitCode = 1;
    return;
  }
  console.log(`${r.changed === false ? '그대로' : '완성'}: ${r.file}`);
}

const [cmd, ...rest] = process.argv.slice(2);
const {pos, o} = parseArgs(rest);
// 키트를 쓰는 명령에서만 새 버전을 확인한다. 알림은 표준 오류로 내 check --json 같은 출력을 깨지 않는다
const DOC_COMMANDS = new Set(['build', 'ensure', 'check', 'extract', 'apply', 'upgrade']);
if (DOC_COMMANDS.has(cmd)) {
  const u = await selfUpdate();
  if (u.status === 'updated') {
    console.error(`알림: html-doc-kit을 ${u.from}에서 ${u.to}로 업데이트했습니다. 새 버전으로 이어서 실행합니다`);
    const r = spawnSync(process.execPath, [u.bin, ...process.argv.slice(2)], {stdio: 'inherit', env: {...process.env, DOC_KIT_NO_UPDATE: '1'}});
    process.exit(r.status ?? 1);
  }
  if (u.status === 'failed') console.error(`알림: html-doc-kit ${u.latest}이 나왔지만 업데이트하지 못했습니다(${u.reason}). 지금 버전 ${VERSION}으로 계속합니다`);
}
try {
  if (cmd === 'build') {
    need(pos[0]);
    const output = o.output || pos[0].replace(/\.[^.]+$/, '') + (/\.html?$/i.test(pos[0]) ? '_편집용' : '') + '.html';
    report(await build(pos[0], output, o));
  } else if (cmd === 'ensure') {
    need(pos[0]);
    report(await ensure(pos[0], o));
  } else if (cmd === 'check') {
    need(pos[0]);
    const r = await check(pos[0], o);
    if (o.json) console.log(JSON.stringify(r));
    else {
      for (const w of r.warnings) console.log(`경고: ${w}`);
      for (const e of r.errors) console.log(`실패: ${e}`);
      if (r.inputFor) console.log(`참고: 이 파일은 build·apply의 입력입니다. 결과 파일은 ${r.inputFor}입니다`);
      if (r.c6.status === 'skip' && r.status === 'complete') console.log(`브라우저 시험 미실행: ${r.c6.reason}`);
      console.log(r.status === 'complete' ? `완성: ${r.file} (${r.pages}쪽)` : r.status === 'excluded' ? `제외됨: ${r.file}` : `미완성: ${r.file}. ensure를 실행하세요`);
    }
    process.exitCode = r.status === 'incomplete' ? 1 : 0;
  } else if (cmd === 'extract') {
    need(pos[0]);
    const r = extract(pos[0], o.output);
    for (const w of r.warnings) console.log(`경고: ${w}`);
    console.log(`본문: ${r.file}`);
  } else if (cmd === 'apply') {
    need(pos[0]);
    if (!pos[1]) throw new Error('되돌릴 파일을 지정하세요');
    report(await apply(pos[0], pos[1], o));
  } else if (cmd === 'upgrade') {
    need(pos[0]);
    report(await upgrade(pos[0], o));
  } else if (cmd === 'install') {
    console.log(`설치: ${install(o).join(', ')}`);
    doctor(o).forEach((l) => console.log(l));
    console.log('참고: 훅은 macOS의 Claude Code·Codex·Cursor에서 확인했습니다. Cursor CLI(agent -p)에서는 결과가 ~/.doc-kit/hook.log에만 남습니다. 자세한 범위는 README를 보세요');
  } else if (cmd === 'uninstall') {
    console.log(`제거: ${uninstall(o).join(', ')}`);
  } else if (cmd === 'update') {
    const u = await selfUpdate({force: true});
    const say = {
      updated: () => `업데이트: ${u.from} → ${u.to}`,
      latest: () => `최신입니다: ${VERSION}`,
      offline: () => `새 버전을 확인하지 못했습니다(${u.reason})`,
      failed: () => `${u.latest}이 나왔지만 업데이트하지 못했습니다(${u.reason})`,
    }[u.status];
    console.log(say ? say() : '확인하지 않았습니다');
    process.exitCode = u.status === 'failed' || u.status === 'offline' ? 1 : 0;
  } else if (cmd === 'doctor') {
    const lines = doctor(o);
    lines.forEach((l) => console.log(l));
    process.exitCode = lines.some((l) => l.startsWith('문제')) ? 1 : 0;
  } else if (cmd === '--version') {
    // doctor가 훅 명령이 셸에서 도는지 시험할 때 쓴다
    console.log(VERSION);
  } else if (cmd === 'hook') {
    await hook(pos[0], pos[1]);
  } else {
    console.log(USAGE);
    process.exitCode = cmd ? 2 : 0;
  }
} catch (e) {
  console.error(`오류: ${e.message}`);
  process.exitCode = 2;
}
