/**
 * paramedic.js — Paramedic Console Client Controller
 */

document.addEventListener("DOMContentLoaded", () => {
  const socket = initSocketConnection();

  // Slider Elements
  const sliderHr = document.getElementById("slider-hr");
  const sliderSpo2 = document.getElementById("slider-spo2");
  const sliderSbp = document.getElementById("slider-sbp");
  const sliderDbp = document.getElementById("slider-dbp");

  const valHr = document.getElementById("val-slider-hr");
  const valSpo2 = document.getElementById("val-slider-spo2");
  const valSbp = document.getElementById("val-slider-sbp");
  const valDbp = document.getElementById("val-slider-dbp");

  // Display Elements
  const dispHr = document.getElementById("disp-hr");
  const dispSpo2 = document.getElementById("disp-spo2");
  const dispBp = document.getElementById("disp-bp");
  const dispTriage = document.getElementById("disp-triage");
  const triageBadge = document.getElementById("triage-badge");

  // Action Buttons
  const btnSyncVitals = document.getElementById("btn-sync-vitals");
  const btnManualReroute = document.getElementById("btn-manual-reroute");
  const btnConnectSensor = document.getElementById("btn-connect-sensor");
  const btnLinkSession = document.getElementById("btn-link-session");
  const sensorStatusLabel = document.getElementById("sensor-status-label");
  const toggleAutostream = document.getElementById("toggle-autostream");

  let streamTimer = null;

  // Initialize Slider Bindings
  sliderHr.addEventListener("input", (e) => {
    valHr.textContent = `${e.target.value} bpm`;
  });
  sliderSpo2.addEventListener("input", (e) => {
    valSpo2.textContent = `${e.target.value} %`;
  });
  sliderSbp.addEventListener("input", (e) => {
    valSbp.textContent = `${e.target.value} mmHg`;
  });
  sliderDbp.addEventListener("input", (e) => {
    valDbp.textContent = `${e.target.value} mmHg`;
  });

  // Sync Vitals to Hospital Endpoint
  async function sendVitals(hr, spo2, sbp, dbp) {
    try {
      const res = await API.post("/api/vitals", {
        heartRate: parseInt(hr),
        spO2: parseInt(spo2),
        systolicBP: parseInt(sbp),
      });
      appendLog("paramedic-log", `Telemetry dispatched: HR ${hr} bpm, SpO2 ${spo2}%, SBP ${sbp} mmHg`, "teal");
    } catch (err) {
      appendLog("paramedic-log", `Failed to send vitals: ${err.message}`, "red");
    }
  }

  btnSyncVitals.addEventListener("click", () => {
    sendVitals(sliderHr.value, sliderSpo2.value, sliderSbp.value, sliderDbp.value);
  });

  // Manual Emergency Reroute Trigger
  btnManualReroute.addEventListener("click", async () => {
    try {
      appendLog("paramedic-log", "Manual Emergency Reroute requested by paramedic.", "red");
      await API.post("/api/paramedic/manual-reroute");
      appendLog("paramedic-log", "Reroute proposal broadcasted to Driver Console.", "teal");
    } catch (err) {
      appendLog("paramedic-log", `Manual reroute error: ${err.message}`, "red");
    }
  });

  // Connect BLE Sensor
  btnConnectSensor.addEventListener("click", async () => {
    btnConnectSensor.disabled = true;
    sensorStatusLabel.textContent = "Status: Scanning devices...";
    appendLog("paramedic-log", "Scanning for BLE peripherals (MAX30102)...");
    try {
      const res = await API.post("/api/sensor/connect");
      sensorStatusLabel.textContent = `Status: ${res.connectionStatus}`;
      btnConnectSensor.textContent = "Sensor Connected";
      appendLog("paramedic-log", `Sensor connected: ${res.connectionStatus}`, "teal");
    } catch (err) {
      sensorStatusLabel.textContent = "Status: Connection Failed";
      btnConnectSensor.disabled = false;
      appendLog("paramedic-log", `Sensor error: ${err.message}`, "red");
    }
  });

  const tripIdInput = document.getElementById("trip-id-input");
  const paramedicDest = document.getElementById("paramedic-dest");
  const paramedicEta = document.getElementById("paramedic-eta");
  const paramedicTier = document.getElementById("paramedic-tier");
  const paramedicPatient = document.getElementById("paramedic-patient");
  const sessionSyncBadge = document.getElementById("session-sync-badge");

  // Load active trip info from Driver console
  async function loadActiveTrip() {
    try {
      const res = await API.get("/api/driver/trip");
      if (res.trip) {
        tripIdInput.value = res.trip.vehicleId || "AMB-108-IND";
        paramedicTier.textContent = `${res.trip.capabilityTier || "ALS"} · ${res.trip.fleetType || "Public"}`;
        if (res.trip.patientName) {
          paramedicPatient.textContent = `${res.trip.patientName} (${res.trip.patientAge || "--"}y) — ${res.trip.patientDescription || "En Route"}`;
        }
      }
      if (res.navigation) {
        paramedicDest.textContent = res.navigation.targetHospitalName || "MY Hospital";
        paramedicEta.textContent = res.navigation.estimatedTime || "12 mins";
      }
    } catch (e) {
      console.warn("Could not load initial trip:", e);
    }
  }

  await loadActiveTrip();

  // Link Session
  btnLinkSession.addEventListener("click", async () => {
    const tripId = tripIdInput.value.trim();
    appendLog("paramedic-log", `Session linked to vehicle ID: ${tripId}`, "teal");
    await loadActiveTrip();
    sessionSyncBadge.className = "badge-status";
    sessionSyncBadge.textContent = "SYNCED";
  });

  // Socket IO Listeners
  if (socket) {
    socket.on("ambulance_telemetry", (data) => {
      if (data.vehicleId) tripIdInput.value = data.vehicleId;
      if (data.targetHospitalName) paramedicDest.textContent = data.targetHospitalName;
      if (data.eta) paramedicEta.textContent = data.eta;
      if (data.capabilityTier || data.fleetType) {
        paramedicTier.textContent = `${data.capabilityTier || "ALS"} · ${data.fleetType || "Public"}`;
      }
      if (data.patient) {
        const p = data.patient;
        paramedicPatient.textContent = `${p.patientName || "Patient"} (${p.patientAge || "--"}y) — ${p.patientDescription || "Emergency Transport"}`;
      }
    });

    socket.on("vitals_stream", (vitals) => {
      dispHr.innerHTML = `${vitals.heartRate} <span class="unit">bpm</span>`;
      dispSpo2.innerHTML = `${vitals.spO2} <span class="unit">%</span>`;
      dispBp.innerHTML = `${vitals.systolicBP} / 76 <span class="unit">mmHg</span>`;

      if (vitals.isCritical) {
        dispTriage.textContent = "Critical (Red Alert)";
        dispTriage.className = "vital-val red";
        triageBadge.className = "badge-status red";
        triageBadge.textContent = "RED";
        appendLog("paramedic-log", `Threshold Breach: HR ${vitals.heartRate} / SpO2 ${vitals.spO2}%`, "red");
      } else {
        dispTriage.textContent = "Stable";
        dispTriage.className = "vital-val";
        triageBadge.className = "badge-status";
        triageBadge.textContent = "GREEN";
      }
    });

    socket.on("reroute_prompt", (data) => {
      appendLog("paramedic-log", `DIVERSION TRIGGERED: Proposed transfer to ${data.hospitalName}`, "red");
    });

    socket.on("reroute_confirmed", (data) => {
      if (data.hospitalName) paramedicDest.textContent = data.hospitalName;
      appendLog("paramedic-log", `DRIVER ACCEPTED: Routing to ${data.hospitalName}`, "teal");
    });

    socket.on("sensor_state_change", (data) => {
      sensorStatusLabel.textContent = `Status: ${data.connectionStatus}`;
    });

    socket.on("arrival_event", (data) => {
      paramedicEta.textContent = "0 mins";
      appendLog("paramedic-log", data.message, "teal");
    });
  }

  // Auto-Streaming Background Simulator
  function startAutoStream() {
    if (streamTimer) clearInterval(streamTimer);
    streamTimer = setInterval(() => {
      if (!toggleAutostream.checked) return;

      // Check if user manually slid to critical values
      const currentHr = parseInt(sliderHr.value);
      const currentSpo2 = parseInt(sliderSpo2.value);

      let nextHr = currentHr;
      let nextSpo2 = currentSpo2;

      // If slider is in normal range, introduce minor natural fluctuation
      if (currentSpo2 >= 90 && currentHr <= 120) {
        nextHr = Math.min(95, Math.max(72, currentHr + Math.floor(Math.random() * 3) - 1));
        nextSpo2 = Math.min(100, Math.max(96, currentSpo2 + Math.floor(Math.random() * 2) - 1));
        sliderHr.value = nextHr;
        valHr.textContent = `${nextHr} bpm`;
        sliderSpo2.value = nextSpo2;
        valSpo2.textContent = `${nextSpo2} %`;
      }

      sendVitals(nextHr, nextSpo2, sliderSbp.value, sliderDbp.value);
    }, 4000);
  }

  toggleAutostream.addEventListener("change", () => {
    if (toggleAutostream.checked) {
      appendLog("paramedic-log", "BLE Telemetry stream resumed.", "teal");
    } else {
      appendLog("paramedic-log", "Auto-stream paused. Manual mode enabled.");
    }
  });

  startAutoStream();
  appendLog("paramedic-log", "Paramedic Console initialized. Telemetry link ready.", "teal");
});
