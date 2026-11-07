# 본문 표기법

## 마크다운(권장)

```markdown
---
title: 문서 제목
type: slide
---
# 첫 쪽 제목
본문입니다.

Notes:
발표 메모는 쪽 끝에 "Notes:" 줄 다음에 씁니다.

---
# 둘째 쪽
```

- 맨 앞 `---` 사이: `title`, `type`(`slide`, `a4`, `a4-landscape`, `auto`). 없어도 됩니다.
- **장표는 `type: slide`를 꼭 적으세요.** 적지 않으면 `---`가 있어도 `auto`입니다.
- 본문의 `---` 줄이 쪽 구분입니다. 쪽을 나누지 않아도 됩니다.
- 그림: `![설명](그림.png)`. 파일 안에 들어갑니다.

## HTML

```html
<title>문서 제목</title>
<meta name="doc-type" content="a4">
<style>h1 { color: #123451; }</style>
<section data-page data-title="쪽 제목" data-notes="발표 메모">
  <h1>첫 쪽</h1>
</section>
<section data-page data-w="1024" data-h="768">
  <h1>크기를 직접 정한 쪽</h1>
</section>
```

- 쪽: `data-page`가 있는 요소, 없으면 `class="slide"`나 `class="page"`, 없으면 맨 위 `<section>` 2개 이상, 없으면 전체가 한 쪽입니다.
- 쪽 속성: `data-title`, `data-notes`, `data-key`(핵심 문장), `data-seconds`, `data-type`, `data-w`·`data-h`(px).
- 스타일은 `<style>`에 씁니다. 쪽 안에만 적용됩니다. 스타일이 없으면 기본 모양이 입혀집니다.
- `vw`·`vh`는 창이 아니라 쪽 크기 기준으로 바뀝니다. `background:url(그림.png)`와 `<svg><image href="그림.png">`의 로컬 그림도 파일 안에 들어갑니다.
- 나눠 쓰는 본문은 마크다운을 권장합니다. HTML 본문 파일은 build나 apply에 넣은 뒤로 결과물로 치지 않지만, 그 전에 턴이 끝나면 키트가 입혀질 수 있습니다.

## 형태

| type | 크기 | 쓰임 |
|---|---|---|
| `slide` | 1920×1080 | 장표. 글이 넘치면 잘립니다 |
| `a4`, `a4-landscape` | A4 고정 | 쪽이 정해진 문서. 글이 넘치면 잘립니다 |
| `auto` | A4 폭, 높이는 내용만큼 | 지정이 없을 때 기본값 |
