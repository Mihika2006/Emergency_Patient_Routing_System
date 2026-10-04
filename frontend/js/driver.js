/* driver.js -- synced to the Trip state machine (models.Trip) and the
   explicit propose/confirm/override reroute endpoints. */

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
  map = L.map("map", { zoomControl: true, attributionControl: true }).setView([22.7196, 75.8577], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
}

async function loadGraph() {
  graph = await Api.get("/api/graph");
  Object.entries(graph.nodes).forEach(([id, n]) => {
    const isHospital = graph.hospital_nodes.includes(id);
    L.circleMarker([n.lat, n.lng], {
      radius: isHospital ? 7 : 4,
      color: isHospital ? "#f24455" : "#2a3a52",
      fillColor: isHospital ? "#f24455" : "#8296b0",
      fillOpacity: 0.9,
      weight: 1.5,
    }).addTo(map).bindTooltip(n.label, { direction: "top" });
  });
  graph.hospital_nodes.forEach(hid => {
    const opt = document.createElement("option");
    opt.value = hid;
    opt.textContent = graph.nodes[hid].label;
    els.destHospital.appendChild(opt);
  });
}

function bindUI() {
  els.registerBtn.addEventListener("click", onRegister);
  els.startSessionBtn.addEventListener("click", onStartSession);
  els.simToggle.addEventListener("change", onToggleSim);
  els.speedSlider.addEventListener("input", () => {
    els.speedVal.textContent = els.speedSlider.value + " km/h";
  });
  els.acceptBtn.addEventListener("click", onConfirmDiversion);
  els.overrideBtn.addEventListener("click", onOverrideDiversion);
}

async function onRegister() {
  const vehicleId = els.vehicleId.value.trim();
  if (!vehicleId) return alert("Enter a vehicle ID, e.g. AMB-07");
  await Api.post("/api/vehicles/register", {
    vehicle_id: vehicleId,
    fleet_type: els.fleetType.value,
    capability_tier: els.capabilityTier.value,
    driver_name: els.driverName.value.trim() || null,
  });
  state.vehicleId = vehicleId;
  els.startSessionBtn.disabled = false;
  logEvent(`Vehicle ${vehicleId} registered (${els.capabilityTier.value}).`);
  connectDriverSocket(vehicleId);
}

async function onStartSession() {
  if (!state.vehicleId) return;
  const destinationId = els.destHospital.value;
  const trip = await Api.post("/api/session/start", {
    vehicle_id: state.vehicleId,
    destination_hospital_id: destinationId,
    patient_name: els.patientName.value.trim() || "Unknown",
    age: els.patientAge.value ? Number(els.patientAge.value) : null,
    chief_complaint: els.chiefComplaint.value.trim(),
  });
  state.tripId = trip.trip_id;
  state.route = trip.route;
  state.stepIndex = 0;
  state.destinationId = destinationId;

  els.sessionInfo.style.display = "block";
  els.sessionIdOut.textContent = trip.trip_id;
  els.etaLabel.textContent = trip.route.eta_minutes.toFixed(1);
  drawRoute(trip.route.polyline);
  updateProgress();
  const equip = trip.patient.required_equipment.length ? ` (needs: ${trip.patient.required_equipment.join(", ")})` : "";
  logEvent(`Trip ${trip.trip_id} started -> ${graph.nodes[destinationId].label}${equip}. ETA ${trip.route.eta_minutes.toFixed(1)} min.`);
}

function drawRoute(polyline, dashed = false) {
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
  els.simStatus.textContent = state.running ? "Running" : "Paused";
  if (state.running) {
    if (!state.route) { alert("Start a session first."); e.target.checked = false; state.running = false; return; }
    state.timer = setInterval(advanceStep, 2200);
  } else {
    clearInterval(state.timer);
  }
}

