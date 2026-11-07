// 릴리스 지킴이: 태그 v<버전>으로 내보낸 키트 코드를 같은 버전 번호로 바꾸지 못하게 한다.
// 이미 나간 파일은 versions.json의 해시로 C2 판정을 받으므로, 해시가 바뀌면 옛 파일이 모두 '키트 코드가 바뀌었습니다'로 실패한다
import {execFileSync} from 'node:child_process';

// 태그가 없거나 git이 없으면(아직 배포 전) null. 태그가 있으면 그 시점의 versions.json
export function taggedVersions(root, version) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore']});
  try {
    git('rev-parse', '--verify', '-q', `refs/tags/v${version}`);
  } catch {
    return null;
  }
  try {
    return JSON.parse(git('show', `refs/tags/v${version}:src/kit/versions.json`));
  } catch {
    return {};
  }
}

// 태그의 해시와 지금 해시가 다르면 오류. 버전을 올리면 새 칸이 생기고 옛 칸은 그대로 남는다
export function guardRelease(root, version, now) {
  const tagged = taggedVersions(root, version);
  const old = tagged && tagged[version];
  if (!old) return;
  const changed = Object.keys({...old, ...now}).filter((k) => old[k] !== now[k]);
  if (changed.length) throw new Error(`v${version} 태그로 이미 내보낸 키트 코드가 바뀌었습니다(${changed.join(', ')}). package.json의 버전을 올린 뒤 다시 빌드하세요`);
}
