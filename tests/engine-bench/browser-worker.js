/* global Stockfish */
// Own bridge; the loopback-only preview maps /engine/ to a separate local package.
const queued = [];
let engine;
self.onmessage = event => {
  if (typeof event.data !== "string" || /[\r\n]/.test(event.data)) return;
  if (engine) engine.postMessage(event.data); else queued.push(event.data);
};
try {
  importScripts("/engine/stockfish.js");
  Stockfish({ locateFile: file => new URL(`/engine/${file}`, self.location.href).href,
    mainScriptUrlOrBlob: new URL("/engine/stockfish.js", self.location.href).href }).then(instance => {
    engine = instance;
    engine.addMessageListener(line => self.postMessage({ line }));
    for (const command of queued) engine.postMessage(command);
    queued.length = 0;
  }).catch(error => self.postMessage({ error: String(error) }));
} catch (error) { self.postMessage({ error: String(error) }); }
