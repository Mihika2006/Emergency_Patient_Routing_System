/**
 * hospital.js — Hospital ER Console Client Controller
 * Synchronized with Driver Console telemetry, destination hospital,
 * ETA countdown, vehicle/fleet tier, patient profile, and bed readiness.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const socket = initSocketConnection();

  // Control Elements
  const selectHospital = document.getElementById("select-hospital");
  const btnConnectDashboard = document.getElementById("btn-connect-dashboard");
  const btnSaveReadiness = document.getElementById("btn-save-readiness");
  const inputIcuBeds = document.getElementById("input-icu-beds");
  const toggleCathLab = document.getElementById("toggle-cath-lab");
  const toggleVentilator = document.getElementById("toggle-ventilator");
  const selectReadinessStatus = document.getElementById("select-readiness-status");
  const statusBadge = document.getElementById("hospital-live-status");

  // Regional Overview Elements
  const fleetVehicleId = document.getElementById("fleet-vehicle-id");
  const fleetTierTag = document.getElementById("fleet-tier-tag");
  const fleetTargetFacility = document.getElementById("fleet-target-facility");
  const fleetEta = document.getElementById("fleet-eta");
  const fleetPatientInfo = document.getElementById("fleet-patient-info");
  const fleetVitals = document.getElementById("fleet-vitals");

  let hospitalMap = null;
  let ambulanceMarker = null;
  let targetHospitalMarker = null;
  let hospitalMarkers = {};
  let hospitalDataMap = {};
  let hospitalRouteLine = null;

  let currentRepresentedId = "HOSP_MY";
  let inboundTargetHospitalId = "HOSP_MY";
  let ambLat = 22.7196;
  let ambLng = 75.8577;

  // Initialize Leaflet Map
  function initMap() {
    hospitalMap = L.map("hospital-map").setView([22.7250, 75.8800], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(hospitalMap);

    // Moving Ambulance Marker with custom glowing cyan style
    const ambIcon = L.divIcon({
      className: "custom-amb-marker",
      html: `<div style="width: 18px; height: 18px; border-radius: 50%; background: #00d4aa; border: 2px solid #fff; box-shadow: 0 0 12px #00d4aa;"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    ambulanceMarker = L.marker([ambLat, ambLng], { icon: ambIcon })
      .addTo(hospitalMap)
      .bindPopup("Active Ambulance: AMB-108-IND");
  }

  initMap();

  // Draw or update connecting route line between ambulance and target facility
  function updateHospitalRoute(destLat, destLng) {
    if (hospitalRouteLine) hospitalMap.removeLayer(hospitalRouteLine);
    const midLat = (ambLat + destLat) / 2 + 0.0025;
    const midLng = (ambLng + destLng) / 2 - 0.0035;

    const points = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const lat = (1 - t) * (1 - t) * ambLat + 2 * (1 - t) * t * midLat + t * t * destLat;
      const lng = (1 - t) * (1 - t) * ambLng + 2 * (1 - t) * t * midLng + t * t * destLng;
      points.push([lat, lng]);
    }

    hospitalRouteLine = L.polyline(points, {
      color: "#00d4aa",
      weight: 3.5,
      opacity: 0.7,
      dashArray: "6, 8",
    }).addTo(hospitalMap);
  }

  // Load Hospitals List
  async function loadHospitals() {
    try {
      const hospitals = await API.get("/api/hospitals");
      selectHospital.innerHTML = "";

      hospitals.forEach((h) => {
        hospitalDataMap[h.hospitalId] = h;
        const opt = document.createElement("option");
        opt.value = h.hospitalId;
        opt.textContent = `${h.name} (${h.icuBedsAvailable} ICU)`;
        selectHospital.appendChild(opt);

        // Marker for each hospital in the network
        const marker = L.circleMarker([h.locationLat, h.locationLong], {
          radius: 7,
          color: "#38bdf8",
          fillColor: "#38bdf8",
          fillOpacity: 0.75,
        }).addTo(hospitalMap).bindPopup(`<strong>${h.name}</strong><br>ICU Beds: ${h.icuBedsAvailable}`);

        hospitalMarkers[h.hospitalId] = { marker, data: h };
      });

      // Default representation to MY Hospital or first option
      if (selectHospital.options.length > 0) {
        selectHospital.value = currentRepresentedId;
      }
    } catch (err) {
      appendLog("hospital-log", `Error loading hospitals: ${err.message}`, "red");
    }
  }

  // Connect Dashboard button logic
  function connectHospitalDashboard(hid) {
    const selected = hospitalDataMap[hid];
    if (!selected) {
      appendLog("hospital-log", `Hospital ID ${hid} not found.`, "red");
      return;
    }

    currentRepresentedId = hid;

    // Update readiness panel with selected hospital's database values
    inputIcuBeds.value = selected.icuBedsAvailable;
    const hasCath = selected.equipment && selected.equipment.some((e) => e.type === "cath_lab" && (e.status === "Operational" || e.status === "operational"));
    const hasVent = selected.equipment && selected.equipment.some((e) => e.type === "ventilator" && (e.status === "Operational" || e.status === "operational"));
    toggleCathLab.checked = Boolean(hasCath);
    toggleVentilator.checked = Boolean(hasVent);
    selectReadinessStatus.value = selected.icuBedsAvailable > 0 ? "Ready" : "Full Capacity";

    // Focus/Zoom map on the hospital and ambulance
    hospitalMap.flyTo([selected.locationLat, selected.locationLong], 13, { duration: 1.2 });
    hospitalMarkers[hid]?.marker.openPopup();

    // Visual state updates
    statusBadge.className = "badge-status";
    statusBadge.textContent = `CONNECTED: ${selected.name.split(" ")[0]}`;

    btnConnectDashboard.textContent = `Connected: ${selected.name.split("(")[0].trim()}`;
    btnConnectDashboard.className = "btn btn-primary";

    // Redraw connecting route
    updateHospitalRoute(selected.locationLat, selected.locationLong);

    appendLog("hospital-log", `Dashboard active: ${selected.name} (${selected.icuBedsAvailable} ICU Beds)`, "teal");
  }

  btnConnectDashboard.addEventListener("click", () => {
    connectHospitalDashboard(selectHospital.value);
  });

  // Switch hospital selection immediately previews or connects
  selectHospital.addEventListener("change", () => {
    btnConnectDashboard.textContent = "Connect Dashboard";
  });

  // Save Readiness button
  btnSaveReadiness.addEventListener("click", () => {
    const beds = parseInt(inputIcuBeds.value) || 0;
    const status = selectReadinessStatus.value;
    const hosp = hospitalDataMap[currentRepresentedId];
    if (hosp) {
      hosp.icuBedsAvailable = beds;
    }
    appendLog(
      "hospital-log",
      `Readiness saved: ${beds} ICU Beds, Status: ${status}, Cath Lab: ${toggleCathLab.checked ? 'Active' : 'Offline'}, Ventilator: ${toggleVentilator.checked ? 'Active' : 'Offline'}`,
      "teal"
    );
  });

  // Fetch initial trip info from driver console
  async function loadInitialTrip() {
    try {
      const res = await API.get("/api/driver/trip");
      if (res.trip) {
        fleetVehicleId.textContent = res.trip.vehicleId || "AMB-108-IND";
        fleetTierTag.textContent = `${res.trip.capabilityTier || "ALS"} · ${res.trip.fleetType || "Public"}`;
        if (res.trip.patientName) {
          fleetPatientInfo.textContent = `${res.trip.patientName} (${res.trip.patientAge || "--"}y) — ${res.trip.patientDescription || "Emergency Transport"}`;
        }
      }
      if (res.navigation) {
        inboundTargetHospitalId = res.navigation.targetHospitalId;
        fleetTargetFacility.textContent = res.navigation.targetHospitalName;
        fleetEta.textContent = res.navigation.estimatedTime || "12 mins";

        const targetHosp = hospitalDataMap[inboundTargetHospitalId];
        if (targetHosp) {
          updateHospitalRoute(targetHosp.locationLat, targetHosp.locationLong);
        }
      }
    } catch (e) {
      console.warn("Could not fetch active trip info:", e);
    }
  }

  await loadHospitals();
  await loadInitialTrip();
  connectHospitalDashboard(selectHospital.value || "HOSP_MY");

  // Socket.IO Listeners for Live Driver & Paramedic Synchronization
  if (socket) {
    socket.on("ambulance_telemetry", (data) => {
      fleetVehicleId.textContent = data.vehicleId;
      fleetTargetFacility.textContent = data.targetHospitalName;
      fleetEta.textContent = data.eta || "12 mins";

      if (data.capabilityTier || data.fleetType) {
        fleetTierTag.textContent = `${data.capabilityTier || "ALS"} · ${data.fleetType || "Public"}`;
      }

      if (data.patient) {
        const p = data.patient;
        fleetPatientInfo.textContent = `${p.patientName || "Patient"} (${p.patientAge || "--"}y) — ${p.patientDescription || "Emergency Transport"}`;
      }

      if (data.vitals) {
        fleetVitals.textContent = `HR ${data.vitals.heartRate} / SpO2 ${data.vitals.spO2}%`;
      }

      // Live location updates on map
      if (data.lat && data.lng) {
        ambLat = data.lat;
        ambLng = data.lng;
        ambulanceMarker.setLatLng([ambLat, ambLng]);
        ambulanceMarker.bindPopup(`<strong>${data.vehicleId}</strong><br>Speed Active • ETA: ${data.eta}`);

        // Update target hospital and route line if hospital target changed
        if (data.targetHospitalId) {
          inboundTargetHospitalId = data.targetHospitalId;
          const targetHosp = hospitalDataMap[data.targetHospitalId];
          if (targetHosp) {
            updateHospitalRoute(targetHosp.locationLat, targetHosp.locationLong);
          }
        }
      }
    });

    socket.on("vitals_stream", (vitals) => {
      fleetVitals.textContent = `HR ${vitals.heartRate} / SpO2 ${vitals.spO2}%`;
      if (vitals.isCritical) {
        fleetVitals.style.color = "var(--danger)";
        statusBadge.className = "badge-status red";
        statusBadge.textContent = "INCOMING CRITICAL";
      } else {
        fleetVitals.style.color = "var(--text-main)";
      }
    });

    socket.on("reroute_confirmed", (data) => {
      fleetTargetFacility.textContent = data.hospitalName;
      inboundTargetHospitalId = data.hospitalId;

      if (data.destCoords) {
        updateHospitalRoute(data.destCoords[0], data.destCoords[1]);
      }

      if (data.cancelledHospitalId === currentRepresentedId) {
        appendLog("hospital-log", `STANDBY CANCELLED: Transport diverted away to ${data.hospitalName}.`, "red");
        statusBadge.className = "badge-status yellow";
        statusBadge.textContent = "DIVERTED AWAY";
      } else if (data.hospitalId === currentRepresentedId) {
        appendLog("hospital-log", `URGENT INBOUND: Critical diversion routed to this facility. Prepare ICU bay.`, "red");
        statusBadge.className = "badge-status red";
        statusBadge.textContent = "TRAUMA BAY PREP";
      } else {
        appendLog("hospital-log", `Regional update: Ambulance diverted to ${data.hospitalName}.`);
      }
    });

    socket.on("arrival_event", (data) => {
      appendLog("hospital-log", data.message, "teal");
      statusBadge.className = "badge-status";
      statusBadge.textContent = "PATIENT ARRIVED";
      fleetEta.textContent = "0 mins";
    });
  }

  appendLog("hospital-log", "Hospital ER Console initialized. Regional monitoring online.", "teal");
});
