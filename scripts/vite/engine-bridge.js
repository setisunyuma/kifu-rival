/* global Stockfish */
// Own classic-worker bridge (KIF-021). Served only by the development engine route; it loads the
// third-party engine from that route and relays one USI line per message.
const queued = [];
let engine;
self.onmessage = event => {
  if (typeof event.data !== "string" || /[\r\n]/.test(event.data) || event.data.length > 4096) return;
  if (engine) engine.postMessage(event.data); else queued.push(event.data);
};
try {
  importScripts("/__kiyu-engine/stockfish.js");
  Stockfish({ locateFile: file => new URL(`/__kiyu-engine/${file}`, self.location.href).href,
    mainScriptUrlOrBlob: new URL("/__kiyu-engine/stockfish.js", self.location.href).href }).then(instance => {
    engine = instance;
    engine.addMessageListener(line => self.postMessage({ line: String(line) }));
    for (const command of queued) engine.postMessage(command);
    queued.length = 0;
  }).catch(error => self.postMessage({ error: String(error) }));
} catch (error) { self.postMessage({ error: String(error) }); }
