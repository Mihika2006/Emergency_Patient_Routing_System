/* hospital.js */

const els = {};
let map, hospitalMarker, ambulanceMarker;
let graph = null;
let state = {
  hospitalId: null,
  incoming: null,        // { session_id, vehicle_id, eta_minutes, receivedAt, diverted }
  etaTimer: null,
};

document.addEventListener("DOMContentLoaded", async () => {
  cacheEls();
  initMap();
  await loadGraph();
  bindUI();
  await refreshHospitalList();
  setInterval(refreshHospitalList, 8000);
});

function cacheEls() {
  ["hospitalSelect", "connectBtn", "connStatus",
   "etaPanel", "etaValue", "etaSub", "vitalsPanel",
   "vHr", "vSpo2", "vBp", "vRisk",
   "patientPanel", "patientName", "patientMeta", "patientTriage", "patientEquip",
   "icuBeds", "cathLab", "ventilator", "readinessStatus", "saveReadinessBtn",
   "regionalList", "log",
  ].forEach(id => els[id] = document.getElementById(id));
}

function initMap() {
  map = L.map("map", { zoomControl: true }).setView([22.7196, 75.8577], 13);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
}

async function loadGraph() {
  try {
    const [graphData, hospitals] = await Promise.all([
      Api.get("/api/graph"),
      Api.get("/api/hospitals")
    ]);
    graph = graphData;

    // Populate the hospital dropdown with Indore hospitals
    if (els.hospitalSelect && Array.isArray(hospitals)) {
      els.hospitalSelect.innerHTML = "";
      hospitals.forEach(h => {
        const opt = document.createElement("option");
        opt.value = h.hospital_id;
        opt.textContent = `${h.name} (${h.trauma_level || 'Level I'})`;
        els.hospitalSelect.appendChild(opt);
      });
    }

    // Add hospital pins to the map
    if (Array.isArray(hospitals)) {
      hospitals.forEach(h => {
        if (h.lat && h.lng) {
          L.circleMarker([h.lat, h.lng], { 
            radius: 8, 
            color: "#f24455", 
            fillColor: "#f24455", 
            fillOpacity: 0.9, 
            weight: 1.5 
          }).addTo(map).bindTooltip(h.name, { permanent: false });
        }
      });
    }
  } catch (err) {
    logEvent("Failed to load map data: " + err.message, true);
  }
}

function bindUI() {
  els.connectBtn.addEventListener("click", onConnect);
  els.saveReadinessBtn.addEventListener("click", onSaveReadiness);
}

async function onConnect() {
  const hid = els.hospitalSelect.value;
  state.hospitalId = hid;

  const h = await Api.get("/api/hospitals").then(list => list.find(x => x.hospital_id === hid));
  if (!h) return;

  if (h.lat && h.lng) {
    map.setView([h.lat, h.lng], 15);
  }

  els.icuBeds.value = h.icu_beds_available;
  els.cathLab.checked = h.cath_lab_available;
  els.ventilator.checked = h.ventilator_available;
  els.readinessStatus.value = h.current_status;

  connectSocket(`/ws/hospital/${hid}`, onSocketMessage,
    () => { els.connStatus.innerHTML = '<span class="dot live"></span> Live feed connected'; },
    () => { els.connStatus.innerHTML = '<span class="dot offline"></span> Reconnecting...'; });

  logEvent(`Connected as ${h.name}.`);
}

