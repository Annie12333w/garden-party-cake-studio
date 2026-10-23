"""Browser test (needs both servers running: backend :8000, frontend :5173).

Checks that the Order Taker chat and draft never carry over between different accounts in one browser tab.
Run: python tests/browser_chat_reset.py
"""
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
SECRET = "MAYA-PRIVATE-NOTE: nephew tree nut allergy"


def ui_login(page, email, pw):
    page.goto(BASE + "/login", wait_until="networkidle")
    page.fill("input[type=email]", email)
    page.fill("input[type=password]", pw)
    page.click("form.auth-form button.btn-primary")
    page.wait_for_timeout(1500)


def plant_chat(page):
    """Stand in for a real chat (no LLM cost): put a message in this tab's saved chat, then reload /order."""
    page.goto(BASE + "/order", wait_until="networkidle")
    page.evaluate("""s => { sessionStorage.setItem('gp_order_chat', JSON.stringify([{role:'user',content:s}]));
                             sessionStorage.setItem('gp_order_draft', JSON.stringify({occasion:'Maya secret party'})); }""", SECRET)
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(800)
    return SECRET in page.content()


def sees_secret(page):
    page.goto(BASE + "/order", wait_until="networkidle")
    page.wait_for_timeout(1000)
    return SECRET in page.content() or "Maya secret party" in page.content()


results = []
with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", headless=True)

    # 1. Maya chats, signs out from the header, Grace signs in
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    ui_login(page, "maya@demo.test", "Cake!2026")
    assert plant_chat(page), "setup: Maya should see her own chat"
    page.click("button.nav-link:has-text('Sign out')")
    page.wait_for_timeout(1200)
    ui_login(page, "grace@demo.test", "Cake!2026")
    results.append(("Maya signs out, Grace signs in: Grace does NOT see Maya's chat", not sees_secret(page)))

    # 2. Maya chats, Grace signs in on the same tab without Maya signing out
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    ui_login(page, "maya@demo.test", "Cake!2026")
    assert plant_chat(page)
    ui_login(page, "grace@demo.test", "Cake!2026")
    results.append(("Grace signs in over Maya's session: Grace does NOT see Maya's chat", not sees_secret(page)))

    # 3. A guest chats, then signs in mid-order: keeps the conversation
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    assert plant_chat(page)
    ui_login(page, "ben@demo.test", "Cake!2026")
    results.append(("Guest chats then signs in as Ben: conversation is kept", sees_secret(page)))

    # 4. Maya's own chat survives a page reload while she stays signed in
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    ui_login(page, "maya@demo.test", "Cake!2026")
    assert plant_chat(page)
    results.append(("Maya reloads the page: her own chat is still there", sees_secret(page)))
    b.close()

for label, passed in results:
    print(("PASS " if passed else "FAIL ") + label)
