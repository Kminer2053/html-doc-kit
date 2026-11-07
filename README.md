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

훅이 파일을 고치는 근거는 둘뿐입니다. (가) 에이전트가 그 경로에 썼다는 직접 증거: 도구의 `file_path`, 또는 셸 명령을 낱말로 나눠 얻은 쓰기 대상(`>`, `>>`, `tee`, 출력 옵션으로 알려진 프로그램과 스크립트의 `-o`/`--output`, `cp`·`mv`·`rsync` 원본 이름을 대상 폴더에 붙인 경로 등). (나) 쓰기가 있었던 턴에 작업 폴더 스캔에서 이번 턴 구간에 바뀐 파일. 그 밖은 고치지 않고, 이번 턴에 생긴 것으로 보이면 `확인 필요: 경로 (…그대로 두었습니다. 문서이면 ensure를 실행하세요)`로 알리기만 합니다.

이번 턴(사용자가 요청을 보낸 때부터)에 만들거나 바꾼 HTML을 봅니다. 턴이 중단돼 끝날 때 훅이 돌지 못했으면 그 턴의 구간(시작부터 마지막 도구 사용까지)과 도구로 쓴 파일을 다음 턴 끝에 함께 처리합니다. 마지막 도구 사용 뒤부터 다음 요청까지 작업 폴더에서 바뀐 HTML은 사용자가 턴 사이에 저장한 파일일 수 있어 고치지 않고 `확인 필요`로 알립니다. 정상으로 끝난 턴과 다음 턴 사이에 사용자나 다른 프로그램이 바꾼 파일은 건드리지 않습니다. 12시간이 넘은 미처리 구간은 다시 훑지 않습니다.

**찾는 방법**

- 도구 입력: 파일 도구, `apply_patch`, 셸 명령(따옴표·공백 경로, `$HOME`, 같은 명령의 `cd`, 리디렉션, `tee`, `-o`, `mv`·`cp` 대상)
- `-o`/`--output`: `curl`, `wget -O`, `pandoc`, `gcc` 같은 출력 옵션 프로그램과 `node`·`python` 등으로 돌린 스크립트에서만 쓰기 대상으로 봅니다. `ls -o`, `grep -o` 같은 읽기 명령은 보지 않습니다. 그 밖의 프로그램의 `-o` 뒤 HTML은 고치지 않고, 이번 턴에 바뀌었으면 `확인 필요`로 알립니다.
- `cp`·`mv`·`rsync`의 대상 폴더는 훑지 않습니다. 원본 인자의 이름을 대상 폴더에 붙인 경로만 고칩니다. 글롭(`*.html`)은 그 자리에서 펼치고, `cp -r` 폴더는 원본 폴더 안의 HTML 이름을 붙입니다(500개까지, 넘으면 알림). `mv`의 글롭처럼 펼칠 수 없으면 위치 미상으로 알립니다.
- 쓰기 도구도, 읽기 전용이 아닌 셸 명령(리디렉션 포함)도 없는 턴(`ls`, `git status`만 돌린 턴 등)은 작업 폴더를 훑어 고치지 않습니다. 그 턴에 작업 폴더에서 바뀐 HTML은 사용자가 저장한 파일일 수 있어 `확인 필요`로만 알립니다. 끝날 때 훅이 돌지 못한 미처리 구간도 그 턴에 쓰기가 있었는지를 기록해 같은 규칙을 따릅니다.
- 작업 폴더 스캔: 점 폴더, `Library`, `AppData`, `node_modules`·가상 환경, `coverage/` 같은 시험 리포트 폴더는 내려가지 않습니다. 작업 폴더가 홈이나 루트이면 스캔하지 않습니다. 폴더 항목 20000개나 깊이 12단계에서 멈추며, 멈추면 `스캔을 N개에서 멈췄습니다…ensure를 실행하세요`처럼 알립니다.
- `~/Desktop`, `~/Downloads`, `~/Documents`는 훑어서 고치지 않습니다. 명령 글자에 폴더 이름이 나와도(`ls ~/Downloads`, 커밋 메시지 등) 마찬가지입니다. 사용자가 받거나 저장한 파일이 섞이기 때문입니다. 거기 있는 파일은 위 (가)의 직접 쓰기 증거(`-o ~/Desktop/r.html`, `> ~/Downloads/a.html` 등)가 있을 때만 고칩니다. 스크립트를 돌린 턴에 이번 턴에 바뀐 HTML이 이 폴더 바로 아래에 있으면 `확인 필요`로 알립니다(`ls`, `git status` 같은 읽기 명령만 돌린 턴은 제외). 작업 폴더가 이 폴더 안의 프로젝트이면 작업 폴더 스캔은 다른 곳과 같습니다.
- 스캔으로만 찾은 파일이 git에서 HEAD와 같으면, 이번 턴에 이 저장소에서 `git commit`으로 커밋한 파일(작성 시각과 커미터 시각이 모두 이번 턴 안)은 처리하고, 그 밖(checkout, 지난 커밋을 다시 쓴 rebase, pull로 받은 남의 커밋 등)은 건너뛰고 알립니다. 5개를 넘으면 입히지 않고 목록만 알립니다.

