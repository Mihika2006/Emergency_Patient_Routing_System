/**
 * api.js — Shared Client API and Socket.IO Network Client
 */

const BASE_URL = window.location.origin.includes(":5000") 
  ? window.location.origin 
  : "http://localhost:5000";

const API = {
  async get(endpoint) {
    const res = await fetch(`${BASE_URL}${endpoint}`);
    if (!res.ok) throw new Error(`GET ${endpoint} failed: ${res.status}`);
    return await res.json();
  },

  async post(endpoint, data = {}) {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`POST ${endpoint} failed: ${res.status}`);
    return await res.json();
  },
};

function initSocketConnection() {
  if (typeof io === "undefined") {
    console.error("Socket.io library not loaded");
    return null;
  }
  const socket = io(BASE_URL, {
    transports: ["websocket", "polling"],
    reconnection: true,
  });

  socket.on("connect", () => {
    const badge = document.getElementById("connection-badge");
    if (badge) {
      badge.className = "connection-badge connected";
      badge.textContent = "Connected";
    }
  });

  socket.on("disconnect", () => {
    const badge = document.getElementById("connection-badge");
    if (badge) {
      badge.className = "connection-badge disconnected";
      badge.textContent = "Disconnected";
    }
  });

  return socket;
}

function appendLog(containerId, message, type = "normal") {
  const container = document.getElementById(containerId);
  if (!container) return;
  const time = new Date().toTimeString().split(" ")[0];
  const row = document.createElement("div");
  row.className = `activity-log-entry ${type}`;
  row.innerHTML = `<span class="time">[${time}]</span><span class="message">${message}</span>`;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}