async function advanceStep() {
  if (!state.route || state.paused) return;   // requirement 2: pause traversal while a decision is awaited
  const path = state.route.polyline;
  if (state.stepIndex >= path.length - 1) {
    clearInterval(state.timer);
    state.running = false;
    els.simToggle.checked = false;
    els.simStatus.textContent = "Arrived";
    logEvent("Ambulance arrived at destination.");
    return;
  }
  state.stepIndex += 1;
  const node = path[state.stepIndex];
  ambulanceMarker.setLatLng([node.lat, node.lng]);
  await Api.post("/api/telemetry/position", { vehicle_id: state.vehicleId, node: node.node });
  updateProgress();
}

function updateProgress() {
  if (!state.route) return;
  const total = state.route.polyline.length - 1;
  const pct = total === 0 ? 100 : Math.round((state.stepIndex / total) * 100);
  els.progressFill.style.width = pct + "%";
  els.progressText.textContent = `${pct}% of route`;
  const node = state.route.polyline[state.stepIndex];
  els.currentNodeLabel.textContent = graph.nodes[node.node]?.label || node.node;
}

function connectDriverSocket(vehicleId) {
  connectSocket(`/ws/driver/${vehicleId}`, (msg) => {
    if (msg.type === "REROUTE_ALERT") showDiversionModal(msg);
    if (msg.type === "DIVERSION_CONFIRMED") logEvent(`Navigation updated -> ${msg.hospital_name}.`, true);
  }, () => logEvent("Live link to dispatch established."),
     () => logEvent("Live link lost -- retrying..."));
}

// --- Requirement 2: high-priority audio-visual diversion modal ---------
function showDiversionModal(msg) {
  state.paused = true;                 // pause normal route traversal
  els.rerouteBanner.style.display = "flex";
  els.modalMessage.textContent = msg.message;
  els.modalEta.textContent = msg.eta_minutes.toFixed(1);
  els.modalBackdrop.classList.add("show");
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
  } catch (e) { /* audio not available -- non-fatal */ }
}

async function onConfirmDiversion() {
  closeModal();
  const trip = await Api.post(`/api/trips/${state.tripId}/confirm_reroute`);
  state.route = trip.route;
  state.stepIndex = 0;
  state.paused = false;
  els.etaLabel.textContent = trip.route.eta_minutes.toFixed(1);
  drawRoute(trip.route.polyline, true);
  logEvent(`Diversion CONFIRMED -> navigating to new fallback hospital.`, true);
}

async function onOverrideDiversion() {
  const reason = els.overrideReason.value.trim() || "Driver override -- staying on primary route";
  closeModal();
  await Api.post(`/api/trips/${state.tripId}/override_reroute`, { reason });
  state.paused = false;
  els.overrideReason.value = "";
  logEvent(`Diversion OVERRIDDEN -- reason logged: "${reason}". Continuing on primary route.`);
}

function closeModal() {
  els.modalBackdrop.classList.remove("show");
  els.rerouteBanner.style.display = "none";
  state.pendingProposal = null;
}

function logEvent(text, alert = false) {
  const div = document.createElement("div");
  div.className = "log-item" + (alert ? " alert" : "");
  div.innerHTML = `<span class="t">${nowLabel()}</span> &nbsp; ${text}`;
  els.log.prepend(div);
}



// COMMENTED VERSION IS THE UPDATED ONE BUT WO ERROR DE RHA HAI , WHI SAMAJH NAHI AA RHI HAI 

// // Driver Console Logic - RET-RP Indore Edition
// let activeVehicle = null;
// let activeTrip = null;
// let simulationInterval = null;
// let currentPathIndex = 0;
// let routeCoordinates = [];
// let routeNodes = [];
// let ambulanceMarker = null;
// let routePolyline = null;
// let simulationSpeed = 45;

// function getEl(...ids) {
//     for (const id of ids) {
//         const el = document.getElementById(id);
//         if (el) return el;
//     }
//     return null;
// }

// // 1. Initialize Map Centered on Indore
// const INDORE_COORDS = [22.7196, 75.8577];
// const map = L.map('map').setView(INDORE_COORDS, 13);

