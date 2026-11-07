"""두 PNG 묶음의 픽셀 차이를 쪽별로 낸다. numpy·Pillow가 있는 파이썬으로 실행한다."""
import sys
import numpy as np
from PIL import Image
d = sys.argv[1]
total = 0
for i in range(1, 16):
    a = np.asarray(Image.open(f'{d}/orig_{i:02d}.png').convert('RGB')).astype(int)
    b = np.asarray(Image.open(f'{d}/kit_{i:02d}.png').convert('RGB')).astype(int)
    m = np.abs(a - b).max(axis=2)
    n = int((m > 0).sum())
    total += n
    ys, xs = np.where(m > 0)
    print(i, n, int(m.max()), (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())) if n else '')
print('total', total)
sys.exit(1 if total else 0)
