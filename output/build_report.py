"""Embed cropped screenshots into the report template -> report.html, then print a PDF to count pages."""
import base64, io, re, sys
from pathlib import Path
from PIL import Image

ROOT = Path(r"C:\Users\annie\OneDrive\Documents\Fall 1\MGT409\Final Project")
SHOTS = ROOT / "output" / "screenshots" / "report"
TPL = Path(__file__).with_name("report_template.html")

CROPS = {  # key: (file, crop box or None, output width)
    "r01": ("r01_home.png", None, 1300),
    "r02": ("r02_chat_ideas.png", (40, 40, 1400, 780), 1100),
    "r07a": ("r07_plan.png", (262, 70, 1420, 1290), 1000),
    "r06team": ("r06_agent_run.png", (262, 150, 1410, 520), 1000),
    "r06log": ("r06_agent_run.png", (585, 540, 1410, 1600), 900),
    "r07b": ("r07_plan.png", (262, 1290, 1420, 1900), 1000),
    "r09": ("r09_tokenomics.png", (262, 60, 1420, 960), 1200),
    "r04": ("r04_order8_review.png", (0, 0, 797, 1075), 760),
    "r05": ("r05_order9_review.png", (0, 0, 797, 1200), 760),
    "r10": ("r10_safety.png", (280, 505, 1400, 1450), 1200),
}


def jpeg_uri(key):
    f, box, w = CROPS[key]
    im = Image.open(SHOTS / f).convert("RGB")
    if box:
        im = im.crop(box)
    if im.width > w:
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=78, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def svg_uri(path):
    return "data:image/svg+xml;base64," + base64.b64encode(path.read_bytes()).decode()


html = TPL.read_text(encoding="utf-8")
brand = ROOT / "frontend" / "public" / "brand"
uris = {k: jpeg_uri(k) for k in CROPS}
uris["wordmark"] = svg_uri(brand / "logo-wordmark.svg")
uris["favicon"] = svg_uri(brand / "favicon.svg")
html = re.sub(r"\{\{img:(\w+)\}\}", lambda m: uris[m.group(1)], html)
out = ROOT / "report.html"
out.write_text(html, encoding="utf-8")
print("report.html", round(out.stat().st_size / 1e6, 2), "MB")

if "--pdf" in sys.argv:
    from playwright.sync_api import sync_playwright
    pdf = Path(sys.argv[sys.argv.index("--pdf") + 1])
    with sync_playwright() as p:
        b = p.chromium.launch(channel="msedge", headless=True)
        pg = b.new_page()
        pg.goto(out.as_uri(), wait_until="load")
        pg.pdf(path=str(pdf), format="Letter", prefer_css_page_size=True, print_background=True)
        b.close()
    from pypdf import PdfReader
    print("pages", len(PdfReader(str(pdf)).pages))