// L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
//     maxZoom: 19,
//     attribution: 'Tiles &copy; Esri &mdash; Source: Esri, USGS, TomTom'
// }).addTo(map);

// const ambIcon = L.divIcon({
//     className: 'custom-amb-icon',
//     html: `<div style="background:#00e5a3;width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 10px #00e5a3;"></div>`,
//     iconSize: [18, 18],
//     iconAnchor: [9, 9]
// });

// function logDispatch(msg) {
//     const logBox = getEl('dispatch-log');
//     if (!logBox) return;
//     const time = new Date().toLocaleTimeString();
//     logBox.innerHTML = `<div><span style="color:#64748b;">${time}</span> ${msg}</div>` + logBox.innerHTML;
// }

// // 2. Fetch Hospitals and Populate Select Dropdown
// async function loadHospitals() {
//     const select = getEl('dest-hospital', 'dest-hospital-select', 'destination-hospital');
//     try {
//         const res = await fetch('http://127.0.0.1:8000/api/hospitals');
//         if (!res.ok) throw new Error(`HTTP ${res.status}`);
//         const hospitals = await res.json();
        
//         if (select) {
//             select.innerHTML = '';
//             Object.values(hospitals).forEach(h => {
//                 const opt = document.createElement('option');
//                 opt.value = h.id;
//                 opt.textContent = `${h.name} (${h.capability || 'ALS'})`;
//                 select.appendChild(opt);
//             });
//         }

//         Object.values(hospitals).forEach(h => {
//             if (h.lat && h.lng) {
//                 L.marker([h.lat, h.lng]).addTo(map)
//                     .bindPopup(`<b>${h.name}</b><br>ICU Beds: ${h.icu_beds_available ?? h.icu_beds ?? 0}`);
//             }
//         });
//         logDispatch("Loaded hospitals and road network for Indore.");
//     } catch (err) {
//         logDispatch(`Failed to load hospitals: ${err.message}`);
//     }
// }

// // 3. Register Vehicle Listener (Prevents Page Reload)
// const btnRegister = getEl('btn-register', 'btn-register-vehicle', 'register-btn');
// if (btnRegister) {
//     btnRegister.addEventListener('click', async (e) => {
//         e.preventDefault();

//         const vIdInput = getEl('vehicle-id', 'veh-id');
//         const vehicleId = vIdInput?.value.trim() || 'AMB-01';
//         const fleetType = getEl('fleet-type')?.value || 'Public';
//         const capability = getEl('capability-tier', 'capability')?.value || 'ALS';

//         try {
//             const res = await fetch('http://127.0.0.1:8000/api/vehicles/register', {
//                 method: 'POST',
//                 headers: { 'Content-Type': 'application/json' },
//                 body: JSON.stringify({
//                     vehicle_id: vehicleId,
//                     fleet_type: fleetType,
//                     capability_tier: capability
//                 })
//             });

//             if (!res.ok) throw new Error(`HTTP ${res.status}`);
//             activeVehicle = await res.json();

//             logDispatch(`Vehicle <b>${activeVehicle.vehicle_id}</b> registered successfully.`);

//             // Enable Start Trip button
//             const btnStart = getEl('btn-start-trip', 'start-trip-btn', 'btn-start');
//             if (btnStart) {
//                 btnStart.disabled = false;
//                 btnStart.removeAttribute('disabled');
//                 btnStart.style.opacity = '1';
//                 btnStart.style.cursor = 'pointer';
//             }

//             btnRegister.textContent = 'Registered ✓';
//             btnRegister.style.background = '#059669';
//             setTimeout(() => {
//                 btnRegister.textContent = 'Register Vehicle';
//                 btnRegister.style.background = '';
//             }, 3000);

//         } catch (err) {
//             logDispatch(`Registration error: ${err.message}`);
//         }
//     });
// }

// // 4. Start Patient Transport Trip Listener
// const btnStartTrip = getEl('btn-start-trip', 'start-trip-btn', 'btn-start');
// const tripForm = getEl('trip-form', 'dispatch-form');

