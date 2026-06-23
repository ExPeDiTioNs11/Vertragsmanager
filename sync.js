// Sıfır-yapılandırma LAN senkronizasyonu (P2P mesh)
// - UDP yayını ile otomatik eş keşfi (aynı ağdaki diğer kopyaları bulur)
// - TCP ile tam mesh bağlantı; değişiklikler anında tüm eşlere yayılır
// - Hiç ek paket / internet gerekmez (Node: net, dgram, crypto, os)
const dgram = require('dgram');
const net = require('net');
const crypto = require('crypto');
const os = require('os');

const MAGIC = 'VERTRAEGE_SYNC_V1';
const UDP_PORT = Number(process.env.SYNC_UDP_PORT || 47920);
const TCP_PORT = Number(process.env.SYNC_TCP_PORT || 47921);
const ANNOUNCE_MS = 4000;

const instanceId = crypto.randomUUID();
const peers = new Map(); // peerId -> socket (kurulu bağlantı)
const pending = new Set(); // bağlanmakta olan peerId'ler

let opts = {};
let udp;
let server;

function log(msg) {
  if (opts.log) opts.log('[sync] ' + msg);
}

// IPv4 arayüzlerinin alt-ağ yayın adreslerini hesapla
function broadcastAddresses() {
  const addrs = ['255.255.255.255'];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      const ip = ni.address.split('.').map(Number);
      const mask = ni.netmask.split('.').map(Number);
      const bc = ip.map((o, i) => (o & mask[i]) | (~mask[i] & 0xff));
      addrs.push(bc.join('.'));
    }
  }
  return [...new Set(addrs)];
}

function sendLine(socket, obj) {
  try { socket.write(JSON.stringify(obj) + '\n'); } catch { /* yok say */ }
}

// Eşe tam veri anlık görüntüsünü gönder
function sendSnapshot(socket) {
  try {
    const records = opts.getSnapshot ? opts.getSnapshot() : [];
    sendLine(socket, { t: 'data', records });
  } catch (e) { log('snapshot hatası: ' + e.message); }
}

function registerPeer(peerId, socket) {
  const old = peers.get(peerId);
  if (old && old !== socket) { try { old.destroy(); } catch {} }
  peers.set(peerId, socket);
  pending.delete(peerId);
  if (opts.onPeersChanged) opts.onPeersChanged(peers.size);
  log('eş bağlandı: ' + peerId.slice(0, 8) + ' (toplam ' + peers.size + ')');
}

function handleMessage(socket, msg, ctx) {
  if (msg.t === 'hello') {
    if (msg.id === instanceId) { socket.destroy(); return; } // kendimiz
    ctx.peerId = msg.id;
    registerPeer(msg.id, socket);
    sendSnapshot(socket); // bağlanınca tam veriyi paylaş
  } else if (msg.t === 'data') {
    if (!opts.applyRemote) return;
    const summary = opts.applyRemote(msg.records || []);
    if (summary && summary.applied > 0 && opts.onApplied) opts.onApplied(summary);
  }
}

function setupConnection(socket) {
  let buffer = '';
  const ctx = { peerId: null };
  socket.setKeepAlive(true, 10000);
  sendLine(socket, { t: 'hello', id: instanceId }); // el sıkışma
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      handleMessage(socket, msg, ctx);
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    if (ctx.peerId && peers.get(ctx.peerId) === socket) {
      peers.delete(ctx.peerId);
      if (opts.onPeersChanged) opts.onPeersChanged(peers.size);
    }
  });
}

function connectToPeer(ip, port, peerId) {
  if (peers.has(peerId) || pending.has(peerId)) return;
  pending.add(peerId);
  const socket = net.connect({ host: ip, port }, () => setupConnection(socket));
  socket.on('error', () => { pending.delete(peerId); });
  socket.on('close', () => { pending.delete(peerId); });
}

function startTcpServer() {
  server = net.createServer((socket) => setupConnection(socket));
  server.on('error', (e) => log('TCP sunucu hatası: ' + e.message));
  server.listen(TCP_PORT, () => log('TCP dinleniyor :' + TCP_PORT));
}

function startUdp() {
  udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.on('error', (e) => log('UDP hatası: ' + e.message));
  udp.on('message', (buf, rinfo) => {
    let m;
    try { m = JSON.parse(buf.toString('utf8')); } catch { return; }
    if (!m || m.magic !== MAGIC || m.id === instanceId) return;
    // Çakışmasız tek bağlantı: küçük id olan taraf bağlanır
    if (instanceId < m.id) connectToPeer(rinfo.address, m.tcp || TCP_PORT, m.id);
  });
  udp.bind(UDP_PORT, () => {
    try { udp.setBroadcast(true); } catch {}
    log('UDP keşif :' + UDP_PORT);
    announce();
    setInterval(announce, ANNOUNCE_MS);
  });
}

function announce() {
  const payload = Buffer.from(JSON.stringify({ magic: MAGIC, id: instanceId, tcp: TCP_PORT }));
  for (const addr of broadcastAddresses()) {
    udp.send(payload, 0, payload.length, UDP_PORT, addr, () => {});
  }
}

// Yerel değişikliği tüm eşlere yayınla
function broadcast(records) {
  if (!records || !records.length || !peers.size) return;
  const msg = JSON.stringify({ t: 'data', records }) + '\n';
  for (const socket of peers.values()) {
    try { socket.write(msg); } catch {}
  }
}

function start(options) {
  opts = options || {};
  startTcpServer();
  startUdp();
  log('başlatıldı, kimlik ' + instanceId.slice(0, 8));
}

function peerCount() { return peers.size; }

module.exports = { start, broadcast, peerCount, instanceId };
