// npm test: 번들을 만들고 모든 시험을 차례로 돌린다. 합쳐서 수십 분 걸린다
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(here, '..');
const run = (...args) => spawnSync('node', args, {stdio: 'inherit', cwd}).status;
if (run('tools/bundle.mjs')) process.exit(1);
let failed = 0;
let goldenSkipped = false;
for (const t of ['test/golden.mjs', 'test/editor.mjs', 'test/forms.mjs', 'test/regress.mjs', 'test/windows.mjs', 'test/windows-install.mjs', 'test/repair.mjs']) {
  console.log(`\n== ${t}`);
  if (t === 'test/golden.mjs') {
    // 원본 장표가 없어 건너뛰었는지 알려고 출력을 받아 그대로 보여 준다
    const g = spawnSync('node', [t], {stdio: ['inherit', 'pipe', 'inherit'], cwd, encoding: 'utf-8', maxBuffer: 1e8});
    process.stdout.write(g.stdout || '');
    goldenSkipped = /^SKIP/m.test(g.stdout || '');
    if (g.status) failed++;
    continue;
  }
  if (run(t)) failed++;
}
// 파이썬 3을 찾는다. Windows의 python3는 스토어 안내용 가짜일 수 있어 python도 본다
const findPy = () => {
  for (const py of process.env.DOC_KIT_PY ? [process.env.DOC_KIT_PY] : ['python3', 'python']) {
    const r = spawnSync(py, ['--version'], {encoding: 'utf-8'});
    if (r.status === 0 && /Python 3/.test((r.stdout || '') + (r.stderr || ''))) return py;
  }
  return null;
};
console.log('\n== 픽셀 비교(numpy·Pillow 필요)');
const py = goldenSkipped ? null : findPy();
if (goldenSkipped) console.log('SKIP 원본 장표가 없어 golden을 건너뜀');
else if (!py) {
  console.log('FAIL 파이썬 3을 찾지 못함(DOC_KIT_PY로 지정)');
  failed++;
} else {
  const pix = spawnSync(py, ['test/pixdiff.py', 'test/out/golden'], {stdio: 'inherit', cwd});
  if (pix.status) failed++;
}
console.log(failed ? `\n실패한 시험 ${failed}개` : '\n모든 시험 통과');
process.exit(failed ? 1 : 0);
