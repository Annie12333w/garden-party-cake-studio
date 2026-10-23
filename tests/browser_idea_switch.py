"""Browser test (needs both servers running: backend :8000, frontend :5173).

Clicking a second 'Use this idea' must replace the first idea's design, not stack it.
Run: python tests/browser_idea_switch.py
"""
import json

from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
IDEAS = [
    {"title": "Golden Garden Birthday", "description": "Swirled buttercream with yellow orchids.",
     "addon_codes": ["fresh_florals_accent", "herb_foliage", "textured_buttercream"], "gallery_slug": "meadow"},
    {"title": "Cherry Lambeth", "description": "Vintage piping with dark cherries.",
     "addon_codes": ["piped_vintage", "figs_seasonal"], "gallery_slug": "cherry-lambeth"},
]
START = {"occasion": "Mom's 60th birthday", "guest_count": 20, "allergies": "none", "size_code": "",
         "cake_flavor": "", "filling": "", "frosting": "cream_cheese",            # frosting chosen by the guest
         "addons": [], "design_notes": "Please keep it pale yellow.",
         "pickup_date": None, "pickup_time": None, "fulfillment": "pickup"}

with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True)
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    page.goto(BASE + "/order", wait_until="networkidle")
    page.evaluate("""([ideas, start]) => {
        sessionStorage.setItem('gp_order_chat', JSON.stringify([{role:'user',content:'Inspire me'},
                                                                {role:'assistant',content:'Here are two ideas.', ideas}]));
        sessionStorage.setItem('gp_order_draft', JSON.stringify(start));
        sessionStorage.setItem('gp_order_owner', 'anon'); }""", [IDEAS, START])
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1000)
    buttons = page.locator("button:has-text('Use this idea')")
    draft = lambda: json.loads(page.evaluate("sessionStorage.getItem('gp_order_draft')"))
    buttons.nth(0).click(); page.wait_for_timeout(700)
    a = draft()
    buttons.nth(1).click(); page.wait_for_timeout(700)
    c = draft()
    b.close()

codes = lambda d: sorted(x["code"] for x in d["addons"])
print("after idea 1:", codes(a), a["size_code"], a["cake_flavor"], a["filling"], a["frosting"])
print("after idea 2:", codes(c), c["size_code"], c["cake_flavor"], c["filling"], c["frosting"])
print("notes 2:", c["design_notes"].replace("\n", " | "))
checks = [
    ("idea 2 replaced idea 1's decorations", codes(c) == ["figs_seasonal", "piped_vintage"]),
    ("guest's own frosting choice kept (cream cheese)", c["frosting"] == "cream_cheese"),
    ("flavors set by idea 1 switched to idea 2's", c["cake_flavor"] == "vanilla_bean" and c["filling"] == "raspberry"),
    ("event details kept", c["occasion"] == START["occasion"] and c["guest_count"] == 20 and c["allergies"] == "none"),
    ("guest's own note kept, only one idea note", "pale yellow" in c["design_notes"]
     and c["design_notes"].count("Idea:") == 1 and "Cherry Lambeth" in c["design_notes"]),
]
for label, ok in checks:
    print(("PASS " if ok else "FAIL ") + label)
