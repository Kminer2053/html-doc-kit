// npm test: 번들을 만들고 모든 시험을 차례로 돌린다. 합쳐서 수십 분 걸린다
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const run = (...args) => spawnSync('node', args, {stdio: 'inherit', cwd: path.join(here, '..')}).status;
if (run('tools/bundle.mjs')) process.exit(1);
let failed = 0;
for (const t of ['test/golden.mjs', 'test/editor.mjs', 'test/forms.mjs', 'test/regress.mjs', 'test/repair.mjs']) {
  console.log(`\n== ${t}`);
  if (run(t)) failed++;
}
const py = process.env.DOC_KIT_PY || 'python3';
console.log('\n== 픽셀 비교(numpy·Pillow 필요)');
const pix = spawnSync(py, ['test/pixdiff.py', 'test/out/golden'], {stdio: 'inherit', cwd: path.join(here, '..')});
if (pix.status) failed++;
console.log(failed ? `\n실패한 시험 ${failed}개` : '\n모든 시험 통과');
process.exit(failed ? 1 : 0);
