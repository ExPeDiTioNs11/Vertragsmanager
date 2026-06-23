// Senkron testi için yardımcı eş süreci (node ile çalışır, Electron'suz)
const sync = require('../sync');
const role = process.env.PEER_ROLE;
const store = new Map();
if (role === 'A') store.set('A1', { uid: 'A1', updated_at: 1000, deleted: 0, name: 'Alice' });

function snapshot() { return [...store.values()]; }
function merge(recs) {
  let applied = 0;
  for (const r of recs || []) {
    const c = store.get(r.uid);
    if (!c || Number(r.updated_at) > Number(c.updated_at)) { store.set(r.uid, r); applied++; }
  }
  return { applied, newVisible: applied };
}

sync.start({ getSnapshot: snapshot, applyRemote: merge, log: () => {} });

// A, 2.5 sn sonra ikinci kaydı yayınlar
if (role === 'A') {
  setTimeout(() => {
    const r = { uid: 'A2', updated_at: 2000, deleted: 0, name: 'Bob' };
    store.set('A2', r);
    sync.broadcast([r]);
  }, 2500);
}

process.on('message', (m) => {
  if (m === 'report') process.send({ keys: [...store.keys()].sort() });
});
