// A4 복구, A5 왕복, A6 오작동 없음. 망가진 입력을 ensure에 넣어 check 통과와 본문 보존을 본다
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {findChrome} from '../src/cli/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '../skill/html-doc-kit/scripts/doc-kit.mjs');
const OUT = path.join(here, 'out', 'repair');
fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(OUT, {recursive: true});
let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' → ' + extra : ''}`);
};
const run = (...args) => spawnSync('node', [CLI, ...args], {encoding: 'utf-8'});
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/7yMK/gAAAABJRU5ErkJggg==';
const WORD = '본문보존확인';
const IMG = `<img src="${png}" alt="pic">`;
const plain = (head, body) => `<!doctype html><html><head><title>시험</title>${head}</head><body>${body}</body></html>`;
const BODY = `<h1>${WORD}</h1><p>문단 글자입니다.</p>${IMG}<table><tr><td>칸</td></tr></table>`;
const slides = (css) => plain(`<style>${css}</style>`, [1, 2, 3].map((n) => `<section class="slide${n === 1 ? ' active' : ''}"><h1>${WORD}${n}</h1><p>쪽 ${n}</p></section>`).join(''));
const cases = {
  '키트 없이 쓴 HTML': plain('', BODY),
  '자체 슬라이드 HTML': slides('.slide{display:none}.slide.active{display:block}') + `<script>let i=0;document.onkeydown=()=>{}</script>`,
  '자체 슬라이드 flex': slides('.slide{display:none;width:1280px;height:720px}.slide.active{display:flex;flex-direction:column}'),
  '전체 숨김 CSS': plain('<style>*{display:none}</style>', BODY),
  '.slide 숨김만': plain('<style>.slide{display:none}</style>', `<div class="slide"><h1>${WORD}</h1></div><div class="slide"><p>둘째</p></div>`),
  '투명 글자 CSS': plain('<style>body{color:transparent}h1,p,td{color:transparent!important}</style>', BODY),
  '투명도 0 CSS': plain('<style>body{opacity:0}</style>', BODY),
  '화면 덮기 CSS': plain('<style>body::before{content:"";position:fixed;inset:0;background:#000;z-index:99999}html,body{overflow:hidden;height:0}</style>', BODY),
  '스크립트·onload': plain('<script>document.title="x"</script><script src="https://cdn.example.com/a.js"></script>', `<div onclick="alert(1)">${WORD}</div><a href="javascript:alert(1)">링크</a><img src="${png}" onerror="alert(1)">`).replace('<body>', '<body onload="init()">'),
  '외부 글꼴·스타일': plain('<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Noto"><style>@import url("https://x.example/a.css");@font-face{font-family:Web;src:url(https://x.example/a.woff2)}h1{color:red;font-family:Web}</style>', BODY),
  '키트와 겹치는 id': plain('<style>#dk-document{display:none}#dk-edit{display:none}.dk-controls{display:none}</style>', `<div id="dk-document"><div id="dk-edit">${WORD}</div></div>`),
  'iframe·base·refresh': plain('<base href="https://x.example/"><meta http-equiv="refresh" content="0;url=https://x.example">', `<iframe src="https://x.example"></iframe><p>${WORD}</p>`),
  '잘린 HTML': plain('<style>h1{color:red', BODY).slice(0, 80 + WORD.length),
  '맨몸 글자': `${WORD} 그냥 글자만 있습니다`,
  '그림만': plain('', IMG),
  '차트 스크립트': plain('', `<h1>${WORD}</h1><canvas id="canvas"></canvas><script>new Chart(document.getElementById('canvas'))</script>`),
  'body 레이아웃 CSS': plain('<style>html,body{height:100%;margin:0;display:grid;place-items:center;font-family:Arial}</style>', BODY),
  '거대한 z-index 메뉴': plain('<style>nav{position:fixed;top:0;left:0;right:0;height:200px;background:red;z-index:2147483647}</style>', `<nav>메뉴</nav>${BODY}`),
};
for (const [name, src] of Object.entries(cases)) {
  const f = path.join(OUT, name.replace(/[^\w가-힣]/g, '_') + '.html');
  fs.writeFileSync(f, src);
  const r = run('ensure', f);
  const c = run('check', f);
  const after = fs.readFileSync(f, 'utf-8');
  const keep = !src.includes(WORD) || after.includes(WORD);
  const img = !src.includes(png) || name.includes('스크립트') || after.includes(png);
  ok(`A4 ${name}`, c.status === 0 && keep && img, c.status ? c.stdout.trim().split('\n').slice(-2).join(' ') : !keep ? '본문 사라짐' : !img ? '그림 사라짐' : '');
  const before = fs.readFileSync(f);
  run('ensure', f);
  ok(`A4 ${name}: 다시 돌려도 같음`, before.equals(fs.readFileSync(f)));
  if (r.status) console.log('   ', r.stderr.trim());
}

// 키트 파일이 망가진 경우
const base = path.join(OUT, 'base.html');
fs.writeFileSync(path.join(OUT, 'base.md'), `---\ntitle: 기준\ntype: slide\n---\n# ${WORD}\n본문\n\nNotes:\n메모보존\n\n---\n# 둘째\n둘째 쪽\n`);
run('build', path.join(OUT, 'base.md'), '-o', base);
ok('빌드 기준 파일 check', run('check', base).status === 0);
const kit = fs.readFileSync(base, 'utf-8');
const broken = {
  '코드 일부 삭제': kit.replace(/function resize\(\)/, 'function gone()'),
  '코드 태그 삭제': kit.replace(/<script id="dk-kit-code">[\s\S]*?<\/script>/, ''),
  '스타일 변경': kit.replace('.dk-controls{', '.dk-controls{display:none;'),
  '잘린 파일': kit.slice(0, kit.indexOf('</main>') + 200),
  '옛 버전 표식': kit.replace(/data-doc-kit="[^"]+"/, 'data-doc-kit="0.9.0"').replace(/content="1\.0\.0"/, 'content="0.9.0"'),
  '메모 자료 깨짐': kit.replace(/<script id="dk-book" type="application\/json">/, '<script id="dk-book" type="application/json">{broken'),
  '쪽 추가': kit.replace('</main>', `<section class="dk-page"><div class="dk-page-inner"><h1>추가쪽${WORD}</h1></div></section></main>`),
  '파일 끝 이어 쓰기': kit + `<section><h1>이어쓴쪽${WORD}</h1></section>`,
  '모델 스크립트 삽입': kit.replace('</h1>', '</h1><script>alert(1)</script>'),
};
for (const [name, src] of Object.entries(broken)) {
  const f = path.join(OUT, `kit_${name.replace(/\W/g, '_')}.html`);
  fs.writeFileSync(f, src);
  const before = run('check', f, '--no-browser').status;
  run('ensure', f);
  const c = run('check', f);
  const after = fs.readFileSync(f, 'utf-8');
  const notes = name === '메모 자료 깨짐' || name === '잘린 파일' ? true : after.includes('메모보존');
  ok(`A4 키트 파일 ${name}`, before !== 0 || name === '쪽 추가' || name === '파일 끝 이어 쓰기' ? c.status === 0 && after.includes(WORD) && notes : false, c.stdout.trim().split('\n').pop());
}
const added = fs.readFileSync(path.join(OUT, 'kit_쪽_추가.html'.replace(/\W/g, '_')).replace('kit_쪽_추가', 'kit_____') , {encoding: 'utf-8', flag: 'a+'});
void added;

