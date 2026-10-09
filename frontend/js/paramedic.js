/* paramedic.js */

const els = {};
let state = {
  tripId: null,
  autoStream: false,
  timer: null,
  ble: false,
  vitals: { hr: 82, spo2: 98, sbp: 118, dbp: 76 },
};

document.addEventListener("DOMContentLoaded", () => {
  cacheEls();
  bindUI();
  syncSliderLabels();
  logEvent("Paramedic console ready. Enter the active Trip ID from the Driver console.");
});

function cacheEls() {
  ["sessionIdIn", "loadSessionBtn", "sessionBadge", "bleBtn", "bleStatus",
   "hr", "hrVal", "spo2", "spo2Val", "sbp", "sbpVal", "dbp", "dbpVal",
   "sendVitalsBtn", "autoStreamToggle", "autoStreamStatus",
   "riskBadge", "triageLabel", "manualTriggerBtn", "log",
   "tileHr", "tileSpo2", "tileSbp",
  ].forEach(id => els[id] = document.getElementById(id));
}

function bindUI() {
  els.loadSessionBtn.addEventListener("click", onLoadSession);
  els.bleBtn.addEventListener("click", onToggleBle);
  ["hr", "spo2", "sbp", "dbp"].forEach(key => {
    els[key].addEventListener("input", syncSliderLabels);
  });
  els.sendVitalsBtn.addEventListener("click", () => sendVitals(true));
  els.autoStreamToggle.addEventListener("change", onToggleAutoStream);
  els.manualTriggerBtn.addEventListener("click", onManualTrigger);
}

function onLoadSession() {
  const id = els.sessionIdIn.value.trim();
  if (!id) return;
  state.tripId = id;
  els.sessionBadge.textContent = `Trip ${id} linked`;
  els.sessionBadge.style.color = "var(--teal)";
  logEvent(`Linked to trip ${id}.`);
}

async function onLinkSession() {
  const tripId = els.sessionIdInput.value.trim();
  if (!tripId) return alert("Enter Trip ID");

  state.tripId = tripId;

  // Connect WebSocket for real-time dispatch updates
  connectSocket(`/ws/paramedic/${tripId}`, (msg) => {
    if (msg.type === "DESTINATION_UPDATED") {
      logEvent(`🚨 CRITICAL DIVERSION CONFIRMED: Route redirected to ${msg.hospital_name}!`, true);
      const banner = document.getElementById("active-hospital-label") || els.patientMeta;
      if (banner) banner.textContent = `Destination: ${msg.hospital_name} (Critical)`;
    }
    if (msg.type === "AMBULANCE_ARRIVED") {
      alert(`🏁 ARRIVAL NOTIFICATION:\n${msg.message}`);
      logEvent(msg.message, true);
    }
  });

  logEvent(`Linked to trip ${tripId}.`);
}

function onToggleBle() {
  state.ble = !state.ble;
  els.bleStatus.textContent = state.ble ? "Connected: PulseOximeter_01" : "Not connected";
  els.bleStatus.style.color = state.ble ? "var(--teal)" : "var(--slate-400)";
  els.bleBtn.textContent = state.ble ? "Disconnect Sensor" : "Connect BLE Sensor";
  logEvent(state.ble ? "BLE sensor connected." : "BLE sensor disconnected.");
}

function syncSliderLabels() {
  els.hrVal.textContent = els.hr.value + " bpm";
  els.spo2Val.textContent = els.spo2.value + " %";
  els.sbpVal.textContent = els.sbp.value + " mmHg";
  els.dbpVal.textContent = els.dbp.value + " mmHg";
}

