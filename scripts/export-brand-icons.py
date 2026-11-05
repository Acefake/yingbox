"""从六色设计原图导出各端品牌资源及 PNG/GIF/HTML 交付包。依赖 Pillow。"""
import base64
import json
import math
import zipfile
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / 'design/logo'
EXPORT = ROOT / 'design/exports'
RES = ROOT / 'android/app/src/main/res/drawable-nodpi'
WEB = ROOT / 'src/renderer/src/assets/imgs/brand'
COLORS = {
    'purple': ('紫水晶', 'yingbox-amethyst-purple.png'),
    'blue': ('冰川蓝', 'yingbox-glacier-blue.png'),
    'green': ('翡翠绿', 'yingbox-jade-green.png'),
    'gold': ('琥珀金', 'yingbox-amber-gold.png'),
    'white': ('珍珠白', 'yingbox-pearl-white.png'),
    'graphite': ('烟灰', 'yingbox-glass-concept.png'),
}


def fit(image, size):
    """等比放入透明画布。"""
    out = Image.new('RGBA', size)
    image = image.copy()
    image.thumbnail(size, Image.Resampling.LANCZOS)
    out.alpha_composite(image, ((size[0]-image.width)//2, (size[1]-image.height)//2))
    return out


def icon_source(name):
    image = Image.open(DESIGN / name).convert('RGBA')
    image = image.crop((118, 118, 1138, 1138)).resize((1024, 1024), Image.Resampling.LANCZOS)
    mask = Image.new('L', image.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 1023, 1023), radius=235, fill=255)
    image.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
    return image


def png(image, path, size):
    path = ROOT / path
    path.parent.mkdir(parents=True, exist_ok=True)
    fit(image, size).save(path, optimize=True)


def animate(image, target, light):
    """四秒循环：轻微悬浮与一次扫光；固定底色保留玻璃半透明层。"""
    width = min(640, image.width)
    art = fit(image, (width, round(image.height*width/image.width)))
    frames = []
    for index in range(40):
        phase = index / 40
        frame = Image.new('RGBA', art.size, '#f3f5f9' if light else '#080c14')
        layer = art.copy()
        if .15 < phase < .7:
            x = int((phase-.15)/.55*(art.width+200))-100
            shine = Image.new('RGBA', art.size)
            ImageDraw.Draw(shine).polygon([(x-35,0),(x,0),(x+90,art.height),(x+55,art.height)], fill=(255,255,255,26))
            shine.putalpha(ImageChops.multiply(shine.getchannel('A'), art.getchannel('A')))
            layer = Image.alpha_composite(layer, shine)
        offset = round(-3*math.sin(phase*2*math.pi))
        layer = fit(layer, (round(art.width*.96), round(art.height*.96)))
        frame.alpha_composite(layer, ((art.width-layer.width)//2, (art.height-layer.height)//2+offset))
        frames.append(frame.convert('RGB'))
    palette = frames[0].quantize(colors=256)
    frames = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    frames[0].save(target, save_all=True, append_images=frames[1:], duration=100, loop=0, disposal=2, optimize=False)


def html(image_path, target, title, light):
    data = base64.b64encode(image_path.read_bytes()).decode()
    bg, fg = ('#f3f5f9','#1d2530') if light else ('#080c14','#f0edff')
    document = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font:15px system-ui;background:BG;color:FG;text-align:center;padding:32px}main{max-width:800px;margin:auto}img{max-width:100%;max-height:480px;animation:float 4s ease-in-out infinite}button{font:inherit;padding:12px 20px;border:1px solid currentColor;border-radius:30px;background:transparent;color:inherit;margin:16px 4px}p{opacity:.7}@keyframes float{50%{transform:translateY(-6px);filter:brightness(1.06)}}.paused img{animation-play-state:paused}@media(prefers-reduced-motion:reduce){img{animation:none}}</style>
<main><h1>TITLE</h1><img src="data:image/png;base64,DATA" alt="影盒"><div><button id="toggle" aria-pressed="false">暂停动画</button><button id="restart">重播</button></div><p>四秒循环 · 系统减少动态效果时静止</p></main><script>const b=document.getElementById('toggle');b.onclick=()=>{const p=document.body.classList.toggle('paused');b.textContent=p?'播放动画':'暂停动画';b.setAttribute('aria-pressed',String(p))};document.getElementById('restart').onclick=()=>{document.body.classList.remove('paused');b.textContent='暂停动画';b.setAttribute('aria-pressed','false');document.querySelector('img').getAnimations().forEach(a=>{a.currentTime=0;a.play()})}</script></html>'''
    document = document.replace('<img src=', '<div class="art"><img src=').replace('alt="影盒"><div>', 'alt="影盒"></div><div>')
    document = document.replace('img{max-width:', '.art{position:relative;display:inline-block;max-width:100%;animation:float 4s ease-in-out infinite}.art:after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,transparent 40%,#ffffff30 50%,transparent 60%);background-size:300% 100%;mask-image:url(data:image/png;base64,DATA);mask-size:100% 100%;animation:sweep 4s ease-in-out infinite}@keyframes sweep{0%,15%{background-position:100% 0;opacity:0}25%{opacity:.5}65%,100%{background-position:0 0;opacity:0}}img{display:block;max-width:')
    document = document.replace('max-height:480px;animation:float 4s ease-in-out infinite', 'max-height:480px')
    document = document.replace('.paused img{', '.paused .art,.paused .art:after{').replace('reduce){img{', 'reduce){.art,.art:after{')
    document = document.replace("document.querySelector('img').getAnimations()", "document.querySelector('.art').getAnimations({subtree:true})")
    target.write_text(document.replace('BG',bg).replace('FG',fg).replace('TITLE',title).replace('DATA',data), encoding='utf-8')


def bundle():
    """生成离线预览索引，并打包全部静态与动态文件。"""
    cards = []
    for key, (label, _) in COLORS.items():
        cards.append(f'<article><h2>{label}</h2><img src="{key}/lockup-static.png" alt="影盒 {label}" style="background:{"#f3f5f9" if key=="white" else "#080c14"}"><p><a href="{key}/icon-animated.html">图标动效</a> · <a href="{key}/wordmark-animated.html">字标动效</a> · <a href="{key}/lockup-animated.html">组合动效</a></p><p><a href="{key}/lockup-static.png">透明 PNG</a> · <a href="{key}/lockup-animated.gif">循环 GIF</a></p></article>')
    (EXPORT/'index.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>影盒品牌素材</title><style>body{font:16px system-ui;background:#0e121a;color:#eee;padding:24px;max-width:1100px;margin:auto}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}img{width:100%;border-radius:16px}h2{font-size:18px}a{color:#b7d4ff}p{line-height:1.8}</style><h1>影盒 · 六色玻璃品牌</h1><p>默认紫水晶。每色均含图标、中文字标与横向组合的 PNG、GIF、HTML。GIF 使用固定底色以保留玻璃质感。</p><main>'+''.join(cards)+'</main></html>',encoding='utf-8')
    with zipfile.ZipFile(EXPORT/'yingbox-brand-kit.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(EXPORT.rglob('*')):
            if path.is_file() and path.suffix!='.zip':
                archive.write(path,path.relative_to(EXPORT))


def export_color(key, label, icon, word):
    directory = EXPORT / key
    directory.mkdir(parents=True, exist_ok=True)
    lockup = Image.new('RGBA', (1280,480))
    lockup.alpha_composite(fit(icon,(400,400)),(40,40))
    lockup.alpha_composite(fit(word,(720,380)),(500,50))
    images = {'icon': fit(icon,(1024,1024)), 'wordmark': fit(word,(1024,480)), 'lockup': lockup}
    for name, image in images.items():
        target = directory / f'{name}-static.png'
        image.save(target, optimize=True)
        animate(image, directory / f'{name}-animated.gif', key=='white')
        html(target, directory / f'{name}-animated.html', f'影盒 · {label}', key=='white')


def default_icons(icon, word):
    png(icon,'resources/icon.png',(512,512))
    png(icon,'build/icon.png',(1024,1024))
    for name in ['resources/logo.ico','build/icon.ico']:
        icon.save(ROOT/name, sizes=[(n,n) for n in (16,24,32,48,64,128,256)])
    for name, size in [('icon-192',192),('icon-512',512),('apple-touch-icon',180)]:
        png(icon,f'src/renderer/public/icons/{name}.png',(size,size))
    safe = Image.new('RGBA',(1024,1024),'#21113d')
    safe.alpha_composite(fit(icon,(640,640)),(192,192))
    png(safe,'src/renderer/public/icons/icon-maskable-512.png',(512,512))
    png(icon,RES/'brand_logo.png',(512,512))
    adaptive = Image.new('RGBA',(432,432))
    adaptive.alpha_composite(fit(icon,(264,264)),(84,84))
    adaptive.save(RES/'brand_launcher.png')
    sidebar = Image.new('RGBA',(164,314),'#21113d')
    sidebar.alpha_composite(fit(icon,(64,64)),(50,84))
    sidebar.alpha_composite(fit(word,(90,46)),(37,165))
    for name in ['installerSidebar.bmp','uninstallerSidebar.bmp']:
        sidebar.convert('RGB').save(ROOT/'build'/name)


def main():
    RES.mkdir(parents=True, exist_ok=True)
    WEB.mkdir(parents=True, exist_ok=True)
    for key, (label, source) in COLORS.items():
        icon = icon_source(source)
        word = Image.open(DESIGN/f'yingbox-wordmark-{key}.png').convert('RGBA')
        word = word.crop(word.getbbox())
        png(icon,WEB/f'icon-{key}.png',(512,512))
        png(word,WEB/f'wordmark-{key}.png',(640,300))
        png(icon,RES/f'brand_icon_{key}.png',(512,512))
        png(word,RES/f'brand_wordmark_{key}.png',(640,300))
        export_color(key,label,icon,word)
        if key=='purple':
            default_icons(icon,word)
        print(f'已导出 {label}', flush=True)
    (EXPORT/'manifest.json').write_text(json.dumps({k:v[0] for k,v in COLORS.items()},ensure_ascii=False,indent=2),encoding='utf-8')
    (EXPORT/'README.txt').write_text('影盒六色品牌素材\n默认紫水晶。每色包含 icon 图标、wordmark 字标、lockup 横向组合。\n*-static.png：透明静态图。\n*-animated.gif：4 秒循环。GIF 不支持半透明，使用固定深色背景，珍珠白使用浅色背景。\n*-animated.html：内嵌 PNG，可离线打开、暂停/重播，尊重系统减少动态效果。\n应用内导航只播放一次，导出文件为循环演示。\n生成：python scripts/export-brand-icons.py（需要 Pillow）。\n',encoding='utf-8')
    bundle()


if __name__=='__main__':
    main()