// async function handleStartTrip(e) {
//     if (e) e.preventDefault();

//     if (!activeVehicle) {
//         alert("Please register the vehicle first!");
//         return;
//     }

//     const patientName = getEl('patient-name')?.value.trim() || 'Rahul Sharma';
//     const patientAge = parseInt(getEl('patient-age')?.value) || 45;
//     const complaint = getEl('chief-complaint')?.value.trim() || 'Acute Chest Pain';
//     const hospitalSelect = getEl('dest-hospital', 'dest-hospital-select', 'destination-hospital');
//     const hospitalId = hospitalSelect?.value || 'H1';

//     const payload = {
//         vehicle_id: activeVehicle.vehicle_id,
//         patient_name: patientName,
//         age: patientAge,
//         chief_complaint: complaint,
//         destination_hospital_id: hospitalId
//     };

//     try {
//         const res = await fetch('http://127.0.0.1:8000/api/trips/start', {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify(payload)
//         });

//         if (!res.ok) throw new Error(`Server returned ${res.status}`);
//         activeTrip = await res.json();

//         logDispatch(`Trip active! <b>Trip ID: ${activeTrip.trip_id}</b>`);
//         logDispatch(`Destination: ${activeTrip.destination_name} (ETA: ${activeTrip.eta_minutes} min)`);

//         const etaVal = getEl('eta-val', 'current-eta');
//         if (etaVal) etaVal.textContent = activeTrip.eta_minutes;

//         if (activeTrip.path_geometry && activeTrip.path_geometry.length > 0) {
//             drawRoute(activeTrip.path_geometry);
//             routeNodes = activeTrip.path_nodes || [];
//         }

//         if (btnStartTrip) {
//             btnStartTrip.disabled = true;
//             btnStartTrip.textContent = 'Transport in Progress...';
//         }

//     } catch (err) {
//         logDispatch(`Start trip failed: ${err.message}`);
//     }
// }

// if (tripForm) tripForm.addEventListener('submit', handleStartTrip);
// if (btnStartTrip) btnStartTrip.addEventListener('click', handleStartTrip);

// // 5. Draw Polyline Route
// function drawRoute(coords) {
//     routeCoordinates = coords;
//     currentPathIndex = 0;

//     if (routePolyline) map.removeLayer(routePolyline);
//     if (ambulanceMarker) map.removeLayer(ambulanceMarker);

//     routePolyline = L.polyline(routeCoordinates, {
//         color: '#00e5a3',
//         weight: 5,
//         opacity: 0.85
//     }).addTo(map);

//     ambulanceMarker = L.marker(routeCoordinates[0], { icon: ambIcon }).addTo(map);
//     map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });

//     updateCurrentNodeUI(0);
// }

// function updateCurrentNodeUI(idx) {
//     const posElem = getEl('current-node', 'current-position');
//     if (posElem && routeNodes.length > idx) {
//         posElem.textContent = `Node: ${routeNodes[idx]}`;
//     }
// }

// // 6. Route Traversal Simulation
// const simToggle = getEl('sim-toggle', 'live-route-toggle');
// if (simToggle) {
//     simToggle.addEventListener('change', () => {
//         if (!activeTrip) {
//             alert("Start a patient trip first!");
//             simToggle.checked = false;
//             return;
//         }

//         if (simToggle.checked) {
//             startSimulation();
//         } else {
//             stopSimulation();
//         }
//     });
// }

// const speedSlider = getEl('speed-slider', 'simulated-speed');
// if (speedSlider) {
//     speedSlider.addEventListener('input', (e) => {
//         simulationSpeed = parseInt(e.target.value);
//         const valElem = getEl('speed-val', 'speed-display');
//         if (valElem) valElem.textContent = `${simulationSpeed} km/h`;
//         if (simToggle && simToggle.checked) {
//             stopSimulation();
//             startSimulation();
//         }
//     });
// }