function onSocketMessage(msg) {
  if (msg.type === "INCOMING_DIVERSION") {
    state.incoming = { ...msg, receivedAt: Date.now(), diverted: true };
    renderEta();
    renderPatient(msg.patient);
    logEvent(`Incoming DIVERTED patient -- vehicle ${msg.vehicle_id}, ETA ${msg.eta_minutes.toFixed(1)} min`, true);
  }
  if (msg.type === "PRE_ARRIVAL_PROPOSAL") {
    // Driver hasn't confirmed yet -- this is advance notice only, shown distinctly from a confirmed diversion.
    logEvent(`Pre-arrival notice: a Red-alert reroute to this facility has been PROPOSED for vehicle ${msg.vehicle_id} ` +
             `(triage: ${msg.patient.triage_level}, ETA ${msg.eta_minutes.toFixed(1)} min) -- awaiting driver confirmation.`, true);
  }
  if (msg.type === "REROUTE_OVERRIDDEN") {
    logEvent(`Driver OVERRODE a proposed diversion to this facility. Reason: "${msg.reason}"`, true);
  }
  if (msg.type === "VITALS_UPDATE") {
    renderVitals(msg);
    renderPatient(msg.patient);
    if (!state.incoming || state.incoming.session_id !== msg.trip_id) {
      state.incoming = { session_id: msg.trip_id, vehicle_id: msg.vehicle_id,
        eta_minutes: msg.eta_minutes || 0, receivedAt: Date.now(), diverted: false };
    } else {
      state.incoming.eta_minutes = msg.eta_minutes ?? state.incoming.eta_minutes;
      state.incoming.receivedAt = Date.now();
    }
    renderEta();
    if (msg.risk_level === "Red") logEvent(`RED ALERT -- vehicle ${msg.vehicle_id} vitals critical (triage: ${msg.patient.triage_level}).`, true);
  }
  if (msg.type === "POSITION_UPDATE") {
    const n = graph.nodes[msg.node];
    if (!ambulanceMarker) {
      ambulanceMarker = L.marker([n.lat, n.lng], { icon: L.divIcon({ className: "", html: "🚑", iconSize: [22, 22] }) }).addTo(map);
    } else {
      ambulanceMarker.setLatLng([n.lat, n.lng]);
    }
  }

  if (msg.type === "DIVERSION_CANCELLED") {
    logEvent(`⚠️ INBOUND PATIENT DIVERTED AWAY: Vehicle ${msg.vehicle_id} was rerouted to ${msg.new_hospital_name}. Reason: ${msg.reason}`, true);
    if (state.incoming && state.incoming.vehicle_id === msg.vehicle_id) {
      state.incoming = null;
      if (els.etaPanel) els.etaPanel.style.display = "none";
      if (els.patientPanel) els.patientPanel.style.display = "none";
    }
  }

  if (msg.type === "AMBULANCE_ARRIVED") {
    alert(`🚨 INBOUND PATIENT ARRIVED!\n${msg.message}`);
    logEvent(`🏁 ${msg.message}`, true);
    if (els.etaValue) els.etaValue.innerHTML = `ARRIVED<span class="unit">Bay 1</span>`;
  }

  if (msg.type === "AMBULANCE_ARRIVED") {
    // 1. Stop the running ETA countdown timer permanently
    clearInterval(state.etaTimer);
    state.etaTimer = null;

    // 2. Update state and stop future timer recalculations
    if (state.incoming) {
      state.incoming.eta_minutes = 0;
    }

    // 3. Update the UI to clearly show arrived status
    if (els.etaValue) {
      els.etaValue.innerHTML = `ARRIVED <span class="unit">Handover Active</span>`;
      els.etaValue.style.color = "#10b981"; // Clean green
    }
    if (els.etaSub) {
      els.etaSub.textContent = `Vehicle ${msg.vehicle_id} · Handover at Emergency Bay`;
    }

    alert(`🏁 ARRIVAL NOTIFICATION:\n${msg.message}`);
    logEvent(`🏁 ${msg.message}`, true);
  }
}

function renderPatient(patient) {
  if (!patient || !els.patientPanel) return;
  els.patientPanel.style.display = "block";
  els.patientName.textContent = patient.name || "Unknown";
  els.patientMeta.textContent = [patient.age ? `${patient.age}y` : null, patient.gender, patient.chief_complaint]
    .filter(Boolean).join(" \u00b7 ") || "No intake details";
  els.patientTriage.textContent = patient.triage_level;
  els.patientEquip.textContent = patient.required_equipment.length ? patient.required_equipment.join(", ") : "None flagged";
}