// A5 왕복: extract → 고치기 → apply
const body = path.join(OUT, 'edit.body.html');
ok('extract', run('extract', base, '-o', body).status === 0);
const idBefore = /data-doc-id="([^"]+)"/.exec(kit)[1];
fs.writeFileSync(body, fs.readFileSync(body, 'utf-8').replace('둘째 쪽', '고친 둘째 쪽'));
ok('apply', run('apply', body, base).status === 0);
const applied = fs.readFileSync(base, 'utf-8');
ok('apply 뒤 내용·메모·문서 id 유지, 판 번호 증가', applied.includes('고친 둘째 쪽') && applied.includes('메모보존') && applied.includes(`data-doc-id="${idBefore}"`) && applied.includes('data-doc-rev="2"'));
ok('apply 뒤 check', run('check', base).status === 0);
fs.writeFileSync(path.join(OUT, 'old.html'), kit.replace(/data-doc-kit="[^"]+"/, 'data-doc-kit="0.9.0"'));
ok('upgrade', run('upgrade', path.join(OUT, 'old.html')).status === 0 && run('check', path.join(OUT, 'old.html')).status === 0);
fs.writeFileSync(path.join(OUT, 'new.html'), kit.replace(/data-doc-kit="[^"]+"/, 'data-doc-kit="99.0.0"'));
const newer = fs.readFileSync(path.join(OUT, 'new.html'));
run('ensure', path.join(OUT, 'new.html'));
ok('더 새 버전은 건드리지 않음', newer.equals(fs.readFileSync(path.join(OUT, 'new.html'))));
fs.writeFileSync(path.join(OUT, 'off.html'), plain('<meta name="doc-kit" content="off">', '<p>x</p>'));
const off = fs.readFileSync(path.join(OUT, 'off.html'));
run('ensure', path.join(OUT, 'off.html'));
const offCheck = run('check', path.join(OUT, 'off.html'));
ok('off 표식은 건드리지 않고 제외됨 보고', off.equals(fs.readFileSync(path.join(OUT, 'off.html'))) && offCheck.stdout.includes('제외됨'));

// 문서 형태와 그림 넣기
fs.writeFileSync(path.join(OUT, 'pic.png'), Buffer.from(png.split(',')[1], 'base64'));
fs.writeFileSync(path.join(OUT, 'form.md'), `# 그림 문서\n\n![그림](pic.png)\n\n![없는 그림](nope.png)\n`);
for (const type of ['a4', 'a4-landscape', 'auto', 'slide']) {
  const f = path.join(OUT, `form_${type}.html`);
  const r = run('build', path.join(OUT, 'form.md'), '-o', f, '--type', type);
  const s = fs.readFileSync(f, 'utf-8');
  ok(`형태 ${type}: 그림이 파일 안에, 없는 그림은 경고`, r.status === 0 && s.includes('data:image/png') && r.stdout.includes('nope.png') && run('check', f).status === 0, r.stderr);
}
fs.writeFileSync(path.join(OUT, 'custom.html'), plain('', '<section data-page data-w="1024" data-h="768"><h1>사대삼</h1></section><section data-page data-w="500" data-h="700"><h1>세로</h1></section>'));
run('ensure', path.join(OUT, 'custom.html'));
const cs = fs.readFileSync(path.join(OUT, 'custom.html'), 'utf-8');
ok('custom: 쪽마다 크기', cs.includes('--dk-w:1024px;--dk-h:768px') && cs.includes('--dk-w:500px;--dk-h:700px') && cs.includes('@page dk-500x700{size:500px 700px'));

// 입력 경계: 사용자 문서를 잃지 않고, 뷰어 없는 파일을 남기지 않는다
const EDGE = path.join(OUT, 'edge');
fs.mkdirSync(EDGE, {recursive: true});
const ef = (name) => path.join(EDGE, name);
const has = (f, word) => fs.readFileSync(f).includes(Buffer.from(word));
const backups = (name) => {
  const d = path.join(EDGE, '.doc-kit', 'backup');
  return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => n.startsWith(name + '.')) : [];
};
fs.writeFileSync(ef('pic.png'), Buffer.from(png.split(',')[1], 'base64'));
fs.writeFileSync(ef('매출100%.png'), Buffer.from(png.split(',')[1], 'base64'));
fs.mkdirSync(ef('d'), {recursive: true});

// 15·51: --- 만으로는 장표가 되지 않는다
const para = '문단 내용입니다. '.repeat(30);
fs.writeFileSync(ef('report.md'), `# 보고서\n\n${Array(25).fill(para).join('\n\n')}\n\n---\n\n# 둘째\n\n${Array(25).fill(para).join('\n\n')}\n`);
const rep1 = run('build', ef('report.md'), '-o', ef('report.html'));
const repHtml = fs.readFileSync(ef('report.html'), 'utf-8');
ok('15·51 type 없는 --- 마크다운은 auto 두 쪽, 완성', rep1.status === 0 && (repHtml.match(/data-dk-size="auto"/g) || []).length === 2 && !repHtml.includes('data-dk-size="slide"'), rep1.stdout + rep1.stderr);
fs.writeFileSync(ef('deck.md'), '---\ntype: slide\n---\n# 장표\n\n---\n# 둘째\n');
run('build', ef('deck.md'), '-o', ef('deck.html'));
ok('15·51 type: slide를 적으면 장표', fs.readFileSync(ef('deck.html'), 'utf-8').includes('data-dk-size="slide"'));

// 16·49: 이상한 경로 하나로 문서 전체가 실패하지 않는다
const oddRefs = {
  'img 퍼센트': '<img src="없음100%.png">',
  'img 질의만': '<img src="?v=1">',
  'img 폴더': '<img src="./">',
  'img 폴더2': '<img src="d">',
  'link 빈': '<link rel="stylesheet" href="">',
  'link 폴더': '<link rel="stylesheet" href="./">',
  'css url 폴더': '<style>h1{background:url(d)}</style>',
};
for (const [name, frag] of Object.entries(oddRefs)) {
  const f = ef(`odd_${name.replace(/\W/g, '_')}.html`);
  fs.writeFileSync(f, plain('', `<h1>${WORD}</h1>${frag}`));
  const r = run('ensure', f, '--no-browser');
  ok(`16·49 ${name}: ensure 성공, 키트 있음, 경고`, r.status === 0 && has(f, 'dk-kit-code') && has(f, WORD) && run('check', f, '--no-browser').status === 0 && (r.stdout.includes('경고') || name.startsWith('link')), r.stdout + r.stderr);
}
fs.writeFileSync(ef('pct.html'), plain('', `<h1>${WORD}</h1><img src="매출100%.png">`));
run('ensure', ef('pct.html'), '--no-browser');
ok('16·49 이름에 %가 든 실제 그림은 파일 안에 넣음', has(ef('pct.html'), 'data:image/png') && !has(ef('pct.html'), '매출100%.png'));
fs.writeFileSync(ef('idtext.html'), plain('', `<h1>${WORD}</h1><p>id=dk-document 라는 글자</p>`));
const idt = run('ensure', ef('idtext.html'), '--no-browser');
ok('16 본문 글자의 id=dk-document는 키트로 오인하지 않음', idt.status === 0 && has(ef('idtext.html'), 'id=dk-document 라는 글자') && run('check', ef('idtext.html'), '--no-browser').status === 0, idt.stderr);

// 30: CSS 배경과 SVG image
fs.writeFileSync(ef('bg.html'), plain('<style>.cover{background:url(pic.png)}.none{background:url(nope.png)}</style>', `<h1>${WORD}</h1><div style="background-image:url('pic.png')">칸</div><svg><image href="pic.png"/></svg><svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="pic.png"/></svg><svg><rect fill="url(#g)"/></svg>`));
const bg = run('ensure', ef('bg.html'), '--no-browser');
const bgs = fs.readFileSync(ef('bg.html'), 'utf-8');
ok('30 CSS·인라인·SVG 그림이 파일 안으로', !/url\(['"]?pic\.png|href="pic\.png"/.test(bgs) && (bgs.match(/data:image\/png/g) || []).length >= 4 && bgs.includes('url(#g)'), bgs.match(/.{30}pic\.png.{10}/)?.[0]);
ok('30 못 찾은 CSS 그림은 경고', bg.stdout.includes('nope.png'), bg.stdout);
fs.mkdirSync(ef('css'), {recursive: true});
fs.writeFileSync(ef('css/a.css'), '.x{background:url(../pic.png)}');
fs.writeFileSync(ef('linked.html'), plain('<link rel="stylesheet" href="css/a.css">', `<h1>${WORD}</h1>`));
run('ensure', ef('linked.html'), '--no-browser');
ok('30 스타일 파일의 url은 그 파일 기준으로 찾음', has(ef('linked.html'), 'data:image/png') && !has(ef('linked.html'), '../pic.png'));

// 31·38: 인코딩
const ASCII = (s) => Buffer.from(s, 'latin1');
const HAN = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]); // EUC-KR로 "한글"
fs.writeFileSync(ef('euc.html'), Buffer.concat([ASCII('<!doctype html><html><head><meta charset="euc-kr"><title>t</title></head><body><h1>'), HAN, ASCII('</h1></body></html>')]));
const euc = run('ensure', ef('euc.html'), '--no-browser');
ok('31·38 EUC-KR은 한글을 지켜 UTF-8로 입힘', euc.status === 0 && has(ef('euc.html'), '한글') && !has(ef('euc.html'), '�') && run('check', ef('euc.html'), '--no-browser').status === 0, euc.stderr);
fs.writeFileSync(ef('u16.html'), Buffer.from('﻿<!doctype html><title>t</title><h1>유니코드</h1>', 'utf16le'));
const u16 = run('ensure', ef('u16.html'), '--no-browser');
ok('31·38 UTF-16도 글자를 지킴', u16.status === 0 && has(ef('u16.html'), '유니코드'), u16.stderr);
const garbled = Buffer.concat([ASCII('<!doctype html><title>t</title><h1>'), HAN, ASCII('</h1>')]);
fs.writeFileSync(ef('nometa.html'), garbled);
const nm = run('ensure', ef('nometa.html'), '--no-browser');
ok('31·38 풀 수 없으면 덮어쓰지 않고 오류', nm.status === 2 && garbled.equals(fs.readFileSync(ef('nometa.html'))) && nm.stderr.includes('인코딩'), nm.stderr);
ok('31·38 check도 깨진 글자로 완성이라 하지 않음', run('check', ef('nometa.html'), '--no-browser').status === 2);

// 36: build가 있던 결과를 지키고 알린다
fs.writeFileSync(ef('n.md'), '# 첫판\n');
run('build', ef('n.md'), '-o', ef('n.html'));
fs.writeFileSync(ef('n.html'), fs.readFileSync(ef('n.html'), 'utf-8').replace('첫판', '사용자수정'));
fs.writeFileSync(ef('n.md'), '# 둘째판\n');
const b2 = run('build', ef('n.md'), '-o', ef('n.html'));
ok('36 다시 build하면 사용자 수정본을 백업하고 경고', backups('n.html').some((n) => fs.readFileSync(path.join(EDGE, '.doc-kit/backup', n), 'utf-8').includes('사용자수정')) && b2.stdout.includes('백업'), b2.stdout);
fs.writeFileSync(ef('notes.html'), '<h1>손으로쓴내용</h1>');
fs.writeFileSync(ef('notes.md'), '# 새글\n');
const b3 = run('build', ef('notes.md'), '-o', ef('notes.html'));
ok('36 손으로 쓴 HTML도 백업하고 경고', backups('notes.html').length === 1 && b3.stdout.includes('덮어썼습니다'), b3.stdout);

// 12·21·35: 사본
fs.writeFileSync(ef('dash.html'), plain('', `<h1>${WORD}</h1><script>x()</script>`));
const dashCopy = ef('dash_편집용.html');
run('ensure', ef('dash.html'), '-o', dashCopy, '--no-browser');
fs.writeFileSync(ef('dash.html'), plain('', `<h1>${WORD}판2</h1><script>x()</script>`));
const c2 = run('ensure', ef('dash.html'), '-o', dashCopy, '--no-browser');
ok('12·21·35 고치지 않은 사본은 백업 뒤 새로 만듦', has(dashCopy, `${WORD}판2`) && backups('dash_편집용.html').length === 1 && c2.stdout.includes('이전 판'), c2.stdout);
fs.writeFileSync(dashCopy, fs.readFileSync(dashCopy, 'utf-8').replace(`${WORD}판2`, '사용자가고친제목'));
const edited = fs.readFileSync(dashCopy);
fs.writeFileSync(ef('dash.html'), plain('', `<h1>${WORD}판3</h1><script>x()</script>`));
const c3 = run('ensure', ef('dash.html'), '-o', dashCopy, '--no-browser');
const second = ef('dash_편집용_2.html');
ok('12·21·35 고친 사본은 그대로 두고 새 이름으로 내고 알림', edited.equals(fs.readFileSync(dashCopy)) && has(second, `${WORD}판3`) && backups('dash_편집용.html').length === 2 && c3.stdout.includes('dash_편집용_2.html'), c3.stdout);
fs.writeFileSync(ef('dash.html'), plain('', `<h1>${WORD}판4</h1><script>x()</script>`));
run('ensure', ef('dash.html'), '-o', dashCopy, '--no-browser');
ok('12·21·35 새 이름 사본을 안 고쳤으면 그 이름을 다시 씀(이름이 늘지 않음)', has(second, `${WORD}판4`) && !fs.existsSync(ef('dash_편집용_3.html')) && edited.equals(fs.readFileSync(dashCopy)));

// 47: ensure는 마크다운을 쓰지 않는다
fs.writeFileSync(ef('m.md'), `# ${WORD}\n`);
const mdBefore = fs.readFileSync(ef('m.md'));
const em = run('ensure', ef('m.md'), '--no-browser');
ok('47 ensure는 .md를 그대로 두고 .html을 냄', em.status === 0 && mdBefore.equals(fs.readFileSync(ef('m.md'))) && has(ef('m.html'), WORD) && run('check', ef('m.html'), '--no-browser').status === 0, em.stdout);
const em2 = run('build', ef('m.md'), '-o', ef('m.md'));
ok('47 build도 입력 .md에 쓰지 않음', em2.status === 2 && mdBefore.equals(fs.readFileSync(ef('m.md'))));

// 5·28·32·48·22: extract·apply
fs.writeFileSync(ef('two.md'), '---\ntitle: 옛제목\n---\n# 옛제목\n첫 쪽\n\n---\n# 둘\n둘째 쪽\n');
run('build', ef('two.md'), '-o', ef('two.html'));
const twoBefore = fs.readFileSync(ef('two.html'));
const self = run('extract', ef('two.html'), '-o', ef('two.html'));
ok('5 extract 입력=출력 거부', self.status === 2 && twoBefore.equals(fs.readFileSync(ef('two.html'))), self.stderr);
ok('5 키트 파일이 아니면 extract 거부', run('extract', ef('notes.md')).status === 2);
const dflt = run('extract', ef('two.html'));
const twoBody = path.join(EDGE, '.doc-kit', 'two.body.html');
ok('5 -o가 없으면 .doc-kit/에 저장', dflt.status === 0 && dflt.stdout.includes(twoBody) && fs.existsSync(twoBody), dflt.stdout);
// 22: 제목 고치기
let tb = fs.readFileSync(twoBody, 'utf-8');
ok('22 제목에서 나온 쪽 제목은 data-title로 박지 않음', !tb.includes('data-title="옛제목"'));
fs.writeFileSync(twoBody, tb.replace(/>옛제목<\/h1>/, '>새제목</h1>'));
run('apply', twoBody, ef('two.html'));
const twoAfter = fs.readFileSync(ef('two.html'), 'utf-8');
const twoBook = JSON.parse(/<script id="dk-book"[^>]*>([\s\S]*?)<\/script>/.exec(twoAfter)[1]);
ok('22 h1을 고치면 쪽 제목과 문서 제목이 함께 바뀜', twoBook.pages[0].title === '새제목' && twoBook.title === '새제목' && twoAfter.includes('<title>새제목</title>'), JSON.stringify(twoBook.title));
// 48: 쪽이 줄면 경고와 rc=1
run('extract', ef('two.html'));
tb = fs.readFileSync(twoBody, 'utf-8');
const onePage = tb.slice(0, tb.lastIndexOf('<section'));
fs.writeFileSync(twoBody, onePage);
const sh = run('apply', twoBody, ef('two.html'));
ok('48 쪽이 줄면 경고·백업 경로·rc=1', sh.status === 1 && sh.stdout.includes('2쪽이 1쪽') && sh.stdout.includes('백업'), sh.stdout);
run('extract', ef('two.html'));
fs.writeFileSync(twoBody, fs.readFileSync(twoBody, 'utf-8') + '<section data-page><h1>다시</h1></section>');
run('apply', twoBody, ef('two.html'));
run('extract', ef('two.html'));
tb = fs.readFileSync(twoBody, 'utf-8');
fs.writeFileSync(twoBody, tb.slice(0, tb.lastIndexOf('<section')));
ok('48 --shrink로 알고 지우면 rc=0', run('apply', twoBody, ef('two.html'), '--shrink').status === 0);
const notKit = plain('', '<p>원문</p>');
fs.writeFileSync(ef('other.html'), notKit);
const ap = run('apply', twoBody, ef('other.html'));
ok('48 키트 파일이 아닌 대상에는 apply 거부', ap.status === 2 && fs.readFileSync(ef('other.html'), 'utf-8') === notKit, ap.stderr);
// 32: 큰 그림은 본문 파일 밖으로
const bigPng = Buffer.concat([Buffer.from(png.split(',')[1], 'base64'), Buffer.alloc(300000, 7)]);
fs.writeFileSync(ef('big.png'), bigPng);
fs.writeFileSync(ef('bigdoc.md'), '# 큰 그림\n\n![그림](big.png)\n\n![또](big.png)\n');
run('build', ef('bigdoc.md'), '-o', ef('bigdoc.html'));
const bigBody = path.join(EDGE, '.doc-kit', 'bigdoc.body.html');
run('extract', ef('bigdoc.html'));
const bb = fs.readFileSync(bigBody, 'utf-8');
ok('32 본문 파일에 큰 base64가 없음', bb.length < 20000 && bb.includes('dk-asset:0') && fs.existsSync(bigBody + '.assets.json'), String(bb.length));
fs.writeFileSync(bigBody, bb.replace('큰 그림', '고친 제목'));
const bigb64 = bigPng.toString('base64');
const ab = run('apply', bigBody, ef('bigdoc.html'));
const bigAfter = fs.readFileSync(ef('bigdoc.html'), 'utf-8');
ok('32 apply가 그림을 되돌림', ab.status === 0 && bigAfter.split(bigb64).length === 3 && bigAfter.includes('고친 제목') && !bigAfter.includes('dk-asset:'), ab.stdout + ab.stderr);
run('extract', ef('bigdoc.html'));
fs.rmSync(bigBody + '.assets.json');
const bigSaved = fs.readFileSync(ef('bigdoc.html'));
const ab2 = run('apply', bigBody, ef('bigdoc.html'));
ok('32 자리표시자를 못 풀면 덮어쓰지 않고 오류', ab2.status === 2 && bigSaved.equals(fs.readFileSync(ef('bigdoc.html'))) && ab2.stderr.includes('dk-asset'), ab2.stderr);
// .doc-kit 안 본문 파일에서 쓴 그림 경로는 문서 폴더 기준으로도 찾는다
run('extract', ef('two.html'));
fs.writeFileSync(twoBody, fs.readFileSync(twoBody, 'utf-8').replace('</h1>', '</h1><img src="pic.png">'));
run('apply', twoBody, ef('two.html'));
ok('5 .doc-kit 본문 파일의 그림 경로도 찾음', has(ef('two.html'), png.split(',')[1].slice(0, 30)));
// 58: 저장본의 그림 번호는 다시 만들 때 지운다
fs.writeFileSync(ef('imgno.html'), fs.readFileSync(ef('deck.html'), 'utf-8').replace('</h1>', `</h1><img data-dk-img="0" src="${png}"><img data-dk-img="0" src="${png}">`));
run('extract', ef('imgno.html'));
const inBody = fs.readFileSync(path.join(EDGE, '.doc-kit', 'imgno.body.html'), 'utf-8');
ok('58 본문 파일과 다시 만든 파일에 data-dk-img가 남지 않음', !inBody.includes('data-dk-img'));
// 28: 입력 HTML 기록
fs.writeFileSync(ef('body_in.html'), '<section data-page data-title="1장"><p>입력</p></section>');
run('build', ef('body_in.html'), '-o', ef('body_out.html'));
const inputs = JSON.parse(fs.readFileSync(path.join(EDGE, '.doc-kit', 'inputs.json'), 'utf-8'));
const chk = run('check', ef('body_in.html'));
ok('28 build 입력을 기록하고 check가 결과 파일을 알려 줌', inputs['body_in.html'] === path.resolve(ef('body_out.html')) && chk.stdout.includes('body_out.html'), chk.stdout);

// 3·29·23: 버전
const fake = plain('', `<h1>${WORD}</h1>`).replace('<html>', '<html data-doc-kit="99.0.0">');
fs.writeFileSync(ef('fake.html'), fake);
const fk = run('ensure', ef('fake.html'), '--no-browser');
ok('3 키트 없는 가짜 미래 표식은 실제로 입힘', fk.status === 0 && has(ef('fake.html'), 'dk-kit-code') && has(ef('fake.html'), WORD) && run('check', ef('fake.html'), '--no-browser').status === 0, fk.stdout);
const future = fs.readFileSync(ef('deck.html'), 'utf-8').replace(/data-doc-kit="[^"]+"/, 'data-doc-kit="99.0.0"');
fs.writeFileSync(ef('future.html'), future);
const fc = run('check', ef('future.html'));
ok('29 부품이 온전한 새 버전 파일은 check 완성·경고', fc.status === 0 && fc.stdout.includes('새것'), fc.stdout);
const uTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-up-'));
const newCli = path.join(uTmp, 'doc-kit.mjs');
const bundle = fs.readFileSync(CLI, 'utf-8');
ok('23 시험 번들 준비', /var VERSION = "1\.0\.0"/.test(bundle));
fs.writeFileSync(newCli, bundle.replace(/var VERSION = "1\.0\.0"/, 'var VERSION = "1.1.0"'));
const upf = ef('up.html');
fs.copyFileSync(ef('deck.html'), upf);
const upr = spawnSync('node', [newCli, 'upgrade', upf, '--no-browser'], {encoding: 'utf-8'});
ok('23 해시표에 있는 옛 버전도 upgrade로 바뀌고 백업됨', upr.status === 0 && fs.readFileSync(upf, 'utf-8').includes('data-doc-kit="1.1.0"') && backups('up.html').length === 1, upr.stdout + upr.stderr);

// 53: 문서 내용이 키트를 망가뜨리지 않는다
const hostile = {
  plaintext: `<h1>${WORD}</h1><plaintext>끝까지 글자`,
  'img name': `<h1>${WORD}</h1><img name="createElement" src="${png}">`,
  '예약 클래스': `<h1>${WORD}</h1><p class="dk-page">가짜 쪽</p><p class="dk-page-inner dk-ui keep">칸</p>`,
  'form name': `<h1>${WORD}</h1><form name="body"><input name="a"></form>`,
};
for (const [name, frag] of Object.entries(hostile)) {
  const f = ef(`host_${name.replace(/\W/g, '_')}.html`);
  fs.writeFileSync(f, plain('', frag));
  const r = run('ensure', f);
  const c = run('check', f);
  ok(`53 ${name}: 브라우저 시험까지 완성`, r.status === 0 && c.status === 0 && has(f, WORD), c.stdout + r.stderr);
}
const klass = fs.readFileSync(ef(`host_${'예약 클래스'.replace(/\W/g, '_')}.html`), 'utf-8');
ok('53 예약 클래스는 지우고 쪽은 하나, 사용자 클래스는 남김', klass.includes('<p>가짜 쪽</p>') && klass.includes('class="keep"') && /data-dk-size="auto"/.test(klass));
fs.writeFileSync(ef('kitform.html'), fs.readFileSync(ef('deck.html'), 'utf-8').replace('</h1>', '</h1><form name="body"></form>'));
const kf = run('check', ef('kitform.html'));
ok('53 완성 파일에 끼운 form name=body는 C6이 잡음', kf.status === 1, kf.stdout);
ok('53 ensure가 복구', run('ensure', ef('kitform.html')).status === 0 && run('check', ef('kitform.html')).status === 0);

// 2·17: 판정이 끝나면 프로세스도 바로 끝난다(45초 타이머가 남지 않는다)
{
  const f = ef('fast.html');
  fs.writeFileSync(f, plain('', `<h1>${WORD}</h1>`));
  run('ensure', f);
  const t0 = Date.now();
  const r = run('check', f, '--json');
  const secs = (Date.now() - t0) / 1000;
  ok('2·17 check가 타이머를 기다리지 않음', r.status === 0 && JSON.parse(r.stdout).c6.status === 'pass' && secs < 25, `${secs.toFixed(1)}초`);
}
// 11·14: 쪽 아래로 넘치면 경고만 하고, 스타일을 버리지 않으며, 완성이다
const paras = (n) => Array.from({length: n}, (_, i) => `문단 ${i} 내용입니다.`).join('\n\n');
for (const [name, type, n] of [['a4 문단 400개', 'a4', 400], ['a4 문단 60개', 'a4', 60], ['slide 문단 120개', 'slide', 120]]) {
  const f = ef(`long_${type}_${n}.md`);
  fs.writeFileSync(f, `---\ntype: ${type}\n---\n<style>h1{color:rgb(1,2,3)}</style>\n\n# ${WORD}\n\n${paras(n)}\n`);
  const out = f.replace(/\.md$/, '.html');
  const r = run('build', f, '-o', out);
  const c = run('check', out);
  ok(`11·14 ${name}: 경고와 함께 완성, 스타일 유지`, r.status === 0 && c.status === 0 && r.stdout.includes('넘습니다') && !r.stdout.includes('버리고') && has(out, 'rgb(1,2,3)'), r.stdout + r.stderr);
}
// 55: auto 쪽의 가로 넘침은 경고이고 스타일을 버리지 않는다
{
  const f = ef('wide.html');
  const row = (tag) => `<tr>${Array.from({length: 24}, (_, i) => `<${tag}>칸${i}내용</${tag}>`).join('')}</tr>`;
  fs.writeFileSync(f, plain('<style>td,th{white-space:nowrap;padding:20px;color:rgb(1,2,3)}</style>', `<h1>${WORD}</h1><table>${row('th')}${row('td')}</table>`));
  const r = run('ensure', f);
  ok('55 auto 쪽 가로 넘침: 경고, 스타일 유지, 완성', r.status === 0 && run('check', f).status === 0 && r.stdout.includes('쪽 폭을') && !r.stdout.includes('버리고') && has(f, 'rgb(1,2,3)'), r.stdout + r.stderr);
}
// 14: 왼쪽으로 사라진 글자는 넘침이 아니라 숨김이다
for (const [name, css, html] of [
  ['고정 쪽 왼쪽 이탈', 'h1,p{position:absolute;left:-9999px}', `<section class="slide"><h1>${WORD}</h1><p>쪽 글자</p></section>`],
  ['auto 쪽 왼쪽 이탈', 'h1,p{position:absolute;left:-9999px}', `<h1>${WORD}</h1><p>쪽 글자</p>`],
]) {
  const f = ef(`left_${name.replace(/\W/g, '_')}.html`);
  fs.writeFileSync(f, plain(`<style>${css}</style>`, html));
  const r = run('ensure', f);
  ok(`14 ${name}: 문서 스타일을 버려 복구`, r.status === 0 && r.stdout.includes('문서 스타일을 버리고') && !has(f, '-9999px') && has(f, WORD), r.stdout + r.stderr);
}
// 11: 인라인 스타일로 숨긴 글자도 복구되고, 문서 스타일은 남는다
{
  const f = ef('inline.html');
  fs.writeFileSync(f, plain('<style>h1{color:rgb(1,2,3)}</style>', `<h1 style="display:none">${WORD}</h1><p style="color:transparent">가려진 문단 글자</p>`));
  const r = run('ensure', f);
  ok('11 인라인 숨김: 인라인만 버리고 완성', r.status === 0 && run('check', f).status === 0 && r.stdout.includes('인라인 스타일을 버리고') && has(f, 'rgb(1,2,3)') && !has(f, 'display:none"'), r.stdout + r.stderr);
}
// 42·9: 응답 없는 그림 서버 때문에 스타일을 버리지 않는다. 띄운 뒤 끊기면 미완성으로 알리되 스타일은 둔다
{
  const server = net.createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const {port} = server.address();
  const doc = plain('<style>h1{font-size:80px}</style>', `<h1>${WORD}</h1><p>글</p><img src="http://127.0.0.1:${port}/slow.png">`);
  const slow = ef('slow.html');
  fs.writeFileSync(slow, doc);
  const r = run('ensure', slow);
  // 뷰어는 그림을 5초까지만 기다리므로 응답 없는 그림 서버가 있어도 완성된다
  ok('42 응답 없는 그림: 상한 뒤 완성되고 스타일 유지', r.status === 0 && r.stdout.includes('완성') && !r.stdout.includes('버리고') && has(slow, '80px'), r.stdout + r.stderr);
  const chrome = findChrome();
  const wrapper = ef('chrome-dies.sh');
  fs.writeFileSync(wrapper, `#!/bin/sh\n"${chrome}" "$@" &\np=$!\nsleep 2\nkill -9 $p\n`, {mode: 0o755});
  // 스크립트가 꺼진 브라우저에서는 준비 표시가 서지 않는다. 미실행으로 알리고 스타일을 둔다
  const noScript = ef('chrome-noscript.sh');
  fs.writeFileSync(noScript, `#!/bin/sh\nexec "${chrome}" --blink-settings=scriptEnabled=false "$@"\n`, {mode: 0o755});
  const never = ef('never.html');
  fs.writeFileSync(never, plain('<style>h1{font-size:80px}</style>', `<h1>${WORD}</h1><p>글</p>`));
  const n = spawnSync('node', [CLI, 'ensure', never], {encoding: 'utf-8', env: {...process.env, DOC_KIT_CHROME: noScript}});
  ok('42 준비 시간 초과: 미실행으로 알리고 스타일 유지', n.status === 0 && n.stdout.includes('미실행') && n.stdout.includes('준비 시간 초과') && !n.stdout.includes('버리고') && has(never, '80px'), n.stdout + n.stderr);
  const dies = ef('dies.html');
  fs.writeFileSync(dies, doc);
  const d = spawnSync('node', [CLI, 'ensure', dies], {encoding: 'utf-8', env: {...process.env, DOC_KIT_CHROME: wrapper}});
  ok('9 띄운 뒤 브라우저가 죽으면 fail, 스타일은 유지', d.status === 1 && d.stderr.includes('미완성') && !d.stdout.includes('버리고') && has(dies, '80px'), d.stdout + d.stderr);
  server.close();
  // 띄우기 실패만 미실행이다. 문서 탓이 아니므로 완성 판정은 C1~C5로 하고 스타일도 그대로 둔다
  const noStart = ef('chrome-no-start.sh');
  fs.writeFileSync(noStart, '#!/bin/sh\nexit 1\n', {mode: 0o755});
  const quiet = ef('nostart.html');
  fs.writeFileSync(quiet, doc);
  const q = spawnSync('node', [CLI, 'ensure', quiet], {encoding: 'utf-8', env: {...process.env, DOC_KIT_CHROME: noStart}});
  ok('9 브라우저를 못 띄우면 미실행, 스타일은 유지', q.status === 0 && q.stdout.includes('미실행') && !q.stdout.includes('버리고') && has(quiet, '80px'), q.stdout + q.stderr);
}
// 25: 브라우저 없이도 전체 숨김 CSS는 버린다. 인쇄 전용 규칙은 건드리지 않는다
{
  const f = ef('static.html');
  fs.writeFileSync(f, plain('<style>*{display:none}</style>', `<h1>${WORD}</h1>`));
  const r = run('ensure', f, '--no-browser');
  ok('25 --no-browser: 전체 숨김 CSS를 버림', r.status === 0 && r.stdout.includes('문서 스타일을 버리고') && !/<style id="dk-doc-style">[^<]*display:none/.test(fs.readFileSync(f, 'utf-8')), r.stdout);
  const g = ef('static_print.html');
  fs.writeFileSync(g, plain('<style>@media print{*{display:none}}h1{display:none}</style>', `<h1>${WORD}</h1><p>글</p>`));
  const s = run('ensure', g, '--no-browser');
  ok('25 --no-browser: 인쇄 규칙·일부 숨김은 유지', s.status === 0 && !s.stdout.includes('버리고') && has(g, '@media print'), s.stdout);
}
// 25: 보임 검사 강화. 실제로 안 보이면 스타일을 버린다
for (const [name, css, frag, gone] of [
  ['clip-path', 'body{clip-path:inset(100%)}', `<h1>${WORD}</h1><p>쪽 글자입니다</p>`, 'clip-path'],
  ['높이 0', 'h1,p{height:0;overflow:hidden}', `<h1>${WORD}</h1><p>쪽 글자입니다</p>`, 'overflow:hidden'],
  ['흰 바탕 흰 글자', '*{color:#fff!important;background:#fff!important}', `<h1>${WORD}</h1><p>쪽 글자입니다</p>`, '#fff!important'],
  ['그림만 숨김', 'img,svg,table{display:none}', IMG, 'img,'],
]) {
  const f = ef(`hide_${name.replace(/\W/g, '_')}.html`);
  fs.writeFileSync(f, plain(`<style>${css}</style>`, frag));
  const r = run('ensure', f);
  const style = /<style id="dk-doc-style">([\s\S]*?)<\/style>/.exec(fs.readFileSync(f, 'utf-8'))[1];
  ok(`25 ${name}: 문서 스타일을 버려 복구`, r.status === 0 && run('check', f).status === 0 && r.stdout.includes('문서 스타일을 버리고') && !style.includes(gone), r.stdout + r.stderr);
}
// 25: 멀쩡한 디자인을 숨김으로 오판하지 않는다
for (const [name, css, frag] of [
  ['어두운 겹 위의 흰 글자', '.bg{position:absolute;inset:0;background:#000}.t{position:relative;color:#fff}', `<div class="bg"></div><div class="t"><h1>${WORD}</h1><p>글자</p></div>`],
  ['::before 어두운 바탕', '.w{position:relative;color:#fff}.w::before{content:"";position:absolute;inset:0;background:#000;z-index:-1}', `<div class="w"><h1>${WORD}</h1></div>`],
  ['인쇄 전용 그림과 글', '.p{display:none}', `<h1>${WORD}</h1><p>글자</p><img class="p" src="${png}">`],
  ['넘치는 칸', '.box{height:100px;overflow:hidden}', `<div class="box"><h1>${WORD}</h1>${'<p>글자 내용</p>'.repeat(60)}</div>`],
  ['스크롤 칸', '.box{height:100px;overflow:auto}', `<div class="box">${'<p>글자 내용</p>'.repeat(60)}</div><h1>${WORD}</h1>`],
]) {
  const f = ef(`keep_${name.replace(/\W/g, '_')}.html`);
  fs.writeFileSync(f, plain(`<style>${css}</style>`, frag));
  const r = run('ensure', f);
  ok(`25 ${name}: 스타일 유지`, r.status === 0 && !r.stdout.includes('버리고') && has(f, css.slice(0, 4)), r.stdout + r.stderr);
}
// 8·24·52: 완성 파일을 직접 고친 경우. check가 잡고 ensure가 복구한다
const deckHtml = fs.readFileSync(ef('deck.html'), 'utf-8');
const docStyle = '<style id="dk-doc-style">';
const headEnd = '</head>';
const h1End = '</h1>';
for (const [name, change, code] of [
  ['8 추가 style로 단추 숨김', (s) => s.replace(headEnd, `<style>#dk-save{display:none!important}</style>${headEnd}`), 'C5'],
  ['8 dk-kit-style media=print', (s) => s.replace('<style id="dk-kit-style">', '<style id="dk-kit-style" media="print">'), 'C5'],
  ['8 dk-kit-code 중복', (s) => s.replace('<script id="dk-book"', '<script id="dk-kit-code">1</script><script id="dk-book"'), 'C3'],
  ['8 dk-book 중복', (s) => s.replace('<script id="dk-base"', '<script id="dk-book" type="application/json">{}</script><script id="dk-base"'), 'C3'],
  ['8·24 meta refresh', (s) => s.replace(headEnd, `<meta http-equiv="Refresh" content="1;url=https://example.com">${headEnd}`), 'C5'],
  ['24 본문 안 style의 @import', (s) => s.replace(h1End, `${h1End}<style>@import url(https://evil.example/a.css);</style>`), 'C5'],
  ['24 dk-doc-style의 @import', (s) => s.replace(docStyle, `${docStyle}@import url(https://evil.example/a.css);`), 'C4'],
  ['24 이스케이프한 @import', (s) => s.replace(docStyle, `${docStyle}@\\69mport url(https://evil.example/a.css);`), 'C4'],
  ['24 dk-doc-style의 외부 글꼴', (s) => s.replace(docStyle, `${docStyle}@font-face{font-family:W;src:url(https://evil.example/a.woff2)}`), 'C4'],
  ['24 form action', (s) => s.replace(h1End, `${h1End}<form action="javascript:alert(1)"></form>`), 'C5'],
  ['24 button formaction', (s) => s.replace(h1End, `${h1End}<button formaction="javascript:alert(1)">눌러</button>`), 'C5'],
  ['52 탭 문자 javascript:', (s) => s.replace(h1End, `${h1End}<a href="java\tscript:alert(1)">링크</a>`), 'C5'],
  ['52 앞쪽 제어 문자', (s) => s.replace(h1End, `${h1End}<a href="\u0001javascript:alert(1)">링크</a>`), 'C5'],
  ['52 SVG animate', (s) => s.replace(h1End, `${h1End}<svg><a><animate attributeName="href" to="javascript:alert(1)"/><text y="20">x</text></a></svg>`), 'C5'],
  ['52 SVG set', (s) => s.replace(h1End, `${h1End}<svg><a><set attributeName="href" to="java&#9;script:alert(1)"/><text y="20">x</text></a></svg>`), 'C5'],
  ['8 doc-style로 저장 숨김', (s) => s.replace(docStyle, `${docStyle}#dk-save{display:none!important}`), 'C6'],
  ['8 doc-style로 단추 투명', (s) => s.replace(docStyle, `${docStyle}button{opacity:0}`), 'C6'],
  ['24 doc-style로 다음 숨김', (s) => s.replace(docStyle, `${docStyle}#dk-next{visibility:hidden!important}`), 'C6'],
]) {
  const f = ef(`tamper_${name.replace(/\W/g, '_')}.html`);
  const changed = change(deckHtml);
  if (changed === deckHtml) ok(`${name}: 시험 자료`, false, '고칠 자리를 못 찾음');
  fs.writeFileSync(f, changed);
  const c = run('check', f);
  const e = run('ensure', f);
  const after = fs.readFileSync(f, 'utf-8');
  ok(`${name}: check 거부(${code}), ensure 복구`, c.status === 1 && c.stdout.includes(code) && e.status === 0 && run('check', f).status === 0 && after.includes('둘째') && !after.includes('evil.example') && !/alert\(1\)/.test(after), c.stdout + e.stdout + e.stderr);
}
// 직접 넣은 head 스타일은 복구 때 버리지 않고 옮긴다
{
  const f = ef('head_style.html');
  fs.writeFileSync(f, deckHtml.replace(headEnd, `<style>h1{color:rgb(4,5,6)}</style>${headEnd}`));
  const e = run('ensure', f);
  const style = /<style id="dk-doc-style">([\s\S]*?)<\/style>/.exec(fs.readFileSync(f, 'utf-8'))[1];
  ok('8 head에 넣은 style은 문서 스타일로 옮김', e.status === 0 && style.includes('rgb(4,5,6)') && run('check', f).status === 0, e.stdout);
}
// 강화 뒤에도 키트가 만든 파일, 브라우저 저장본, 더 새 버전 파일은 그대로 통과한다
ok('52 키트가 만든 파일은 통과', run('check', ef('deck.html')).status === 0);
{
  const f = ef('future.html');
  fs.writeFileSync(f, deckHtml.replace(/data-doc-kit="[^"]*"/, 'data-doc-kit="99.0.0"').replace(headEnd, `<style id="dk-new-part">a{}</style>${headEnd}`));
  ok('52 더 새 키트의 새 부품은 막지 않음', run('check', f).status === 0, run('check', f).stdout);
}

// A6 + 훅: 임시 홈과 임시 프로젝트
// 저장소 안의 test/out은 앱 폴더로 판정되므로 저장소 밖에서 시험한다
const HK = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-hook-'));
const home = path.join(HK, 'home');
const proj = path.join(HK, 'proj');
fs.mkdirSync(path.join(proj, 'docs'), {recursive: true});
const env = {...process.env, DOC_KIT_HOME: home};
const hook = (agent, event, input) => spawnSync('node', [CLI, 'hook', agent, event], {encoding: 'utf-8', env, input: JSON.stringify(input)});
const sid = {session_id: 'test', cwd: proj};
hook('claude', 'prompt', sid);
const report = path.join(proj, 'report.html');
fs.writeFileSync(report, plain('', `<h1>${WORD}</h1>`));
const scripted = path.join(proj, 'docs', 'index.html');
fs.writeFileSync(scripted, plain('', '<h1>문서 사이트</h1><script>start()</script>'));
fs.mkdirSync(path.join(proj, 'react', 'public'), {recursive: true});
fs.writeFileSync(path.join(proj, 'react', 'package.json'), JSON.stringify({dependencies: {react: '^19'}}));
const reactIndex = path.join(proj, 'react', 'public', 'index.html');
fs.writeFileSync(reactIndex, plain('', '<div id="root"></div>'));
const appIndex = path.join(proj, 'react', 'index.html');
fs.writeFileSync(appIndex, plain('', '<div id="root"></div>'));
fs.mkdirSync(path.join(proj, 'coverage'), {recursive: true});
const cov = path.join(proj, 'coverage', 'index.html');
fs.writeFileSync(cov, plain('', '<table></table>'));
const tmpl = path.join(proj, 'mail.html');
fs.writeFileSync(tmpl, plain('', '<p>{% if name %}이름{% endif %}</p>'));
const outside = path.join(HK, 'outside', 'desk.html');
fs.mkdirSync(path.dirname(outside), {recursive: true});
fs.writeFileSync(outside, plain('', `<h1>${WORD}</h1>`));
hook('claude', 'post', {...sid, tool_name: 'Bash', tool_input: {command: `echo hi > ${outside}`}});
const before = {react: fs.readFileSync(reactIndex, 'utf-8'), app: fs.readFileSync(appIndex, 'utf-8'), cov: fs.readFileSync(cov, 'utf-8'), tmpl: fs.readFileSync(tmpl, 'utf-8'), scripted: fs.readFileSync(scripted, 'utf-8')};
const st = hook('claude', 'stop', sid);
ok('훅: 표식 없는 새 HTML을 끝날 때 입힘', run('check', report).status === 0, st.stdout.slice(0, 100));
ok('훅: 입히기 전 원본 백업', fs.existsSync(path.join(proj, '.doc-kit', 'backup')) && fs.readdirSync(path.join(proj, '.doc-kit', 'backup')).some((n) => n.startsWith('report.html')));
ok('훅: 스크립트 있는 파일은 그대로 두고 사본', fs.readFileSync(scripted, 'utf-8') === before.scripted && run('check', path.join(proj, 'docs', 'index_편집용.html')).status === 0);
ok('훅: React public·앱 프로젝트 안 건드림', fs.readFileSync(reactIndex, 'utf-8') === before.react && fs.readFileSync(appIndex, 'utf-8') === before.app);
ok('훅: 시험 리포트 폴더 안 건드림', fs.readFileSync(cov, 'utf-8') === before.cov);
ok('훅: 템플릿 안 건드림', fs.readFileSync(tmpl, 'utf-8') === before.tmpl);
ok('훅: Bash로 작업 폴더 밖에 쓴 파일도 리디렉션으로 잡음', run('check', outside).status === 0);
ok('훅: 사용자에게 알림', st.stdout.includes('systemMessage') && st.stdout.includes('report.html'), st.stdout.slice(0, 120));
const again = fs.readFileSync(report);
hook('claude', 'prompt', sid);
const st2 = hook('claude', 'stop', sid);
ok('훅: 바뀐 게 없으면 조용히 그대로', again.equals(fs.readFileSync(report)) && !st2.stdout.includes('systemMessage'), st2.stdout);
const patch = hook('codex', 'prompt', {session_id: 'cx', cwd: proj});
void patch;
const cx = path.join(proj, 'cx.html');
fs.writeFileSync(cx, plain('', `<h1>${WORD}</h1>`));
hook('codex', 'post', {session_id: 'cx', cwd: proj, tool_name: 'apply_patch', tool_input: {command: '*** Begin Patch\n*** Add File: cx.html\n+x\n*** End Patch'}});
hook('codex', 'stop', {session_id: 'cx', cwd: proj});
ok('훅: Codex apply_patch', run('check', cx).status === 0);
hook('cursor', 'prompt', {conversation_id: 'cu', workspace_roots: [proj]});
const cu = path.join(proj, 'cu.html');
fs.writeFileSync(cu, plain('', `<h1>${WORD}</h1>`));
hook('cursor', 'post', {conversation_id: 'cu', workspace_roots: [proj], file_path: cu});
const cs2 = hook('cursor', 'stop', {conversation_id: 'cu', workspace_roots: [proj]});
ok('훅: Cursor', run('check', cu).status === 0 && !cs2.stdout.includes('followup'), cs2.stdout);
const bad = hook('claude', 'stop', {session_id: 'x', cwd: '/nonexistent/dir'});
ok('훅: 이상한 입력에도 작업을 막지 않음', bad.status === 0);

// 12·21·35: 훅이 사본의 사용자 수정을 지키고 알린다. 28: build 입력은 건드리지 않는다
const dcopy = path.join(proj, 'docs', 'index_편집용.html');
fs.writeFileSync(dcopy, fs.readFileSync(dcopy, 'utf-8').replace('문서 사이트', '사용자수정표시'));
const dcopyBefore = fs.readFileSync(dcopy);
hook('claude', 'prompt', sid);
fs.writeFileSync(scripted, plain('', '<h1>문서 사이트 판2</h1><script>start()</script>'));
hook('claude', 'post', {...sid, tool_name: 'Write', tool_input: {file_path: scripted}});
const stc = hook('claude', 'stop', sid);
const dnew = path.join(proj, 'docs', 'index_편집용_2.html');
ok('35 훅: 고친 사본을 덮어쓰지 않고 새 이름으로 내고 알림', dcopyBefore.equals(fs.readFileSync(dcopy)) && fs.existsSync(dnew) && fs.readFileSync(dnew, 'utf-8').includes('판2') && stc.stdout.includes('index_편집용_2.html') && stc.stdout.includes('사용자가 고친'), stc.stdout);
hook('claude', 'prompt', sid);
const inb = path.join(proj, 'in_body.html');
fs.writeFileSync(inb, '<section data-page data-title="1장"><p>조각</p></section>');
run('build', inb, '-o', path.join(proj, 'in_out.html'));
const inbBefore = fs.readFileSync(inb);
hook('claude', 'stop', sid);
ok('28 훅: build 입력 HTML은 2MB 파일로 바뀌지 않음', inbBefore.equals(fs.readFileSync(inb)));
hook('claude', 'prompt', sid);
const euch = path.join(proj, 'euc_hook.html');
fs.writeFileSync(euch, Buffer.concat([ASCII('<!doctype html><html><head><meta charset="euc-kr"><title>t</title></head><body><h1>'), HAN, ASCII('</h1></body></html>')]));
hook('claude', 'stop', sid);
ok('38 훅: EUC-KR도 한글을 지켜 입힘', fs.readFileSync(euch).includes(Buffer.from('한글')) && run('check', euch).status === 0);

// 설치·제거: 임시 홈에서 기존 설정 보존
const ih = path.join(OUT, 'ihome');
fs.mkdirSync(path.join(ih, '.claude'), {recursive: true});
fs.mkdirSync(path.join(ih, '.cursor'), {recursive: true});
fs.mkdirSync(path.join(ih, '.codex'), {recursive: true});
const keep = {hooks: {Stop: [{hooks: [{type: 'command', command: 'mine'}]}]}, theme: 'dark'};
fs.writeFileSync(path.join(ih, '.claude/settings.json'), JSON.stringify(keep));
fs.writeFileSync(path.join(ih, '.claude/CLAUDE.md'), '# 내 지침\n');
fs.writeFileSync(path.join(ih, '.cursor/hooks.json'), JSON.stringify({version: 1, hooks: {stop: [{command: 'mine'}]}}));
ok('설치', run('install', '--home', ih).status === 0);
run('install', '--home', ih);
const cl = JSON.parse(fs.readFileSync(path.join(ih, '.claude/settings.json'), 'utf-8'));
ok('설치: 기존 설정 보존, 두 번 설치해도 중복 없음', cl.theme === 'dark' && cl.hooks.Stop.length === 2 && JSON.stringify(cl.hooks.Stop).includes('mine') && cl.hooks.UserPromptSubmit.length === 1);
ok('설치: 스킬·지침 세 곳', ['.claude/skills/html-doc-kit/SKILL.md', '.agents/skills/html-doc-kit/SKILL.md', '.cursor/rules/html-doc-kit.mdc', '.codex/AGENTS.md'].every((x) => fs.existsSync(path.join(ih, x))) && fs.readFileSync(path.join(ih, '.claude/CLAUDE.md'), 'utf-8').includes('# 내 지침'));
// 13: Codex 미승인은 문제다. 세 훅이 모두 승인돼야 통과한다
{
  const d0 = run('doctor', '--home', ih);
  ok('13 doctor: Codex 미승인이면 rc=1', d0.status === 1 && d0.stdout.includes('문제  Codex 훅 승인 필요'), d0.stdout);
  const cfg = path.join(ih, '.codex/config.toml');
  const trust = (ev) => `[hooks.state."${ih}/.codex/hooks.json:${ev}:0:0"]\ntrusted_hash = "sha256:a"\n\n`;
  fs.writeFileSync(cfg, trust('stop'));
  const d1 = run('doctor', '--home', ih);
  ok('13 doctor: stop만 승인이면 아직 rc=1', d1.status === 1 && d1.stdout.includes('prompt, post'), d1.stdout);
  fs.writeFileSync(cfg, trust('user_prompt_submit') + trust('post_tool_use') + trust('stop'));
  const d2 = run('doctor', '--home', ih);
  ok('doctor', d2.status === 0, d2.stdout.split('\n').filter((l) => l.startsWith('문제')).join(' '));
  const h = path.join(ih, '.codex/hooks.json');
  const saved = fs.readFileSync(h);
  const cut = JSON.parse(saved);
  delete cut.hooks.PostToolUse;
  fs.writeFileSync(h, JSON.stringify(cut));
  const d3 = run('doctor', '--home', ih);
  ok('13 doctor: 훅 하나가 빠지면 문제', d3.status === 1 && d3.stdout.includes('없음: PostToolUse'), d3.stdout);
  fs.writeFileSync(h, saved);
}
run('uninstall', '--home', ih);
const cl2 = JSON.parse(fs.readFileSync(path.join(ih, '.claude/settings.json'), 'utf-8'));
ok('제거: 기존 설정만 남음', cl2.theme === 'dark' && JSON.stringify(cl2.hooks) === JSON.stringify(keep.hooks) && fs.readFileSync(path.join(ih, '.claude/CLAUDE.md'), 'utf-8').trim() === '# 내 지침' && !fs.existsSync(path.join(ih, '.claude/skills/html-doc-kit')));

// === 훅·설치 회귀. 대부분 브라우저 없이(C6 미실행) 빠르게 돈다
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-hook2-'));
  const hhome = path.join(root, 'home');
  const hasKit = (f) => fs.existsSync(f) && fs.readFileSync(f, 'latin1').includes('dk-kit-code');
  const size = (f) => fs.statSync(f).size;
  const noChrome = path.join(root, 'no-chrome.sh');
  fs.writeFileSync(noChrome, '', {mode: 0o644}); // 실행 권한이 없어 바로 실패한다(띄우기 실패 = 미실행)
  const fast = {...process.env, DOC_KIT_HOME: hhome, DOC_KIT_CHROME: noChrome};
  const hk = (agent, event, input, e = fast) => spawnSync('node', [CLI, 'hook', agent, event], {encoding: 'utf-8', env: e, input: JSON.stringify(input)});
  let n = 0;
  const session = () => {
    const dir = path.join(root, `p${++n}`);
    fs.mkdirSync(dir, {recursive: true});
    const id = {session_id: `s${n}`, cwd: dir};
    const put = (rel, text = plain('', `<h1>${WORD}</h1>`)) => {
      const f = path.join(dir, rel);
      fs.mkdirSync(path.dirname(f), {recursive: true});
      fs.writeFileSync(f, text);
      return f;
    };
    return {
      dir,
      put,
      prompt: () => hk('claude', 'prompt', id),
      write: (rel, text) => {
        const f = put(rel, text);
        hk('claude', 'post', {...id, tool_name: 'Write', tool_input: {file_path: f}});
        return f;
      },
      bash: (command) => hk('claude', 'post', {...id, tool_name: 'Bash', tool_input: {command}}),
      stop: () => hk('claude', 'stop', id).stdout,
    };
  };

  // 1: 끝날 때 훅이 돌지 못한 턴의 파일을 다음 끝날 때 복구한다
  {
    const s = session();
    s.prompt();
    const intr = s.write('intr.html');
    s.prompt();
    const out = s.stop();
    ok('1 중단된 턴의 파일을 다음 Stop에서 복구', hasKit(intr) && out.includes('intr.html'), out);
    const bg = s.put('bg.html');
    s.prompt();
    s.stop();
    ok('1 Stop 뒤에 쓴 파일도 다음 Stop에서 복구', hasKit(bg));
    const quiet = s.put('later.html');
    const before = fs.statSync(quiet).mtimeMs;
    s.prompt();
    const f = fs.readdirSync(path.join(hhome, '.doc-kit/state')).length;
    ok('1 prompt는 파일을 바꾸지 않음', before === fs.statSync(quiet).mtimeMs && f > 0);
    s.stop();
    const sf = fs.readdirSync(path.join(hhome, '.doc-kit/state')).map((x) => JSON.parse(fs.readFileSync(path.join(hhome, '.doc-kit/state', x), 'utf-8'))).find((x) => x.cwd === s.dir);
    const old = Date.now() - 13 * 3600 * 1000;
    const stale = {...sf, start: old};
    const stateName = fs.readdirSync(path.join(hhome, '.doc-kit/state')).find((x) => JSON.parse(fs.readFileSync(path.join(hhome, '.doc-kit/state', x), 'utf-8')).cwd === s.dir);
    fs.writeFileSync(path.join(hhome, '.doc-kit/state', stateName), JSON.stringify(stale));
    const oldHand = s.put('hand.html');
    fs.utimesSync(oldHand, new Date(old + 3600000), new Date(old + 3600000));
    s.prompt();
    s.stop();
    ok('1 12시간 넘은 세션은 그동안 바뀐 파일까지 쓸어 담지 않음', !hasKit(oldHand));
  }

  // 4·26: 템플릿 판정을 좁히고, 그래도 건너뛰면 알린다
  {
    const s = session();
    s.prompt();
    const py = s.put('py.html', plain('<style>body {{ margin:0 }}</style>', '<h1>보고서</h1>'));
    const blank = s.put('blank.html', plain('', '<p>{{회사명}} 귀하</p>'));
    const pct = s.put('lt.html', plain('', '<p>성장률 <% 기준</p>'));
    const jinja = s.write('jinja.html', plain('', '<p>{% if a %}글{% endif %}</p>'));
    const hbs = s.put('hbs.html', plain('', '<p>{{#if a}}글{{/if}}</p>'));
    const out = s.stop();
    ok('4 CSS의 {{와 빈칸 표시는 문서로 처리', hasKit(py) && hasKit(blank) && hasKit(pct), out);
    ok('4·26 템플릿 지시문은 건너뛰고 알림', !hasKit(jinja) && !hasKit(hbs) && out.includes('템플릿으로 보여') && out.includes('jinja.html'), out);
  }

  // 10·26: out, target, vendor는 앱 신호가 아니다. 제외는 이유를 알린다. 위쪽 package.json은 작업 폴더까지만 본다
  {
    const s = session();
    s.prompt();
    const a = s.write('out/report.html');
    const b = s.write('vendor/v.html');
    const c = s.write('target/t.html');
    const d = s.write('dist/x.html');
    const out = s.stop();
    ok('10 out, target, vendor는 입힘', hasKit(a) && hasKit(b) && hasKit(c), out);
    ok('10 앱 폴더에 도구로 쓴 파일은 제외 이유를 알림', !hasKit(d) && out.includes('제외:') && out.includes('dist'), out);
    const up = path.join(root, `up${n}`);
    fs.mkdirSync(path.join(up, 'a', 'b'), {recursive: true});
    fs.writeFileSync(path.join(up, 'package.json'), JSON.stringify({devDependencies: {vite: '^6'}}));
    const uid = {session_id: `up${n}`, cwd: path.join(up, 'a', 'b')};
    hk('claude', 'prompt', uid);
    const upf = path.join(up, 'a', 'b', 'up.html');
    fs.writeFileSync(upf, plain('', `<h1>${WORD}</h1>`));
    hk('claude', 'stop', uid);
    ok('10 .git이 없으면 작업 폴더 위의 package.json은 보지 않음', hasKit(upf));
    const s2 = session();
    s2.prompt();
    const many = Array.from({length: 12}, (_, i) => s2.write(`dist/d${i}.html`));
    const o2 = s2.stop();
    ok('10 제외 알림 줄 수 상한', many.every((f) => !hasKit(f)) && o2.includes('그 밖에 넣지 않은 파일 4개'), o2.slice(0, 200));
  }

  // 5: 본문 파일 면제는 .doc-kit 안만
  {
    const s = session();
    const body = '<!-- html-doc-kit 본문 파일: 고친 뒤 apply 하세요 -->\n<section data-page><p>본문</p></section>';
    s.prompt();
    const inside = s.write('.doc-kit/r.body.html', body);
    const final = s.write('최종.html', body);
    const out = s.stop();
    ok('5 .doc-kit 안의 본문 파일은 그대로', fs.readFileSync(inside, 'utf-8') === body);
    ok('5 그 밖의 본문 파일은 입히지 않고 apply 필요를 알림', fs.readFileSync(final, 'utf-8') === body && out.includes('apply가 필요합니다') && out.includes('최종.html'), out);
    const kitDoc = s.put('r.html', plain('', '<h1>x</h1>'));
    run('ensure', '--no-browser', kitDoc);
    s.prompt();
    run('extract', kitDoc);
    const bodyFile = path.join(s.dir, '.doc-kit', 'r.body.html');
    hk('claude', 'post', {session_id: `s${n}`, cwd: s.dir, tool_name: 'Edit', tool_input: {file_path: bodyFile}});
    const o2 = s.stop();
    ok('5 본문을 고치고 apply를 잊으면 알림', o2.includes('apply가 필요합니다'), o2);
  }

  // 6: 흔한 셸 경로
  {
    const s = session();
    const away = path.join(root, `away${n}`);
    const desk = path.join(hhome, 'Desktop');
    fs.mkdirSync(away, {recursive: true});
    fs.mkdirSync(desk, {recursive: true});
    const body = plain('', `<h1>${WORD}</h1>`);
    const q = (p) => `"${p}"`;
    s.prompt();
    const spaced = path.join(away, '내 보고서.html');
    fs.writeFileSync(spaced, body);
    s.bash(`echo hi > ${q(spaced)}`);
    const viaHome = path.join(desk, 'b.html');
    fs.writeFileSync(viaHome, body);
    s.bash('cat > $HOME/Desktop/b.html <<EOF\n<p>a > 무시.html</p>\nEOF');
    const viaBrace = path.join(hhome, 'b2.html');
    fs.writeFileSync(viaBrace, body);
    s.bash('echo hi > "${HOME}/b2.html"');
    const viaCd = path.join(away, 'c.html');
    fs.writeFileSync(viaCd, body);
    s.bash(`cd ${q(away)} && echo hi > c.html`);
    const viaCpDir = path.join(away, 'd.html');
    fs.writeFileSync(viaCpDir, body);
    s.bash(`cp src.html ${q(away)}/`);
    fs.writeFileSync(path.join(away, 'src.html'), body);
    s.bash(`cp /tmp/none.html ${q(path.join(away, 'cp.html'))}`);
    fs.writeFileSync(path.join(away, 'cp.html'), body);
    const moved = s.write('w.html');
    const movedTo = path.join(away, 'w2.html');
    fs.renameSync(moved, movedTo);
    s.bash(`mv ${q(moved)} ${q(movedTo)}`);
    const oldTime = new Date(Date.now() - 86400000);
    const oldFile = path.join(away, 'old_src.html');
    fs.writeFileSync(oldFile, body);
    fs.utimesSync(oldFile, oldTime, oldTime);
    const oldTo = path.join(s.dir, 'old.html');
    fs.renameSync(oldFile, oldTo);
    s.bash(`mv ${q(oldFile)} ${q(oldTo)}`);
    const out = s.stop();
    ok('6 따옴표·공백 경로', hasKit(spaced), out);
    ok('6 $HOME, ${HOME}, 여기 문서', hasKit(viaHome) && hasKit(viaBrace) && !out.includes('무시.html'), out);
    ok('6 같은 명령의 cd', hasKit(viaCd));
    ok('6 cp 대상 파일', hasKit(path.join(away, 'cp.html')));
    ok('6 cp 대상 폴더는 파일명을 붙임', hasKit(path.join(away, 'src.html')));
    ok('6 mv로 옮긴 파일은 새 위치에서 입히고 옛 경로는 알리지 않음', hasKit(movedTo) && !out.includes('찾지 못했습니다'), out);
    ok('6 옛 수정 시각으로 옮겨 온 파일', hasKit(oldTo));
    void viaCpDir;

    const s2 = session();
    s2.prompt();
    const py = path.join(desk, 'gen.html');
    s2.bash('python3 gen.py');
    fs.writeFileSync(py, body);
    const dl = path.join(hhome, 'Downloads', 'dl.html');
    fs.mkdirSync(path.dirname(dl), {recursive: true});
    fs.writeFileSync(dl, body);
    const deep = path.join(desk, 'deep', 'x.html');
    fs.mkdirSync(path.dirname(deep), {recursive: true});
    fs.writeFileSync(deep, body);
    s2.stop();
    ok('6 스크립트 실행이 있으면 바탕화면·다운로드를 얕게 훑음', hasKit(py) && hasKit(dl) && !hasKit(deep));

    const s3 = session();
    s3.prompt();
    const untouched = path.join(desk, 'quiet.html');
    fs.writeFileSync(untouched, body);
    s3.bash('ls -la');
    s3.stop();
    ok('6 HTML도 스크립트도 없는 Bash면 바탕화면을 보지 않음', !hasKit(untouched));

    const s4 = session();
    s4.prompt();
    const gone = s4.write('gone.html');
    fs.rmSync(gone);
    s4.bash('echo x > "$OUT/a.html"');
    const o4 = s4.stop();
    ok('6 사라진 파일과 위치 미상 쓰기를 알림', o4.includes('찾지 못했습니다') && o4.includes('gone.html') && o4.includes('위치를 찾지 못한') && o4.includes('$OUT/a.html'), o4);
    s4.prompt();
    const rm = s4.write('tmp.html');
    fs.rmSync(rm);
    s4.bash(`rm -f ${q(rm)}`);
    const o5 = s4.stop();
    ok('6 rm으로 지운 파일은 알리지 않음', !o5.includes('tmp.html'), o5);
  }

  // 7·20·9·19·43: 알림. 사본 규칙은 유지한다
  {
    const cur = path.join(root, `cur${n}`);
    fs.mkdirSync(cur, {recursive: true});
    const cid = {conversation_id: `cu${n}`, workspace_roots: [cur]};
    hk('cursor', 'prompt', cid);
    const dash = path.join(cur, 'dash.html');
    fs.writeFileSync(dash, plain('', '<h1>차트</h1><canvas></canvas><script>draw()</script>'));
    const offf = path.join(cur, 'off.html');
    fs.writeFileSync(offf, plain('<meta name="doc-kit" content="off">', '<p>끔</p>'));
    const c = hk('cursor', 'stop', cid).stdout;
    ok('7 사본 규칙은 그대로', !hasKit(dash) && hasKit(path.join(cur, 'dash_편집용.html')));
    ok('7·20 Cursor도 사본·제외·미실행·경고를 알림', c.includes('followup_message') && c.includes('dash_편집용.html') && c.includes('off.html') && c.includes('미실행') && c.includes('경고'), c);

    const s = session();
    s.prompt();
    const nopic = s.write('nopic.html', plain('', '<h1>글</h1><img src="없는그림.png">'));
    const hid = s.write('hid.html', plain('<style>#dk-edit{display:none}</style>', '<h1>글</h1>'));
    const out = s.stop();
    ok('9 브라우저 시험 미실행을 파일마다 알림', out.includes('브라우저 시험 미실행') && out.includes('nopic.html') && out.includes('hid.html'), out);
    ok('19 W1 경고를 훅에서 전달', out.includes('없는그림.png') && out.includes('경고(nopic.html)'), out);
    ok('43 백업 경로를 알림', /원본: [^"\\]*\.doc-kit\/backup\/nopic\.html\.\d+/.test(out), out);

    const s2 = session();
    s2.prompt();
    const kinds = {
      onclick: plain('', '<button onclick="go()">눌러</button>'),
      frame: plain('', '<h1>글</h1><iframe src="https://example.com"></iframe>'),
      obj: plain('', '<h1>글</h1><object data="a.pdf"></object>'),
      emb: plain('', '<h1>글</h1><embed src="a.swf">'),
      comment: plain('', '<h1>글</h1><!-- <script>옛코드()</script> --><p>&lt;script&gt;는 글자</p>'),
    };
    const files = Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, s2.write(`${k}.html`, v)]));
    const o2 = s2.stop();
    ok('43 on*, iframe, object, embed는 제자리 대신 사본', ['onclick', 'frame', 'obj', 'emb'].every((k) => !hasKit(files[k]) && hasKit(path.join(s2.dir, `${k}_편집용.html`))), o2);
    ok('43 주석·글자 속 script는 스크립트가 아님', hasKit(files.comment));

    const s3 = session();
    s3.prompt();
    const dropped = s3.write('drop.html', plain('<style>*{display:none}</style>', '<h1>글</h1>'));
    const o3 = s3.stop();
    ok('42 CSS를 버리면 훅에서도 알림', hasKit(dropped) && o3.includes('버리고'), o3);
  }

  // 27·41·40: 스캔 범위
  {
    const s = session();
    s.prompt();
    const lib = s.put('Library/Application Support/App/page.html');
    const dot = s.put('.cache/x/c.html');
    const vsc = s.put('.vscode/extensions/w.html');
    const app = s.put('AppData/Local/a.html');
    const bld = s.put('_build/html/index.html');
    const site = s.put('site/index.html');
    const real = s.put('note.html');
    s.stop();
    ok('27·41 점 폴더, Library, AppData, _build, site는 스캔하지 않음', [lib, dot, vsc, app, bld, site].every((f) => !hasKit(f)) && hasKit(real));

    // 작업 폴더가 홈이면 스캔을 끄고 도구로 쓴 파일만 본다
    const homeId = {session_id: `home${n}`, cwd: hhome};
    hk('claude', 'prompt', homeId);
    const stray = path.join(hhome, 'stray.html');
    fs.writeFileSync(stray, plain('', '<p>다른 앱</p>'));
    const named = path.join(hhome, 'named.html');
    fs.writeFileSync(named, plain('', '<p>도구</p>'));
    hk('claude', 'post', {...homeId, tool_name: 'Write', tool_input: {file_path: named}});
    hk('claude', 'stop', homeId);
    ok('41 작업 폴더가 홈이면 스캔 없이 도구로 쓴 파일만', !hasKit(stray) && hasKit(named));
    const rootId = {session_id: `root${n}`, cwd: '/'};
    hk('claude', 'prompt', rootId);
    const r = hk('claude', 'stop', rootId);
    ok('41 작업 폴더가 루트면 스캔 없음', r.status === 0 && r.stdout.trim() === '{}', r.stdout);

    // git에서 HEAD와 같은 파일은 건너뛴다
    const g = session();
    const git = (...a) => spawnSync('git', ['-C', g.dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], {encoding: 'utf-8'});
    git('init', '-q');
    g.put('docs/d1.html', plain('', '<p>주</p>'));
    g.put('.gitignore', 'ignored/\n');
    git('add', '.');
    git('commit', '-qm', '1');
    git('checkout', '-qb', 'f');
    const d1 = g.put('docs/d1.html', plain('', '<p>가지</p>'));
    git('add', '.');
    git('commit', '-qm', '2');
    git('checkout', '-q', '-');
    g.prompt();
    git('checkout', '-q', 'f');
    const fresh = g.put('new.html');
    const ign = g.put('ignored/i.html');
    const gout = g.stop();
    ok('40 git checkout으로 바뀐 파일은 입히지 않음', !hasKit(d1) && git('status', '--porcelain', '--', 'docs').stdout === '', gout);
    ok('40 git에 없는 새 파일은 입힘', hasKit(fresh));
    ok('40 git이 무시하는 파일은 건너뛰고 알림', !hasKit(ign) && gout.includes('git이 무시'), gout);

    const m = session();
    m.prompt();
    const six = Array.from({length: 6}, (_, i) => m.put(`r${i}.html`));
    const named2 = m.write('named.html');
    const mout = m.stop();
    ok('40 스캔으로만 찾은 파일이 5개를 넘으면 입히지 않고 목록만 알림', six.every((f) => !hasKit(f)) && mout.includes('6개') && mout.includes('r0.html'), mout);
    ok('40 도구로 쓴 파일은 상한과 무관하게 입힘', hasKit(named2));
    const five = session();
    five.prompt();
    const fv = Array.from({length: 5}, (_, i) => five.put(`r${i}.html`));
    five.stop();
    ok('40 5개까지는 입힘', fv.every(hasKit));
  }

  // 39: 웹 신호
  {
    for (const dep of ['express', 'koa', 'fastify', 'hono', 'preact', 'lit', '@sveltejs/kit', '@11ty/eleventy', 'tailwindcss']) {
      const s = session();
      s.put('package.json', JSON.stringify({dependencies: {[dep]: '1'}}));
      s.prompt();
      const f = s.write('index.html');
      const out = s.stop();
      ok(`39 의존성 ${dep}`, !hasKit(f) && out.includes(dep), out);
    }
    for (const conf of ['vite.config.mts', 'next.config.cjs', 'astro.config.ts', 'webpack.config.cjs', 'svelte.config.mjs']) {
      const s = session();
      s.put(conf, '');
      s.prompt();
      const f = s.put('index.html');
      s.stop();
      ok(`39 설정 ${conf}`, !hasKit(f));
    }
    const s = session();
    s.prompt();
    const fs5 = ['static/about.html', 'views/error.html', 'templates/t.html', 'partials/header.html', 'emails/welcome.html'].map((r) => s.write(r, '<div>조각</div>'));
    s.stop();
    ok('39 static, views, templates, partials, emails 제외', fs5.every((f) => !hasKit(f)));
    for (const marker of ['go.mod', 'pyproject.toml', 'composer.json', 'conf.py']) {
      const a = session();
      a.put(marker, '');
      a.prompt();
      const f = a.write('index.html');
      const before = fs.readFileSync(f);
      const out = a.stop();
      ok(`39 애매한 신호 ${marker}는 사본`, before.equals(fs.readFileSync(f)) && hasKit(path.join(a.dir, 'index_편집용.html')) && out.includes(marker), out);
    }
    const plainPkg = session();
    plainPkg.put('package.json', JSON.stringify({dependencies: {lodash: '1'}}));
    plainPkg.prompt();
    const pf = plainPkg.write('report.html');
    plainPkg.stop();
    ok('39 웹과 무관한 package.json은 문서로 처리', hasKit(pf));
  }

  // 50: 제외 표기
  {
    const s = session();
    s.put('.doc-kit.json', JSON.stringify({exclude: ['*.skip.html', 'out2/**', 'drafts/', 'exact/a.html', 'sub/*/x.html']}));
    s.prompt();
    const names = ['a.skip.html', 'deep/b.skip.html', 'out2/b.html', 'out2/c/d.html', 'drafts/e.html', 'exact/a.html', 'sub/k/x.html'];
    const ex = names.map((r) => s.write(r));
    const inc = ['a.html', 'out22/b.html', 'exact/b.html', 'sub/k/l/x.html'].map((r) => s.write(r));
    const off = s.write('c.html', plain('<meta content="off" name="doc-kit">', '<p>끔</p>'));
    const off2 = s.write('c2.html', plain("<meta content=OFF name='DOC-KIT'>", '<p>끔</p>'));
    const notOff = s.write('c3.html', plain('<!-- <meta name="doc-kit" content="off"> -->', '<p>주석</p>'));
    const out = s.stop();
    ok('50 exclude 글롭', ex.every((f) => !hasKit(f)), ex.filter(hasKit).join());
    ok('50 exclude에 안 맞는 파일은 입힘', inc.every(hasKit), inc.filter((f) => !hasKit(f)).join());
    ok('50 제외 표식은 속성 순서·대소문자 무관, 주석은 표식 아님', !hasKit(off) && !hasKit(off2) && hasKit(notOff) && out.includes('c.html'), out);
    ok('50 check도 제외로 판정', run('check', off).stdout.includes('제외됨'));
  }

  // 28: 입력 파일
  {
    const s = session();
    s.prompt();
    const inb = s.write('body.html', '<section data-page data-title="1장"><p>조각</p></section>');
    const outp = path.join(s.dir, 'result.html');
    spawnSync('node', [CLI, 'build', inb, '-o', outp, '--no-browser'], {encoding: 'utf-8'});
    const size0 = size(inb);
    const o1 = s.stop();
    ok('28 build 입력은 입히지 않음', size(inb) === size0 && !o1.includes('body.html에'), o1);
    s.prompt();
    fs.writeFileSync(inb, '<section data-page data-title="1장"><p>조각 고침</p></section>');
    fs.utimesSync(inb, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
    const o2 = s.stop();
    ok('28 입력만 고치고 다시 만들지 않으면 알림', o2.includes('반영하지 않았습니다'), o2);
  }

  // 처리 시간이 모자라면 남은 파일을 다음 Stop으로 넘긴다
  {
    const s = session();
    s.prompt();
    const a = s.write('a1.html');
    const b = s.write('a2.html');
    const id = {session_id: `s${n}`, cwd: s.dir};
    const o = hk('claude', 'stop', id, {...fast, DOC_KIT_HOOK_BUDGET_MS: '1'}).stdout;
    const first = [a, b].filter(hasKit).length;
    s.prompt();
    s.stop();
    ok('시간이 모자란 파일은 다음 Stop에서 처리', first < 2 && o.includes('다음 턴') && hasKit(a) && hasKit(b), o);
  }

  // 44·46·34·45: 설치
  {
    const ih2 = path.join(root, 'ihome2');
    const ctl = (...a) => spawnSync('node', [CLI, ...a, '--home', ih2], {encoding: 'utf-8'});
    fs.mkdirSync(path.join(ih2, '.claude'), {recursive: true});
    const mixedCmd = `"${process.execPath}" "${ih2}/.doc-kit/bin/doc-kit.mjs" hook claude stop`;
    const userCheck = 'node ~/.doc-kit/bin/doc-kit.mjs check x.html';
    fs.writeFileSync(path.join(ih2, '.claude/settings.json'), JSON.stringify({hooks: {Stop: [{hooks: [{type: 'command', command: 'say done'}, {type: 'command', command: mixedCmd}]}, {hooks: [{type: 'command', command: userCheck}]}]}}));
    ok('44 설치', ctl('install').status === 0);
    const read = (f) => fs.readFileSync(path.join(ih2, f), 'utf-8');
    const stopHooks = () => JSON.stringify(JSON.parse(read('.claude/settings.json')).hooks?.Stop || []);
    ok('44 같은 그룹의 사용자 훅과 check 명령은 남고 키트 훅은 하나', stopHooks().includes('say done') && stopHooks().includes('check x.html') && stopHooks().split('hook claude stop').length === 2, stopHooks());
    const conf = path.join(ih2, '.claude/settings.json');
    const addMine = JSON.parse(read('.claude/settings.json'));
    addMine.theme = 'dark';
    fs.writeFileSync(conf, JSON.stringify(addMine));
    ctl('install');
    const baks = fs.readdirSync(path.join(ih2, '.claude')).filter((x) => x.startsWith('settings.json.doc-kit-bak'));
    ok('44 고칠 때마다 시각을 붙인 백업', baks.length >= 2 && baks.includes('settings.json.doc-kit-bak'), baks.join());
    const countBefore = fs.readdirSync(path.join(ih2, '.codex')).filter((x) => x.includes('doc-kit-bak')).length;
    ctl('install');
    ok('44 바뀐 것이 없으면 백업을 늘리지 않음', fs.readdirSync(path.join(ih2, '.codex')).filter((x) => x.includes('doc-kit-bak')).length === countBefore);

    // 34·45: 설치된 위치에서 다시 install
    const installedCli = path.join(ih2, '.claude/skills/html-doc-kit/scripts/doc-kit.mjs');
    const re = spawnSync('node', [installedCli, 'install', '--home', ih2], {encoding: 'utf-8'});
    ok('34 설치된 스킬 폴더에서 다시 설치해도 스킬이 남음', re.status === 0 && fs.existsSync(installedCli) && fs.existsSync(path.join(ih2, '.claude/skills/html-doc-kit/SKILL.md')), re.stderr);
    const agentsCli = path.join(ih2, '.agents/skills/html-doc-kit/scripts/doc-kit.mjs');
    const re2 = spawnSync('node', [agentsCli, 'install', '--home', ih2], {encoding: 'utf-8'});
    ok('45 다른 쪽 스킬 폴더에서 돌려도 남음', re2.status === 0 && fs.existsSync(agentsCli) && fs.existsSync(installedCli), re2.stderr);
    const binCli = path.join(ih2, '.doc-kit/bin/doc-kit.mjs');
    const re3 = spawnSync('node', [binCli, 'install', '--home', ih2], {encoding: 'utf-8'});
    ok('45 설치된 실행 파일에서 돌려도 남음', re3.status === 0 && fs.existsSync(binCli) && fs.existsSync(installedCli), re3.stderr);

    // 46: 고른 에이전트만 제거
    const bad = ctl('uninstall', '--agents', 'foo');
    ok('46 모르는 에이전트는 거부하고 아무것도 지우지 않음', bad.status === 2 && fs.existsSync(installedCli), bad.stderr);
    const u = ctl('uninstall', '--agents', 'cursor');
    ok('46 cursor만 제거', u.status === 0 && u.stdout.includes('Cursor') && !u.stdout.includes('Codex') && !read('.cursor/hooks.json').includes('doc-kit.mjs') && !fs.existsSync(path.join(ih2, '.cursor/rules/html-doc-kit.mdc')), u.stdout + u.stderr);
    ok('46 나머지는 남음', read('.claude/settings.json').includes('hook claude stop') && read('.codex/hooks.json').includes('hook codex stop') && read('.claude/CLAUDE.md').includes('html-doc-kit') && fs.existsSync(binCli) && fs.existsSync(agentsCli) && fs.existsSync(installedCli));
    ctl('uninstall', '--agents', 'codex');
    ok('46 공유 스킬 폴더는 쓰는 에이전트가 없어질 때 지움', !fs.existsSync(agentsCli) && fs.existsSync(binCli) && fs.existsSync(installedCli));
    const dr = ctl('doctor');
    ok('46 doctor는 설치된 에이전트만 봄', dr.status === 0 && !dr.stdout.includes('Codex') && !dr.stdout.includes('Cursor') && dr.stdout.includes('Claude Code'), dr.stdout);
    ctl('uninstall', '--agents', 'claude');
    ok('46 마지막 에이전트를 빼면 실행 파일도 지움', !fs.existsSync(binCli) && !fs.existsSync(installedCli) && stopHooks().includes('say done') && !stopHooks().includes('hook claude'), stopHooks());
    const inst = spawnSync('node', [CLI, 'install', '--home', ih2, '--agents', 'claude'], {encoding: 'utf-8'});
    ok('13 설치 출력에 실측 전 안내', inst.stdout.includes('실측 전'), inst.stdout);
  }

  // Chrome을 그대로 쓰는 복구 한 건: 끝까지 통과하고 45초를 기다리지 않는다
  {
    const s = session();
    s.prompt();
    const f = s.write('real.html');
    const t0 = Date.now();
    const id = {session_id: `s${n}`, cwd: s.dir};
    const o = hk('claude', 'stop', id, {...process.env, DOC_KIT_HOME: hhome}).stdout;
    ok('훅: 실제 브라우저로 입히고 알림에 미실행 없음', run('check', f).status === 0 && o.includes('real.html') && !o.includes('미실행'), `${Date.now() - t0}ms ${o}`);
  }
}

console.log(fails ? `\n실패 ${fails}건` : '\n모두 통과');
process.exit(fails ? 1 : 0);
void execFileSync;
