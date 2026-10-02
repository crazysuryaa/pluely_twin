import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const appUrl = process.argv[2] ?? "http://127.0.0.1:1422";
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = await mkdtemp(path.join(tmpdir(), "commenter-layout-"));
const port = 9333;
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDebugger() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await sleep(100);
  }
  throw new Error("Chrome DevTools endpoint did not start");
}

async function createPage() {
  const response = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" }
  );
  if (!response.ok) throw new Error(`Unable to create Chrome page: ${response.status}`);
  return response.json();
}

function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };

  const opened = new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("CDP WebSocket failed"));
  });

  return {
    async send(method, params = {}) {
      await opened;
      const id = nextId++;
      const result = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close() {
      socket.close();
    },
  };
}

const mockWebSocketSource = String.raw`
(() => {
  localStorage.setItem(
    "pluely-twin:last-connection-link",
    "pluely-twin://connect?host=127.0.0.1&port=8765&token=test-token"
  );

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor() {
      this.readyState = MockWebSocket.CONNECTING;
      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.({});
      }, 0);
    }

    send(payload) {
      let message;
      try { message = JSON.parse(payload); } catch { return; }
      if (message.type !== "authenticate") return;

      setTimeout(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: "authenticated",
            session_id: "layout-test-session",
            latest_event_seq: 0,
            host_connected: false
          })
        });

        for (let index = 1; index <= 80; index += 1) {
          this.onmessage?.({
            data: JSON.stringify({
              type: "host_event",
              seq: index,
              event: {
                type: "speaker_final",
                speaker: "Speaker",
                text: "Layout regression message " + index + " with enough content to occupy a row."
              }
            })
          });
        }
      }, 0);
    }

    close() {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({});
    }
  }

  window.WebSocket = MockWebSocket;
})();
`;

let cdp;
try {
  await waitForDebugger();
  const page = await createPage();
  cdp = connectCdp(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1512,
    height: 761,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: mockWebSocketSource,
  });
  await cdp.send("Page.navigate", { url: appUrl });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `Boolean([...document.querySelectorAll('button')].find((button) => button.textContent === 'Connect'))`,
    });
    if (ready.result.value) break;
    await sleep(100);
  }

  await cdp.send("Runtime.evaluate", {
    expression: `[...document.querySelectorAll('button')]
      .find((button) => button.textContent === 'Connect')?.click()`,
  });
  await sleep(1000);

  const result = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const feedHeader = [...document.querySelectorAll('div')]
        .find((element) => element.textContent === 'Session Feed');
      const panel = feedHeader?.parentElement;
      const messages = feedHeader?.nextElementSibling;
      if (!panel || !messages) {
        throw new Error('Session feed did not render: ' + document.body.innerText);
      }
      const panelRect = panel.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        documentHeight: document.documentElement.scrollHeight,
        panelTop: panelRect.top,
        panelBottom: panelRect.bottom,
        panelHeight: panelRect.height,
        panelViewportRatio: panelRect.height / window.innerHeight,
        messagesClientHeight: messages.clientHeight,
        messagesScrollHeight: messages.scrollHeight,
        messagesOverflowY: getComputedStyle(messages).overflowY,
      };
    })()`,
  });

  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "Layout evaluation failed"
    );
  }

  const metrics = result.result.value;
  console.log(JSON.stringify(metrics, null, 2));

  const panelFitsViewport = metrics.panelBottom <= metrics.viewportHeight + 1;
  const documentFitsViewport = metrics.documentHeight <= metrics.viewportHeight + 1;
  const messagesScroll =
    metrics.messagesOverflowY === "auto" &&
    metrics.messagesScrollHeight > metrics.messagesClientHeight;
  const workspaceUsesTargetHeight =
    metrics.panelViewportRatio >= 0.8 && metrics.panelViewportRatio <= 0.85;

  if (
    !panelFitsViewport ||
    !documentFitsViewport ||
    !messagesScroll ||
    !workspaceUsesTargetHeight
  ) {
    throw new Error(
      "Chat layout regression: workspace must use 80–85% of the viewport and the message feed must own overflow"
    );
  }
} finally {
  cdp?.close();
  chrome.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => chrome.once("exit", resolve)),
    sleep(2000),
  ]);
  await rm(profile, { recursive: true, force: true });
}
