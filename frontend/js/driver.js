
let map, routeLine, ambulanceMarker;
let graph = null;
let state = {
  vehicleId: null,
  tripId: null,
  route: null,         // {path, polyline, eta_minutes}
  stepIndex: 0,
  running: false,
  timer: null,
  destinationId: null,
  pendingProposal: null,
  paused: false,        // true while a reroute decision is awaited (requirement 2)
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheEls();
  initMap();
  await loadGraph();
  bindUI();
  setInterval(() => Api.post("/api/traffic/refresh").catch(() => {}), 30000);
  logEvent("Driver console ready. Register a vehicle to begin.");
});

function cacheEls() {
  ["vehicleId", "driverName", "fleetType", "capabilityTier", "destHospital",
   "patientName", "patientAge", "chiefComplaint",
   "registerBtn", "startSessionBtn", "sessionInfo", "sessionIdOut",
   "simToggle", "simStatus", "speedSlider", "speedVal", "progressFill",
   "progressText", "currentNodeLabel", "etaLabel", "rerouteBanner",
   "log", "modalBackdrop", "modalMessage", "modalEta", "acceptBtn", "overrideBtn", "overrideReason",
  ].forEach(id => els[id] = document.getElementById(id));
}

function initMap() {
  map = L.map("map", { zoomControl: true, attributionControl: true }).setView([22.7250, 75.8700], 13);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, USGS, TomTom'
  }).addTo(map);
}

// FIXED: Added safe null-coalescing for label / name so undefined label will never throw
async function loadGraph() {
  try {
    // 1. Fetch graph and hospitals in parallel
    const [graphData, hospitalsData] = await Promise.all([
      Api.get("/api/graph"),
      Api.get("/api/hospitals")
    ]);
    
    graph = graphData;

    if (!graph || !graph.nodes) return;

    // Collect list of hospital node keys
    let hospitalNodeKeys = [];
    if (Array.isArray(graph.hospital_nodes)) {
      hospitalNodeKeys = graph.hospital_nodes;
    } else if (graph.hospital_nodes && typeof graph.hospital_nodes === 'object') {
      hospitalNodeKeys = Object.values(graph.hospital_nodes);
    }

    // Render road nodes & hospital markers
    Object.entries(graph.nodes).forEach(([id, n]) => {
      if (!n) return;
      const isHospital = hospitalNodeKeys.includes(id) || ['D', 'J', 'M', 'H1', 'H2', 'H3'].includes(id);
      const labelText = n.label || n.name || id;

      L.circleMarker([n.lat, n.lng], {
        radius: isHospital ? 8 : 4,
        color: isHospital ? "#f24455" : "#2a3a52",
        fillColor: isHospital ? "#f24455" : "#8296b0",
        fillOpacity: 0.9,
        weight: isHospital ? 2.5 : 1.5,
      }).addTo(map).bindTooltip(labelText, { direction: "top" });
    });

    // 2. Populate the Primary Destination Hospital dropdown
    if (els.destHospital) {
      els.destHospital.innerHTML = "";
      
      const hospitalList = hospitalsData ? Object.values(hospitalsData) : [];
      
      if (hospitalList.length > 0) {
        hospitalList.forEach(h => {
          const opt = document.createElement("option");
          opt.value = h.id || h.hospital_id;
          opt.textContent = `${h.name}`;
          els.destHospital.appendChild(opt);
        });
      } else {
        // Fallback directly from graph nodes if hospitals endpoint is empty
        const fallbackIds = ['D', 'J', 'M'];
        fallbackIds.forEach(hid => {
          if (graph.nodes[hid]) {
            const opt = document.createElement("option");
            opt.value = hid;
            opt.textContent = graph.nodes[hid].label || hid;
            els.destHospital.appendChild(opt);
          }
        });
      }
    }
    
    logEvent("Loaded Indore road network and hospitals.");
  } catch (err) {
    logEvent("Failed to load map network: " + err.message, true);
  }
}

function bindUI() {
  if (els.registerBtn) {
    els.registerBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onRegister(e);
    });
  }
  if (els.startSessionBtn) {
    els.startSessionBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onStartSession(e);
    });
  }
  if (els.simToggle) els.simToggle.addEventListener("change", onToggleSim);
  if (els.speedSlider) {
    els.speedSlider.addEventListener("input", () => {
      if (els.speedVal) els.speedVal.textContent = els.speedSlider.value + " km/h";
    });
  }
  if (els.acceptBtn) els.acceptBtn.addEventListener("click", onConfirmDiversion);
  if (els.overrideBtn) els.overrideBtn.addEventListener("click", onOverrideDiversion);
}

