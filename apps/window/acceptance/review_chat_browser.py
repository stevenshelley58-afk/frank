"""Isolated, fail-closed browser acceptance. Never invokes real provider APIs."""
import argparse
import copy
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

ROOT = "/api/ad-template-generator/runs/fixture-run"

def record(number, message="Earlier correction", status="ready_for_review", annotations=None):
    rid = "rrev_" + f"{number:032x}"
    return {"id":rid,"revision":number,"message":message,"annotations":annotations or [],"status":status,
        "before":{p:f"{rid}-before-{p}.png" for p in ("feed","story")},
        "after":{p:f"{rid}-after-{p}.png" for p in ("feed","story")} if status == "ready_for_review" else None}

class Fixture:
    def __init__(self):
        self.revision=1; self.history=[record(1)]; self.posts=[]; self.events=0
        previews=[{"placement":p,"kind":kind,"url":f"/fixtures/{p}.svg"} for p in ("feed","story") for kind in ("qa-source-filled","final-neutral-shippable")]
        self.run={"id":"fixture-run","project_id":"fixture-project","title":"Fixture review","status":"ready_for_review","review_status":"ready_for_review","updated_at":"2026-09-08T00:00:00Z", "output":{"review_summary":{"status":"ready_for_review","previews":previews,"source":{"url":"/fixtures/feed.svg"},"scores":{"overall":9.9},"smoke_test":{"passed":True}}}}
    def complete(self):
        self.run["status"]="ready_for_review"; self.run["review_status"]="ready_for_review"
        last=self.history[-1]; self.history[-1]=record(last["revision"],last["message"],annotations=last["annotations"])
    def api(self, route):
        path=urlsplit(route.request.url).path
        def reply(body, status=200): route.fulfill(status=status,content_type="application/json",body=json.dumps(body))
        if "/artifacts/" in path or path.startswith("/fixtures/"):
            height=1920 if "story" in path else 1350
            svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="{height}"><rect width="1080" height="{height}" fill="#dad5c9"/><rect x="80" y="180" width="900" height="500" fill="#4d7168"/><text x="90" y="120" font-size="60">Review fixture</text></svg>'
            route.fulfill(content_type="image/svg+xml",body=svg); return
        if path == "/api/projects": reply({"projects":[{"id":"fixture-project","name":"Fixture project"}],"archived_projects":[]})
        elif path == "/api/ad-template-generator/runs": reply({"runs":[self.run]})
        elif path == ROOT: reply({"run":self.run})
        elif path == ROOT+"/revisions": reply({"current_revision":self.revision,"run_status":self.run["status"],"revisions":self.history})
        elif path in (ROOT+"/review-messages",ROOT+"/revisions/undo") and route.request.method == "POST":
            body=route.request.post_data_json; self.posts.append((path,copy.deepcopy(body)))
            assert body["project_id"] == "fixture-project" and body["expected_revision"] == self.revision
            assert body["idempotency_key"]
            if self.run["status"] != "ready_for_review": reply({"error":{"message":"Revision already running"}},409); return
            self.revision+=1; self.run["status"]="queued"; self.run["review_status"]="revision_requested"
            item=record(self.revision,body.get("message","Restore previous revision"),"pending",body.get("annotations",[])); self.history.append(item)
            reply({"status":"queued","current_revision":self.revision,"review_revision":item},202)
        elif path.endswith("/events"):
            self.events+=1; route.fulfill(content_type="text/event-stream",body=": fixture heartbeat\n\n")
        elif path.startswith("/api/ad-template-generator/"): reply({"available":False,"models":[],"roles":[]})
        elif route.request.method == "GET": reply({"projects":[],"chats":[],"sessions":[],"accounts":[],"items":[]})
        else: route.abort()

def select_review(page):
    page.locator("#ad-tab-review").click()
    page.locator(".ad-review-row").first.wait_for(state="visible")
    page.locator(".ad-review-row").first.click()
    page.locator(".ad-review-chat").wait_for(state="visible")
    expect(page.locator('[data-testid="review-chat-input"]')).to_be_enabled()

def draw(page):
    canvas=page.locator(".ad-review-compare-card").filter(has=page.locator("strong",has_text="Reusable template")).locator(".ad-review-annotation-layer")
    canvas.scroll_into_view_if_needed(); box=canvas.bounding_box(); assert box and box["width"]>80
    page.mouse.move(box["x"]+box["width"]*.15,box["y"]+box["height"]*.2); page.mouse.down()
    page.mouse.move(box["x"]+box["width"]*.55,box["y"]+box["height"]*.4,steps=5); page.mouse.up()
    expect(page.locator(".ad-review-annotation-box")).to_have_count(1)

