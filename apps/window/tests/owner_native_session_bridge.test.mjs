import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {nativeLoginUrl, parseAppBridgeMessage} from "../web/js/owner-app-host.js";
const bridge = readFileSync(new URL("../web/js/owner-native-bridge.js", import.meta.url), "utf8");
test("login targets are fixed and never provider callback or arbitrary redirects", () => {
  assert.equal(nativeLoginUrl("crm"), "https://crm.frank.fail/api/method/frank_owner_entry.api.enter?app=crm");
  assert.equal(nativeLoginUrl("support"), "https://crm.frank.fail/api/method/frank_owner_entry.api.enter?app=support");
  assert.equal(nativeLoginUrl("mail"), "https://mail.frank.fail/frank/launch?bridge=1");
  assert.equal(nativeLoginUrl("campaigns"), "https://marketing.frank.fail/saml/discovery");
  assert.equal(nativeLoginUrl("https://evil.test"), null);
});
test("session-required messages enforce exact frame, origin, version and app", () => {
  const source = {};
  const frame = {contentWindow: source};
  const data = {channel:"frank.owner-app",version:1,app:"crm",type:"session_required"};
  const event = {source,origin:"https://crm.frank.fail",data};
  assert.deepEqual(parseAppBridgeMessage(event,frame,"crm"),{type:"session_required"});
  assert.equal(parseAppBridgeMessage({...event,source:{}},frame,"crm"),null);
  assert.equal(parseAppBridgeMessage({...event,origin:"https://evil.test"},frame,"crm"),null);
  assert.equal(parseAppBridgeMessage({...event,data:{...data,version:2}},frame,"crm"),null);
});
test("native checks do not follow login redirects or export page data", () => {
  assert.match(bridge,/redirect: "manual"/);
  assert.match(bridge,/owner@blockwise.sale/);
  assert.match(bridge,/authenticated === true/);
  assert.doesNotMatch(bridge,/document.cookie|localStorage|sessionStorage|response.text/);
  assert.match(bridge,/postMessage[\s\S]*parentOrigin/);
});
