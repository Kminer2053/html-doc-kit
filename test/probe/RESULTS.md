# P1-0 세 에이전트 실측

재실행: `node test/probe/setup.mjs <임시 폴더>`로 시험 폴더를 만든 뒤 각 CLI를 그 안에서 돌립니다. `codex exec`는 표준 입력을 닫아야 합니다(`</dev/null`). 안 닫으면 입력을 기다리며 멈춥니다.

## 2026-11-07 결과

| 항목 | Claude Code | Codex 0.145 | Cursor |
|---|---|---|---|
| CLI 로그인 | 만료, 모델 호출 실패 | 됨 | 안 됨(`agent login` 필요) |
| 프로젝트 스킬 자동 호출 | 미확인 | **확인.** 가장 낮은 등급 모델이 `.agents/skills`의 스킬을 언급 없이 불렀다 | 미확인 |
| 턴 시작 훅 | **확인.** 입력에 `session_id`, `transcript_path`가 온다 | 신뢰 전 작동 안 함 | 미확인 |
| 파일 저장 뒤·끝날 때 훅 | 미확인 | 신뢰 전 작동 안 함 | 미확인 |
| Bash로 쓴 파일을 끝날 때 찾기 | 미확인 | 미확인 | 미확인 |
| 훅 안에서 Chrome 실행 | 미확인 | 미확인 | 미확인 |
| IDE·데스크톱 앱 | 자동 시험 불가, 직접 확인 필요 | 자동 시험 불가, 직접 확인 필요 | 자동 시험 불가, 직접 확인 필요 |

## 2026-11-08 추가 실측

- Codex: 사용자가 대화형 `codex`에서 훅 세 개를 신뢰한 뒤 `~/.codex/config.toml`에 `hooks.state."/Users/<사용자>/.codex/hooks.json:<이벤트>:0:0"` 형식으로 기록됐다. 이후 `codex exec`에서 prompt·post·stop 훅이 돌았고, 스킬 없이 셸로 쓴 HTML에 Stop 훅이 키트를 넣었다.
- Claude Code: `claude -p`에서 스킬·훅이 돌고 낮은 모델 시험 11건이 통과했다.
- Cursor CLI: `agent -p`에서는 사용자 훅이 돌지 않는다. 프로젝트 훅은 `--trust` 뒤 `afterFileEdit`만 돈다. 새 폴더마다 신뢰를 묻고, 답하지 않으면 아무 일도 하지 않는다.

## 설계에 반영할 것

- **Codex 훅은 사용자 승인이 있어야 돈다.** 프로젝트 `.codex/hooks.json`도, `-c`로 넣은 훅도 실행되지 않았다. `~/.codex/config.toml`의 `hooks.state`에 훅별 `trusted_hash`가 기록되는 구조로 보인다. 설치 프로그램이 신뢰를 대신 쓰지 않고, 사용자가 처음 한 번 승인하게 안내한다. `doctor`는 승인 여부를 점검해야 한다. 승인 경로는 아직 직접 확인하지 않았다.
- `--dangerously-bypass-hook-trust`와 Cursor `--force`는 시험에서 쓰지 않는다(안전 검사가 막았고, 실제 사용 환경과도 다르다).
- 승인 전에는 Codex에서 PRD 5.6의 3겹(훅)이 없다. 그동안은 스킬과 지침만 작동한다.