**처리**

- 스크립트 없는 HTML: 제자리에서 입힙니다. 원본은 `.doc-kit/backup/`에 두고 경로를 알립니다.
- 자체 스크립트, `on*` 속성, `iframe`·`object`·`embed`가 있는 HTML: 그대로 두고 옆에 `이름_편집용.html`을 만듭니다. 사본에서는 그 요소가 빠지므로 경고로 알립니다.
- `requirements.txt`, `pyproject.toml`, `setup.py`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `mix.exs`, `composer.json`, `Gemfile`만 있는 저장소의 평범한 보고서: 일반 문서처럼 제자리에서 입힙니다. 이 파일의 의존성 선언 자리에 서버 웹 프레임워크(flask, django, fastapi, rails, sinatra, laravel, spring-boot, gin, axum, phoenix 등)가 있으면 앱 폴더(`templates/`, `static/`, `views/` 등) 안은 건드리지 않고 알리며, 그 밖의 HTML은 원본을 두고 `이름_편집용.html` 사본을 만들어 알립니다. 이름은 의존성을 적는 자리에서만 찾습니다: requirements는 줄 첫머리 패키지 이름, `pyproject.toml`은 `dependencies`·`optional-dependencies` 배열(Poetry는 `[tool.poetry.dependencies]` 키), `Cargo.toml`은 `[dependencies]` 표의 키, `Gemfile`은 `gem '이름'`, `go.mod`는 `require` 경로, `composer.json`은 `require` 키, `pom.xml`·`build.gradle`은 `artifactId`·의존성 좌표·플러그인 id, `mix.exs`는 deps. 설명·주석에 나온 낱말(`description = "Generate a poem"` 등)은 신호가 아닙니다. jinja2, tornado, sphinx, markupsafe, jupyter, jekyll, 그리고 대개 HTTP 클라이언트로 쓰는 aiohttp는 웹앱 신호가 아닙니다. Sphinx `conf.py`도 코드 프로젝트 신호로만 보고 출력 폴더 `_build/`만 뺍니다.
- 건드리지 않음(모두 이유를 알림): 웹 프레임워크·웹 서버·빌드 설정(`package.json`의 웹 의존성, 빌드 설정 파일 등)이 있는 프로젝트, 위 프로젝트 파일 속 서버 웹 프레임워크가 있는 프로젝트의 앱 폴더, 코드 프로젝트(`package.json`이나 위 언어 프로젝트 파일이 있는 곳) 안의 `src/`, `public/`, `dist/`, `build/`, `static/`, `views/`, `templates/`, `partials/`, `emails/`, `site/`, `_build/`, `_site/` 등, `node_modules/`·`coverage/` 같은 의존성·리포트 폴더, 템플릿 지시문(`{% %}`, `<% %>`, `{{#...}}`)이 있는 파일(`pre`·`code`·`textarea`·`script`·`style` 안의 예시는 지시문으로 보지 않음), git이 무시하는 파일(스캔으로 찾은 경우), `.doc-kit.json`의 `exclude`, `<meta name="doc-kit" content="off">`. 프로젝트 위쪽은 `.git`이 없으면 작업 폴더까지만 봅니다.
- `{{회사명}}` 같은 빈칸 표시와 CSS의 `{{`는 템플릿으로 보지 않습니다. `out/`, `target/`, `vendor/`도 앱 신호가 아닙니다. 프로젝트 신호가 없는 평범한 폴더에서는 `emails/`, `site/`, `public/`, `templates/` 같은 이름도 문서 폴더로 봅니다.
- `.doc-kit/` 안의 본문 파일은 건드리지 않습니다. 그 밖의 곳에 있는 본문 파일과 고친 뒤 되돌리지 않은 본문은 `apply`가 필요하다고 알립니다.

