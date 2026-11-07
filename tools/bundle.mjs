// src를 묶어 스킬의 단일 실행 파일을 만든다. 키트 코드의 해시를 버전별로 기록한다(버전을 올리면 옛 해시가 남는다)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf-8');
const version = JSON.parse(read('package.json')).version;
const b64 = (f) => fs.readFileSync(path.join(root, f)).toString('base64');
const KIT_JS = read('src/kit/kit.js');
const KIT_CSS = read('src/kit/kit.css');
const BASE_CSS = read('src/kit/base.css');
const FONT_CSS =
  '/* Noto Sans KR, SIL Open Font License 1.1 (scripts.sil.org/OFL) */' +
  [400, 700].map((w) => `@font-face{font-family:DocKitFull;src:url(data:font/woff2;base64,${b64(`src/kit/fonts/full-${w}.woff2`)}) format("woff2");font-weight:${w};font-display:block}`).join('');
if (KIT_JS.includes('</script') || /<\/style/.test(KIT_CSS + BASE_CSS)) throw new Error('키트 코드에 닫는 태그 글자가 있으면 안 됩니다');
const sha = (s) => crypto.createHash('sha256').update(s.replace(/\r\n?/g, '\n')).digest('hex').slice(0, 32);
const vf = path.join(root, 'src/kit/versions.json');
const versions = fs.existsSync(vf) ? JSON.parse(fs.readFileSync(vf, 'utf-8')) : {};
versions[version] = {code: sha(KIT_JS), style: sha(KIT_CSS), base: sha(BASE_CSS), font: sha(FONT_CSS)};
fs.writeFileSync(vf, JSON.stringify(versions, null, 1) + '\n');
fs.writeFileSync(
  path.join(root, 'src/cli/assets.gen.mjs'),
  `export const VERSION=${JSON.stringify(version)};\nexport const KIT_JS=${JSON.stringify(KIT_JS)};\nexport const KIT_CSS=${JSON.stringify(KIT_CSS)};\nexport const BASE_CSS=${JSON.stringify(BASE_CSS)};\nexport const FONT_CSS=${JSON.stringify(FONT_CSS)};\nexport const HASHES=${JSON.stringify(versions)};\n`,
);
await build({
  entryPoints: [path.join(root, 'src/cli/main.mjs')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(root, 'skill/html-doc-kit/scripts/doc-kit.mjs'),
  banner: {js: '#!/usr/bin/env node\n// html-doc-kit 실행 파일(자동 생성). 고치지 말고 src를 고친 뒤 npm run build'},
  legalComments: 'none',
});
fs.copyFileSync(path.join(root, 'src/kit/fonts/OFL.txt'), path.join(root, 'skill/html-doc-kit/assets/OFL.txt'));
console.log('built', version, (fs.statSync(path.join(root, 'skill/html-doc-kit/scripts/doc-kit.mjs')).size / 1e6).toFixed(1) + 'MB');
