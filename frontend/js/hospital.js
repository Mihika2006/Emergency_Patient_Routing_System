// ==============================================================================
// FILE: frontend/js/hospital.js
// ==============================================================================
/**
 * Hospital Staff UI Script
 * - Pre-arrival telemetry dashboard (Report US-18, Fig. 4)
 * - Manages multi-console diversion notifications and handover registration
 */

const socket = io();
let currentHospitalId = "HOSP_MY";
let hospitalsList = [];

document.addEventListener("DOMContentLoaded", async () => {
  await loadHospitalSelector();
  setupSocketListeners();
});

async function loadHospitalSelector() {
  const res = await fetch("/api/hospitals");
  hospitalsList = await res.json();
  const selector = document.getElementById("hospital-facility-select");
  selector.innerHTML = "";

  hospitalsList.forEach((h) => {
    const opt = document.createElement("option");
    opt.value = h.hospitalId;
    opt.innerText = h.name;
    selector.appendChild(opt);
  });

  selector.value = currentHospitalId;
  updateBedStatusDisplay();

  selector.addEventListener("change", (e) => {
    currentHospitalId = e.target.value;
    updateBedStatusDisplay();
  });
}

function updateBedStatusDisplay() {
  const active = hospitalsList.find((h) => h.hospitalId === currentHospitalId);
  if (active) {
    document.getElementById("lbl-active-facility-name").innerText = active.name;
    document.getElementById("lbl-icu-beds-count").innerText = active.icuBedsAvailable;
    const badge = document.getElementById("icu-capacity-badge");
    if (active.icuBedsAvailable > 0) {
      badge.innerText = "CAPACITY AVAILABLE";
      badge.className = "badge badge-success";
    } else {
      badge.innerText = "CAPACITY FULL";
      badge.className = "badge badge-critical";
    }
  }
}

function setupSocketListeners() {
  socket.on("ambulance_telemetry", (data) => {
    if (data.targetHospitalId === currentHospitalId) {
      document.getElementById("incoming-ambulance-card").classList.remove("hidden");
      document.getElementById("cancellation-notice").classList.add("hidden");
      document.getElementById("arrival-banner-hospital").classList.add("hidden");

      document.getElementById("lbl-incoming-vehicle-id").innerText = data.vehicleId;
      document.getElementById("lbl-live-eta").innerText = data.eta;
      document.getElementById("disp-hosp-hr").innerText = `${data.vitals.heartRate} BPM`;
      document.getElementById("disp-hosp-spo2").innerText = `${data.vitals.spO2}%`;
      document.getElementById("disp-hosp-bp").innerText = `${data.vitals.systolicBP} mmHg`;

      const triageIndicator = document.getElementById("lbl-triage-priority");
      if (data.vitals.isCritical) {
        triageIndicator.innerText = "PRIORITY 1: RED ALERT (RESUSCITATION READY)";
        triageIndicator.className = "triage-critical";
      } else {
        triageIndicator.innerText = "PRIORITY 2: YELLOW (STABLE MONITORING)";
        triageIndicator.className = "triage-stable";
      }
    }
  });

  socket.on("reroute_confirmed", (data) => {
    if (data.cancelledHospitalId === currentHospitalId) {
      // Prior destination receives cancellation notice
      document.getElementById("incoming-ambulance-card").classList.add("hidden");
      const cancelBox = document.getElementById("cancellation-notice");
      cancelBox.classList.remove("hidden");
      cancelBox.innerText = `Ambulance diverted away to ${data.hospitalName} due to patient condition change.`;
    } else if (data.hospitalId === currentHospitalId) {
      // Newly assigned hospital receives emergency diversion arrival alert
      document.getElementById("cancellation-notice").classList.add("hidden");
      document.getElementById("incoming-ambulance-card").classList.remove("hidden");
      document.getElementById("lbl-triage-priority").innerText = "INCOMING EMERGENCY DIVERSION (ICU/VENTILATOR ALLOCATED)";
    }
  });

  socket.on("arrival_event", (data) => {
    if (data.hospitalId === currentHospitalId) {
      document.getElementById("lbl-live-eta").innerText = "ARRIVED (0 mins)";
      const banner = document.getElementById("arrival-banner-hospital");
      banner.classList.remove("hidden");
      banner.innerText = `Status: Arrived / Admitted to Bay. ${data.message}`;
    }
  });
}