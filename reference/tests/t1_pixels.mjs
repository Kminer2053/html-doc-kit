// 시험 1: 편집 켠 상태의 15장이 원본과 픽셀까지 같은지 + 편집 단위 목록
import fs from 'node:fs';
import {open, CAPTURE_CSS} from './cdp.mjs';
const here = new URL('.', import.meta.url).pathname;
const R = '/Users/hoonsbook/AX2030/outputs/';
const ORIG = R + 'AX2030_본부장회의_요약기반_15p_v6.html';
const EDIT = R + 'AX2030_본부장회의_요약기반_15p_v6_편집용.html';
const b = await open(1920, 1080);
for (const [tag, file] of [['orig', ORIG], ['edit', EDIT]]) {
  await b.nav(file);
  await b.ev(`(()=>{const s=document.createElement('style');s.className='ed-ui';s.textContent=${JSON.stringify(CAPTURE_CSS)};document.head.append(s);return 1})()`);
  for (let i = 0; i < 15; i++) {
    await b.ev(`go(${i});document.fonts.ready.then(()=>true)`);
    await b.ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await b.shot(`${here}p_${tag}_${String(i + 1).padStart(2, '0')}.png`, {x: 0, y: 0, width: 1920, height: 1080});
  }
  if (tag === 'edit') {
    const info = await b.ev(`(()=>{const out=[];sheets.forEach((s,i)=>{const hs=[...s.querySelectorAll('[data-ed]')];
      const big=hs.filter(h=>h.querySelector('div,p,table,ul,ol,section,figure,svg,h1,h2,h3,h4')).map(h=>h.tagName+'.'+h.className+' :: '+h.innerText.replace(/\\s+/g,' ').slice(0,70));
      // 고칠 수 없는 글자(편집 단위 밖)
      const w=document.createTreeWalker(s,NodeFilter.SHOW_TEXT);let miss=[];for(let n=w.nextNode();n;n=w.nextNode()){if(n.nodeValue.trim()&&!n.parentElement.closest('[data-ed],svg,style,script'))miss.push(n.nodeValue.trim().slice(0,40))}
      out.push({page:i+1,hosts:hs.length,big,miss})});return out})()`);
    fs.writeFileSync(here + 'hosts.json', JSON.stringify(info, null, 1));
    console.log(info.map((x) => `p${x.page} hosts=${x.hosts} big=${x.big.length} miss=${x.miss.length}`).join('\n'));
    console.log('big samples', JSON.stringify(info.flatMap((x) => x.big.map((y) => x.page + ': ' + y)).slice(0, 25), null, 1));
    console.log('status', await b.ev(`document.querySelector('#ed-status').textContent`), 'baseOver via overflow class', await b.ev(`document.querySelectorAll('.ed-over').length`));
  }
}
await b.close();
