# html-doc-kit

HTML 문서에 뷰어와 편집기를 항상 넣어 주는 스킬입니다. Claude Code, Codex, Cursor에서 쓸 수 있습니다. 모델은 본문만 쓰고, 뷰어·편집기는 고정 명령이 넣습니다. 모델이 지침을 어기고 HTML을 직접 써도 작업이 끝날 때 훅이 복구합니다.

- 요구사항: [PRD.md](PRD.md), 작업계획: [PLAN.md](PLAN.md)
- 시험 현황: [test/REGRESSION_STATUS.md](test/REGRESSION_STATUS.md), 에이전트 실측: [test/probe/RESULTS.md](test/probe/RESULTS.md)

## 설치

Node 22 이상이 필요합니다. 실행에 필요한 것은 `skill/html-doc-kit/` 안에 모두 들어 있습니다.

```bash
node skill/html-doc-kit/scripts/doc-kit.mjs install
```

세 에이전트의 스킬, 전역 지침, 훅을 넣습니다. 기존 설정은 보존하고 처음 고칠 때 `*.doc-kit-bak`을 남깁니다. `--agents codex`처럼 일부만 넣을 수 있습니다. 점검은 `doctor`, 제거는 `uninstall`입니다.

**Codex는 훅을 처음 한 번 직접 승인해야 합니다.** 터미널에서 `codex`를 실행해 안내를 따르세요. 승인 전에는 Codex에서 자동 복구가 돌지 않습니다.

## 명령

```
build <본문.md|본문.html> -o <결과.html> [--type slide|a4|a4-landscape|auto] [--title 제목]
ensure <파일.html>                 어떤 HTML이든 완성 파일로 (이미 완성이면 그대로)
check <파일.html>                  0 완성, 1 미완성, 2 입력 문제
extract <파일.html> [-o 본문.html]  본문만 꺼내기
apply <본문.html> <파일.html>       고친 본문 되돌리기
upgrade <파일.html>                키트를 최신으로
```

본문 표기법은 [skill/html-doc-kit/references/input.md](skill/html-doc-kit/references/input.md)에 있습니다.

## 훅이 건드리는 파일

이번 작업에서 만들거나 바꾼 HTML만 봅니다.

- 스크립트 없는 HTML: 제자리에서 입힙니다. 원본은 `.doc-kit/backup/`에 둡니다.
- 자체 스크립트가 있는 HTML: 그대로 두고 옆에 `이름_편집용.html`을 만듭니다.
- 건드리지 않음: 프로젝트 안의 `src/`, `public/`, `dist/`, `build/`, `coverage/` 등, 웹 프레임워크를 쓰는 프로젝트, 템플릿 파일, `.doc-kit.json`의 `exclude`, `<meta name="doc-kit" content="off">`.

보장하지 못하는 경우: 훅을 설치하지 않은 환경에서 모델이 스킬을 쓰지 않을 때, 작업 폴더 밖에 파일 도구나 리디렉션이 아닌 방법으로 쓴 파일, 문서지능 출력, Claude Code Artifact.

## 개발

```bash
npm install
npm run build   # src → skill/html-doc-kit/scripts/doc-kit.mjs
npm test        # 전체 시험(수십 분)
```

키트 코드(`src/kit/`)를 바꿔 내놓을 때는 `package.json`의 버전을 올립니다. `src/kit/versions.json`에 버전별 해시가 쌓여 옛 파일도 `check`를 통과합니다.
