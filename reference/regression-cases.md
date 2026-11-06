# 편집기 회귀 시험 목록

AX2030 편집용 HTML을 독립 검증하며 재현한 문제입니다. 1차는 첫 판, 2차는 고친 판에서 나왔습니다.
문서 키트의 편집기는 이 항목을 모두 다시 시험해 통과해야 합니다. 2차 뒤 고치지 않고 받아들인 항목은 PLAN.md의 P1-3에 적었습니다.

## 1차 검증

| 번호 | 갈래 | 정도 | 문제 | 위치 |
|---|---|---|---|---|
| 1차-1 | behavior | high | 임시 저장 안내(불러오기/버리기)를 고르지 않은 채 저장하면 안내 없이 임시 저장이 지워져 이전 편집이 영구히 사라진다. | work/headquarters-meeting-v6/tools/editor/editor.js afterSave(335-341행)의 localStorage.remo |
| 1차-2 | behavior | high | 칸을 비우고 저장한 뒤 다시 열면(임시 저장 불러오기도 같음) 그 칸은 편집 칸에서 빠져 다시 쓸 수 없다. 친 글자는 버려지거나 옆 칸으로 들어간다. | editor.js markHosts(37-44행). 글자 노드가 있는 요소와 '자식 없는 빈 td'만 칸으로 삼는데, 비운 칸에는 <br>이 남는다. |
| 1차-3 | behavior | medium | 장표의 빈 곳(여백 등)을 누르면 가까운 칸으로 커서가 들어가, 칸 밖에서 쓰는 Space·N·→ 등이 글자 입력이나 커서 이동이 된다. 쪽이 안 넘어가고 장표 글자가 바뀐다. | 편집 켜진 상태의 칸 바깥 영역 클릭(editor.js setEditing 66행의 contentEditable과 브라우저 커서 배치) |
| 1차-4 | behavior | medium | 칸을 비우면 732칸 중 169칸이 폭이나 높이 0으로 줄어든다. 그중 87칸은 원래 자리를 눌러도 그 칸으로 돌아오지 못한다(같은 창에서는 ⌘Z만 가능). | 편집 대상 칸 전체(빈 칸의 최소 크기 없음). 예: 각 쪽 머리의 .brand, 꼬리의 'NN / 15', 5쪽 현황 파악, 6쪽 D-1~D-4, 11쪽 B-1 |
| 1차-5 | behavior | medium | 가로 배치(flex) 칸에서 일부 글자만 서식을 주면 글자가 조각나 흩어지거나 줄이 깨진다. | editor.js 서식 막대(245-268행)가 만드는 <span>이 flex 항목이 되는 칸. 13쪽 .budget-table-title, 12쪽 '2029 전 |
| 1차-6 | behavior | medium | 메모(N)를 열거나 창을 줄이면 고친 내용과 상관없이 거짓 넘침 경고와 주황 테두리가 뜬다. | editor.js overflowOf·checkOverflow(119-144행)와 baseOver(449-452행). 처음 연 배율에서만 기준을 재서, 배율이 바 |
| 1차-7 | behavior | medium | ⌘A 후 덮어쓰면 범례 색 표시나 화살표가 든 칸은 새 글자가 표시 요소 안으로 들어가 모양이 깨진다. | 11쪽 범례 '체류 인구'·'집중 구역', 14쪽 '↔ 기획·측정'·'↔ 변화·실행' |
| 1차-8 | behavior | medium | 끝에 줄바꿈이 붙은 글을 붙여넣으면 빈 줄이 하나 더 생겨 표 행이 커지고 넘침 경고가 뜬다. | editor.js paste 처리(167-170행). 끝의 빈 줄도 insertLineBreak를 실행한다. |
| 1차-9 | behavior | medium | 넘침 경고 문구가 쪽을 넘겨도 바뀌지 않는다. 멀쩡한 쪽에 경고가 뜨고, 넘치는 쪽으로 돌아와도 문구가 없을 수 있다. | editor.js checkOverflow(131-144행). 쪽 이동(go) 때 다시 계산하지 않는다. |
| 1차-10 | behavior | medium | 연속 읽기(R)에서는 보고 있는 쪽과 현재 쪽이 따로 논다. 메모를 열어 고치면 다른 쪽 메모가 바뀌고, →를 누르면 엉뚱한 쪽으로 뛴다. | 장표 스크립트 index(스크롤로 안 바뀜), editor.js syncBook(89행)의 BOOK.pages[index] |
| 1차-11 | behavior | medium | 큰 그림으로 바꾼 뒤에는 임시 저장이 아무 알림 없이 멈춘다. 그 뒤 고친 내용과 그림은 창이 닫히면 복구되지 않는다. | editor.js saveDraft(380-395행). 저장 공간 초과 오류를 삼킨다. |
| 1차-12 | behavior | medium | 안내를 고르지 않고 다른 글을 고치면 임시 저장의 이전 메모 수정이 덮여 사라진다(장표 글은 합쳐지는데 메모는 통째로 덮어쓴다). | editor.js saveDraft(392행)의 book: BOOK |
| 1차-13 | behavior | low | 넘친 채 저장한 파일을 다시 열면 그 넘침이 기준값이 되어 경고가 전혀 뜨지 않는다. | editor.js baseOver(449-452행) |
| 1차-14 | behavior | low | 입력 뒤 0.8초 안에 창을 닫거나 새로고침하면 마지막 입력이 임시 저장에 들어가지 않는다. | editor.js touch(83행)의 800ms 대기, beforeunload(371행)에서 임시 저장을 하지 않음 |
| 1차-15 | behavior | low | 서식 막대와 그림 막대가 고른 글자나 그림에서 떨어져 남는다. | editor.js selectionchange(222-232행), 그림 막대 click 처리(272-281행) |
| 1차-16 | behavior | low | 표지에 보이는 제목을 고쳐도 쪽 목록·메모 제목·탭 제목이 바뀌지 않는다. | editor.js syncBook(91행). .page-header h1만 동기화하는데, 표지에 보이는 것은 .cover-title h1이다. |
| 1차-17 | behavior | low | 글자 묶음이 섞인 문단에서 '지우기'와 '굵게'가 사용자 서식뿐 아니라 장표 원래의 굵은 글씨·색·작은 글씨까지 없앤다. | editor.js 서식 막대(265행)의 removeFormat·bold. 10쪽 '추정 계획소요', 13쪽 '연도별 계획소요 (백만원)' |
| 1차-18 | behavior | low | 메모의 핵심 문장에 Enter로 넣은 줄바꿈이 쪽을 다녀오면 화면에서 사라진다(자료에는 남아 있음). | editor.js syncBook(90행), #note-key의 white-space:normal |
| 1차-19 | behavior | low | 바꾼 그림이 틀보다 작으면 늘어나지 않고 작게 가운데에 놓인다. 표지 아래 띠는 글이 길어지면 위로 자라 표지를 덮는데 경고가 없다. | 표지 .source-figure img(max-width/max-height만 적용), .cover-bottom과 overflowOf(119-130행) |
| 1차-20 | behavior | low | 12쪽 간트의 빈 연도 칸은 눌러도 커서가 들어가지 않아 글자를 쓸 수 없고, 일정 막대도 고칠 수 없다. | editor.js markHosts(42-44행). 12쪽 td.year-cell은 빈 <div>를 품고 있어 칸에서 제외된다. |
| 1차-21 | visual | medium | 실제로 글이 잘리거나 가려지는데 넘침 경고가 없다. 표지, 고정 높이 띠, 원, 옆 칸처럼 .page-body 바닥을 넘지 않는 넘침을 잡지 못한다. | 표지·3쪽 지향점 띠·11쪽 왼쪽 사업 데이터·12쪽 2029 원 / editor.js overflowOf(119-130행)는 .page-body 바닥, .pan |
| 1차-22 | visual | medium | 슬라이드 내용을 고치지 않았는데 넘침 경고와 주황 테두리가 뜬다. 메모를 열거나 창을 줄여 배율이 바뀌면 글줄이 달라지는데, 기준값은 처음 열 때의 배율로만 재기 때문이다. | editor.js baseOver(449행)와 checkOverflow(131행) / 메모 패널·창 크기 변경 |
| 1차-23 | visual | medium | 쪽을 옮겨도 경고 문구가 다시 계산되지 않는다. 멀쩡한 쪽에 '이 장 내용이 넘칩니다'가 남고, 정작 넘치는 쪽으로 돌아오면 문구가 없다. | 상단 #ed-status / editor.js checkOverflow는 글 수정·편집 전환·저장 때만 돈다(쪽 이동 때는 안 돎) |
| 1차-24 | visual | medium | 경고가 떠 있는 동안 저장하면 '저장됨' 표시가 나오지 않아 저장됐는지 화면으로 알 수 없다. 위 문제로 경고가 다른 쪽까지 따라다녀 이 상황이 더 자주 생긴다. | editor.js showStatus(145-149행): 경고 문구가 저장됨 문구보다 앞선다 |
| 1차-25 | visual | medium | 글자를 고른 채 쪽을 넘기면 서식 막대가 다음 쪽에 그대로 남아 내용을 가린다. | 서식 막대 / 다음 쪽 단추·쪽 목록으로 이동할 때 |
| 1차-26 | visual | low | 연속 읽기에서 글자를 고른 채 스크롤하면 서식 막대가 제자리에 남아 다른 쪽 내용을 가린다. | R 연속 읽기 / editor.js placeBar는 선택이 바뀔 때만 위치를 잡는다 |
| 1차-27 | visual | low | 그림 바꾸기 버튼을 띄운 뒤 키보드로 쪽을 넘기면 버튼이 다음 쪽에 남는다. | 그림 바꾸기 버튼 / 표지 그림·로고 클릭 뒤 → 키 |
| 1차-28 | visual | low | 넘친 채로 저장하고 다시 열면 경고가 없어진다. 저장된 넘침을 원래 상태로 재기 때문이다. | editor.js baseOver(449행) |
| 1차-29 | visual | low | 눈에 보이는 문제가 없는데 작은 값으로 넘침 경고가 뜬다. 장표 영역 아래에 쪽번호 선까지 약 16px 여유가 있어 이만큼은 잘리지 않는다. | 5·8·11·12쪽 / editor.js OVER_TOLERANCE=1 |
| 1차-30 | visual | low | 일부 칸은 마우스를 올린 표시와 커서가 있는 칸 표시가 거의 보이지 않는다. 테두리가 부모에 잘리거나 어두운 파란 바탕에 묻힌다. | 2쪽 대내외 환경 줄, 3쪽 지향점, 12쪽 머리줄 등 / editor.css 5-6행 outline |
| 1차-31 | visual | low | 처음 열었을 때 글자를 눌러 고칠 수 있다는 안내가 맨 아래 작은 글자 한 줄뿐이다. | 첫 화면 / 아래쪽 안내 줄 |
| 1차-32 | visual | low | 경고 문구가 나타나면 위쪽 버튼들이 왼쪽으로 밀려 저장 단추 위치가 바뀐다. | 상단 조작 막대(쪽 목록 칸이 줄어듦) |
| 1차-33 | visual | low | 표지 제목을 고쳐도 쪽 목록과 메모 제목이 바뀌지 않는다. | 1쪽 / editor.js syncBook은 .page-header h1만 본다(표지의 보이는 제목은 다른 h1) |
| 1차-34 | visual | low | E로 편집을 끈 화면에서도 아래 안내가 그대로 '글자를 눌러 바로 고칩니다 … E 편집 끄기'다. | 아래쪽 안내 줄 |
| 1차-35 | code | high | 내려받기 저장이 거부·취소돼도 '저장됨'으로 처리되고 임시 저장까지 지워져, 경고 없이 글이 전부 사라진다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:361-369 save,  |
| 1차-36 | code | medium | 저장 중 AbortError 말고 다른 오류가 나면 안내 없이 내려받기로 넘어가 '저장됨'으로 표시하고 임시 저장을 지운다. 저장 단추를 두 번 눌러도 이 경로를 탄다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:356-369 |
| 1차-37 | code | medium | 칸의 글자를 모두 지우면 다시 칠 수 없는 경우가 있다. 저장 후 다시 열거나 임시 저장을 불러오면 비운 칸은 전부 편집 칸에서 빠진다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:38, 42-44 mark |
| 1차-38 | code | medium | 글이 늘지 않았는데 넘침 경고가 뜬다. 기준값은 처음 연 창의 배율로 한 번만 재는데, CSS zoom 배율이 바뀌면 레이아웃 값이 달라지기 때문이다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:119-144, 446-4 |
| 1차-39 | code | medium | 쪽을 옮겨도 넘침 경고 글자가 다시 계산되지 않아, 넘치지 않는 쪽에 경고가 남고 넘친 쪽에 돌아와도 경고가 없다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:131-149 (go에서  |
| 1차-40 | code | medium | 넘친 채 저장한 파일을 다시 열면 그 넘침이 새 기준값이 되어 경고가 사라진다. README의 '원래보다 넘치면 경고' 문장과 어긋난다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:446-452; /User |
| 1차-41 | code | medium | display:flex인 칸(37개)에서 일부 글자에만 서식을 주면 글자가 조각나 벌어지거나 띄어쓰기가 사라진다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:245-268 (서식 sp |
| 1차-42 | code | medium | 표지 그림을 4MB 안팎 파일로 바꾸면 임시 저장이 조용히 실패하고, 이후 글자 수정도 임시 저장되지 않는다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:379-395; /User |
| 1차-43 | code | low | ⌘S를 누른 직후 쓰기가 끝나기 전에 친 글자는 파일에 없는데 '저장됨'으로 처리되고 임시 저장도 지워진다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:347-354, 335-3 |
| 1차-44 | code | low | 임시 저장 안내를 그냥 둔 채 고치거나 저장해도 안내가 남고, 나중에 '불러오기'를 누르면 처음 읽어 둔 옛 내용이 더 새 글을 덮어쓴다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:397-424 |
| 1차-45 | code | low | 글자를 친 뒤 0.8초 안에 닫으면 그 수정은 임시 저장되지 않는다. 닫을 때 임시 저장을 곧바로 쓰는 처리가 없다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:82-83, 371-376 |
| 1차-46 | code | low | 임시 저장 값이 깨진 JSON이면 안내가 뜨지 않을 뿐 아니라 이후 임시 저장도 영구히 막힌다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:391-395 |
| 1차-47 | code | low | 임시 저장 키가 파일 경로라, 파일을 옮기거나 다른 경로로 저장한 뒤 계속 고치면 그 파일을 열어도 안내가 뜨지 않는다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:7, 380-392 |
| 1차-48 | code | low | 서식 막대와 그림 막대가 쪽을 옮겨도 남는다. 그림 막대는 다른 쪽에서 눌러도 표지 그림을 바꾼다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:222-232, 272-2 |
| 1차-49 | code | low | 표지에서 보이는 제목을 고쳐도 쪽 목록·메모 제목·BOOK.title에 반영되지 않는다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:91 |
| 1차-50 | code | low | 발표 메모의 핵심 문장(#note-key)에 Enter로 넣은 줄바꿈이 쪽을 다녀오면 화면에서 사라진다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:90; note-key의  |
| 1차-51 | code | low | 넘침 경고가 떠 있는 쪽에서 저장하면 화면에 저장 표시가 나타나지 않는다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:145-149 |
| 1차-52 | code | low | 브라우저가 읽지 못하는 그림 파일을 고르면 경고 없이 표지 그림이 깨지고, 되돌릴 방법이 없다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:284-296 |
| 1차-53 | code | low | README는 아이콘을 고칠 수 없다고 하지만, 3쪽 '지향점' 칸을 전체 선택해 지우면 안의 아이콘도 지워진다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/README.md:59; /Users/hoonsbook/AX2030 |
| 1차-54 | code | low | 넘침 경고는 쪽 경계를 넘을 때만 잡아, 쪽 안에서 글이 다른 내용과 겹치는 경우는 알리지 않는다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/tools/editor/editor.js:119-130 |
| 1차-55 | code | low | README의 빌드 명령만 기준 폴더가 달라, 저장소 루트에서 실행하면 파이썬 경로를 찾지 못한다. | /Users/hoonsbook/AX2030/work/headquarters-meeting-v6/README.md:65 |

## 2차 검증

| 번호 | 갈래 | 정도 | 문제 | 위치 |
|---|---|---|---|---|
| 2차-1 | regress | medium | (새 문제) 12쪽 표에서 묶음의 둘째 행 이후 칸이 두 줄이 되면, 아무것도 넘치지 않았는데 거짓 경고가 뜨고 고치지 않은 다른 행에 빨간 테두리가 생긴다. | editor.js measureSlide 185-187행의 조상 scroll 넘침 계산. 12쪽 rowspan 묶음의 첫 행 TR은 scrollHeight에 ro |
| 2차-2 | regress | medium | (옛 B9의 남은 부분) 연속 읽기에서 메모를 열거나 닫으면 배율이 바뀌어 화면이 2~3쪽 밀리는데, 현재 쪽은 따라가지 않아 보이는 쪽과 메모·쪽 표시가 어긋난다. | 장표 toggleNotes·resize(배율만 바꾸고 현재 쪽으로 스크롤하지 않음), editor.js followReading(스크롤 이벤트에만 반응) |
| 2차-3 | regress | medium | (옛 C18) 3쪽 '지향점' 칸의 글자를 모두 지우면 잠근 아이콘도 함께 지워진다. 다시 쳐도 아이콘 없이 저장된다. 14쪽 화살표 칸은 Backspace를 한 번 더 누르면 화살표가 지워진다. README의 '아이콘은 고칠 수 없다'와 어긋난다. | 3쪽 '지향점'(svg 잠금), 14쪽 '↔ 기획·측정'·'↔ 변화·실행'. editor.js lockDecoration 50-58행. contenteditabl |
| 2차-4 | regress | low | (새 문제) 14쪽 화살표 칸은 화살표 자리를 누르면 커서가 잠근 글자 안으로 들어가, 치는 글자가 말없이 버려진다. 칸을 비운 뒤에는 칸 가운데를 눌러도 같다. | 14쪽 '↔ 기획·측정'·'↔ 변화·실행'. <i>가 display:block이라 칸 위쪽 대부분을 차지한다(109×116px 칸에 109×48px). |
| 2차-5 | regress | low | (새 문제) 쪽을 따라가는 처리 때문에, 장표 높이가 창 절반보다 작은 세로로 긴 창의 연속 읽기에서 →가 한 쪽씩 건너뛰고 ←는 두 번 눌러야 한다. R을 켜고 끄기만 해도 쪽이 밀린다. | editor.js followReading 435-448행. go는 장표 위쪽을 창 맨 위에 맞추는데, 현재 쪽은 창 가운데에 있는 장표로 다시 정한다. |
| 2차-6 | regress | low | (새 문제) 칸마다 기준값 하나만 쓰기 때문에 처음부터 기준값이 큰 칸은 자기 넘침을 놓친다. 숫자 원 글자가 원을 벗어나도 경고가 없다. | editor.js checkOverflow 209행과 measureSlide의 max. 기준값이 10을 넘는 칸이 62개다(12쪽 최대 108, 5쪽 29, 13 |
| 2차-7 | regress | low | (새 문제) '지우기'가 브라우저 명령이 아닌 직접 DOM 변경으로 바뀌어 ⌘Z로 되돌릴 수 없고, 고른 글자만이 아니라 묶음 전체의 서식을 벗기며, 누른 뒤 선택이 풀리고 막대는 남는다. | editor.js clearStyles 370-375행 |
| 2차-8 | regress | low | (옛 B16의 남은 부분) 원래 굵은 글씨가 섞인 칸을 ⌘A 뒤 굵게 누르면 원래 <b>가 사라져 굵기와 색이 바뀐다. | editor.js 서식 막대 382행 execCommand('bold'). 10쪽 '추정 계획소요 4과제 합계…' |
| 2차-9 | regress | low | (새 문제) 비운 가로 배치 칸은 잠시 block으로 바뀌어 줄바꿈 차단을 빠져나간다. Enter와 줄바꿈 붙여넣기가 그대로 들어가 띠 높이가 커지고 글자가 내려앉는다. | editor.js noBreak·isFlexy 85-87행과 editor.css 12행 [data-ed-empty] 표시 방식. 예: 2쪽 '대내외 환경' |
| 2차-10 | regress | low | (새 문제) 큰 그림은 임시 저장에서 빠지는데, 불러온 뒤 원래 그림으로 돌아갔다는 안내가 없다. 그대로 저장하면 바꾼 그림 없이 저장된다. | editor.js saveDraft 576행, offerDraft 복구 처리 |
| 2차-11 | regress | low | (새 문제) 상태 글자가 190px로 고정되어, 세 가지가 겹치면 정작 '임시 저장 안 됨'이 잘려 보이지 않는다. | editor.css 2행 #ed-status, editor.js showStatus |
| 2차-12 | regress | low | (새 문제) 임시 저장 안내 창이 떠 있는 동안에도 ←→·N·R 단축키가 듣는다. 어두운 막 뒤에서 쪽이 넘어가고 메모·연속 읽기가 켜진다. | 장표 keydown 처리(모달 상태를 보지 않음). editor.js는 E와 저장만 막는다. |
| 2차-13 | regress | low | (새 문제) 글자를 고른 채 위쪽 '메모' 단추를 누르면 배율이 바뀌는데 서식 막대는 옛 자리에 남는다. | editor.js hideBars는 쪽 이동·스크롤·창 크기 때만 불린다. toggleNotes는 window resize를 내지 않는다. |
| 2차-14 | regress | low | (옛 B15의 남은 부분) 제목을 고쳐도 브라우저 탭 제목은 쪽을 옮겨야 바뀐다. | editor.js syncBook 121-134행은 document.title을 건드리지 않는다. |
| 2차-15 | regress | low | (옛 V9의 남은 부분) 어두운 바탕 칸은 주황으로 보이게 됐지만, 부모 overflow:hidden에 붙은 칸은 테두리가 여전히 잘려 커서가 있는 칸 표시가 거의 보이지 않는다. | 2쪽 '대내외 환경'·'전 산업의 AI 활용', 3쪽 '지향점', 12쪽 '2029 전환조건'·'실행관점'. editor.css 5-7행의 outline-offs |
| 2차-16 | fresh | medium | 문단 옆에 굵은 라벨이 있는 칸(`<b>라벨</b><p>문단</p>`)에서 문단을 비운 뒤 임시 저장을 불러오면 칸 구조가 바뀐다. 비운 문단은 칸에서 빠지고 바깥 div가 한 칸이 된다. 그 자리를 눌러 다시 쓰면 글이 옆 라벨로 들어가고 문단은 계속 빈다. ⌘A·Backspace는 라벨과 다른 글까지 함께 지운다. 해당 칸은 12개다(4쪽 4개, 5쪽 4개, 8쪽 2개, 13쪽 1개, 14쪽 1개). | work/headquarters-meeting-v6/tools/editor/editor.js offerDraft 618~625행의 markHosts와 blockO |
| 2차-17 | fresh | medium | 12쪽 표에서 그룹의 둘째 줄 이하를 고쳐 그 줄이 두 줄이 되면, 1배 기준으로는 넘치지 않았는데 '⚠ 22px 넘침'이 뜬다. 빨간 테두리는 고친 줄이 아니라 그 그룹의 첫 줄과 번호·그룹명에 붙는다. 반대로 그룹 첫 줄의 칸은 기준값이 81~108로 커서 실제 넘침이 가려진다. | editor.js measureSlide 185~187행. 조상 검사에 tr이 포함된다. rowspan이 있는 tr은 scrollHeight-clientHeigh |
| 2차-18 | fresh | medium | 3쪽 '지향점' 칸은 아이콘(svg)을 잠갔는데도 글자를 지우면 아이콘이 함께 사라진다. 첫 글자를 Backspace로 한 번 지우는 평범한 동작에서도 생긴다. | editor.js lockDecoration 50~58행. contenteditable=false만으로는 svg 삭제를 막지 못한다. beforeinput에 삭제 |
| 2차-19 | fresh | medium | 글이 늘어 아래 상자가 쪽번호 선을 덮어도, 글자가 선을 3px 넘게 넘지 않으면 경고가 없다. 선이 띠 글자 바로 밑이나 글자 끝을 지나고, 상자가 쪽번호에 바짝 붙는다. 한 단어만 더해도 생긴다. SVG 지도 위에 글이 올라가는 경우도 겹침 대상이 아니다. | editor.js measureSlide 184행(글자 영역과 limit만 비교), 179행(img만 겹침 대상). 상자 경계와 svg는 보지 않는다. OVER_ |
| 2차-20 | fresh | medium | 경고는 1배 배치로 재는데, 화면은 zoom 배율에서 표 줄 높이가 반올림돼 더 커진다. 12·13쪽은 노트북 창에서 각주가 쪽번호 선에 그어져 보여도 경고가 없다. | editor.js atFullScale 158~166행과 measureSlide. 1배 기준이라 인쇄 결과와는 맞지만, 브라우저 발표 화면과는 다르다. |
| 2차-21 | fresh | medium | 세로로 긴 창의 연속 읽기에서 현재 쪽 판정이 다음 쪽으로 밀린다. →는 두 쪽씩 뛰고, ←는 두 번 눌러야 한 쪽 줄고, 쪽 고르기 선택이 한 쪽 뒤로 바뀐다. 쪽 표시와 메모는 화면 맨 위 쪽이 아닌 다음 쪽을 가리킨다. 맥북 화면 절반 창과 같은 크기에서 생긴다. | editor.js followReading 435~448행. 화면 세로 중앙이 속한 장표를 현재 쪽으로 삼는다. 장표 높이가 화면 높이의 절반보다 작으면 scro |
| 2차-22 | fresh | medium | 연속 읽기에서 N으로 메모를 열면 배율이 줄고 scrollTop은 그대로라 화면이 2~3쪽 뒤로 밀린다. 그런데도 쪽 표시와 메모는 원래 쪽에 머문다. 스크롤 전까지 보이는 장표와 고치는 메모의 쪽이 다르다. 원본 발표본에서도 화면은 똑같이 밀린다. 다만 편집용은 메모 내용을 고치므로 '메모가 다른 쪽에 들어가지 않게' 한 의도와 어긋난다. | 장표 스크립트 toggleNotes·resize. editor.js followReading은 scroll 이벤트로만 돌고, 이때는 scroll 이벤트가 없다. |
| 2차-23 | fresh | low | 11쪽 범례의 색 점 잠금이 뚫린다. 글자 끝에서 왼쪽 밖까지 드래그하면 점까지 선택되고, 치면 점이 사라지며 글자가 점의 청록·주황 배경과 기울임을 물려받는다. 점을 누르거나 왼쪽 화살표로 점 앞에 커서를 두면 글자가 점 앞에 들어가고, Delete는 점을 지운다. 14쪽 ↔를 누른 뒤 치면 글자가 조용히 버려진다. | editor.js lockDecoration 50~58행(선택·커서가 잠금 앞으로 가는 것을 막지 않음), ⌘A 처리 277~287행은 키보드 선택만 보호한다. |
| 2차-24 | fresh | low | 임시 저장 창이 떠 있는 동안 키가 뒤로 샌다. →, ←, Home, End, PageDown은 쪽을 옮기고, N은 메모를 열고, R은 연속 읽기를 켠다. Tab으로 창 밖에 포커스가 나간 뒤 Space를 누르면 다음 쪽으로 간다. 글이 바뀌지는 않는다. | 장표 스크립트의 document keydown(inert로 막히지 않음). editor.js는 ⌘S(save 531행)와 E(295행)만 modalOpen으로 막 |
| 2차-25 | fresh | low | 20만 자가 넘는 새 그림을 넣고 저장 없이 닫았다가 불러오면 그림만 조용히 옛 그림으로 돌아간다. 닫기 전에도, 불러온 뒤에도 알림이 없다. | editor.js saveDraft 576행(큰 그림을 @@IMG로 대체), offerDraft 619~621행(originalImages로 되돌림), showS |
| 2차-26 | fresh | low | 넘침 경고가 현재 쪽 위주라 넘친 채로 지나가기 쉽다. 단일 보기에서 넘친 쪽을 떠나면 경고가 사라지고, 그 상태로 저장해도 '저장됨'만 나온다. 연속 읽기에서는 저장 뒤 다른 쪽의 넘침이 상태에서 사라지는데 빨간 칸은 남는다. 연속 읽기를 나가면 넘치지 않는 쪽에서도 상태에 경고가 남는다. | editor.js checkOverflow 203·219행(대상 쪽), afterSave 509행(touched.clear). toggleRead는 재계산하지 않 |
| 2차-27 | fresh | low | 가로 배치 칸을 비우면 display가 바뀌어 '가로 배치 칸' 보호가 꺼진다. 빈 상태에서 Enter와 여러 줄 붙여넣기, ⌘B가 막히지 않아 다시 글을 넣었을 때 줄바꿈과 서식이 남는다. 첫 줄이 빈 칸이 되기도 한다. | editor.js isFlexy 85행, noBreak 87행, beforeinput 239~245행, paste 253행. editor.css 12행 때문에 빈 |
| 2차-28 | fresh | low | 메모 패널의 잔문제 세 가지다. 메모에서 ⌘B를 누르면 굵게 보이지만 저장도 유지도 안 되고 쪽을 옮기면 사라진다. 편집 켜짐에서는 메모 제목·근거 줄을 드래그로 선택·복사할 수 없다. 메모 입력 중 패널 스크롤바를 누르면 메모에서 커서가 빠져, 이어 친 글자가 장표 단축키로 동작할 수 있다. | editor.js beforeinput 243행(format 차단은 isFlexy만 봄), mousedown 263~268행(#speaker 전체를 막음). |
