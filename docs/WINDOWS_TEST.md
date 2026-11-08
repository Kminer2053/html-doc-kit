# Windows 시험 안내

html-doc-kit은 macOS에서만 확인했습니다. 아래 프롬프트를 Windows PC의 코딩 에이전트(Claude Code, Codex, Cursor 중 하나)에 그대로 붙여 넣으면 설치부터 시험, 결과 보고까지 진행합니다. 브라우저에서 직접 고치고 저장해 보는 단계만 사람이 합니다.

## 붙여 넣을 프롬프트

```text
이 Windows PC에서 html-doc-kit(https://github.com/Kminer2053/html-doc-kit)이 제대로 설치되고 동작하는지 시험해 줘. 이 키트는 macOS에서만 확인됐고, 이번 시험의 목적은 Windows에서만 생기는 문제를 찾는 것이다. 답과 보고는 한국어로 해 줘.

지킬 것
- 키트 코드는 고치지 마. 문제를 찾으면 재현 방법과 실제 출력을 기록만 해.
- 로그인이나 훅 승인은 내가 직접 한다. 필요하면 멈추고 알려 줘. --yolo, --force, 훅 승인 우회 옵션은 쓰지 마.
- 시험 파일은 %TEMP%\dk-win 아래에만 만들어. 다른 프로젝트 폴더는 건드리지 마.
- 명령마다 실제 출력과 종료 코드를 남겨. 추측으로 "통과"라고 쓰지 마.

1. 환경 확인
- node -v(22 이상이어야 함), git --version, PowerShell 버전, Windows 버전을 기록해.
- Chrome(C:\Program Files\Google\Chrome\Application\chrome.exe)과 Edge(C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe)가 있는지 확인해.
- git config core.autocrlf 값을 기록해.

2. 내려받기와 설치
- %TEMP%\dk-win\repo에 저장소를 clone해.
- clone한 폴더에서 git status가 깨끗한지 확인해. 줄바꿈 변환 때문에 바뀐 파일이 보이면 기록해.
- node skill\html-doc-kit\scripts\doc-kit.mjs install을 실행하고, 이어서 doctor를 실행해.
- 설치된 파일을 열어 확인해: %USERPROFILE%\.doc-kit\bin\doc-kit.mjs, %USERPROFILE%\.claude\settings.json, %USERPROFILE%\.codex\hooks.json, %USERPROFILE%\.cursor\hooks.json, 그리고 각 에이전트의 skills 폴더에 들어간 html-doc-kit.
- 훅 명령 문자열의 node 경로와 doc-kit.mjs 경로가 Windows에서 그대로 실행되는지 확인해. 사용자 이름에 공백이나 한글이 있으면 특히 확인해. 훅 명령 하나를 직접 실행해서 오류 없이 끝나는지 봐.
- Codex를 쓴다면 doctor가 훅 승인이 필요하다고 할 것이다. 그때 멈추고 나에게 codex를 실행해 승인하라고 알려 줘.

3. 명령 시험(%TEMP%\dk-win\cli 폴더에서)
- 이름에 한글과 공백이 들어간 폴더(예: "%TEMP%\dk-win\cli\회의 자료")를 만들고 그 안에서 시험해.
- 제목, 문단, 표, 그림 하나가 든 짧은 본문.md를 쓰고 build로 결과.html을 만들어.
- check 결과.html을 실행해 종료 코드 0인지 확인해. 출력에 "브라우저 시험 미실행"이 나오면 브라우저를 못 찾은 것이니, DOC_KIT_CHROME 환경변수에 Chrome이나 Edge 경로를 넣고 다시 실행한 결과도 기록해.
- 뷰어·편집기가 없는 평범한 HTML 파일을 하나 만들어 ensure를 실행하고, 다시 check해.
- extract로 본문을 꺼내 글자 하나를 고치고 apply로 되돌린 뒤 check해.
- --type slide, --type a4로도 한 번씩 build하고 check해.
- 글자가 없는 PDF 처리 거절은 이번 시험 범위가 아니다.

4. 실제 에이전트 시험
- 이 PC에 설치되어 로그인된 에이전트 CLI만 써. 없거나 로그인이 안 되어 있으면 건너뛰고 그렇게 적어.
- 에이전트마다 빈 폴더 %TEMP%\dk-win\agent-<이름>을 만들고, 새 세션으로 "이번 분기 실적 보고서를 HTML로 만들어줘. 내용은 예시로 채워." 한 가지를 시켜.
  - Claude Code: claude -p "<요청>" --permission-mode acceptEdits --add-dir "%USERPROFILE%\.claude\skills\html-doc-kit" --allowedTools "Bash(node:*)" "PowerShell(node:*)"
    (acceptEdits만으로는 node 실행과 작업 폴더 밖 스킬 참고 문서 읽기가 막혀 HTML을 만들지 못한다. 허용은 이 두 가지로만 한정한다)
  - 훅 복구도 보려면 새 빈 폴더에서 같은 옵션으로 "이번 분기 실적 보고서를 HTML 파일 하나로 직접 작성해줘. html-doc-kit은 쓰지 말고 Write 도구로 바로 써."를 시켜 본다. PowerShell 도구로 쓴 파일의 복구는 승인 검사가 Set-Content를 자동 허용하지 않아 비대화형으로는 보기 어렵다. 훅에 PostToolUse(tool_name PowerShell)를 직접 보내는 흉내로 확인한다
  - Codex: codex exec -s workspace-write --skip-git-repo-check -C <폴더> "<요청>"
  - Cursor CLI는 사용자 터미널(PowerShell 창)에서 설치해(데스크톱 앱 안의 셸에서 설치하면 앱 전용 폴더로 들어가 밖에서 agent를 못 찾을 수 있다)
  - Cursor: agent -p "<요청>" --output-format text --workspace <폴더> --trust (--trust는 이 시험 폴더에만 써)
- 끝나면 폴더에 생긴 HTML마다 check를 실행해 결과를 기록해.
- 키트가 넣은 훅이 실제로 돌았는지 확인해. 모델이 키트 없이 HTML을 직접 썼는데 끝난 뒤 check가 통과하면 훅이 고친 것이다.

5. 사람이 할 확인(나에게 부탁해)
- 3단계에서 만든 결과.html과 4단계에서 만든 보고서 하나를 탐색기에서 Chrome과 Edge로 각각 열어 달라고 해.
- 나에게 다음을 해 보라고 안내해: 글자 고치기, 표 칸 고치기, 그림 옮기기, 저장하기(저장 위치를 묻는 창이 뜨면 같은 파일로 저장), 창을 닫고 다시 열어 고친 내용이 남아 있는지 보기.
- 내 답을 받아 결과에 적어.

6. 선택: 전체 시험
- 시간이 되면 저장소 폴더에서 npm install 뒤 npm test를 실행해(수십 분 걸린다). AX2030 원본이 없어 건너뛰는 시험과 python3가 없어 실패하는 시험은 Windows 문제가 아니니 따로 표시해.

7. 결과 보고
- %TEMP%\dk-win\WINDOWS_RESULTS.md에 결과를 써. 항목마다 통과, 실패, 건너뜀 중 하나와 근거(명령, 출력 일부, 종료 코드)를 표로 정리해.
- 실패는 재현 방법과 실제 출력을 그대로 붙이고, 원인으로 보이는 곳(파일과 줄)이 있으면 추정이라고 밝히고 적어.
- 마지막에 결과 파일 위치와 실패 요약을 나에게 알려 줘. 저장소에 커밋하거나 푸시하지는 마.
```

## 결과를 받은 뒤

`WINDOWS_RESULTS.md`를 Mac 쪽 작업 세션에 넘기면 고칠 곳을 정리해 반영합니다.
