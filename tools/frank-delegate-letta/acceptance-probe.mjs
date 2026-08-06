// Phase 8 acceptance probe — run INSIDE the frank-web container.
// Items 1-3: questions about the system must produce prose, zero delegations.
// Item 6: vague request must not silently run.
async function count() {
  const r = await fetch('http://localhost:3001/api/delegations');
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 2000) {
    const { value } = await reader.read();
    buf += dec.decode(value);
    if (buf.includes('\n\n')) break;
  }
  reader.cancel();
  const snap = JSON.parse(buf.split('data: ')[1].split('\n\n')[0]);
  return snap.items;
}

async function chat(msg) {
  const r = await fetch('http://localhost:3001/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, roomId: 'central', roomName: 'Central', agentName: 'Frank' }),
  });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    if (buf.includes('"done":true')) break;
  }
  reader.cancel();
  // Parse SSE frames properly.
  let text = '';
  let doneEvt = '';
  for (const frame of buf.split('\n\n')) {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      let evt;
      try { evt = JSON.parse(line.slice(6)); } catch { continue; }
      if (evt.text) text += evt.text;
      if (evt.done) doneEvt = JSON.stringify(evt);
    }
  }
  return { text, doneRaw: doneEvt };
}

(async () => {
  const probes = [
    'Can you send tasks to other rooms?',
    'What rooms exist in this system?',
    'Do something about Chase\u2019s game.',
  ];
  for (const p of probes) {
    const before = (await count()).length;
    const { text, doneRaw } = await chat(p);
    const after = await count();
    const delta = after.length - before;
    const newOnes = after.length > before ? after.slice(0, delta).map((d) => `${d.status}:${d.toRoomId}`) : [];
    console.log('---');
    console.log('PROBE:', p);
    console.log('delegations delta:', delta, newOnes.join(',') || '(none)');
    console.log('reply:', text.slice(0, 300));
    console.log('done evt:', doneRaw.slice(0, 220));
  }
})();
