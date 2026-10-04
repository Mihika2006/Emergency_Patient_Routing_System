/* api.js -- thin fetch/WebSocket wrapper shared by all three portals. */

const API_BASE = (window.RET_RP_API_BASE) || "http://localhost:8000";

const Api = {
  async get(path) {
    const r = await fetch(`${API_BASE}${path}`);
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) throw new Error(`POST ${path} -> ${r.status}`);
    return r.json();
  },
  async patch(path, body) {
    const r = await fetch(`${API_BASE}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status}`);
    return r.json();
  },
  wsUrl(path) {
    const base = API_BASE.replace(/^http/, "ws");
    return `${base}${path}`;
  },
};

function connectSocket(path, onMessage, onOpen, onClose) {
  let socket;
  let retryDelay = 1500;

  function open() {
    socket = new WebSocket(Api.wsUrl(path));
    socket.onopen = () => { retryDelay = 1500; if (onOpen) onOpen(); };
    socket.onmessage = (evt) => {
      try { onMessage(JSON.parse(evt.data)); } catch (e) { console.error("bad ws payload", e); }
    };
    socket.onclose = () => {
      if (onClose) onClose();
      setTimeout(open, retryDelay);
      retryDelay = Math.min(retryDelay * 1.5, 10000);
    };
    socket.onerror = () => socket.close();
  }
  open();
  return {
    send: (obj) => { if (socket && socket.readyState === 1) socket.send(JSON.stringify(obj)); },
  };
}

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour12: false });
}

function riskClass(level) {
  if (level === "Red") return "critical";
  if (level === "Yellow") return "warning";
  return "normal";
}
