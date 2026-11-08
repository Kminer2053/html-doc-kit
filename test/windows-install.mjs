// Windows 설치의 훅 명령과 임시 프로필 정리를 Mac에서도 시험한다. 실제 홈은 건드리지 않고 임시 홈을 쓴다
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {codexTrusted, doctor, install, nodeToken, parseRegPath, pathNode, persistentPath, probeNode, uninstall} from '../src/cli/install.mjs';
import {sweepProfiles} from '../src/cli/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-wintest-'));
let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond || !extra ? '' : ` :: ${extra}`}`);
  if (!cond) failed++;
};
// 가짜 node.exe. 실제로 돌리지 않고 probe가 판을 알려 준다(Windows에서도 셸 스크립트를 못 돌려 실패하지 않게)
const versions = new Map();
const stub = (dir, name, major) => {
  fs.mkdirSync(dir, {recursive: true});
  const f = path.join(dir, name);
  fs.writeFileSync(f, 'stub');
  versions.set(f, major);
  return f;
};
const probe = (f) => versions.get(f) ?? NaN;
const good = path.join(root, 'good');
stub(good, 'node.exe', 24);
const old = path.join(root, 'old');
stub(old, 'node.exe', 20);
const shim = path.join(root, 'shim');
stub(shim, 'node.cmd', 24);
const empty = path.join(root, 'empty');
fs.mkdirSync(empty);
const win = (p) => ({PATH: p, PATHEXT: '.COM;.EXE;.BAT;.CMD'});
// 가짜 레지스트리. 시스템 Path와 사용자 Path를 돌려준다. null이면 못 읽은 것
const reg = (sys, user = '') => (key) => (key.startsWith('HKLM') ? sys : user);
// 영구 PATH와 지금 셸 PATH가 같은 Windows
const W = (p, extra = {}) => ({platform: 'win32', env: win(p), probe, readReg: reg(p), ...extra});
const quoted = `"${process.execPath}"`;

try {
  // 1. 첫 낱말
  ok('Mac·Linux는 예전 그대로 따옴표 경로', nodeToken({platform: 'darwin', env: win(good), probe}) === quoted && nodeToken({platform: 'linux', env: win(good), probe}) === quoted);
  ok('Windows: PATH에 Node 24 node.exe가 있으면 맨 node', nodeToken(W(good)) === 'node');
  ok('Windows: Path 키 이름의 대소문자가 달라도 찾음', nodeToken({...W(good), env: {Path: good, PathExt: '.EXE'}}) === 'node');
  ok('Windows: PATH의 node가 22 미만이면 따옴표 경로', nodeToken(W(old)) === quoted);
  ok('Windows: PATH 앞쪽의 낡은 node가 셸이 고르는 것이면 따옴표 경로', nodeToken(W(`${old};${good}`)) === quoted);
  ok('Windows: 빈 디렉터리는 건너뛰고 다음 PATH를 봄', nodeToken(W(`${empty};${good}`)) === 'node');
  ok('Windows: node.cmd가 먼저면 따옴표 경로', nodeToken(W(`${shim};${good}`)) === quoted);
  ok('Windows: PATH에 node가 없으면 따옴표 경로', nodeToken(W(empty)) === quoted);
  // 지금 Node와 같은 파일이면 돌려 보지 않고 쓴다(판을 못 찍는 파일로 확인)
  const mute = path.join(root, 'mute');
  const muteExe = stub(mute, 'node.exe', NaN);
  ok('Windows: 지금 Node와 같은 파일이면 그대로 씀', pathNode({...W(mute), execPath: muteExe}) === muteExe && !pathNode(W(mute)));
  ok('실제 probe: 지금 Node의 주 판 번호', probeNode(process.execPath) === Number(process.versions.node.split('.')[0]));

  // 1-2. 영구 PATH. 시작 메뉴로 켠 앱은 셸에서만 붙인 PATH를 받지 못한다
  const fnmDir = path.join(root, 'fnm_multishells', '1234');
  stub(fnmDir, 'node.exe', 24);
  ok('Windows: 레지스트리를 못 읽으면 따옴표 경로', nodeToken({...W(good), readReg: reg(null)}) === quoted);
  ok('Windows: 셸에서만 붙인 node는 쓰지 않음', nodeToken({...W(`${fnmDir};${good}`), readReg: reg(empty)}) === quoted);
  ok('Windows: 영구 PATH에 node가 있으면 셸 PATH가 fnm이어도 맨 node', nodeToken({...W(`${fnmDir};${good}`), readReg: reg(empty, good)}) === 'node');
  ok('Windows: 영구 PATH의 node가 fnm 세션 폴더 안이면 따옴표 경로', nodeToken({...W(fnmDir), env: {...win(fnmDir), FNM_MULTISHELL_PATH: fnmDir}}) === quoted);
  ok('Windows: 영구 PATH는 시스템 값 다음 사용자 값', nodeToken({...W(good), readReg: reg(old, good)}) === quoted && nodeToken({...W(good), readReg: reg(empty, good)}) === 'node');
  ok('Windows: 셸 PATH의 node가 낡았으면 따옴표 경로', nodeToken({...W(old), readReg: reg(good)}) === quoted);
  ok('Windows: 영구 PATH의 %VAR%를 풂', persistentPath({env: {SystemRoot: 'C:\\Windows', localappdata: 'C:\\L'}, readReg: reg('%SystemRoot%\\system32;%NOPE%', '%LOCALAPPDATA%\\bin')}) === 'C:\\Windows\\system32;%NOPE%;C:\\L\\bin');
  ok('Windows: 영구 PATH에 %VAR%가 있어도 찾음', nodeToken({...W(good), env: {...win(good), DKROOT: root}, readReg: reg('%DKROOT%' + path.sep + 'good')}) === 'node');
  const regOut = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;C:\\x\r\n\r\n';
  ok('reg 출력 읽기', parseRegPath(regOut) === '%USERPROFILE%\\bin;C:\\x' && parseRegPath('    Path    REG_SZ    C:\\a b\r\n') === 'C:\\a b' && parseRegPath('') === null);

  // 2. 설치·재설치·제거. 스킬 원본은 임시 홈에 복사해 둔다
  const home = path.join(root, 'home');
  fs.cpSync(path.join(here, '..', 'skill', 'html-doc-kit'), path.join(home, '.claude', 'skills', 'html-doc-kit'), {recursive: true});
  const bin = path.join(home, '.doc-kit', 'bin', 'doc-kit.mjs');
  const oldCmd = (a, e) => `"C:\\Program Files\\nodejs\\node.exe" "${bin}" hook ${a} ${e}`;
  // 예전 따옴표 꼴로 설치돼 있던 상태와 사용자 훅
  fs.mkdirSync(path.join(home, '.cursor'), {recursive: true});
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({hooks: {Stop: [{hooks: [{type: 'command', command: oldCmd('claude', 'stop')}, {type: 'command', command: 'say done'}]}]}}));
  fs.writeFileSync(path.join(home, '.cursor', 'hooks.json'), JSON.stringify({version: 1, hooks: {stop: [{command: oldCmd('cursor', 'stop')}]}}));
  install({home, ...W(good)});
  const claude = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf-8'));
  const cursor = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf-8'));
  const codex = JSON.parse(fs.readFileSync(path.join(home, '.codex', 'hooks.json'), 'utf-8'));
  const cmds = (cfg) => Object.values(cfg.hooks).flat().flatMap((h) => [h.command, ...(h.hooks || []).map((x) => x.command)]).filter(Boolean);
  const ours = (cfg) => cmds(cfg).filter((c) => c.includes('doc-kit.mjs'));
  const all = [...ours(claude), ...ours(cursor), ...ours(codex)];
  ok('Windows 설치: 모든 훅이 node "<bin>" hook 꼴', all.length === 12 && all.every((c) => c.startsWith(`node "${bin}" hook `)), all.join('\n'));
  ok('재설치: 예전 따옴표 꼴 훅은 바뀌고 사용자 훅은 남음', !cmds(claude).some((c) => c.startsWith('"C:')) && !cmds(cursor).some((c) => c.startsWith('"C:')) && cmds(claude).includes('say done') && claude.hooks.Stop.flatMap((h) => h.hooks).filter((x) => x.command.includes('hook claude stop')).length === 1);
  ok('Claude Code PostToolUse 대상에 PowerShell', claude.hooks.PostToolUse.at(-1).matcher === 'Write|Edit|MultiEdit|Bash|PowerShell');

  // 3. doctor: 맨 node 꼴을 Node 경로 없음으로 보지 않는다
  const dOk = doctor({home, ...W(good)});
  ok('doctor: 맨 node 꼴 훅은 PATH에서 찾히면 정상', !dOk.some((l) => l.includes('Node 경로 없음')), dOk.join('\n'));
  const dLost = doctor({home, ...W(empty)});
  ok('doctor: PATH에서 node가 사라지면 Node 경로 없음', dLost.some((l) => l.startsWith('문제') && l.includes('Node 경로 없음')), dLost.join('\n'));
  ok('doctor(Windows): 셸 두 개의 훅 명령 시험 줄', dLost.some((l) => l.includes('훅 명령 시험(cmd.exe)')) && dLost.some((l) => l.includes('훅 명령 시험(PowerShell)')), dLost.join('\n'));
  ok('doctor(Windows): 맨 node 꼴이면 PowerShell 주의 없음', !dLost.some((l) => l.startsWith('주의') && l.includes('PowerShell')));
  const dMac = doctor({home, platform: 'darwin', env: win(good)});
  ok('doctor(Mac): 셸 시험 줄 없음', !dMac.some((l) => l.includes('훅 명령 시험')));

  // 4. 따옴표 꼴로 되돌아간 설치는 주의를 띄운다
  install({home, ...W(empty)});
  const fallback = ours(JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf-8')));
  ok('Windows: PATH에 node가 없으면 따옴표 경로로 설치', fallback.length === 3 && fallback.every((c) => c.startsWith(`"${process.execPath}" "${bin}" hook `)));
  const dQuoted = doctor({home, ...W(empty)});
  ok('doctor(Windows): 따옴표 꼴이면 PowerShell 주의', dQuoted.some((l) => l.startsWith('주의') && l.includes('PowerShell')), dQuoted.join('\n'));
  ok('doctor: 따옴표 경로의 Node가 있으면 Node 경로 없음이 아님', !dQuoted.some((l) => l.includes('Node 경로 없음')), dQuoted.join('\n'));

  // 5. 제거는 두 꼴을 다 지운다
  const s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf-8'));
  s.hooks.Stop.push({hooks: [{type: 'command', command: `node "${bin}" hook claude stop`}]});
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(s));
  uninstall({home});
  const left = ['.claude/settings.json', '.codex/hooks.json', '.cursor/hooks.json'].map((f) => fs.readFileSync(path.join(home, f), 'utf-8')).join('\n');
  ok('제거: 두 꼴의 우리 훅이 모두 빠지고 사용자 훅은 남음', !/doc-kit\.mjs"?\s+hook\s/.test(left) && left.includes('say done'), left);

  // 6. 남은 임시 프로필 정리
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(tmp);
  const hourAgo = (Date.now() - 2 * 3600000) / 1000;
  const mk = (name, inner, stale = true) => {
    const d = path.join(tmp, name);
    fs.mkdirSync(d);
    if (inner === 'Default') fs.mkdirSync(path.join(d, 'Default'));
    else if (inner) fs.writeFileSync(path.join(d, inner), 'x');
    if (stale) fs.utimesSync(d, hourAgo, hourAgo);
    return d;
  };
  const a = mk('doc-kit-aaaaaa', 'Local State');
  const b = mk('doc-kit-bbbbbb', 'DevToolsActivePort');
  const c = mk('doc-kit-cccccc', 'Default');
  const fresh = mk('doc-kit-dddddd', 'Local State', false);
  const plain = mk('doc-kit-eeeeee', 'notes.txt');
  const other = mk('other-ffffff', 'Local State');
  const emptyOld = mk('doc-kit-gggggg', null);
  const emptyFresh = mk('doc-kit-hhhhhh', null, false);
  const emptyOdd = mk('doc-kit-rel-x', null);
  const notDir = path.join(tmp, 'doc-kit-roundtrip-1.html');
  fs.writeFileSync(notDir, 'x');
  fs.utimesSync(notDir, hourAgo, hourAgo);
  sweepProfiles({dir: tmp});
  ok('정리: 한 시간 넘은 Chrome 프로필 모양 doc-kit-* 폴더만 지움', ![a, b, c].some((d) => fs.existsSync(d)) && [fresh, plain, other, notDir].every((d) => fs.existsSync(d)));
  sweepProfiles({dir: path.join(root, 'no-such-dir')});
  ok('정리: 임시 폴더가 없어도 오류 없음', true);
  ok('정리: 한 시간 넘은 빈 doc-kit-XXXXXX 폴더도 지우고, 새 것과 다른 이름은 둠', !fs.existsSync(emptyOld) && fs.existsSync(emptyFresh) && fs.existsSync(emptyOdd));
  // W5: Windows Codex의 승인 키는 작은따옴표 리터럴과 역슬래시 경로
  const winConf = "[hooks.state.'C:\\Users\\USER\\.codex\\hooks.json:post_tool_use:0:0']\r\ntrusted_hash = \"sha256:aa\"\r\n";
  ok('Codex 승인: Windows 키(작은따옴표·역슬래시, CRLF)를 알아봄', codexTrusted(winConf, 'post_tool_use') && !codexTrusted(winConf, 'stop'));
  const macConf = '[hooks.state."/Users/a/.codex/hooks.json:stop:0:0"]\ntrusted_hash = "sha256:bb"\n';
  ok('Codex 승인: macOS 키(큰따옴표·슬래시)도 그대로', codexTrusted(macConf, 'stop') && !codexTrusted(macConf, 'post_tool_use'));
  ok('Codex 승인: 큰따옴표 안 이중 역슬래시 키도 알아봄', codexTrusted('[hooks.state."C:\\\\Users\\\\U\\\\.codex\\\\hooks.json:stop:0:0"]\ntrusted_hash = "x"', 'stop'));
  ok('Codex 승인: 따옴표 짝이 안 맞으면 아님', !codexTrusted('[hooks.state."C:/u/.codex/hooks.json:stop:0:0\']\ntrusted_hash = "x"', 'stop'));
} catch (e) {
  ok('예외 없이 끝남', false, e.stack);
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
console.log(failed ? `FAIL ${failed}건` : 'PASS 전부');
process.exit(failed ? 1 : 0);
