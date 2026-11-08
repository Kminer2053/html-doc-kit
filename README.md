<div align="center">

# html-doc-kit

**HTML 문서에 뷰어와 편집기를 항상 넣어 주는 스킬**
_코딩 에이전트에게 **"이 내용 HTML로 만들어줘"** 한마디면 브라우저에서 바로 고치고 저장할 수 있는 파일이 나옵니다._

![Node 22+](https://img.shields.io/badge/Node-22%2B-339933?logo=nodedotjs&logoColor=white)
![에이전트](https://img.shields.io/badge/에이전트-Claude%20Code·Codex·Cursor-5E35B1)
![출력](https://img.shields.io/badge/출력-HTML%20한%20파일-267A68)
![키트](https://img.shields.io/badge/키트-1.0.0-2563EB)
![확인](https://img.shields.io/badge/확인-macOS·Windows-6B7280)
[![License: MIT](https://img.shields.io/badge/License-MIT-EAB308)](LICENSE)

[바로 시작](#5분-시작) · [사용 예시](#이렇게-씁니다-초간단-3단계) · [결과물](#결과물은-이렇게-생겼습니다) · [문서](#문서)

</div>

---

> [!IMPORTANT]
> **확인 범위(2026-11-08, 1단계 완료):** macOS에서 Claude Code·Codex는 낮은 등급 모델로 11개 요청 모두 뷰어·편집기가 든 파일이 나왔고, Cursor는 앱에서 훅이 도는 것을 확인했습니다. 만든 파일은 Chrome·Safari에서 보이기·고치기·저장을 확인했습니다. Windows 10(PowerShell 5.1·Git Bash)에서 설치·명령·훅과 Claude Code·Codex·Cursor CLI 실행을 확인했습니다(2026-11-08, 키트 없이 직접 쓴 HTML도 훅이 고침). Windows의 Chrome·Edge에서도 열기·고치기·저장을 자동으로 확인했고, Chrome에서는 사람이 진짜 저장 창으로 같은 파일 덮어쓰기와 그림 끌기까지 확인했습니다. Cursor 앱으로 만든 보고서도 통과했습니다([Windows 시험 안내](docs/WINDOWS_TEST.md)). 자세한 실측은 [실측 표](test/probe/RESULTS.md)에 있습니다.

## 이런 분께 좋습니다

에이전트가 만든 HTML 보고서를 받고 **"이거 조금만 고치려면 또 시켜야 하나?"** 에서 막히는 분들을 위해 만들었습니다.

- **에이전트에게 보고서·장표를 HTML로 시키는 분** — 받은 파일을 다시 에이전트에게 맡기지 않고 브라우저에서 바로 고치고 싶을 때
- **낮은 등급 모델을 쓰는 분** — 뷰어와 편집기가 빠진 파일이 나오면 안 될 때
- **세 에이전트를 섞어 쓰는 분** — Claude Code, Codex, Cursor 어디서 만들어도 같은 모양의 파일이 필요할 때

---

## 이렇게 씁니다 (초간단 3단계)

**1. 한 번 설치합니다.**
　예: `node skill/html-doc-kit/scripts/doc-kit.mjs install` ([5분 시작](#5분-시작))

**2. 에이전트에게 평소처럼 말합니다.**

```text
분기 실적 보고서를 HTML로 작성해줘.
10장짜리 발표 자료를 HTML로 만들어줘.
회의록을 html로 뽑아줘.
```

**3. 나온 파일을 브라우저로 엽니다.**
　글자를 누르면 고칠 수 있고, 그림은 끌어서 옮기며, ⌘S 또는 Ctrl+S로 저장합니다.

**스킬 이름을 말하지 않아도 됩니다. HTML 문서를 시키기만 하면 됩니다.**

---

## 결과물은 이렇게 생겼습니다

결과는 글꼴까지 든 HTML 한 파일입니다. 저장한 파일도 같은 기능을 가진 HTML 한 파일입니다.

| 구분 | 기능 |
|---|---|
| **뷰어** | 쪽 이동(단추, ← →, Space, PageUp/Down, Home, End) · 쪽 목록 · 연속 읽기(R) · 발표 메모(N) · 전체화면(F) · 경과 시간 · 창에 맞춘 배율 · 인쇄(편집 표시 없이 쪽별로) |
| **편집기** | 모든 글자와 표 칸 고치기 · 편집 켜고 끄기(E) · 서식 막대(굵게, 크기, 색, 지우기) · 발표 메모 고치기 · 그림 바꾸기와 끌어서 옮기기 · 넘침 경고 |
| **저장** | Chrome·Edge는 처음 고른 파일에 이어서 덮어쓰고, 파일이 밖에서 바뀌었으면 먼저 묻습니다. 그 밖의 브라우저는 내려받기로 저장합니다. 저장하지 않고 닫으면 고친 본문과 메모를 임시 저장에서 되살립니다 |
| **쪽 형태** | `slide`, `a4`, `a4-landscape`, `auto` |

---

## 왜 만들었나

- **장표 하나에 묶인 편집기를 모든 문서로** — 사내 발표 장표를 편집용으로 만들며 생긴 뷰어와 편집기를, 앞으로 시키는 모든 HTML 문서에 기본으로 넣기 위해 만들었습니다.
- **모델은 본문만, 뷰어·편집기는 키트가** — 모델이 뷰어·편집기 코드를 쓰지 않으니 낮은 등급 모델에서도 빠지지 않습니다.
- **지침을 어겨도 복구** — 모델이 HTML을 직접 써도 작업이 끝날 때 훅이 키트를 넣도록 설계했습니다(예외는 [주의할 점](#주의할-점)).

| 보통의 방식 | html-doc-kit |
|---|---|
| 모델이 뷰어·편집기까지 매번 새로 씀 | 모델은 본문만 쓰고 `build`가 입힘 |
| 빠지거나 망가져도 모름 | `check`가 완성·미완성을 종료 코드로 판정 |
| 고치려면 다시 에이전트에게 부탁 | 브라우저에서 바로 고치고 저장 |

---

<div align="center"><sub>여기부터는 동작 원리와 설치, 세부 규칙입니다. 쓰기만 할 분은 <a href="#5분-시작">5분 시작</a>의 설치 명령만 보시면 됩니다.</sub></div>

---

## 동작 원리

**본문 작성 → `build`(뷰어·편집기 입히기) → `check`(완성 판정) → 끝날 때 훅이 한 번 더 확인.**

- 모델은 본문만 마크다운이나 HTML 조각으로 씁니다. 표기법은 [`references/input.md`](skill/html-doc-kit/references/input.md)에 있습니다.
- 뷰어·편집기는 고정 명령이 넣습니다. 모델이 관여하지 않습니다.
- 이미 만든 파일은 `extract`로 본문만 꺼내 고치고 `apply`로 되돌립니다. 사용자가 브라우저에서 고친 내용과 메모는 그대로 남습니다.
- 모델이 지침을 어기고 HTML을 직접 써도 작업이 끝날 때 훅이 복구하도록 설계했습니다. 훅이 어떤 파일을 고치는지는 [훅이 건드리는 파일](#훅이-건드리는-파일)에 있습니다.

---

## 5분 시작

**사전 요건:** Node 22 이상. 실행에 필요한 것은 `skill/html-doc-kit/` 안에 모두 들어 있습니다.

```bash
# 1. 저장소 받기
git clone https://github.com/Kminer2053/html-doc-kit.git
cd html-doc-kit

# 2. 세 에이전트에 설치
node skill/html-doc-kit/scripts/doc-kit.mjs install

# 3. 점검 (문제가 있으면 종료 코드 1)
node skill/html-doc-kit/scripts/doc-kit.mjs doctor
```

설치 후 에이전트에게 이렇게 말해 보세요.

```text
이번 분기 실적 보고서를 HTML로 만들어줘. 내용은 예시로 채워.
```

`install`은 세 에이전트의 스킬, 전역 지침, 훅을 넣습니다. 기존 설정은 보존합니다. 처음 고칠 때 `*.doc-kit-bak`을, 그 뒤로 내용이 바뀔 때마다 시각을 붙인 백업을 남깁니다. 다시 설치하거나 제거할 때는 키트가 넣은 훅 항목만 빼므로 같은 그룹의 사용자 훅은 남습니다.

### Claude Code

```bash
node skill/html-doc-kit/scripts/doc-kit.mjs install --agents claude
```

설치 뒤 바로 씁니다. 스킬은 `~/.claude/skills/html-doc-kit`, 지침은 `~/.claude/CLAUDE.md`, 훅은 `~/.claude/settings.json`에 들어갑니다.

### Codex

```bash
node skill/html-doc-kit/scripts/doc-kit.mjs install --agents codex
```

스킬은 `~/.agents/skills/html-doc-kit`, 지침은 `~/.codex/AGENTS.md`, 훅은 `~/.codex/hooks.json`에 들어갑니다.

> [!CAUTION]
> **Codex는 훅을 처음 한 번 직접 승인해야 합니다.** 터미널에서 `codex`를 실행해 안내를 따르세요. 승인 전에는 Codex에서 자동 복구가 돌지 않으며, `doctor`는 prompt·post·stop 세 훅의 승인을 보고 하나라도 없으면 문제로 알립니다. Codex를 쓰지 않으면 `uninstall --agents codex`로 빼세요.

### Cursor

```bash
node skill/html-doc-kit/scripts/doc-kit.mjs install --agents cursor
```

스킬은 `~/.agents/skills/html-doc-kit`, 지침은 `~/.cursor/rules/html-doc-kit.mdc`, 훅은 `~/.cursor/hooks.json`에 들어갑니다. CLI에서 다른 점은 [주의할 점](#주의할-점)에 있습니다.

### 일부 에이전트만

`--agents codex`처럼 일부만 넣고 뺄 수 있습니다(`uninstall --agents cursor`). 함께 쓰는 스킬 폴더와 실행 파일은 쓰는 에이전트가 없어질 때 지웁니다.

---

## 직접 실행하기 (CLI)

`doc-kit`은 `node skill/html-doc-kit/scripts/doc-kit.mjs`입니다(설치 뒤에는 `~/.doc-kit/bin/doc-kit.mjs`).

```text
build <본문.md|본문.html> -o <결과.html> [--type slide|a4|a4-landscape|auto] [--title 제목]
ensure <파일.html> [-o 결과.html]    어떤 HTML이든 완성 파일로 만듭니다(이미 완성이면 그대로). 마크다운은 같은 이름의 .html로 냅니다
check <파일.html>                    완성 여부 판정. 0 완성, 1 미완성, 2 입력 문제
extract <파일.html> [-o 본문.html]   완성 파일에서 본문만 꺼냅니다(기본 위치 .doc-kit/)
apply <본문.html> <파일.html> [--shrink]  고친 본문을 완성 파일로 되돌립니다. 쪽을 일부러 줄였으면 --shrink
upgrade <파일.html>                  키트를 최신으로 바꿉니다
install | uninstall | doctor         에이전트 설치·제거·점검(--home 경로, --agents claude,codex,cursor)
공통: --no-browser 브라우저 시험 생략
```

```bash
# 1. 본문으로 장표 만들기
node skill/html-doc-kit/scripts/doc-kit.mjs build 본문.md -o 결과.html --type slide

# 2. 완성 판정
node skill/html-doc-kit/scripts/doc-kit.mjs check 결과.html   # -> 종료 코드 0이면 완성
```

본문 표기법은 [`skill/html-doc-kit/references/input.md`](skill/html-doc-kit/references/input.md)에 있습니다.

---

## 훅이 건드리는 파일

모델이 지침을 어기고 HTML을 직접 썼을 때 작업이 끝나며 훅이 하는 일입니다.

- **고치는 근거는 둘뿐** — 에이전트가 그 경로에 썼다는 직접 증거(도구의 파일 경로, 셸 명령의 쓰기 대상)가 있거나, 쓰기가 있었던 턴에 작업 폴더에서 바뀐 파일일 때만 고칩니다. 그 밖은 `확인 필요`로 알리기만 합니다.
- **평범한 HTML** — 제자리에서 입히고, 원본은 `.doc-kit/backup/`에 둡니다.
- **자체 스크립트가 있는 HTML** — 그대로 두고 옆에 `이름_편집용.html` 사본을 만듭니다.
- **건드리지 않는 곳** — 웹앱·웹사이트 프로젝트의 앱 폴더, 템플릿 파일, git이 무시하는 파일, 바탕화면·다운로드·문서 폴더(직접 쓴 증거가 없을 때), `.doc-kit.json`의 `exclude`, `<meta name="doc-kit" content="off">`가 든 파일. 모두 이유를 알립니다.

상세: [`docs/HOOKS.md`](docs/HOOKS.md)

---

## 주의할 점

> **보장하지 못하는 경우:** 훅을 설치하지 않은 환경에서 모델이 스킬을 쓰지 않을 때, Codex 훅을 승인하기 전, 세션을 닫아 끝날 때 훅이 다시 오지 않는 턴, 스크립트가 옮겨 수정 시각이 옛날로 남은 파일, 셸 변수 등으로 위치를 알 수 없는 쓰기(알리기만 합니다), 문서지능 출력, Claude Code Artifact.

- **작업 폴더 밖·점 폴더** — 스크립트가 안에서 정한 경로에 쓴 HTML은 찾지 못할 수 있습니다.
- **코드 프로젝트의 앱 폴더** — `build/`, `dist/`, `public/`에 생긴 HTML은 문서여도 알리기만 합니다. 문서이면 `ensure`를 직접 실행하세요.
- **Cursor CLI `-p`(print) 실행** — 끝날 때 결과를 화면에 보여 주지 못하고 `~/.doc-kit/hook.log`에만 남깁니다. 예전에 설치했으면 `install`을 다시 실행하세요.
- **Cursor CLI 전역 지침** — 작업 폴더가 홈 밖(`/tmp`, 외장 디스크 등)이면 전역 지침이 빠집니다. 스킬과 훅은 그대로 돕니다.
- **모델이 파일을 쓰지 않을 때** — 되묻기만 하거나 대화창에 HTML을 출력하면 고칠 파일이 없어 키트가 들어가지 않습니다.
- **다른 포맷 변환** — PDF·HWPX·DOCX·PPTX를 고칠 수 있는 HTML로 바꾸는 기능은 아직 없습니다(2단계 이후).

자세한 한계는 [`docs/HOOKS.md`](docs/HOOKS.md#남는-한계)에 있습니다.

---

## 내 파일은 어떻게 되나요?

- **모두 이 컴퓨터에서 돕니다** — 키트는 외부로 아무것도 보내지 않습니다. 완성 판정의 브라우저 시험도 이 컴퓨터의 Chrome이나 Edge를 띄워 돌립니다.
- **원본은 남깁니다** — 훅이 제자리에서 고친 파일의 원본은 `.doc-kit/backup/`에, 설치가 고친 에이전트 설정의 원본은 `*.doc-kit-bak`에 있습니다.
- **끄는 방법** — 파일 하나는 `<meta name="doc-kit" content="off">`, 폴더는 `.doc-kit.json`의 `exclude`, 전부는 `uninstall`입니다.

> [!CAUTION]
> 훅이 자동으로 고친 파일은 끝날 때 경로를 알립니다. 중요한 문서는 열어 확인하세요.

---

## FAQ

**웹앱이나 웹사이트의 HTML도 바꾸나요?** 아닙니다. 웹 프레임워크·빌드 설정이 있는 프로젝트와 앱 폴더는 건드리지 않고 이유만 알립니다.

**모델이 스킬을 안 쓰고 HTML을 직접 쓰면요?** 작업이 끝날 때 훅이 키트를 넣습니다. 끝난 뒤 `check`가 0이면 완성입니다.

**Windows에서도 되나요?** 됩니다. Windows 10에서 설치, 명령, 훅(Git Bash·PowerShell·cmd), Claude Code·Codex·Cursor CLI 실행을 확인했습니다. 훅은 Node 22 이상이 시스템 PATH에 있으면 어느 셸에서나 돌고, 없으면 `doctor`가 알려 줍니다. Codex 앱만 깔아 `codex` 명령이 없으면 훅 승인은 앱 안의 `codex.exe`에 `--no-daemon`을 붙여 실행해 합니다(`doctor`가 경로를 알려 줌). Chrome에서 진짜 저장 창으로 덮어쓰기와 그림 끌기를 확인했고, Cursor 앱으로 만든 보고서도 통과했습니다. Chrome은 `AppData` 아래(임시 폴더 포함)에는 저장을 막으니, 고칠 문서는 문서 폴더 같은 곳에 두세요. [Windows 시험 안내](docs/WINDOWS_TEST.md)로 직접 시험할 수 있습니다.

**글자가 없는 스캔 PDF도 바꿔 주나요?** 아닙니다. 다른 포맷 변환은 2단계 과제이며, 글자가 없는 스캔 PDF는 처리하지 않습니다.

---

## 리포 구성

```text
html-doc-kit/
├── skill/html-doc-kit/        # 설치되는 스킬 (실행에 필요한 것 전부)
│   ├── SKILL.md               # 에이전트가 읽는 지침
│   ├── references/input.md    # 본문 표기법
│   ├── scripts/doc-kit.mjs    # 빌드된 단일 실행 파일
│   └── assets/OFL.txt         # 내장 글꼴 라이선스
├── src/
│   ├── kit/                   # 뷰어·편집기 코드와 글꼴, 버전별 해시
│   └── cli/                   # 명령·설치·훅
├── test/                      # 회귀·편집기·복구 시험, 에이전트 실측
├── reference/                 # 원래 장표에서 옮겨 온 회귀 목록과 원본 시험
├── tools/                     # 번들러, 글꼴 생성, 릴리스 가드
├── docs/
│   ├── HOOKS.md               # 훅이 건드리는 파일과 남는 한계
│   └── WINDOWS_TEST.md        # Windows 시험 안내
├── LICENSE                    # MIT
├── PRD.md                     # 요구사항
└── PLAN.md                    # 작업계획과 진행 현황
```

---

## 개발과 검증

```bash
npm install
npm run build   # src → skill/html-doc-kit/scripts/doc-kit.mjs
npm test        # 전체 시험(수십 분)
```

키트 코드(`src/kit/`)를 바꿔 내놓을 때는 `package.json`의 버전을 올립니다. `src/kit/versions.json`에 버전별 해시가 쌓여 옛 파일도 `check`를 통과합니다.

릴리스할 때는 `v<버전>` 태그(예: `git tag v1.0.0`)를 붙입니다. 태그가 생긴 뒤로는 키트 코드가 태그 때와 다르면 `npm run build`가 "버전을 올린 뒤 다시 빌드하세요"로 멈춥니다(`tools/release-guard.mjs`). 같은 버전 번호로 해시가 바뀌면 이미 나간 파일이 모두 `check` C2에서 실패하기 때문입니다.

---

## 문서

| 문서 | 내용 |
|---|---|
| **[PRD.md](PRD.md)** | 요구사항, 확정된 결정, 단계별 목표 |
| **[PLAN.md](PLAN.md)** | 작업계획과 진행 현황 |
| **[docs/HOOKS.md](docs/HOOKS.md)** | 훅이 건드리는 파일과 남는 한계 |
| **[docs/WINDOWS_TEST.md](docs/WINDOWS_TEST.md)** | Windows 시험 안내(에이전트에 붙여 넣을 프롬프트) |
| **[test/REGRESSION_STATUS.md](test/REGRESSION_STATUS.md)** | 회귀 목록 이행 현황 |
| **[test/probe/RESULTS.md](test/probe/RESULTS.md)** | 세 에이전트 실측 |
| **[skill/html-doc-kit/references/input.md](skill/html-doc-kit/references/input.md)** | 본문 표기법 |

---

## 크레딧 & 라이선스

사내 발표 장표를 편집용으로 만들며 생긴 뷰어·편집기에서 출발해 분리한 스킬입니다. 기여는 언제든 환영합니다. 이슈나 PR을 열어 주세요.

[MIT License](LICENSE)로 배포합니다. 내장 글꼴(Noto Sans CJK KR 부분 집합)은 SIL Open Font License 1.1을 따르며 전문은 [`skill/html-doc-kit/assets/OFL.txt`](skill/html-doc-kit/assets/OFL.txt)에 있습니다.

---

<div align="center">

**본문만 쓰세요. 뷰어와 편집기는 키트가 넣습니다.**

[처음부터 시작하기](#5분-시작) · [요구사항](PRD.md) · [피드백 남기기](https://github.com/Kminer2053/html-doc-kit/issues)

</div>