def journey(browser,url,output,name,width):
    context=browser.new_context(viewport={"width":width,"height":900},reduced_motion="reduce")
    page=context.new_page(); fixture=Fixture(); checks=[]; errors=[]
    page.on("pageerror",lambda error:errors.append(str(error)))
    page.route("**/api/**",fixture.api); page.route("**/fixtures/**",fixture.api)
    try:
        page.goto(url+"/ad-template-generator",wait_until="domcontentloaded"); select_review(page)
        assert fixture.events == 0; checks.append("terminal run opens no event stream")
        snapshots=page.locator("img[data-review-snapshot]"); expect(snapshots).to_have_count(2)
        for image in snapshots.all():
            expect(image).to_have_js_property("complete",True)
            assert image.evaluate("img => img.naturalWidth > 0")
        checks.append("immutable before and after images")
        draw(page); page.locator(".ad-review-annotation-comments input").fill("Move this headline lower")
        composer=page.locator('[data-testid="review-chat-input"]'); composer.fill("Keep everything else unchanged")
        toolbar=page.locator(".ad-review-toolbar")
        toolbar.get_by_role("button",name="Story",exact=True).click()
        expect(composer).to_have_value("Keep everything else unchanged"); draw(page)
        page.get_by_role("button",name="Remove annotation 1",exact=True).click()
        expect(page.locator(".ad-review-annotation-box")).to_have_count(0)
        toolbar.get_by_role("button",name="Feed",exact=True).click()
        expect(page.locator(".ad-review-annotation-box")).to_have_count(1)
        checks.append("placement-safe annotations, removal and draft preservation")
        page.locator('[data-testid="review-chat-send"]').click()
        expect(composer).to_be_disabled(); assert len(fixture.posts)==1
        payload=fixture.posts[0][1]; area=payload["annotations"][0]
        assert set(payload)=={"project_id","message","annotations","expected_revision","idempotency_key"}
        assert set(area)=={"placement","x","y","width","height","message"}
        assert area["placement"]=="feed" and area["message"]=="Move this headline lower"
        assert abs(area["x"]-.15)<.02 and abs(area["width"]-.4)<.02
        checks.append("annotated correction queued once with correct coordinates")
        fixture.complete(); page.reload(wait_until="domcontentloaded"); select_review(page)
        expect(page.locator(".ad-review-chat-thread")).to_contain_text("Keep everything else unchanged")
        page.locator('[data-testid="review-undo"]').click(); expect(composer).to_be_disabled()
        assert fixture.posts[-1][0].endswith("/revisions/undo") and fixture.revision==3
        checks.append("saved history survives reload and undo queues a new revision")
        fixture.complete(); page.reload(wait_until="domcontentloaded"); select_review(page)
        composer.fill("Correct the date only"); page.locator('[data-testid="review-chat-send"]').click()
        expect(composer).to_be_disabled(); assert fixture.posts[-1][1]["annotations"]==[]
        checks.append("text-only correction and processing lock")
        assert not errors, errors
        page.screenshot(path=str(output.parent/f"review-chat-{name}.png"),full_page=True)
        return {"checks":checks,"status":"pass"}
    except Exception as error:
        page.screenshot(path=str(output.parent/f"review-chat-{name}-failure.png"),full_page=True)
        return {"checks":checks,"status":"fail","error":str(error),"page_errors":errors}
    finally: context.close()

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--url",required=True); parser.add_argument("--output",type=Path,required=True); args=parser.parse_args()
    if urlsplit(args.url).hostname not in {"127.0.0.1","localhost"}: raise SystemExit("Only isolated loopback previews are permitted")
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(); journeys={n:journey(browser,args.url.rstrip("/"),args.output,n,w) for n,w in (("desktop",1280),("mobile",390))}; browser.close()
    receipt={"schema":"frank.review-chat-browser/v1","fixture_based":True,"provider_calls":False,"publishing":False,"captured_at":datetime.now(timezone.utc).isoformat(),"journeys":journeys,"status":"pass" if all(x["status"]=="pass" for x in journeys.values()) else "fail"}
    args.output.write_text(json.dumps(receipt,indent=2)+"\n"); print(json.dumps(receipt)); return 0 if receipt["status"]=="pass" else 1
if __name__=="__main__": raise SystemExit(main())
