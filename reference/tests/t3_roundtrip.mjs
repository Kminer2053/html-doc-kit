// 시험 3: 고치지 않고 저장한 파일이 원본과 같은 화면인지 + 편집된 저장본의 다른 쪽이 그대로인지
import fs from 'node:fs';
import {open, CAPTURE_CSS} from './cdp.mjs';
const here = new URL('.', import.meta.url).pathname;
const EDIT = '/Users/hoonsbook/AX2030/outputs/AX2030_본부장회의_요약기반_15p_v6_편집용.html';
const b = await open(1920, 1080);
await b.nav(EDIT);
const clean = await b.ev('axEditor.cleanHtml()');
fs.writeFileSync(here + 'saved0.html', clean);
const built = fs.readFileSync(EDIT, 'utf-8');
console.log('고치지 않고 저장: 길이', clean.length, '빌드', built.length, '같음', clean === built);
if (clean !== built) {
  let i = 0;
  while (clean[i] === built[i]) i++;
  console.log('첫 차이', JSON.stringify(built.slice(i - 50, i + 90)), '\n  ↔', JSON.stringify(clean.slice(i - 50, i + 90)));
}
for (const [tag, file] of [['s0', here + 'saved0.html'], ['s1', here + 'saved1.html']]) {
  await b.nav(file);
  await b.ev(`(()=>{const s=document.createElement('style');s.className='ed-ui';s.textContent=${JSON.stringify(CAPTURE_CSS)};document.head.append(s);return 1})()`);
  for (let i = 0; i < 15; i++) {
    await b.ev(`go(${i});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    await b.shot(`${here}p_${tag}_${String(i + 1).padStart(2, '0')}.png`, {x: 0, y: 0, width: 1920, height: 1080});
  }
}
await b.close();