// function startSimulation() {
//     const intervalTime = Math.max(800, 3000 - (simulationSpeed * 20));
//     logDispatch(`Simulation running (${simulationSpeed} km/h).`);

//     simulationInterval = setInterval(() => {
//         if (currentPathIndex < routeCoordinates.length - 1) {
//             currentPathIndex++;
//             const nextCoord = routeCoordinates[currentPathIndex];
//             ambulanceMarker.setLatLng(nextCoord);
//             updateCurrentNodeUI(currentPathIndex);

//             if (activeTrip && routeNodes[currentPathIndex]) {
//                 fetch(`http://127.0.0.1:8000/api/trips/${activeTrip.trip_id}/location`, {
//                     method: 'POST',
//                     headers: { 'Content-Type': 'application/json' },
//                     body: JSON.stringify({
//                         current_node: routeNodes[currentPathIndex],
//                         speed: simulationSpeed
//                     })
//                 }).catch(() => {});
//             }
//         } else {
//             stopSimulation();
//             if (simToggle) simToggle.checked = false;
//             logDispatch(`Ambulance arrived at destination.`);
//         }
//     }, intervalTime);
// }

// function stopSimulation() {
//     if (simulationInterval) clearInterval(simulationInterval);
// }

// // 7. WebSocket for Critical Reroute Alerts
// function connectDriverWebSocket() {
//     const ws = new WebSocket('ws://127.0.0.1:8000/ws');

//     ws.onmessage = (event) => {
//         try {
//             const data = JSON.parse(event.data);
//             if (data.type === 'REROUTE_PROMPT') {
//                 handleRerouteAlert(data);
//             }
//         } catch (e) {}
//     };

//     ws.onclose = () => setTimeout(connectDriverWebSocket, 3000);
// }

// function handleRerouteAlert(data) {
//     stopSimulation();
//     const modal = getEl('reroute-modal');
//     if (!modal) {
//         if (confirm(`CRITICAL VITAL DROP!\nProposed Diversion: ${data.fallback_hospital_name}\nReason: ${data.reason}\n\nConfirm Reroute?`)) {
//             confirmReroute(data.fallback_hospital_id);
//         }
//         return;
//     }

//     const nameEl = getEl('reroute-hospital-name');
//     const reasonEl = getEl('reroute-reason');
//     const etaEl = getEl('reroute-eta');

//     if (nameEl) nameEl.textContent = data.fallback_hospital_name;
//     if (reasonEl) reasonEl.textContent = data.reason;
//     if (etaEl) etaEl.textContent = `${data.eta_minutes || '--'} min`;
//     modal.style.display = 'flex';

//     const btnConfirm = getEl('btn-confirm-reroute');
//     if (btnConfirm) {
//         btnConfirm.onclick = () => {
//             modal.style.display = 'none';
//             confirmReroute(data.fallback_hospital_id);
//         };
//     }

//     const btnOverride = getEl('btn-override-reroute');
//     if (btnOverride) {
//         btnOverride.onclick = () => {
//             modal.style.display = 'none';
//             logDispatch(`Driver OVERRODE diversion. Continuing route.`);
//             if (simToggle && simToggle.checked) startSimulation();
//         };
//     }
// }

// async function confirmReroute(hospitalId) {
//     if (!activeTrip) return;
//     try {
//         const res = await fetch(`http://127.0.0.1:8000/api/trips/${activeTrip.trip_id}/reroute/confirm`, {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({ new_destination_id: hospitalId })
//         });
//         const updated = await res.json();
//         logDispatch(`REROUTED to <b>${updated.destination_name}</b>!`);

//         if (updated.path_geometry) {
//             drawRoute(updated.path_geometry);
//             routeNodes = updated.path_nodes || [];
//         }
//         if (simToggle && simToggle.checked) startSimulation();
//     } catch (err) {
//         logDispatch(`Failed to confirm reroute: ${err.message}`);
//     }
// }

// // Initial bootstrap
// window.addEventListener('DOMContentLoaded', () => {
//     loadHospitals();
//     connectDriverWebSocket();
// });
