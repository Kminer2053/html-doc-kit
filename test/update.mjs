// 스스로 업데이트: 설치된 키트가 문서 명령을 실행할 때 새 릴리스를 받아 다시 설치하고 같은 명령을 이어 가는지 본다.
// 진짜 GitHub 대신 이 시험이 띄운 로컬 서버를 쓴다(DOC_KIT_UPDATE_API). 실제 홈은 건드리지 않는다
import {execFile, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_CLI = path.join(root, 'skill', 'html-doc-kit', 'scripts', 'doc-kit.mjs');
const VERSION = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).version;
const NEW = '9.9.9';
const ASSET = 'html-doc-kit-skill.tar.gz';
let failed = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : `\n  ${String(detail).slice(0, 800)}`}`);
  if (!cond) failed++;
};
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-upd-'));
const run = (file, args, env = {}) =>
  new Promise((resolve) => {
    execFile(process.execPath, [file, ...args], {cwd: T, env: {...process.env, DOC_KIT_NO_UPDATE: '', ...env}, encoding: 'utf-8', maxBuffer: 1e8}, (e, stdout, stderr) => resolve({code: e ? (e.code ?? 1) : 0, stdout, stderr}));
  });
const version = (file) => spawnSync(process.execPath, [file, '--version'], {encoding: 'utf-8'}).stdout.trim();
const hookCmds = (home) => JSON.stringify(JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf-8')).hooks);
const installAt = (name) => {
  const home = path.join(T, name);
  const r = spawnSync(process.execPath, [REPO_CLI, 'install', '--home', home], {encoding: 'utf-8', env: {...process.env, DOC_KIT_HOME: home}});
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return {home, bin: path.join(home, '.doc-kit', 'bin', 'doc-kit.mjs')};
};

try {
  // 새 판 묶음: 지금 스킬을 복사해 버전만 바꾼다
  const stage = path.join(T, 'stage');
  fs.cpSync(path.join(root, 'skill', 'html-doc-kit'), path.join(stage, 'html-doc-kit'), {recursive: true});
  const nb = path.join(stage, 'html-doc-kit', 'scripts', 'doc-kit.mjs');
  fs.writeFileSync(nb, fs.readFileSync(nb, 'utf-8').replace(`VERSION = "${VERSION}"`, `VERSION = "${NEW}"`));
  const good = path.join(T, 'good.tar.gz');
  spawnSync('tar', ['-czf', good, '-C', stage, 'html-doc-kit']);
  // 릴리스에 스킬 묶음이 없을 때 받는 저장소 소스 묶음 모양(<최상위>/skill/html-doc-kit)
  const src = path.join(T, 'src', 'Kminer2053-html-doc-kit-abc123');
  fs.mkdirSync(path.join(src, 'skill'), {recursive: true});
  fs.cpSync(path.join(stage, 'html-doc-kit'), path.join(src, 'skill', 'html-doc-kit'), {recursive: true});
  const srcTar = path.join(T, 'src.tar.gz');
  spawnSync('tar', ['-czf', srcTar, '-C', path.join(T, 'src'), path.basename(src)]);
  const bad = path.join(T, 'bad.tar.gz');
  fs.writeFileSync(bad, 'not a tarball');

  let latest = NEW;
  let asset = good;
  let hits = 0;
  let withAsset = true;
  const server = http.createServer((req, res) => {
    hits++;
    if (req.url === '/repos/Kminer2053/html-doc-kit/releases/latest') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({tag_name: `v${latest}`, assets: withAsset ? [{name: ASSET, browser_download_url: `http://127.0.0.1:${server.address().port}/dl`}] : []}));
    } else if (req.url === '/dl') res.end(fs.readFileSync(asset));
    else if (req.url === `/repos/Kminer2053/html-doc-kit/tarball/v${NEW}`) res.end(fs.readFileSync(srcTar));
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const API = `http://127.0.0.1:${server.address().port}`;

  const md = path.join(T, 'a.md');
  fs.writeFileSync(md, '# 제목\n\n본문');
  const doc = path.join(T, 'a.html');
  const b = await run(REPO_CLI, ['build', md, '-o', doc, '--no-browser'], {DOC_KIT_UPDATE_API: API});
  ok('개발 중인 실행 파일(저장소)은 확인하지 않음', b.code === 0 && hits === 0, b.stdout + b.stderr);

  const A = installAt('h1');
  const before = hookCmds(A.home);
  const c = await run(A.bin, ['check', doc, '--no-browser'], {DOC_KIT_HOME: A.home, DOC_KIT_UPDATE_API: API});
  ok('새 버전이면 받아 다시 설치하고 알림', c.stderr.includes(`${NEW}로 업데이트했습니다`) && version(A.bin) === NEW, c.stderr);
  ok('같은 명령을 새 버전으로 이어서 실행', c.code === 0 && c.stdout.includes('완성'), c.stdout + c.stderr);
  ok('스킬 폴더도 새 버전', version(path.join(A.home, '.claude', 'skills', 'html-doc-kit', 'scripts', 'doc-kit.mjs')) === NEW && version(path.join(A.home, '.agents', 'skills', 'html-doc-kit', 'scripts', 'doc-kit.mjs')) === NEW);
  ok('훅 명령 글자가 그대로(Codex 승인 유지)', hookCmds(A.home) === before, `${before}\n${hookCmds(A.home)}`);
  const h0 = hits;
  const c2 = await run(A.bin, ['check', doc, '--no-browser'], {DOC_KIT_HOME: A.home, DOC_KIT_UPDATE_API: API});
  ok('한 시간 안에는 다시 확인하지 않음', hits === h0 && c2.code === 0, `${hits} ${h0}`);
  const j = await run(A.bin, ['check', doc, '--json', '--no-browser'], {DOC_KIT_HOME: A.home, DOC_KIT_UPDATE_API: API});
  ok('check --json 출력은 깨지지 않음', (() => {
    try {
      return JSON.parse(j.stdout).status === 'complete';
    } catch {
      return false;
    }
  })(), j.stdout);

  latest = VERSION;
  const B = installAt('h2');
  const l = await run(B.bin, ['check', doc, '--no-browser'], {DOC_KIT_HOME: B.home, DOC_KIT_UPDATE_API: API});
  ok('최신이면 그대로', l.code === 0 && !l.stderr.includes('업데이트') && version(B.bin) === VERSION, l.stderr);

  const C = installAt('h3');
  const off = await run(C.bin, ['check', doc, '--no-browser'], {DOC_KIT_HOME: C.home, DOC_KIT_UPDATE_API: 'http://127.0.0.1:9'});
  ok('확인하지 못해도 조용히 계속', off.code === 0 && off.stdout.includes('완성') && !off.stderr.includes('업데이트'), off.stdout + off.stderr);

  latest = NEW;
  asset = bad;
  const D = installAt('h4');
  const f = await run(D.bin, ['check', doc, '--no-browser'], {DOC_KIT_HOME: D.home, DOC_KIT_UPDATE_API: API});
  ok('받은 파일이 망가졌으면 알리고 지금 버전으로 계속', f.code === 0 && f.stdout.includes('완성') && f.stderr.includes('업데이트하지 못했습니다') && version(D.bin) === VERSION, f.stdout + f.stderr);

  asset = good;
  const E = installAt('h5');
  const u = await run(E.bin, ['update'], {DOC_KIT_HOME: E.home, DOC_KIT_UPDATE_API: API});
  ok('update 명령', u.code === 0 && u.stdout.includes(`${VERSION} → ${NEW}`) && version(E.bin) === NEW, u.stdout + u.stderr);
  const off2 = await run(E.bin, ['check', doc, '--no-browser'], {DOC_KIT_HOME: E.home, DOC_KIT_UPDATE_API: API, DOC_KIT_NO_UPDATE: '1'});
  ok('DOC_KIT_NO_UPDATE=1이면 끔', off2.code === 0, off2.stderr);
  withAsset = false;
  const F = installAt('h6');
  const s6 = await run(F.bin, ['check', doc, '--no-browser'], {DOC_KIT_HOME: F.home, DOC_KIT_UPDATE_API: API});
  ok('스킬 묶음이 없으면 소스 묶음에서 찾아 설치', s6.code === 0 && version(F.bin) === NEW, s6.stdout + s6.stderr);
  server.close();
} finally {
  fs.rmSync(T, {recursive: true, force: true});
}
console.log(failed ? `실패 ${failed}개` : '업데이트 시험 통과');
process.exit(failed ? 1 : 0);
