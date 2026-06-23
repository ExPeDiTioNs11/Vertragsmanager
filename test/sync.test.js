// P2P senkron testi: iki eş süreci başlat, veri her ikisine yayılıyor mu?
const { test } = require('node:test');
const assert = require('node:assert');
const { fork } = require('node:child_process');
const path = require('node:path');

const PEER = path.join(__dirname, '_syncpeer.js');

function makeEnv(role, tcp) {
  return { ...process.env, PEER_ROLE: role, SYNC_TCP_PORT: String(tcp), SYNC_UDP_PORT: '47920' };
}
function report(child) {
  return new Promise((resolve) => {
    const onMsg = (m) => { if (m && m.keys) { child.off('message', onMsg); resolve(m.keys); } };
    child.on('message', onMsg);
    child.send('report');
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('senkron: kayıtlar her iki eşe yayılır', { timeout: 25000 }, async () => {
  const a = fork(PEER, [], { env: makeEnv('A', 47921) });
  const b = fork(PEER, [], { env: makeEnv('B', 47931) });
  try {
    await wait(7000); // keşif + bağlantı + yayılma
    const [ka, kb] = await Promise.all([report(a), report(b)]);
    assert.deepEqual(ka, ['A1', 'A2'], 'A kendi kayitlarini tutmali');
    assert.deepEqual(kb, ['A1', 'A2'], 'B, A kayitlarini almali');
  } finally {
    a.kill();
    b.kill();
  }
});
