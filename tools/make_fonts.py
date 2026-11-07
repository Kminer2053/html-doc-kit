#!/usr/bin/env python3
"""Noto Sans KR에서 한글 전체와 문장부호를 뽑아 키트의 예비 글꼴(woff2)을 만든다. fontTools·brotli가 있는 파이썬으로 실행한다.
  python tools/make_fonts.py <NotoSansKR-Regular·Bold.ttf 폴더>
결과는 커밋한다. 키트를 쓰는 사람에게는 이 도구가 필요 없다."""
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

RANGES = [
    (0x20, 0x7E), (0xA0, 0x17F), (0x1100, 0x11FF), (0x2000, 0x206F), (0x2070, 0x209F), (0x20A0, 0x20CF), (0x2100, 0x218F), (0x2190, 0x21FF),
    (0x2200, 0x22FF), (0x2460, 0x24FF), (0x2500, 0x257F), (0x25A0, 0x26FF), (0x2700, 0x27BF), (0x3000, 0x303F), (0x3130, 0x318F),
    (0x3200, 0x33FF), (0xAC00, 0xD7A3), (0xFF00, 0xFFEF),
]
OUT = Path(__file__).resolve().parents[1] / "src/kit/fonts"
OUT.mkdir(parents=True, exist_ok=True)
for name, weight in (("Regular", 400), ("Bold", 700)):
    font = TTFont(Path(sys.argv[1]) / f"NotoSansKR-{name}.ttf")
    options = subset.Options()
    options.flavor = "woff2"
    options.hinting = False
    options.name_IDs = ["*"]  # 글꼴 사용 허가(OFL) 문구를 남긴다
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=[c for a, b in RANGES for c in range(a, b + 1)])
    sub.subset(font)
    font.flavor = "woff2"
    font.save(OUT / f"full-{weight}.woff2")
    print(weight, (OUT / f"full-{weight}.woff2").stat().st_size)