// FIXED: e.preventDefault() added to prevent form submission from reloading the page
async function onRegister(e) {
  if (e) e.preventDefault();
  const vehicleId = els.vehicleId ? els.vehicleId.value.trim() : "";
  if (!vehicleId) return alert("Enter a vehicle ID, e.g. AMB-07");

  try {
    await Api.post("/api/vehicles/register", {
      vehicle_id: vehicleId,
      fleet_type: els.fleetType ? els.fleetType.value : "Public",
      capability_tier: els.capabilityTier ? els.capabilityTier.value : "ALS",
      driver_name: (els.driverName && els.driverName.value.trim()) || null,
    });
    state.vehicleId = vehicleId;
    if (els.startSessionBtn) els.startSessionBtn.disabled = false;
    logEvent(`Vehicle ${vehicleId} registered (${els.capabilityTier ? els.capabilityTier.value : "ALS"}).`);
    connectDriverSocket(vehicleId);
  } catch (err) {
    logEvent("Registration failed: " + err.message, true);
  }
}

// FIXED: e.preventDefault() added and null checks on graph node labels
async function onStartSession(e) {
  if (e) e.preventDefault();
  if (!state.vehicleId) return;
  const destinationId = els.destHospital ? els.destHospital.value : null;
  if (!destinationId) return alert("Select a destination hospital.");

  try {
    const trip = await Api.post("/api/session/start", {
      vehicle_id: state.vehicleId,
      destination_hospital_id: destinationId,
      patient_name: (els.patientName && els.patientName.value.trim()) || "Unknown",
      age: (els.patientAge && els.patientAge.value) ? Number(els.patientAge.value) : null,
      chief_complaint: els.chiefComplaint ? els.chiefComplaint.value.trim() : "",
    });

    state.tripId = trip.trip_id;
    state.route = trip.route;
    state.stepIndex = 0;
    state.destinationId = destinationId;

    if (els.sessionInfo) els.sessionInfo.style.display = "block";
    if (els.sessionIdOut) els.sessionIdOut.textContent = trip.trip_id;
    if (els.etaLabel) els.etaLabel.textContent = trip.route.eta_minutes.toFixed(1);

    drawRoute(trip.route.polyline);
    updateProgress();

    const destLabel = (graph.nodes[destinationId] && (graph.nodes[destinationId].label || graph.nodes[destinationId].name)) || destinationId;
    const equip = (trip.patient && trip.patient.required_equipment && trip.patient.required_equipment.length)
      ? ` (needs: ${trip.patient.required_equipment.join(", ")})`
      : "";
    logEvent(`Trip ${trip.trip_id} started -> ${destLabel}${equip}. ETA ${trip.route.eta_minutes.toFixed(1)} min.`);
  } catch (err) {
    logEvent("Failed to start session: " + err.message, true);
  }
}

function drawRoute(polyline, dashed = false) {
  if (!polyline || !polyline.length) return;
  if (routeLine) map.removeLayer(routeLine);
  const latlngs = polyline.map(p => [p.lat, p.lng]);
  routeLine = L.polyline(latlngs, {
    color: dashed ? "#f24455" : "#2dd4bf",
    weight: 4,
    opacity: 0.85,
    dashArray: dashed ? "8 6" : null,
  }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });

  if (!dashed || !ambulanceMarker) {
    if (ambulanceMarker) map.removeLayer(ambulanceMarker);
    const start = polyline[0];
    ambulanceMarker = L.marker([start.lat, start.lng], {
      icon: L.divIcon({ className: "", html: "🚑", iconSize: [24, 24] }),
    }).addTo(map);
  }
}

function onToggleSim(e) {
  state.running = e.target.checked;
  if (els.simStatus) els.simStatus.textContent = state.running ? "Running" : "Paused";
  if (state.running) {
    if (!state.route) { alert("Start a session first."); e.target.checked = false; state.running = false; return; }
    state.timer = setInterval(advanceStep, 2200);
  } else {
    clearInterval(state.timer);
  }
}