function renderEta() {
  if (!els.etaPanel || !state.incoming) return;
  els.etaPanel.style.display = "flex";
  const inc = state.incoming;

  // If already arrived, do not start countdown timer
  if (inc.eta_minutes <= 0) {
    clearInterval(state.etaTimer);
    state.etaTimer = null;
    els.etaValue.innerHTML = `ARRIVED <span class="unit">Handover Active</span>`;
    els.etaSub.textContent = `Vehicle ${inc.vehicle_id} · Handover at Emergency Bay`;
    return;
  }

  els.etaPanel.classList.toggle("diverted", !!inc.diverted);
  els.etaValue.innerHTML = `${inc.eta_minutes.toFixed(1)}<span class="unit">min ETA</span>`;
  els.etaSub.textContent = `Vehicle ${inc.vehicle_id} · Session ${inc.session_id}` + (inc.diverted ? " · DIVERTED" : "");
  
  clearInterval(state.etaTimer);
  state.etaTimer = setInterval(() => {
    const elapsedMin = (Date.now() - inc.receivedAt) / 60000;
    const remaining = Math.max(0, inc.eta_minutes - elapsedMin);
    if (remaining <= 0) {
      clearInterval(state.etaTimer);
      state.etaTimer = null;
      els.etaValue.innerHTML = `ARRIVED <span class="unit">Handover Active</span>`;
    } else {
      els.etaValue.innerHTML = `${remaining.toFixed(1)}<span class="unit">min ETA</span>`;
    }
  }, 1000);
}

function renderVitals(msg) {
  els.vitalsPanel.style.display = "block";
  const v = msg.vitals || {};
  els.vHr.textContent = v.heart_rate ?? "--";
  els.vSpo2.textContent = v.spo2 ?? "--";
  els.vBp.textContent = `${v.systolic_bp ?? "--"}/${v.diastolic_bp ?? "--"}`;
  els.vRisk.textContent = (msg.risk_level || "Green").toUpperCase();
  els.vRisk.className = "risk-badge " + (msg.risk_level || "Green");
}

async function onSaveReadiness() {
  if (!state.hospitalId) return;
  await Api.patch(`/api/hospitals/${state.hospitalId}`, {
    icu_beds_available: Number(els.icuBeds.value),
    cath_lab_available: els.cathLab.checked,
    ventilator_available: els.ventilator.checked,
    current_status: els.readinessStatus.value,
  });
  logEvent("Readiness status updated.");
  refreshHospitalList();
}

async function refreshHospitalList() {
  try {
    const hospitals = await Api.get("/api/hospitals");
    els.regionalList.innerHTML = "";
    hospitals.forEach(h => {
      const div = document.createElement("div");
      div.className = "hcard";
      div.innerHTML = `
        <div class="hcard-top">
          <span class="name">${h.name}</span>
          <span class="pill ${h.current_status === 'Ready' ? 'ready' : 'diverting'}">${h.current_status}</span>
        </div>
        <div class="hcard-meta">
          <span>ICU beds: <b>${h.icu_beds_available}</b></span>
          <span>Cath lab: <b>${h.cath_lab_available ? 'Yes' : 'No'}</b></span>
          <span>Ventilator: <b>${h.ventilator_available ? 'Yes' : 'No'}</b></span>
        </div>`;
      els.regionalList.appendChild(div);
    });
  } catch (e) { /* backend not up yet */ }
}

function logEvent(text, alert = false) {
  const div = document.createElement("div");
  div.className = "log-item" + (alert ? " alert" : "");
  div.innerHTML = `<span class="t">${nowLabel()}</span> &nbsp; ${text}`;
  els.log.prepend(div);
}
