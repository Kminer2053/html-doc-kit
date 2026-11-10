// 릴리스에 붙일 스킬 묶음을 만든다: dist/html-doc-kit-skill.tar.gz (최상위 폴더 html-doc-kit/)
// 설치된 키트의 업데이트가 이 파일을 받는다. 먼저 npm run build로 묶음 파일을 새로 만든다
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'html-doc-kit-skill.tar.gz');
fs.mkdirSync(path.dirname(out), {recursive: true});
const r = spawnSync('tar', ['-czf', out, '-C', path.join(root, 'skill'), 'html-doc-kit'], {stdio: 'inherit', env: {...process.env, COPYFILE_DISABLE: '1'}});
if (r.status !== 0) process.exit(1);
console.log('packed', path.relative(root, out), (fs.statSync(out).size / 1e6).toFixed(1) + 'MB');