`exclude`는 경로와 글롭을 받습니다. 슬래시 없는 글롭은 폴더 깊이와 상관없이 이름에 맞춥니다.

```json
{"exclude": ["drafts/", "out2/**", "*.tmpl.html"]}
```

브라우저 시험을 돌리지 못했거나, 경고가 있거나, 스타일을 버렸으면 끝날 때 함께 알립니다. Cursor는 끝날 때 사용자에게 바로 보여 줄 길이 없어 평범한 완료 외의 내용을 모델을 거쳐(`followup_message`) 전합니다. 실제로 어떻게 보이는지는 실측 전입니다.

보장하지 못하는 경우: 훅을 설치하지 않은 환경에서 모델이 스킬을 쓰지 않을 때, Codex 훅을 승인하기 전, 세션을 닫아 끝날 때 훅이 다시 오지 않는 턴, 스크립트가 옮겨 수정 시각이 옛날로 남은 파일, 셸 변수 등으로 위치를 알 수 없는 쓰기(알리기만 합니다), 문서지능 출력, Claude Code Artifact.

**남는 한계**

- 작업 폴더 밖이나 점 폴더(`.cache/`, `.output/` 등)에 스크립트가 쓴 HTML은, 그 경로가 명령 글자에 직접 나오지 않으면(`python3 gen.py`가 안에서 정한 경로 등) 찾지 못할 수 있습니다.
- 바탕화면·다운로드·문서 폴더는 스크립트를 돌린 턴에 바로 아래(첫 단계)만 보고 `확인 필요`로 알립니다. 그 아래 폴더에 쓴 파일은 알리지 못합니다.
- 코드 프로젝트의 `build/`, `dist/`, `public/` 같은 앱 폴더에 생긴 HTML은 문서여도 제외하고 알리기만 합니다. 문서이면 `ensure`를 직접 실행하세요.
- 쓰기 도구나 쓰기 명령 없이 바뀐 작업 폴더 HTML(설치한 훅이 잡지 못하는 도구로 쓴 경우 포함)은 고치지 않고 알리기만 합니다.
- 스캔 상한(항목 20000개, 깊이 12단계)을 넘는 곳은 알리기만 합니다.

## 개발

```bash
npm install
npm run build   # src → skill/html-doc-kit/scripts/doc-kit.mjs
npm test        # 전체 시험(수십 분)
```

키트 코드(`src/kit/`)를 바꿔 내놓을 때는 `package.json`의 버전을 올립니다. `src/kit/versions.json`에 버전별 해시가 쌓여 옛 파일도 `check`를 통과합니다.

릴리스할 때는 `v<버전>` 태그(예: `git tag v1.0.0`)를 붙입니다. 태그가 없는 동안(배포 전)에는 빌드가 같은 버전의 해시를 새로 덮어쓰지만, 태그가 생긴 뒤로는 키트 코드가 태그 때와 다르면 `npm run build`가 "버전을 올린 뒤 다시 빌드하세요"로 멈춥니다(`tools/release-guard.mjs`). 같은 버전 번호로 해시가 바뀌면 이미 나간 파일이 모두 `check` C2에서 실패하기 때문입니다.
