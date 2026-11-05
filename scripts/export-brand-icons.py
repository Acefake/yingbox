"""从蓝色玻璃设计稿导出各端品牌资源；运行前安装 Pillow。"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
source = Image.open(ROOT / 'design/logo/yingbox-glacier-blue.png').convert('RGBA')
# 设计稿的透明留白不进入实际图标，避免小尺寸下标志过小。
logo = source.crop((118, 118, 1138, 1138)).resize((1024, 1024), Image.Resampling.LANCZOS)

def save_png(path, size, image=logo):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    image.resize((size, size), Image.Resampling.LANCZOS).save(target)

save_png('resources/icon.png', 512)
save_png('build/icon.png', 1024)
save_png('src/renderer/src/assets/imgs/logo.png', 512)
for target in ['resources/logo.ico', 'build/icon.ico']:
    logo.save(ROOT / target, sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
for name, size in [('icon-192', 192), ('icon-512', 512), ('apple-touch-icon', 180)]:
    save_png(f'src/renderer/public/icons/{name}.png', size)
# 自适应掩模的安全区包住整个标志，背景填满画布。
safe = Image.new('RGBA', (1024, 1024), '#08192d')
safe.alpha_composite(logo.resize((640, 640), Image.Resampling.LANCZOS), (192, 192))
save_png('src/renderer/public/icons/icon-maskable-512.png', 512, safe)
res = 'android/app/src/main/res'
save_png(f'{res}/drawable-nodpi/brand_logo.png', 512)
adaptive = Image.new('RGBA', (432, 432))
adaptive.alpha_composite(logo.resize((264, 264), Image.Resampling.LANCZOS), (84, 84))
save_png(f'{res}/drawable-nodpi/brand_launcher.png', 432, adaptive)
# NSIS 欢迎页：实色底、蓝色标志和原有应用名。
from PIL import ImageFont
sidebar = Image.new('RGB', (164, 314), '#08192d')
sidebar.paste(logo.resize((64, 64), Image.Resampling.LANCZOS), (50, 84), logo.resize((64, 64), Image.Resampling.LANCZOS))
draw = ImageDraw.Draw(sidebar)
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 20)
draw.text((82, 168), '影盒', font=font, fill='#eaf4ff', anchor='mt')
for name in ('installerSidebar.bmp', 'uninstallerSidebar.bmp'):
    sidebar.save(ROOT / 'build' / name)
