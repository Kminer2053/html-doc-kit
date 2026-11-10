// 키트를 쓸 때(build·ensure·check 등) 최신 버전인지 보고, 새 버전이 있으면 받아 다시 설치한다.
// 훅에서는 확인하지 않는다(턴마다 네트워크를 쓰지 않는다). 확인은 한 시간에 한 번이고, 실패해도 지금 버전으로 계속한다.
// 보내는 것은 공개 저장소의 최신 릴리스 조회뿐이다(사용자 정보 없음)
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {newerThan} from './check.mjs';
import {VERSION} from './core.mjs';
import {binPath, hookNode, installedAgents, skillDirs} from './install.mjs';

const REPO = 'Kminer2053/html-doc-kit';
// 릴리스에 붙이는 스킬 묶음(npm run pack). 없으면 저장소 소스 묶음을 받는다
export const ASSET = 'html-doc-kit-skill.tar.gz';
const CHECK_EVERY_MS = 3600 * 1000;
const MAX_BYTES = 200e6;
const api = () => (process.env.DOC_KIT_UPDATE_API || 'https://api.github.com').replace(/\/$/, '');
const home = () => process.env.DOC_KIT_HOME || os.homedir();
const stateFile = (h) => path.join(h, '.doc-kit', 'state', 'update.json');
const HEADERS = {'User-Agent': 'html-doc-kit-updater'};
const real = (f) => {
  try {
    return fs.realpathSync(f);
  } catch {
    return path.resolve(f);
  }
};
const readState = (h) => {
  try {
    return JSON.parse(fs.readFileSync(stateFile(h), 'utf-8'));
  } catch {
    return {};
  }
};
const writeState = (h, s) => {
  try {
    fs.mkdirSync(path.dirname(stateFile(h)), {recursive: true});
    fs.writeFileSync(stateFile(h), JSON.stringify(s));
  } catch {}
};

// 설치된 실행 파일로 돌 때만 스스로 업데이트한다. 저장소에서 개발 중인 실행 파일로 돌 때는 하지 않는다
export function isInstalledCopy(file = process.argv[1], h = home()) {
  if (!file) return false;
  const me = real(file);
  return [binPath(h), ...skillDirs(h).map((d) => path.join(d, 'scripts', 'doc-kit.mjs'))].some((f) => fs.existsSync(f) && real(f) === me);
}

async function get(url, ms, accept) {
  const r = await fetch(url, {headers: {...HEADERS, Accept: accept}, signal: AbortSignal.timeout(ms), redirect: 'follow'});
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

// 풀어 놓은 폴더에서 스킬(SKILL.md와 scripts/doc-kit.mjs)을 찾는다. 소스 묶음이면 <최상위>/skill/html-doc-kit에 있다
function findSkill(dir, depth = 0) {
  if (fs.existsSync(path.join(dir, 'SKILL.md')) && fs.existsSync(path.join(dir, 'scripts', 'doc-kit.mjs'))) return dir;
  if (depth >= 4) return null;
  const subs = fs.readdirSync(dir, {withFileTypes: true}).filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules');
  // 이름이 html-doc-kit이거나 skill인 폴더를 먼저 본다
  subs.sort((a, b) => Number(!/^(html-doc-kit|skill)$/.test(a.name)) - Number(!/^(html-doc-kit|skill)$/.test(b.name)));
  for (const e of subs) {
    const hit = findSkill(path.join(dir, e.name), depth + 1);
    if (hit) return hit;
  }
  return null;
}

// 결과 status: skipped(확인 안 함) · latest(최신) · offline(확인 실패) · updated · failed(새 버전이 있으나 설치 실패)
export async function selfUpdate({force = false} = {}) {
  const h = home();
  if (!force && (process.env.DOC_KIT_NO_UPDATE || !isInstalledCopy(process.argv[1], h))) return {status: 'skipped'};
  const st = readState(h);
  if (!force && st.checkedAt && Date.now() - st.checkedAt >= 0 && Date.now() - st.checkedAt < CHECK_EVERY_MS) return {status: 'skipped'};
  writeState(h, {checkedAt: Date.now()});
  let rel;
  try {
    rel = await (await get(`${api()}/repos/${REPO}/releases/latest`, 3000, 'application/vnd.github+json')).json();
  } catch (e) {
    return {status: 'offline', reason: e.name === 'TimeoutError' ? '시간 초과' : e.message};
  }
  const tag = String(rel?.tag_name || '');
  const latest = tag.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(latest) || !newerThan(latest, VERSION)) return {status: 'latest', latest: latest || VERSION};
  const agents = installedAgents(h);
  if (!agents.length) return {status: 'failed', latest, reason: '훅이 설치된 에이전트가 없어 install을 다시 실행해야 합니다'};
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-update-'));
  try {
    const asset = (rel.assets || []).find((a) => a?.name === ASSET && a.browser_download_url);
    const url = asset ? asset.browser_download_url : `${api()}/repos/${REPO}/tarball/${encodeURIComponent(tag)}`;
    const buf = Buffer.from(await (await get(url, 120000, 'application/octet-stream')).arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('받은 파일이 너무 큽니다');
    const file = path.join(tmp, 'kit.tar.gz');
    fs.writeFileSync(file, buf);
    const out = path.join(tmp, 'x');
    fs.mkdirSync(out);
    const t = spawnSync('tar', ['-xzf', file, '-C', out], {encoding: 'utf-8', timeout: 120000, windowsHide: true});
    if (t.status !== 0) throw new Error(`압축을 풀지 못했습니다${t.stderr ? `: ${t.stderr.trim().split('\n').pop()}` : ''}`);
    const skill = findSkill(out);
    if (!skill) throw new Error('받은 파일에서 스킬을 찾지 못했습니다');
    const newBin = path.join(skill, 'scripts', 'doc-kit.mjs');
    const node = hookNode(h) || process.execPath;
    const env = {...process.env, DOC_KIT_NO_UPDATE: '1'};
    const v = spawnSync(node, [newBin, '--version'], {encoding: 'utf-8', timeout: 30000, windowsHide: true, env});
    if (v.status !== 0 || v.stdout.trim() !== latest) throw new Error(`받은 키트의 버전(${(v.stdout || '').trim() || '알 수 없음'})이 ${latest}가 아닙니다`);
    const ins = spawnSync(node, [newBin, 'install', '--home', h, '--agents', agents.join(',')], {encoding: 'utf-8', timeout: 180000, windowsHide: true, env});
    if (ins.status !== 0) throw new Error(`설치 실패: ${`${ins.stderr || ''}${ins.stdout || ''}`.trim().split('\n').pop()}`);
    return {status: 'updated', from: VERSION, to: latest, bin: binPath(h)};
  } catch (e) {
    return {status: 'failed', latest, reason: e.name === 'TimeoutError' ? '시간 초과' : e.message};
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
}
