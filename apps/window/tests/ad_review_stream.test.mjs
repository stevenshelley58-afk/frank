import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../web/js/ad-template-generator.js", import.meta.url), "utf8");
const code = source.slice(source.indexOf("const QUIET_RUN_STATUSES"), source.indexOf("async function loadScopedGraph"));
function fixture(status) {
  const streams = [], timers = [], badge = {textContent: ""};
  const c = {
    Set, String, Number, Math, JSON, encodeURIComponent,
    active: true, selectedRunId: "run-1", selectedReviewRunId: "run-1", runSelectionRevision: 1,
    runs: [{id: "run-1", status}], runEvents: [], runEventCache: new Map(), eventStream: null, eventReconnectTimer: null,
    EVENT_KINDS: [], renderEventViews() {}, renderReviewDetail() {}, renderRunDetail() {}, renderReviewQueue() {},
    runStatusLabel: s => s, $: () => badge, mergeAdTemplateGeneratorRun: (a,b) => ({...a,...b}),
    window: {setTimeout(fn) {timers.push(fn); return timers.length;}, clearTimeout() {}},
    EventSource: class {constructor(url) {this.url=url; this.listeners={}; streams.push(this);} close() {this.closed=true;} addEventListener(k,fn) {this.listeners[k]=fn;}},
    getAdTemplateGeneratorRun: async () => c.nextDetail || c.runs[0],
  };
  c.stopRunEvents = () => { c.eventStream?.close(); c.eventStream=null; c.eventReconnectTimer=null; };
  vm.createContext(c); vm.runInContext(code, c);
  c.connectRunEvents(c.runs[0]);
  return {c, streams, timers, badge};
}
for (const status of ["ready_for_review", "completed", "failed", "cancelled", "discarded", "approved"]) {
  test(`terminal ${status} opens no stream`, () => {
    const f=fixture(status); assert.equal(f.streams.length,0); assert.equal(f.timers.length,0); assert.equal(f.badge.textContent,status);
  });
}
test("normal EOF reconciles ready state without reconnecting", async () => {
  const f=fixture("running"); f.c.nextDetail={id:"run-1",status:"ready_for_review"};
  await f.streams[0].onerror();
  assert.equal(f.timers.length,0); assert.equal(f.c.eventStream,null); assert.equal(f.badge.textContent,"ready_for_review");
});
test("active transport failure schedules one reconnect", async () => {
  const f=fixture("running"); await f.streams[0].onerror();
  assert.equal(f.timers.length,1); assert.equal(f.badge.textContent,"Reconnecting…");
});
test("import event is not treated as terminal before smoke checks", async () => {
  const f=fixture("running");
  f.streams[0].listeners["template.imported"]({data:JSON.stringify({kind:"template.imported",sequence:1})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.notEqual(f.streams[0].closed,true); assert.equal(f.c.eventStream,f.streams[0]);
});
test("ready event refreshes authoritative state then closes", async () => {
  const f=fixture("running"); f.c.nextDetail={id:"run-1",status:"ready_for_review"};
  f.streams[0].listeners["template.ready-for-review"]({data:JSON.stringify({kind:"template.ready-for-review",sequence:2})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.c.runs[0].status,"ready_for_review"); assert.equal(f.c.eventStream,null); assert.equal(f.timers.length,0);
});

test("a late close cannot reconnect or update another selected run", async () => {
  const f=fixture("running"); f.c.selectedRunId="another-run"; f.c.runSelectionRevision+=1;
  await f.streams[0].onerror(); assert.equal(f.timers.length,0); assert.equal(f.c.runs[0].status,"running");
});
