"""Build the self-contained slides.html (reveal.js + images inlined) from slides_template.html."""
import base64, io, re, sys
from pathlib import Path
from PIL import Image

HERE = Path(__file__).parent
ROOT = HERE.parent
SHOTS = HERE / "screenshots" / "report"
VENDOR = HERE / "vendor" / "reveal"   # reveal.js 5.2.1 dist files (MIT)

CROPS = {  # key: (file, crop box, output width)
    "chat": ("r02_chat_ideas.png", (40, 40, 1400, 780), 1100),
    "planstrip": ("r07_plan.png", (262, 570, 1420, 1060), 1000),
    "order8": ("r04_order8_review.png", (0, 0, 797, 662), 760),
    "lucie": ("lucie_custom.png", (160, 250, 1280, 570), 900),
    "orders": ("r12_orders_board.png", (262, 140, 600, 730), 500),
    "shopping": ("r08_shopping.png", (272, 272, 1408, 1060), 1000),
}


def jpeg_uri(key):
    f, box, w = CROPS[key]
    im = Image.open(SHOTS / f).convert("RGB").crop(box)
    if im.width > w:
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def svg_uri(p):
    return "data:image/svg+xml;base64," + base64.b64encode(p.read_bytes()).decode()


html = (HERE / "slides_template.html").read_text(encoding="utf-8")
brand = ROOT / "frontend" / "public" / "brand"
uris = {k: jpeg_uri(k) for k in CROPS}
PHOTOS = {"hero": "hero-golden-garden.jpg", "tablegarden": "table-garden.jpg", "croquembouche": "croquembouche.jpg",
          "dessert": "dessert-table.jpg", "cherry": "cherry-lambeth.jpg", "raspberry": "raspberry-tart.jpg",
          "choux": "choux-crown.jpg", "bramble": "bramble-pomegranate.jpg"}
for k, f in PHOTOS.items():
    im = Image.open(ROOT / "frontend" / "public" / "photos" / f).convert("RGB")
    im.thumbnail((1000, 1000)); _b = io.BytesIO(); im.save(_b, "JPEG", quality=80, optimize=True)
    uris["photo_" + k] = "data:image/jpeg;base64," + base64.b64encode(_b.getvalue()).decode()
uris["wordmark_light"] = svg_uri(brand / "logo-wordmark-light.svg")
uris["favicon"] = svg_uri(brand / "favicon.svg")
html = re.sub(r"\{\{img:(\w+)\}\}", lambda m: uris[m.group(1)], html)
html = re.sub(r"\{\{photo:(\w+)\}\}", lambda m: uris["photo_" + m.group(1)], html)

# reuse the agent diagram from the report so both stay in sync
report_tpl = (HERE / "report_template.html").read_text(encoding="utf-8")
svg = re.search(r"<svg viewBox=\"0 0 860 330\".*?</svg>", report_tpl, re.S).group(0)
svg = svg.replace('width="100%"', 'width="100%" style="max-height:430px;display:block"')
html = html.replace("{{svg}}", svg)
html = html.replace("{{reveal_css}}", (VENDOR / "reveal.css").read_text(encoding="utf-8"))
html = html.replace("{{reveal_js}}", (VENDOR / "reveal.js").read_text(encoding="utf-8").replace("</script", "<\\/script"))
out = ROOT / "slides.html"
out.write_text(html, encoding="utf-8")
print("slides.html", round(out.stat().st_size / 1e6, 2), "MB")

if "--shots" in sys.argv:  # screenshot every slide for checking
    from playwright.sync_api import sync_playwright
    dest = Path(sys.argv[sys.argv.index("--shots") + 1]); dest.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(channel="msedge", headless=True)
        pg = b.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(out.as_uri(), wait_until="load"); pg.wait_for_timeout(800)
        n = pg.evaluate("Reveal.getTotalSlides()")
        for i in range(n):
            pg.evaluate(f"Reveal.slide({i})"); pg.wait_for_timeout(700)
            over = pg.evaluate("""(() => { const s = Reveal.getCurrentSlide();
                return s.scrollHeight > 720 + 4 ? s.scrollHeight : 0; })()""")
            pg.screenshot(path=str(dest / f"slide{i + 1:02d}.png"))
            print("slide", i + 1, "overflow px" if over else "ok", over or "")
        b.close()
