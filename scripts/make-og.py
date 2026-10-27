"""生成 docs/og.png（1200×630 社交卡片）——README 顶部横幅 / Pages og:image 共用。
用法：python scripts/make-og.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
OUT = Path(__file__).resolve().parent.parent / "docs" / "og.png"

FONTS = Path("C:/Windows/Fonts")
CJK_BOLD = next(p for p in [FONTS / "msyhbd.ttc", FONTS / "msyh.ttc", FONTS / "simhei.ttf"] if p.exists())
CJK = next(p for p in [FONTS / "msyh.ttc", FONTS / "simhei.ttf"] if p.exists())
MONO = next(p for p in [FONTS / "consola.ttf", FONTS / "cour.ttf"] if p.exists())


def font(path, size):
    return ImageFont.truetype(str(path), size)


# 背景：竖向深绿渐变 + 右上角径向高光
img = Image.new("RGB", (W, H), "#07160f")
top = (18, 56, 35)
bottom = (5, 16, 11)
px = img.load()
for y in range(H):
    t = y / (H - 1)
    r = int(top[0] + (bottom[0] - top[0]) * t)
    g = int(top[1] + (bottom[1] - top[1]) * t)
    b = int(top[2] + (bottom[2] - top[2]) * t)
    for x in range(W):
        px[x, y] = (r, g, b)

glow = Image.new("L", (W, H), 0)
gd = ImageDraw.Draw(glow)
gd.ellipse([W - 520, -360, W + 200, 300], fill=70)
glow = glow.filter(__import__("PIL.ImageFilter", fromlist=["ImageFilter"]).GaussianBlur(120))
img = Image.composite(Image.new("RGB", (W, H), (30, 120, 76)), img, glow.point(lambda v: int(v * 0.75)))

d = ImageDraw.Draw(img)

# 左侧强调条
d.rounded_rectangle([56, 150, 64, 300], radius=4, fill="#35d07f")

# 顶部小字
d.text((88, 96), "DEEPSEEK HARNESS PLUGIN  ·  OPEN SOURCE MIT  ·  A-SHARE DASHBOARD",
       font=font(MONO, 19), fill="#6f9682")

# 主标题
d.text((86, 150), "韭菜盒子 LeekBox", font=font(CJK_BOLD, 82), fill="#eaf7ef")

# 副标题
d.text((90, 264), "A 股看盘助手 · 装进 DeepSeek Harness 的行情面板", font=font(CJK, 33), fill="#b8d3c2")

# 功能胶囊
chips = ["实时行情", "分时 / K 线", "自选股盈亏", "价格预警", "技术信号选股", "涨停情绪", "龙虎榜", "7×24 快讯", "AI 分析"]
x, y = 88, 344
cf = font(CJK, 24)
for text in chips:
    tw = d.textlength(text, font=cf)
    if x + tw + 44 > W - 70:
        x, y = 88, y + 62
    d.rounded_rectangle([x, y, x + tw + 40, y + 46], radius=23, fill="#123322", outline="#255a3d", width=2)
    d.text((x + 20, y + 8), text, font=cf, fill="#cfe8da")
    x += tw + 58

# 底部信息
d.line([88, 528, W - 88, 528], fill="#1d4a33", width=2)
d.text((88, 552), "github.com/SuCriss/dsh-leekbox", font=font(MONO, 26), fill="#35d07f")
note = "公开免费数据源 · 无需 API key · 只监听 127.0.0.1 · 数据仅供研究，不构成投资建议"
nf = font(CJK, 20)
d.text((W - 88 - d.textlength(note, font=nf), 558), note, font=nf, fill="#7f9b8c")

OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, optimize=True)
print(f"{OUT}  {OUT.stat().st_size // 1024}kb  {img.size[0]}x{img.size[1]}")
