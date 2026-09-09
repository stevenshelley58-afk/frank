"""One-shot operator bootstrap: create the Frank acceptance storage-state file
with a real headless Chromium against production. Never prints credentials."""
import os
import stat
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

STATE = Path("/secure/frank-storage-state.json")
URL = "https://frank.fail"

username = os.environ.get("FRANK_BROWSER_BASIC_AUTH_USER", "").strip()
password = os.environ.get("FRANK_BROWSER_BASIC_AUTH_PASSWORD", "")
if not username or not password:
    print("missing basic-auth env", file=sys.stderr)
    raise SystemExit(2)

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    context = browser.new_context(http_credentials={"username": username, "password": password})
    page = context.new_page()
    response = page.goto(URL, wait_until="domcontentloaded", timeout=30000)
    if response is None or response.status != 200:
        print(f"basic auth navigation returned HTTP {response.status if response else 'none'}", file=sys.stderr)
        browser.close()
        raise SystemExit(1)
    content = page.content()
    if "401" in content[:2000] or "Unauthorized" in content[:2000]:
        print("basic auth appears to have failed (401 page)", file=sys.stderr)
        browser.close()
        raise SystemExit(1)
    if not page.locator("#chat-composer").count():
        print("page does not look like the Hub app", file=sys.stderr)
        browser.close()
        raise SystemExit(1)
    context.storage_state(path=str(STATE))
    browser.close()

STATE.chmod(stat.S_IRUSR | stat.S_IWUSR)
mode = stat.S_IMODE(STATE.lstat().st_mode)
print(f"storage-state written: {STATE} regular={STATE.is_file()} symlink={STATE.is_symlink()} mode={oct(mode)}")
