// A1: AX2030 장표를 키트로 만들어 15쪽 모두 원본과 픽셀 비교한다. 원본 저장소가 있을 때만 돈다
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {open} from './lib/cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out', 'golden');
fs.mkdirSync(out, {recursive: true});
const CLI = path.join(here, '../skill/html-doc-kit/scripts/doc-kit.mjs');
const ORIG = process.env.AX2030_DECK || '/Users/hoonsbook/AX2030/outputs/AX2030_본부장회의_요약기반_15p_v6.html';
if (!fs.existsSync(ORIG)) {
  console.log('SKIP 원본 장표 없음');
  process.exit(0);
}
const html = fs.readFileSync(ORIG, 'utf-8');
const i = html.indexOf('const BOOK=') + 'const BOOK='.length;
const book = JSON.parse(html.slice(i, html.indexOf(';const $=s=>', i)));
// 입력: 장표 CSS와 글꼴 + 쪽 본문 + 메모
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
const parts = html.split(/(?=<section class="slide )/).slice(1).map((s, n) => {
  let sec = s;
  if (n === 14) sec = sec.slice(0, sec.indexOf('</div><aside'));
  const p = book.pages[n];
  const attrs = `data-title="${p.title.replace(/"/g, '&quot;')}" data-key="${p.key_message.replace(/"/g, '&quot;')}" data-seconds="${p.seconds}" data-notes="${p.narration.replace(/"/g, '&quot;')}"`;
  return sec.replace('<section class="slide ', `<section ${attrs} class="slide `);
});
const input = path.join(out, 'input.html');
fs.writeFileSync(input, `<!doctype html><title>AX2030 본부장회의</title><meta name="doc-type" content="slide"><style>${css}</style>${parts.join('')}`);
const built = path.join(out, 'kit.html');
execFileSync('node', [CLI, 'build', input, '-o', built], {stdio: 'inherit'});

const CAPTURE_ORIG = `.controls,.app-footer,.speaker{display:none!important}html,body{margin:0;background:#fff;overflow:hidden}#workspace{display:block!important;height:auto!important;padding:0!important}#viewport{display:block!important;overflow:visible!important}#canvas{zoom:1!important}.slide{box-shadow:none!important}`;
const CAPTURE_KIT = `.dk-ui{display:none!important}html,body,body.dk-js{margin:0;background:#fff;overflow:hidden}body.dk-js #dk-workspace{position:static!important;display:block!important;padding:0!important}body.dk-js #dk-viewport{display:block!important;overflow:visible!important}body.dk-js #dk-document{display:block!important}body.dk-js .dk-page{zoom:1!important;margin:0!important;box-shadow:none!important}#dk-document .dk-page-inner>.slide{box-shadow:none!important}`;
const b = await open(1920, 1080);
const shots = [['orig', ORIG, CAPTURE_ORIG, 'go'], ['kit', built, CAPTURE_KIT, 'dkKit.go']];
for (const [tag, file, cap, go] of shots) {
  await b.nav(file);
  await b.ev(`(()=>{const s=document.createElement('style');s.className='dk-ui';s.textContent=${JSON.stringify(cap)};document.head.append(s);return 1})()`);
  for (let n = 0; n < 15; n++) {
    await b.ev(`${go}(${n});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    await b.shot(path.join(out, `${tag}_${String(n + 1).padStart(2, '0')}.png`), {x: 0, y: 0, width: 1920, height: 1080});
  }
}
await b.close();
console.log('captured');
