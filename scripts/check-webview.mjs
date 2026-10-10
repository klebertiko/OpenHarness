const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("Usage: node scripts/check-webview.mjs <debug-port>");
}

// Cold CI runners can take well over 15s to start the WebView2 runtime.
const deadline = Date.now() + Number(process.env.OH_WEBVIEW_TIMEOUT_MS ?? 60_000);
let page;
let lastSeen = "no response from the DevTools endpoint";
while (Date.now() < deadline) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    lastSeen = `targets: ${JSON.stringify(targets.map(({ type, url }) => ({ type, url })))}`;
    page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
    if (page) break;
  } catch (error) {
    // WebView2 starts after the native window and sidecar.
    lastSeen = `DevTools endpoint error: ${error.cause?.code ?? error.message}`;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

if (!page) throw new Error(`WebView2 did not expose a page target (${lastSeen})`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("CDP connection timed out")), 5_000);
  socket.addEventListener("open", () => {
    clearTimeout(timeout);
    resolve();
  }, { once: true });
  socket.addEventListener("error", () => {
    clearTimeout(timeout);
    reject(new Error("CDP connection failed"));
  }, { once: true });
});

const result = await new Promise((resolve, reject) => {
  const id = 1;
  const timeout = setTimeout(() => reject(new Error("DOM inspection timed out")), 5_000);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== id) return;
    clearTimeout(timeout);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result.result.value);
  });
  socket.send(JSON.stringify({
    id,
    method: "Runtime.evaluate",
    params: {
      expression: `({ title: document.title, readyState: document.readyState, body: document.body?.innerText ?? "", href: location.href })`,
      returnByValue: true,
    },
  }));
});
socket.close();

if (result.title !== "OpenHarness") throw new Error(`Unexpected window title: ${result.title}`);
if (result.readyState !== "complete") throw new Error(`WebView document is ${result.readyState}`);
if (result.body.length < 100 || !result.body.includes("OpenHarness")) {
  throw new Error("OpenHarness UI did not render expected content");
}

console.log(JSON.stringify({
  title: result.title,
  readyState: result.readyState,
  href: result.href,
  bodyCharacters: result.body.length,
}));