async function sendVitals(manual = false) {
  if (!state.tripId) return alert("Load an active Trip ID first.");
  const payload = {
    trip_id: state.tripId,
    heart_rate: Number(els.hr.value),
    spo2: Number(els.spo2.value),
    systolic_bp: Number(els.sbp.value),
    diastolic_bp: Number(els.dbp.value),
    respiratory_rate: 16,
  };
  try {
    const result = await Api.post("/api/telemetry/vitals", payload);
    renderRisk(result.risk_level);
    updateTiles(payload, result.risk_level);
    if (result.proposal) {
      // NOTE: this only PROPOSES a reroute -- the destination has not changed yet.
      // The driver must Confirm or Override on their console before anything diverts.
      logEvent(`Reroute PROPOSED -> ${result.proposal.hospital_name} (${result.proposal.eta_minutes.toFixed(1)} min). Awaiting driver confirmation.`, true);
    }
    if (manual) logEvent(`Vitals sent: HR ${payload.heart_rate}, SpO2 ${payload.spo2}%`);
  } catch (e) {
    logEvent("Failed to send vitals -- is the backend running?", true);
  }

  if (vitals.spo2 < 90 || vitals.hr > 120) {
  logEvent(`CRITICAL VITALS STREAMED -- SpO2: ${vitals.spo2}%, HR: ${vitals.hr} bpm [RED ALERT]`, true);
  } else {
  logEvent(`Vitals sent: HR ${vitals.hr}, SpO2 ${vitals.spo2}%`);
  }
}

function onToggleAutoStream(e) {
  state.autoStream = e.target.checked;
  els.autoStreamStatus.textContent = state.autoStream ? "Streaming every 5s" : "Manual entry";
  if (state.autoStream) {
    state.timer = setInterval(autoStreamTick, 5000);
    logEvent("Auto-stream enabled: syncing vitals to hospital every 5s.");
  } else {
    clearInterval(state.timer);
  }
}

function autoStreamTick() {
  // gentle random walk so the demo feels alive, occasionally drifting critical
  const drift = (v, step, min, max) => Math.max(min, Math.min(max, v + (Math.random() - 0.5) * step));
  state.vitals.hr = drift(state.vitals.hr, 6, 55, 150);
  state.vitals.spo2 = drift(state.vitals.spo2, 1.5, 82, 100);
  els.hr.value = Math.round(state.vitals.hr);
  els.spo2.value = Math.round(state.vitals.spo2);
  syncSliderLabels();
  sendVitals(false);
}

async function onManualTrigger() {
  if (!state.tripId) return alert("Load an active Trip ID first.");
  logEvent("Manual emergency reroute triggered by paramedic (Paramedic.triggerManualReroute).", true);
  const result = await Api.post(`/api/trips/${state.tripId}/propose_reroute`);
  if (result.status === "PROPOSED") {
    logEvent(`Reroute proposed -> ${result.hospital_name} (${result.eta_minutes.toFixed(1)} min). Awaiting driver confirmation.`, true);
  } else {
    logEvent(`No new proposal: ${result.reason || "no eligible hospital"}.`, true);
  }
}

function renderRisk(level) {
  els.riskBadge.textContent = level.toUpperCase();
  els.riskBadge.className = "risk-badge " + level;
  const triageMap = { Green: "Stable", Yellow: "Urgent", Red: "Critical" };
  els.triageLabel.textContent = triageMap[level] || "--";
}

function updateTiles(payload, risk) {
  const cls = riskClass(risk);
  els.tileHr.querySelector(".value").innerHTML = `${payload.heart_rate}<span class="unit">bpm</span>`;
  els.tileSpo2.querySelector(".value").innerHTML = `${payload.spo2}<span class="unit">%</span>`;
  els.tileSbp.querySelector(".value").innerHTML = `${payload.systolic_bp}/${payload.diastolic_bp}<span class="unit">mmHg</span>`;
  [els.tileHr, els.tileSpo2, els.tileSbp].forEach(t => {
    t.classList.remove("normal", "warning", "critical");
    t.classList.add(cls);
  });
}

function logEvent(text, alert = false) {
  const div = document.createElement("div");
  div.className = "log-item" + (alert ? " alert" : "");
  div.innerHTML = `<span class="t">${nowLabel()}</span> &nbsp; ${text}`;
  els.log.prepend(div);
}
