/**
 * driver.js — Driver Console Client Controller
 * Complete functionality: Hospital Selection, Vehicle & Fleet Config,
 * Optional Patient Profile, Animated Road Trajectory, In-Cabin Repeater,
 * and 1-Tap Audio-Visual Reroute Confirmation Prompt.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const socket = initSocketConnection();

  // Navigation & Metrics Elements
  const navStatusBadge = document.getElementById("nav-status-badge");
  const dispSpeed = document.getElementById("disp-speed");
  const dispEta = document.getElementById("disp-eta");
  const dispDist = document.getElementById("disp-dist");

  // In-Cabin Repeater Elements
  const driverHr = document.getElementById("driver-hr");
  const driverSpo2 = document.getElementById("driver-spo2");
  const driverTriageBadge = document.getElementById("driver-triage-badge");

  // Dispatch Form Elements
  const selectDestination = document.getElementById("select-destination");
  const inputVehicleId = document.getElementById("input-vehicle-id");
  const selectFleetType = document.getElementById("select-fleet-type");
  const selectCapabilityTier = document.getElementById("select-capability-tier");
  const inputPatientName = document.getElementById("input-patient-name");
  const inputPatientAge = document.getElementById("input-patient-age");
  const inputPatientDesc = document.getElementById("input-patient-desc");
  const btnSaveDispatch = document.getElementById("btn-save-dispatch");
  const btnStartTransit = document.getElementById("btn-start-transit");

  // Modal Elements
  const rerouteModal = document.getElementById("reroute-modal");
  const modalReason = document.getElementById("modal-reroute-reason");
  const modalHospitalName = document.getElementById("modal-hospital-name");
  const modalIcuBeds = document.getElementById("modal-icu-beds");
  const btnAcceptReroute = document.getElementById("btn-accept-reroute");
  const btnDeclineReroute = document.getElementById("btn-decline-reroute");

  // Map & Trajectory State
  let driverMap = null;
  let ambulanceMarker = null;
  let destinationMarker = null;
  let routePolyline = null;
  let hospitalDataMap = {};

  let currentLat = 22.7196;
  let currentLng = 75.8577;
  let targetLat = 22.7150;
  let targetLng = 75.8702;
  let targetName = "MY Hospital (Maharaja Yeshwantrao)";

  let transitInterval = null;
  let isNavigating = false;
  let currentSpeed = 0;
  let waypoints = [];
  let waypointIndex = 0;

  // Initialize Leaflet OpenStreetMap
  function initMap() {
    driverMap = L.map("driver-map").setView([currentLat, currentLng], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(driverMap);

    // Custom pulsing ambulance icon
    const ambIcon = L.divIcon({
      className: "custom-amb-marker",
      html: `<div style="width: 18px; height: 18px; border-radius: 50%; background: #00d4aa; border: 2px solid #fff; box-shadow: 0 0 12px #00d4aa;"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    ambulanceMarker = L.marker([currentLat, currentLng], { icon: ambIcon })
      .addTo(driverMap)
      .bindPopup(`<strong>Ambulance Unit</strong><br>${inputVehicleId.value}`);

    // Destination Hospital Marker
    destinationMarker = L.circleMarker([targetLat, targetLng], {
      radius: 9,
      color: "#38bdf8",
      fillColor: "#38bdf8",
      fillOpacity: 0.85,
    }).addTo(driverMap).bindPopup(`<strong>Target ER</strong><br>${targetName}`);

    generateWaypoints();
    drawRoute();
  }

  // Generate intermediate points to simulate realistic road geometry
  function generateWaypoints() {
    waypoints = [];
    const steps = 60;
    const midLat = (currentLat + targetLat) / 2 + 0.0025;
    const midLng = (currentLng + targetLng) / 2 - 0.0035;

    // Quadratic bezier curve interpolation for natural road curvature
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const lat = (1 - t) * (1 - t) * currentLat + 2 * (1 - t) * t * midLat + t * t * targetLat;
      const lng = (1 - t) * (1 - t) * currentLng + 2 * (1 - t) * t * midLng + t * t * targetLng;
      waypoints.push([lat, lng]);
    }
    waypointIndex = 0;
  }

  function drawRoute() {
    if (routePolyline) driverMap.removeLayer(routePolyline);
    routePolyline = L.polyline(waypoints, {
      color: "#00d4aa",
      weight: 4,
      opacity: 0.8,
      dashArray: "6, 8",
    }).addTo(driverMap);
  }

  // Load Hospitals List from API
  async function loadHospitals() {
    try {
      const list = await API.get("/api/hospitals");
      selectDestination.innerHTML = "";
      list.forEach((h) => {
        hospitalDataMap[h.hospitalId] = h;
        const opt = document.createElement("option");
        opt.value = h.hospitalId;
        opt.textContent = `${h.name} (${h.icuBedsAvailable} ICU Beds)`;
        selectDestination.appendChild(opt);
      });

      if (hospitalDataMap["HOSP_MY"]) {
        selectDestination.value = "HOSP_MY";
      }
    } catch (e) {
      console.error("Could not load hospitals:", e);
    }
  }

  // Calculate distance in kilometers
  function calcDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Switch destination hospital
  function updateDestination(hospitalId) {
    const hosp = hospitalDataMap[hospitalId];
    if (!hosp) return;

    targetLat = hosp.locationLat;
    targetLng = hosp.locationLong;
    targetName = hosp.name;

    destinationMarker.setLatLng([targetLat, targetLng]);
    destinationMarker.bindPopup(`<strong>Target ER</strong><br>${targetName}`);

    generateWaypoints();
    drawRoute();

    const dist = calcDistanceKm(currentLat, currentLng, targetLat, targetLng);
    const etaMins = Math.max(1, Math.round((dist / 35) * 60));

    dispDist.textContent = `${dist.toFixed(1)} km`;
    dispEta.textContent = `${etaMins} mins`;

    appendLog("driver-log", `Destination target set: ${targetName}`, "teal");
  }

  selectDestination.addEventListener("change", (e) => {
    updateDestination(e.target.value);
  });

  // Save & Update Dispatch Configuration
  btnSaveDispatch.addEventListener("click", async () => {
    const payload = {
      vehicleId: inputVehicleId.value.trim() || "AMB-108-IND",
      fleetType: selectFleetType.value,
      capabilityTier: selectCapabilityTier.value,
      hospitalId: selectDestination.value,
      patientName: inputPatientName.value.trim(),
      patientAge: inputPatientAge.value.trim(),
      patientDescription: inputPatientDesc.value.trim(),
      etaMinutes: dispEta.textContent.trim() || "12 mins",
    };

    try {
      const res = await API.post("/api/driver/dispatch", payload);
      appendLog(
        "driver-log",
        `Dispatch confirmed: ${payload.vehicleId} [${payload.capabilityTier}] -> ${selectDestination.options[selectDestination.selectedIndex].text}`,
        "teal"
      );
      if (res.navigation) {
        updateDestination(res.navigation.targetHospitalId);
      }
    } catch (err) {
      appendLog("driver-log", `Dispatch save error: ${err.message}`, "red");
    }
  });

  // Navigation simulation loop
  function startSimulation() {
    if (isNavigating) {
      clearInterval(transitInterval);
      isNavigating = false;
      btnStartTransit.textContent = "Resume Emergency Transit";
      navStatusBadge.textContent = "PAUSED";
      dispSpeed.textContent = "0 km/h";
      appendLog("driver-log", "Transit paused.");
      return;
    }

    isNavigating = true;
    btnStartTransit.textContent = "Pause Transit";
    navStatusBadge.className = "badge-status";
    navStatusBadge.textContent = "ACTIVE GUIDANCE";
    appendLog("driver-log", `En-route to ${targetName}. Visual telemetry active.`, "teal");

    transitInterval = setInterval(async () => {
      if (waypointIndex >= waypoints.length - 1) {
        clearInterval(transitInterval);
        isNavigating = false;
        currentLat = targetLat;
        currentLng = targetLng;
        ambulanceMarker.setLatLng([currentLat, currentLng]);

        navStatusBadge.textContent = "ARRIVED AT ER";
        dispSpeed.textContent = "0 km/h";
        dispDist.textContent = "0.0 km";
        dispEta.textContent = "0 mins";
        btnStartTransit.disabled = true;
        btnStartTransit.textContent = "Transit Completed";

        appendLog("driver-log", `Arrived at ${targetName}. Initiating patient handover.`, "teal");

        try {
          await API.post("/api/ambulance/arrival");
        } catch (e) {
          console.error(e);
        }
        return;
      }

      // Step forward along road waypoint
      waypointIndex++;
      const [newLat, newLng] = waypoints[waypointIndex];
      currentLat = newLat;
      currentLng = newLng;

      ambulanceMarker.setLatLng([currentLat, currentLng]);
      driverMap.panTo([currentLat, currentLng], { animate: true, duration: 0.8 });

      // Calculate speed and remaining distance
      currentSpeed = Math.floor(Math.random() * 12) + 40; // 40-52 km/h
      const remainingDist = calcDistanceKm(currentLat, currentLng, targetLat, targetLng);
      const remainingEta = Math.max(1, Math.round((remainingDist / currentSpeed) * 60));

      dispSpeed.innerHTML = `${currentSpeed} <span style="font-size: 10px; font-weight: normal; color: var(--text-muted);">km/h</span>`;
      dispDist.innerHTML = `${remainingDist.toFixed(1)} <span style="font-size: 10px; font-weight: normal; color: var(--text-muted);">km</span>`;
      dispEta.innerHTML = `${remainingEta} <span style="font-size: 10px; font-weight: normal; color: var(--text-muted);">mins</span>`;

      // Broadcast position to Hospital and Paramedic consoles
      try {
        await API.post("/api/ambulance/location", {
          lat: currentLat,
          lng: currentLng,
          etaMinutes: `${remainingEta} mins`,
        });
      } catch (err) {
        console.error(err);
      }
    }, 1800);
  }

  btnStartTransit.addEventListener("click", startSimulation);

  // 1-Tap Reroute Confirmation Modal Handlers
  btnAcceptReroute.addEventListener("click", async () => {
    rerouteModal.classList.add("hidden");
    appendLog("driver-log", "DIVERSION ACCEPTED: Recalculating path to new tertiary facility.", "teal");
    try {
      await API.post("/api/driver/respond-reroute", { accepted: true });
    } catch (err) {
      appendLog("driver-log", `Error confirming reroute: ${err.message}`, "red");
    }
  });

  btnDeclineReroute.addEventListener("click", async () => {
    rerouteModal.classList.add("hidden");
    appendLog("driver-log", "Diversion declined. Maintaining route to primary facility.", "yellow");
    try {
      await API.post("/api/driver/respond-reroute", { accepted: false });
    } catch (err) {
      console.error(err);
    }
  });

  // Socket IO Listeners
  if (socket) {
    socket.on("vitals_stream", (vitals) => {
      driverHr.innerHTML = `${vitals.heartRate} <span class="unit">bpm</span>`;
      driverSpo2.innerHTML = `${vitals.spO2} <span class="unit">%</span>`;

      if (vitals.isCritical) {
        driverTriageBadge.className = "badge-status red";
        driverTriageBadge.textContent = "CRITICAL";
      } else {
        driverTriageBadge.className = "badge-status";
        driverTriageBadge.textContent = "GREEN";
      }
    });

    socket.on("reroute_prompt", (data) => {
      modalReason.textContent = data.reason;
      modalHospitalName.textContent = data.hospitalName;
      modalIcuBeds.textContent = `${data.icuBeds} Beds Available`;
      rerouteModal.classList.remove("hidden");
      appendLog("driver-log", `SAFETY BREACH: 1-Tap Reroute prompt received for ${data.hospitalName}.`, "red");
    });

    socket.on("reroute_confirmed", (data) => {
      targetLat = data.destCoords[0];
      targetLng = data.destCoords[1];
      targetName = data.hospitalName;

      selectDestination.value = data.hospitalId;
      destinationMarker.setLatLng([targetLat, targetLng]);
      destinationMarker.bindPopup(`<strong>Diverted ER</strong><br>${targetName}`);

      generateWaypoints();
      drawRoute();

      navStatusBadge.className = "badge-status red";
      navStatusBadge.textContent = "REROUTE PATH";
      appendLog("driver-log", `Path rerouted to: ${targetName}`, "teal");
    });

    socket.on("arrival_event", (data) => {
      appendLog("driver-log", data.message, "teal");
    });
  }

  await loadHospitals();
  initMap();
  appendLog("driver-log", "Driver Console initialized. GPS telemetry linked.", "teal");
});