async function advanceStep() {
  if (!state.route || state.paused) return;
  const path = state.route.polyline;
  if (state.stepIndex >= path.length - 1) {
    clearInterval(state.timer);
    state.running = false;
    if (els.simToggle) els.simToggle.checked = false;
    if (els.simStatus) els.simStatus.textContent = "Arrived";

    // Post arrival notification to backend
    await Api.post("/api/trips/arrive", {
      vehicle_id: state.vehicleId,
      trip_id: state.tripId,
      hospital_id: state.destinationId
    }).catch(() => {});

    logEvent("Ambulance arrived at destination.");
    return;
  }
  state.stepIndex += 1;
  const node = path[state.stepIndex];
  ambulanceMarker.setLatLng([node.lat, node.lng]);
  await Api.post("/api/telemetry/position", { vehicle_id: state.vehicleId, node: node.node }).catch(() => {});
  updateProgress();
}

function updateProgress() {
  if (!state.route) return;
  const total = state.route.polyline.length - 1;
  const pct = total === 0 ? 100 : Math.round((state.stepIndex / total) * 100);
  if (els.progressFill) els.progressFill.style.width = pct + "%";
  if (els.progressText) els.progressText.textContent = `${pct}% of route`;
  const node = state.route.polyline[state.stepIndex];
  if (els.currentNodeLabel && node) {
    const label = (graph.nodes[node.node] && (graph.nodes[node.node].label || graph.nodes[node.node].name)) || node.node;
    els.currentNodeLabel.textContent = label;
  }
}

function connectDriverSocket(vehicleId) {
  connectSocket(`/ws/driver/${vehicleId}`, (msg) => {
    if (msg.type === "REROUTE_ALERT") {
      showDiversionModal(msg);
    }
    if (msg.type === "DIVERSION_CONFIRMED") {
      state.destinationId = msg.hospital_id;
      if (els.currentNodeLabel) els.currentNodeLabel.textContent = `Diverted -> ${msg.hospital_name}`;
      if (els.etaLabel) els.etaLabel.textContent = msg.eta_minutes.toFixed(1);
      drawRoute(msg.polyline, true); // true = dashed red line
      logEvent(`Navigation updated: Diverted -> ${msg.hospital_name}.`, true);
    }
    if (msg.type === "AMBULANCE_ARRIVED") {
      alert(`🏁 ARRIVAL NOTIFICATION:\n${msg.message}`);
      logEvent(msg.message, true);
    }
  }, () => logEvent("Live link to dispatch established."),
     () => logEvent("Live link lost -- retrying..."));
}

function showDiversionModal(msg) {
  state.paused = true;
  if (els.rerouteBanner) els.rerouteBanner.style.display = "flex";
  if (els.modalMessage) els.modalMessage.textContent = msg.message;
  if (els.modalEta) els.modalEta.textContent = msg.eta_minutes.toFixed(1);
  if (els.modalBackdrop) els.modalBackdrop.classList.add("show");
  state.pendingProposal = msg;
  playAlertTone();
  logEvent(`REROUTE ALERT -- ${msg.message}`, true);
}

function playAlertTone() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square"; osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.18);
  } catch (e) {}
}

async function onConfirmDiversion() {
  closeModal();
  const trip = await Api.post(`/api/trips/${state.tripId}/confirm_reroute`);
  state.route = trip.route;
  state.stepIndex = 0;
  state.paused = false;
  if (els.etaLabel) els.etaLabel.textContent = trip.route.eta_minutes.toFixed(1);
  drawRoute(trip.route.polyline, true);
  logEvent(`Diversion CONFIRMED -> navigating to new fallback hospital.`, true);
}

async function onOverrideDiversion() {
  const reason = (els.overrideReason && els.overrideReason.value.trim()) || "Driver override -- staying on primary route";
  closeModal();
  await Api.post(`/api/trips/${state.tripId}/override_reroute`, { reason });
  state.paused = false;
  if (els.overrideReason) els.overrideReason.value = "";
  logEvent(`Diversion OVERRIDDEN -- reason logged: "${reason}". Continuing on primary route.`);
}

function closeModal() {
  if (els.modalBackdrop) els.modalBackdrop.classList.remove("show");
  if (els.rerouteBanner) els.rerouteBanner.style.display = "none";
  state.pendingProposal = null;
}

function logEvent(text, alert = false) {
  if (!els.log) return;
  const div = document.createElement("div");
  div.className = "log-item" + (alert ? " alert" : "");
  div.innerHTML = `<span class="t">${nowLabel()}</span> &nbsp; ${text}`;
  els.log.prepend(div);
}