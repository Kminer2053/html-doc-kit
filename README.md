# html-doc-kit

HTML 문서에 뷰어와 편집기를 항상 넣어 주는 스킬입니다. Claude Code, Codex, Cursor에서 쓸 수 있습니다. 모델은 본문만 쓰고, 뷰어·편집기는 고정 명령이 넣습니다. 모델이 지침을 어기고 HTML을 직접 써도 작업이 끝날 때 훅이 복구하도록 설계했습니다.

> **보장 범위(실측 전):** 저장 뒤·끝날 때 훅과 훅 안의 브라우저 시험은 세 에이전트 모두 실제 에이전트로 아직 확인하지 못했습니다([실측 표](test/probe/RESULTS.md)). 격리한 시험에서 훅 입력을 흉내 내 확인한 동작입니다. 낮은 모델 수용 시험(A3)을 통과하기 전까지는 보장이 아니라 설계 목표로 읽으세요. 꼭 필요한 문서는 `check`로 직접 확인하세요.

- 요구사항: [PRD.md](PRD.md), 작업계획: [PLAN.md](PLAN.md)
- 시험 현황: [test/REGRESSION_STATUS.md](test/REGRESSION_STATUS.md), 에이전트 실측: [test/probe/RESULTS.md](test/probe/RESULTS.md)

## 설치

Node 22 이상이 필요합니다. 실행에 필요한 것은 `skill/html-doc-kit/` 안에 모두 들어 있습니다.

```bash
node skill/html-doc-kit/scripts/doc-kit.mjs install
```

세 에이전트의 스킬, 전역 지침, 훅을 넣습니다. 기존 설정은 보존합니다. 처음 고칠 때 `*.doc-kit-bak`을, 그 뒤로 내용이 바뀔 때마다 시각을 붙인 백업을 남깁니다. 다시 설치하거나 제거할 때는 키트가 넣은 훅 항목만 빼므로 같은 그룹의 사용자 훅은 남습니다.

`--agents codex`처럼 일부만 넣고 뺄 수 있습니다(`uninstall --agents cursor`). 함께 쓰는 스킬 폴더와 실행 파일은 쓰는 에이전트가 없어질 때 지웁니다. 점검은 `doctor`이며 문제가 있으면 종료 코드 1입니다.

**Codex는 훅을 처음 한 번 직접 승인해야 합니다.** 터미널에서 `codex`를 실행해 안내를 따르세요. 승인 전에는 Codex에서 자동 복구가 돌지 않으며, `doctor`는 prompt·post·stop 세 훅의 승인을 보고 하나라도 없으면 문제로 알립니다. 전역 훅의 승인 표시 형식은 아직 실제 승인으로 확인하지 못했으므로, 승인했는데도 문제로 나오면 알려 주세요. Codex를 쓰지 않으면 `uninstall --agents codex`로 빼세요.

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

마지막으로 처리를 마친 뒤 만들거나 바꾼 HTML을 봅니다. 턴이 중단돼 끝날 때 훅이 돌지 못했으면 그 파일은 다음 턴 끝에 함께 처리합니다. 다만 기준 시각이 12시간 넘게 지났으면 도구로 쓴 파일만 잇고 스캔은 새로 시작합니다.

**찾는 방법**

- 도구 입력: 파일 도구, `apply_patch`, 셸 명령(따옴표·공백 경로, `$HOME`, 같은 명령의 `cd`, 리디렉션, `tee`, `-o`, `mv`·`cp` 대상)
- 작업 폴더 스캔: 점 폴더, `Library`, `AppData`, 앱 폴더는 내려가지 않습니다. 작업 폴더가 홈이나 루트이면 스캔하지 않습니다.
- 셸 명령에 `.html`이나 스크립트 실행이 있으면 `~/Desktop`, `~/Downloads`, `~/Documents` 바로 아래도 봅니다.
- 스캔으로만 찾은 파일은 git에서 HEAD와 같으면 건너뜁니다. 5개를 넘으면 입히지 않고 목록만 알립니다.

**처리**

- 스크립트 없는 HTML: 제자리에서 입힙니다. 원본은 `.doc-kit/backup/`에 두고 경로를 알립니다.
- 자체 스크립트, `on*` 속성, `iframe`·`object`·`embed`가 있는 HTML: 그대로 두고 옆에 `이름_편집용.html`을 만듭니다. 사본에서는 그 요소가 빠지므로 경고로 알립니다.
- `go.mod`, `pyproject.toml`, `composer.json`, `conf.py`처럼 문서도 함께 있을 수 있는 프로젝트: 사본을 만듭니다.
- 건드리지 않음(모두 이유를 알림): 프로젝트 안의 `src/`, `public/`, `dist/`, `build/`, `static/`, `views/`, `templates/`, `partials/`, `emails/`, `coverage/` 등, 웹 프레임워크·웹 서버를 쓰는 프로젝트, 템플릿 지시문(`{% %}`, `<% %>`, `{{#...}}`)이 있는 파일, git이 무시하는 파일(스캔으로 찾은 경우), `.doc-kit.json`의 `exclude`, `<meta name="doc-kit" content="off">`. 프로젝트 위쪽은 `.git`이 없으면 작업 폴더까지만 봅니다.
- `{{회사명}}` 같은 빈칸 표시와 CSS의 `{{`는 템플릿으로 보지 않습니다. `out/`, `target/`, `vendor/`도 앱 신호가 아닙니다.
- `.doc-kit/` 안의 본문 파일은 건드리지 않습니다. 그 밖의 곳에 있는 본문 파일과 고친 뒤 되돌리지 않은 본문은 `apply`가 필요하다고 알립니다.

`exclude`는 경로와 글롭을 받습니다. 슬래시 없는 글롭은 폴더 깊이와 상관없이 이름에 맞춥니다.

```json
{"exclude": ["drafts/", "out2/**", "*.tmpl.html"]}
```

브라우저 시험을 돌리지 못했거나, 경고가 있거나, 스타일을 버렸으면 끝날 때 함께 알립니다. Cursor는 끝날 때 사용자에게 바로 보여 줄 길이 없어 평범한 완료 외의 내용을 모델을 거쳐(`followup_message`) 전합니다. 실제로 어떻게 보이는지는 실측 전입니다.

보장하지 못하는 경우: 훅을 설치하지 않은 환경에서 모델이 스킬을 쓰지 않을 때, Codex 훅을 승인하기 전, 세션을 닫아 끝날 때 훅이 다시 오지 않는 턴, 작업 폴더와 위 세 폴더 밖에 스크립트로 쓴 파일, 스크립트가 옮겨 수정 시각이 옛날로 남은 파일, 셸 변수 등으로 위치를 알 수 없는 쓰기(알리기만 합니다), 문서지능 출력, Claude Code Artifact.

## 개발

```bash
npm install
npm run build   # src → skill/html-doc-kit/scripts/doc-kit.mjs
npm test        # 전체 시험(수십 분)
```

키트 코드(`src/kit/`)를 바꿔 내놓을 때는 `package.json`의 버전을 올립니다. `src/kit/versions.json`에 버전별 해시가 쌓여 옛 파일도 `check`를 통과합니다.
