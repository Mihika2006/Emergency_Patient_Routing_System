// ==============================================================================
// FILE: frontend/js/paramedic.js
// ==============================================================================
/**
 * Paramedic Console Script
 * - Streams automated BLE telemetry (Fig. 5, US-02, US-03)
 * - Simulates sudden distress deterioration to test Red Alert (US-08)
 * - Provides manual vital override form strictly for sensor fallback (US-05)
 * - Features manual emergency reroute trigger (US-19)
 */

const socket = io();
let isStreaming = false;
let telemetryTimer = null;

let currentHeartRate = 75;
let currentSpO2 = 98;
let currentSystolicBP = 120;

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-connect-ble").addEventListener("click", connectBleSensor);
  document.getElementById("btn-simulate-distress").addEventListener("click", triggerDistressSimulation);
  document.getElementById("btn-manual-reroute").addEventListener("click", triggerManualEmergency);
  document.getElementById("form-manual-vitals").addEventListener("submit", submitManualVitals);

  setupSocketListeners();
});

async function connectBleSensor() {
  const statusLabel = document.getElementById("ble-status-text");
  statusLabel.innerText = "Scanning for BLE sensors...";
  
  try {
    const res = await fetch("/api/sensor/connect", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      statusLabel.innerText = "Connected & Streaming";
      document.getElementById("ble-card").classList.add("sensor-active");
      document.getElementById("btn-connect-ble").disabled = true;
      startTelemetryStream();
    }
  } catch (err) {
    statusLabel.innerText = "Connection failed. Use manual entry.";
  }
}

function startTelemetryStream() {
  isStreaming = true;
  if (telemetryTimer) clearInterval(telemetryTimer);

  telemetryTimer = setInterval(async () => {
    // Normal stable variations around physiological baseline
    if (currentSpO2 >= 90) {
      currentHeartRate = 72 + Math.floor(Math.random() * 8);
      currentSpO2 = 97 + Math.floor(Math.random() * 3);
      currentSystolicBP = 118 + Math.floor(Math.random() * 6);
    }

    await pushVitals(currentHeartRate, currentSpO2, currentSystolicBP);
  }, 1000);
}

function triggerDistressSimulation() {
  // Simulates sudden respiratory and cardiac distress (US-07, US-08)
  currentHeartRate = 135;
  currentSpO2 = 84;
  currentSystolicBP = 165;
  pushVitals(currentHeartRate, currentSpO2, currentSystolicBP);
}

async function pushVitals(hr, spo2, bp) {
  try {
    await fetch("/api/vitals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ heartRate: hr, spO2: spo2, systolicBP: bp })
    });
  } catch (err) {
    console.warn("Telemetry transmission error", err);
  }
}

async function submitManualVitals(e) {
  e.preventDefault();
  const hr = parseInt(document.getElementById("input-manual-hr").value, 10);
  const spo2 = parseInt(document.getElementById("input-manual-spo2").value, 10);
  const bp = parseInt(document.getElementById("input-manual-bp").value, 10);

  currentHeartRate = hr;
  currentSpO2 = spo2;
  currentSystolicBP = bp;

  await pushVitals(hr, spo2, bp);
  document.getElementById("manual-vitals-feedback").innerText = "Manual vitals logged & evaluated.";
  setTimeout(() => {
    document.getElementById("manual-vitals-feedback").innerText = "";
  }, 3000);
}

async function triggerManualEmergency() {
  await fetch("/api/paramedic/manual-reroute", { method: "POST" });
}

function setupSocketListeners() {
  socket.on("vitals_stream", (vitals) => {
    document.getElementById("val-heart-rate").innerText = vitals.heartRate;
    document.getElementById("val-spo2").innerText = vitals.spO2;
    document.getElementById("val-bp").innerText = vitals.systolicBP;

    const alertBanner = document.getElementById("clinical-alert-banner");
    if (vitals.isCritical) {
      alertBanner.classList.remove("hidden");
      alertBanner.className = "alert-box alert-critical";
      alertBanner.innerText = `CRITICAL RED ALERT: Threshold Breach! SpO2: ${vitals.spO2}% | HR: ${vitals.heartRate} BPM`;
    } else {
      alertBanner.className = "alert-box alert-normal";
      alertBanner.innerText = "Patient Telemetry Stable within Safe Range.";
    }
  });

  socket.on("arrival_event", (data) => {
    const alertBanner = document.getElementById("clinical-alert-banner");
    alertBanner.classList.remove("hidden");
    alertBanner.className = "alert-box alert-success";
    alertBanner.innerText = data.message;
  });
}