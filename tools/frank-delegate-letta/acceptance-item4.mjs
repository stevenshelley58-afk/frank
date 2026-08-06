// Phase 8 items 4-5: real delegation through Central's delegate_task tool.
async function items() {
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
  while (Date.now() - t0 < 120000) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    if (buf.includes('"done":true')) break;
  }
  reader.cancel();
  let text = '';
  for (const frame of buf.split('\n\n')) {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      let evt;
      try { evt = JSON.parse(line.slice(6)); } catch { continue; }
      if (evt.text) text += evt.text;
    }
  }
  return text;
}

(async () => {
  const before = await items();
  const reply = await chat('Get Blockwise to check whether the Stripe checkout fix is deployed to the worker.');
  const after = await items();
  const newOnes = after.filter((d) => !before.some((b) => b.id === d.id));
  console.log('new delegations:', newOnes.length);
  for (const d of newOnes) {
    console.log(JSON.stringify({ id: d.id, room: d.toRoomId, status: d.status, task: d.task.slice(0, 200) }, null, 1));
  }
  console.log('central reply:', reply.slice(0, 250));
})();
