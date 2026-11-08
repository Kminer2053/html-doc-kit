// 윈도 전용 경로와 PowerShell 명령 읽기. 맥에서도 돌도록 경로 변환은 플랫폼을 넘겨 시험하고, PowerShell은 맥 경로로 끝까지 돌려 본다
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// 진짜 홈을 건드리지 않게 불러오기 전에 임시 홈을 정한다
const HK = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-win-'));
const home = path.join(HK, 'home');
fs.mkdirSync(home, {recursive: true});
process.env.DOC_KIT_HOME = home;
const hookUrl = pathToFileURL(path.join(here, '../src/cli/hook.mjs')).href;
const {fromMsys, readPowerShell, looksPowerShell, effectsOf} = await import(hookUrl);

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' → ' + extra : ''}`);
};
// 확인이 도중에 던져도 임시 폴더를 지운다
try {
  const show = (r) => JSON.stringify({w: [...r.written], rm: [...r.removed], u: [...r.unknown], m: [...r.maybe], ran: r.ran, wrote: r.wrote});

  // W1: Git Bash 경로
  {
    const win = {platform: 'win32', tmp: 'C:\\Users\\USER\\AppData\\Local\\Temp'};
    const cases = [
      ['/c/Users/USER/AppData/Local/Temp/x/B 보고서.html', 'C:\\Users\\USER\\AppData\\Local\\Temp\\x\\B 보고서.html'],
      ['/c', 'C:\\'],
      ['/d/', 'D:\\'],
      ['/D/out/a.html', 'D:\\out\\a.html'],
      ['/tmp/x/a.html', 'C:\\Users\\USER\\AppData\\Local\\Temp\\x\\a.html'],
      ['/tmp', 'C:\\Users\\USER\\AppData\\Local\\Temp'],
      ['/tmpx/a.html', '/tmpx/a.html'],
      ['/cd/a.html', '/cd/a.html'],
      ['C:/Users/a.html', 'C:/Users/a.html'],
      ['C:\\Users\\a.html', 'C:\\Users\\a.html'],
      ['docs/a.html', 'docs/a.html'],
    ];
    for (const [from, want] of cases) ok(`W1 ${from}`, fromMsys(from, win) === want, fromMsys(from, win));
    ok('W1 윈도가 아니면 그대로', fromMsys('/c/Users/a.html', {platform: 'darwin'}) === '/c/Users/a.html' && fromMsys('/tmp/a.html', {platform: 'linux'}) === '/tmp/a.html');
  }

  // W4: PowerShell 읽기
  const D = path.join(HK, 'ps');
  fs.mkdirSync(path.join(D, 'src'), {recursive: true});
  fs.mkdirSync(path.join(D, 'dest'), {recursive: true});
  fs.writeFileSync(path.join(D, 'src', 'a.html'), '<p>a</p>');
  const P = (...p) => path.join(D, ...p);
  const ps = (cmd, cwd = D) => readPowerShell(cmd, cwd);
  const has = (set, p) => set.has(p);
  {
    let r = ps(`Set-Content -Path '${P('a.html')}' -Value '<p>x</p>'`);
    ok('W4 Set-Content -Path', has(r.written, P('a.html')) && r.ran && r.wrote, show(r));
    r = ps(`'<p>x</p>' | Out-File -FilePath "${P('b.html')}" -Encoding utf8`);
    ok('W4 Out-File -FilePath', has(r.written, P('b.html')) && r.ran, show(r));
    r = ps(`Add-Content ${P('c.html')} 'x'`);
    ok('W4 Add-Content 위치 인자', has(r.written, P('c.html')) && r.written.size === 1, show(r));
    r = ps(`sc -Path:${P('c2.html')} -Value x`);
    ok('W4 별칭 sc와 -Path:값', has(r.written, P('c2.html')), show(r));
    r = ps(`@'\n<html><body>a > b.html; Remove-Item x</body></html>\n'@ | Set-Content -LiteralPath '${P('d.html')}' -Encoding UTF8`);
    ok('W4 여기 문자열 안의 > 와 명령은 무시', has(r.written, P('d.html')) && r.written.size === 1 && r.removed.size === 0, show(r));
    r = ps(`$html = @"\n<p>$name</p>\n"@\n$html | Out-File "${P('d2.html')}"`);
    ok('W4 겹따옴표 여기 문자열', has(r.written, P('d2.html')) && r.written.size === 1, show(r));
    r = ps(`Write-Output 'x' > "${P('e.html')}"`);
    ok('W4 > 리디렉션', has(r.written, P('e.html')) && r.wrote, show(r));
    r = ps(`node gen.js *> ${P('e2.html')}; Write-Output y 2>&1 >> ${P('e3.html')}`);
    ok('W4 *> 와 2>&1 >>', has(r.written, P('e2.html')) && has(r.written, P('e3.html')), show(r));
    r = ps(`Get-Content x.txt > $null`);
    ok('W4 > $null 은 쓰기가 아님', !r.wrote && !r.ran && r.written.size === 0, show(r));
    r = ps(`Set-Content -Path '${P("it''s.html")}' -Value x`);
    ok("W4 홑따옴표 안의 ''", has(r.written, P("it's.html")), show(r));
    r = ps(`Set-Content -Path "${P('cost`$1 `"q`".html')}" -Value x`);
    ok('W4 겹따옴표 안의 ` 이스케이프', has(r.written, P('cost$1 "q".html')), show(r));
    r = ps(`Set-Content -Path 'sub\\q.html' -Value x`);
    ok('W4 \\는 글자 그대로', has(r.written, path.resolve(D, 'sub\\q.html')), show(r));
    r = ps(`Set-Content -Path "$env:TEMP/x/f.html" -Value x; Set-Content -Path ~/g.html x; Out-File -FilePath "$HOME/g2.html"; sc "\${env:USERPROFILE}/g3.html" x`);
    ok('W4 $env:TEMP·~·$HOME·${env:USERPROFILE}', has(r.written, path.join(os.tmpdir(), 'x', 'f.html')) && has(r.written, path.join(home, 'g.html')) && has(r.written, path.join(home, 'g2.html')) && has(r.written, path.join(home, 'g3.html')), show(r));
    r = ps(`$out = "${P('h.html')}"\nSet-Content -Path $out -Value x`);
    ok('W4 변수에 담은 경로', has(r.written, P('h.html')), show(r));
    r = ps(`Set-Content -Path "$dir\\i.html" -Value x`);
    ok('W4 모르는 변수는 위치 미상', r.written.size === 0 && [...r.unknown].some((u) => u.includes('i.html')) && r.ran, show(r));
    r = ps(`Set-Content -Path (Join-Path $env:TEMP 'j0.html') -Value x`);
    ok('W4 괄호 식 경로는 위치 미상', r.written.size === 0 && [...r.unknown].some((u) => u.includes('j0.html')), show(r));
    r = ps(`Set-Location ${P('src')}; New-Item -ItemType File -Name j.html; cd ..; New-Item -Path ${P('dest')} -Name k.html -ItemType File -Force; ni l.html`);
    ok('W4 Set-Location·cd 뒤 New-Item', has(r.written, P('src', 'j.html')) && has(r.written, P('dest', 'k.html')) && has(r.written, P('l.html')), show(r));
    r = ps(`Copy-Item ${P('src', 'a.html')} ${P('dest')}; Copy-Item -Path ${P('src', 'a.html')} -Destination ${P('m.html')}; cp ${P('src', '*.html')} ${P('dest')}\\`);
    ok('W4 Copy-Item 폴더로·파일로·글롭', has(r.written, P('dest', 'a.html')) && has(r.written, P('m.html')) && r.removed.size === 0, show(r));
    r = ps(`Copy-Item -Recurse ${P('src')} ${P('dest')}`);
    ok('W4 Copy-Item -Recurse 폴더', has(r.written, P('dest', 'src', 'a.html')), show(r));
    r = ps(`Move-Item -Path ${P('src', 'a.html')} -Destination ${P('dest')}`);
    ok('W4 Move-Item 은 원본을 지움', has(r.written, P('dest', 'a.html')) && has(r.removed, P('src', 'a.html')), show(r));
    r = ps(`Remove-Item -Path ${P('a.html')}, ${P('b.html')} -Force; del ${P('c.html')}`);
    ok('W4 Remove-Item 쉼표 목록·del', has(r.removed, P('a.html')) && has(r.removed, P('b.html')) && has(r.removed, P('c.html')) && r.written.size === 0, show(r));
    r = ps(`Get-Content ${P('a.html')} | Select-String foo; Test-Path x.html; Get-ChildItem *.html; dir; Resolve-Path a.html; echo hi; if (Test-Path a) { Get-Item a }`);
    ok('W4 읽기 전용은 쓰기가 아님', !r.ran && !r.wrote && r.written.size === 0 && r.maybe.size === 0, show(r));
    r = ps(`# Set-Content ${P('z.html')}\n<# Out-File ${P('z2.html')} #>`);
    ok('W4 주석은 무시', !r.ran && r.written.size === 0, show(r));
    r = ps(`Invoke-WebRequest -Uri https://x.example -OutFile ${P('w.html')}`);
    ok('W4 모르는 cmdlet은 쓰기로 보고 HTML은 확인 필요', r.ran && has(r.maybe, P('w.html')) && r.written.size === 0, show(r));
    r = ps(`[IO.File]::WriteAllText("${P('n.html')}", $s)`);
    ok('W4 .NET 메서드 호출', r.ran && r.wrote && has(r.written, P('n.html')), show(r));
    r = ps(`$o = "${P('n2.html')}"; [System.IO.File]::WriteAllLines($o, $lines, [Text.Encoding]::UTF8); [IO.File]::AppendAllText('n3.html', 'x'); [IO.File]::CreateText("$env:TEMP/n4.html")`);
    ok('W4 [IO.File] 쓰기 메서드의 첫 인자', has(r.written, P('n2.html')) && has(r.written, P('n3.html')) && has(r.written, path.resolve(os.tmpdir(), 'n4.html')), show(r));
    r = ps(`$w = New-Object System.IO.StreamWriter("${P('n5.html')}", $false); $w2 = New-Object -TypeName System.IO.StreamWriter -ArgumentList ${P('n6.html')}; $w3 = [System.IO.StreamWriter]::new('n7.html')`);
    ok('W4 StreamWriter', has(r.written, P('n5.html')) && has(r.written, P('n6.html')) && has(r.written, P('n7.html')) && r.wrote, show(r));
    r = ps(`[IO.File]::WriteAllText($target, $html); [IO.File]::WriteAllText((Join-Path $d 'n8.html'), $s); [IO.File]::WriteAllText('${P('n9.txt')}', 'x')`);
    ok('W4 .NET 쓰기 경로를 모르면 위치 미상', r.written.size === 0 && [...r.unknown].some((u) => u.includes('$target')) && [...r.unknown].some((u) => u.includes('n8.html')) && r.unknown.size === 2 && r.wrote, show(r));
    r = ps(`[IO.File]::ReadAllText('${P('src', 'a.html')}')`);
    ok('W4 다른 .NET 메서드는 확인 필요로만', r.written.size === 0 && has(r.maybe, P('src', 'a.html')), show(r));
    r = ps(`Get-Service; Get-Module -ListAvailable; Get-ExecutionPolicy; Test-Connection x; Measure-Object; Format-Hex a; ConvertFrom-StringData x; Wait-Process 1; Write-Information hi; Write-Host x`);
    ok('W4 읽기 동사 cmdlet은 쓰기가 아님', !r.ran && !r.wrote && r.written.size === 0 && r.unknown.size === 0, show(r));
    r = ps(`Get-Foo -Name ${P('q.html')}; Write-Host x > ${P('q2.html')}`);
    ok('W4 읽기 동사의 HTML은 확인 필요, 리디렉션은 쓰기', !r.ran && has(r.maybe, P('q.html')) && has(r.written, P('q2.html')) && r.wrote, show(r));
    r = ps(`Get-Report -OutFile ${P('q3.html')}`);
    ok('W4 읽기 동사도 출력 파일 매개변수가 있으면 쓰기일 수 있음', r.ran && has(r.maybe, P('q3.html')), show(r));
    r = ps(`$o = Join-Path ${P('src')} 'v.html'; Set-Content $o x; $o2 = Join-Path -Path $HOME -ChildPath v2.html; Out-File -FilePath $o2`);
    ok('W4 Join-Path 대입을 따라감', has(r.written, P('src', 'v.html')) && has(r.written, path.join(home, 'v2.html')), show(r));
    r = ps(`$o = Get-OutPath; Set-Content $o x; $o3 = Join-Path $root 'v3.html'; Set-Content $o3 x; $o4 = "${P('v4.html')}"; $o4 = Get-Other; sc $o4 x`);
    ok('W4 값을 모르는 변수로 쓰면 위치 미상', r.written.size === 0 && [...r.unknown].some((u) => u === '$o') && [...r.unknown].some((u) => u === '$o3') && [...r.unknown].some((u) => u === '$o4') && r.wrote, show(r));
    r = ps(`$log = Get-LogDir; Set-Content "$log\\run.txt" x`);
    ok('W4 HTML이 아닌 줄 아는 위치 미상 쓰기는 알리지 않음', r.unknown.size === 0 && r.wrote, show(r));
    r = ps(`pandoc in.md -o "${P('p.html')}"; node build.js`);
    ok('W4 외부 프로그램은 셸 읽기로', has(r.written, P('p.html')) && r.ran, show(r));
    r = ps(`$s = 'x'\n$s | Set-Content -Path $p`);
    ok('W4 위치를 모르는 쓰기도 쓰기 턴', r.ran && r.wrote, show(r));
  }
  ok('W4 PowerShell 판별', looksPowerShell('Set-Content -Path a.html -Value x') && looksPowerShell('"x" | Out-File "$env:TEMP\\a.html"') && !looksPowerShell('cat > a.html <<EOF') && !looksPowerShell('echo Set-Contents'));
  {
    const yes = ['sc a.html x', 'cd x; ni a.html', "'x' | ac -Path a.html", 'out-file a.html', 'SET-CONTENT a.html x', '[IO.File]::WriteAllText("a.html", $s)', '[System.IO.File]::WriteAllBytes($p, $b)', '$w = New-Object System.IO.StreamWriter($p)', '[System.IO.StreamWriter]::new($p)'];
    const no = ['cat sc.txt > a.html', 'echo ni hao', 'grep -r ac src', 'ls sc/', 'scp a.html host:', 'nice -n 5 make', 'acme build'];
    ok('W4 PowerShell 판별: 별칭·.NET·대소문자', yes.every(looksPowerShell), yes.filter((c) => !looksPowerShell(c)).join(' | '));
    ok('W4 PowerShell 판별: POSIX 명령은 아님', !no.some(looksPowerShell), no.filter(looksPowerShell).join(' | '));
  }
  {
    const cmd = `'<p>x</p>' | Out-File -FilePath ${P('u.html')}`;
    const tool = (name, platform) => effectsOf({cwd: D, tool_name: name, tool_input: {command: cmd}}, platform);
    ok('W4 PowerShell 도구는 PowerShell로 읽음', tool('PowerShell', 'darwin').written.has(P('u.html')) && tool('powershell', 'darwin').active);
    ok('W4 윈도의 다른 셸 도구도 PowerShell 명령이면 합쳐 읽음', tool('shell', 'win32').written.has(P('u.html')) && tool('shell', 'win32').active);
    ok('W4 윈도가 아니면 셸 읽기만', !tool('Bash', 'darwin').written.has(P('u.html')));
  }

  // W4 끝까지: 임시 홈과 임시 작업 폴더에서 훅을 돌린다
  {
    const proj = path.join(HK, 'proj');
    const outside = path.join(HK, 'outside');
    fs.mkdirSync(proj, {recursive: true});
    fs.mkdirSync(outside, {recursive: true});
    const env = {...process.env, DOC_KIT_HOME: home};
    const hook = (agent, event, input) => spawnSync('node', ['--input-type=module', '-e', `import {hook} from ${JSON.stringify(hookUrl)}; await hook(process.argv[1], process.argv[2]);`, agent, event], {encoding: 'utf-8', env, cwd: proj, input: JSON.stringify(input)});
    const page = (t) => `<!doctype html><html><head><title>시험</title></head><body><h1>${t}</h1><p>문단</p></body></html>`;
    const kit = (f) => fs.readFileSync(f, 'utf-8').includes('data-doc-kit=');
    const sid = {session_id: 'win-ps', cwd: proj};
    hook('claude', 'prompt', sid);
    const far = path.join(outside, 'B 보고서.html');
    fs.writeFileSync(far, page('밖에 쓴 문서'));
    hook('claude', 'post', {...sid, tool_name: 'PowerShell', tool_input: {command: `$html = @'\n${page('밖에 쓴 문서')}\n'@\nSet-Content -LiteralPath '${far}' -Value $html -Encoding UTF8`}});
    const st = hook('claude', 'stop', sid);
    ok('W4 훅: PowerShell로 작업 폴더 밖에 쓴 파일을 입힘', kit(far), st.stdout.slice(0, 200) + st.stderr.slice(0, 200));
    hook('claude', 'prompt', sid);
    const near = path.join(proj, 'report.html');
    fs.writeFileSync(near, page('안에 쓴 문서'));
    hook('claude', 'post', {...sid, tool_name: 'PowerShell', tool_input: {command: `$p = Get-DocPath\n$html | Set-Content -Path $p`}});
    const st2 = hook('claude', 'stop', sid);
    ok('W4 훅: 위치를 모르는 PowerShell 쓰기도 쓰기 턴으로 보고 작업 폴더를 고침', kit(near) && !st2.stdout.includes('쓰기 도구나 쓰기 명령이 없었는데'), st2.stdout.slice(0, 300));
    hook('claude', 'prompt', sid);
    const idle = path.join(proj, 'idle.html');
    fs.writeFileSync(idle, page('읽기만 한 턴'));
    hook('claude', 'post', {...sid, tool_name: 'PowerShell', tool_input: {command: `Get-ChildItem *.html | Select-Object Name`}});
    const st3 = hook('claude', 'stop', sid);
    ok('W4 훅: 읽기 전용 PowerShell만 쓴 턴은 고치지 않음', !kit(idle) && st3.stdout.includes('쓰기 도구나 쓰기 명령이 없었는데'), st3.stdout.slice(0, 300));
    hook('claude', 'prompt', sid);
    const svc = path.join(proj, 'service.html');
    fs.writeFileSync(svc, page('서비스만 본 턴'));
    hook('claude', 'post', {...sid, tool_name: 'PowerShell', tool_input: {command: `Get-Service | Where-Object Status -eq Running; Get-Module -ListAvailable; Get-ExecutionPolicy`}});
    const st4 = hook('claude', 'stop', sid);
    ok('W4 훅: Get-Service 같은 읽기 동사만 쓴 턴은 고치지 않음', !kit(svc) && st4.stdout.includes('확인 필요') && st4.stdout.includes('service.html'), st4.stdout.slice(0, 300));
  }
} finally {
  fs.rmSync(HK, {recursive: true, force: true});
}
console.log(fails ? `\n${fails}개 실패` : '\n모두 통과');
process.exit(fails ? 1 : 0);
