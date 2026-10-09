// ==============================================================================
// FILE: frontend/js/driver.js
// ==============================================================================
/**
 * Driver Console Script
 * - Uses Real Geolocation with Indore fallback (22.7196, 75.8577)
 * - Queries OSRM for realistic road curvature geometry
 * - Implements 1-Tap audio-visual reroute prompt modal (US-15, US-16, US-17)
 * - Synchronizes arrival handover event at final route coordinate
 */

let map, ambulanceMarker, destinationMarker, routePolyline;
let activeRoutePoints = [];
let currentIndex = 0;
let isNavigating = false;
let navInterval = null;

const INDORE_FALLBACK = [22.7196, 75.8577];
let currentCoords = [...INDORE_FALLBACK];
let currentHospital = null;
let hospitalsList = [];

const socket = io();

document.addEventListener("DOMContentLoaded", async () => {
  initMap();
  detectLiveLocation();
  await loadHospitals();

  document.getElementById("btn-start-nav").addEventListener("click", startNavigation);
  document.getElementById("btn-stop-nav").addEventListener("click", stopNavigation);
  document.getElementById("btn-accept-reroute").addEventListener("click", () => respondReroute(true));
  document.getElementById("btn-decline-reroute").addEventListener("click", () => respondReroute(false));

  setupSocketListeners();
});

function initMap() {
  map = L.map("map").setView(INDORE_FALLBACK, 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  const ambIcon = L.divIcon({
    className: "amb-leaflet-icon",
    html: "<div style='background-color:#ef4444;width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 8px rgba(0,0,0,0.5);'></div>",
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  ambulanceMarker = L.marker(INDORE_FALLBACK, { icon: ambIcon }).addTo(map);
}

function detectLiveLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        currentCoords = [pos.coords.latitude, pos.coords.longitude];
        ambulanceMarker.setLatLng(currentCoords);
        map.setView(currentCoords, 14);
        document.getElementById("lbl-gps-status").innerText = `${currentCoords[0].toFixed(4)}, ${currentCoords[1].toFixed(4)} (Live GPS)`;
      },
      (err) => {
        console.warn("GPS unavailable or denied. Defaulting to Central Indore.", err);
        currentCoords = [...INDORE_FALLBACK];
        document.getElementById("lbl-gps-status").innerText = "22.7196, 75.8577 (Central Indore)";
      },
      { timeout: 7000 }
    );
  } else {
    document.getElementById("lbl-gps-status").innerText = "22.7196, 75.8577 (Central Indore)";
  }
}

async function loadHospitals() {
  try {
    const res = await fetch("/api/hospitals");
    hospitalsList = await res.json();
    const select = document.getElementById("dest-select");
    select.innerHTML = "";

    hospitalsList.forEach((h, index) => {
      const opt = document.createElement("option");
      opt.value = h.hospitalId;
      opt.innerText = h.name;
      select.appendChild(opt);
      if (index === 0) currentHospital = h;
    });

    select.addEventListener("change", (e) => {
      currentHospital = hospitalsList.find((h) => h.hospitalId === e.target.value);
      document.getElementById("lbl-target-facility").innerText = currentHospital.name;
    });
  } catch (e) {
    console.error("Failed to load hospitals", e);
  }
}

async function fetchOsrmCurvedRoute(startLatLng, destLatLng) {
  const url = `https://router.project-osrm.org/route/v1/driving/${startLatLng[1]},${startLatLng[0]};${destLatLng[1]},${destLatLng[0]}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes && data.routes.length > 0) {
      return data.routes[0].geometry.coordinates.map((coord) => [coord[1], coord[0]]);
    }
  } catch (err) {
    console.warn("OSRM lookup failed, using linear interpolation.", err);
  }
  return [startLatLng, destLatLng];
}

async function startNavigation() {
  if (!currentHospital) return;
  isNavigating = true;
  currentIndex = 0;

  document.getElementById("btn-start-nav").disabled = true;
  document.getElementById("btn-stop-nav").disabled = false;
  document.getElementById("nav-status-badge").innerText = "ACTIVE GUIDANCE";
  document.getElementById("nav-status-badge").className = "badge badge-active";
  document.getElementById("arrival-card").classList.add("hidden");

  const destCoords = [currentHospital.locationLat, currentHospital.locationLong];

  if (destinationMarker) map.removeLayer(destinationMarker);
  destinationMarker = L.marker(destCoords).addTo(map).bindPopup(currentHospital.name).openPopup();

  activeRoutePoints = await fetchOsrmCurvedRoute(currentCoords, destCoords);

  if (routePolyline) map.removeLayer(routePolyline);
  routePolyline = L.polyline(activeRoutePoints, { color: "#2563eb", weight: 6, opacity: 0.8 }).addTo(map);
  map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });

  runRouteProgression();
}

function runRouteProgression() {
  if (navInterval) clearInterval(navInterval);

  navInterval = setInterval(() => {
    if (!isNavigating || currentIndex >= activeRoutePoints.length) {
      if (currentIndex >= activeRoutePoints.length && isNavigating) {
        completeArrival();
      }
      return;
    }

    currentCoords = activeRoutePoints[currentIndex];
    ambulanceMarker.setLatLng(currentCoords);

    const remainingSteps = activeRoutePoints.length - currentIndex;
    const estRemainingMins = Math.max(1, Math.ceil(remainingSteps * 0.4));
    document.getElementById("eta-display").innerText = `ETA: ${estRemainingMins} mins`;
    document.getElementById("lbl-distance-remaining").innerText = `${(remainingSteps * 0.15).toFixed(1)} km`;

    fetch("/api/ambulance/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: currentCoords[0],
        lng: currentCoords[1],
        etaMinutes: `${estRemainingMins} mins`,
      }),
    });

    currentIndex++;
  }, 1000);
}

function stopNavigation() {
  isNavigating = false;
  if (navInterval) clearInterval(navInterval);
  document.getElementById("btn-start-nav").disabled = false;
  document.getElementById("btn-stop-nav").disabled = true;
  document.getElementById("nav-status-badge").innerText = "HALTED";
}

async function completeArrival() {
  isNavigating = false;
  clearInterval(navInterval);
  document.getElementById("btn-start-nav").disabled = false;
  document.getElementById("btn-stop-nav").disabled = true;
  document.getElementById("nav-status-badge").innerText = "ARRIVED AT ER";
  document.getElementById("nav-status-badge").className = "badge badge-success";
  document.getElementById("eta-display").innerText = "ETA: 0 mins";

  await fetch("/api/ambulance/arrival", { method: "POST" });
}

function playVoiceAlert(text) {
  if ("speechSynthesis" in window) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.0;
    window.speechSynthesis.speak(utter);
  }
}

function setupSocketListeners() {
  // 1-Tap Audio-Visual Reroute prompt triggered by Risk Engine (US-15, US-16)
  socket.on("reroute_prompt", (data) => {
    document.getElementById("modal-hospital-name").innerText = data.hospitalName;
    document.getElementById("modal-icu-beds").innerText = data.icuBeds;
    document.getElementById("reroute-reason").innerText = data.reason;
    document.getElementById("reroute-modal").classList.remove("hidden");

    playVoiceAlert(`Attention driver. Red Alert triggered. Immediate reroute recommended to ${data.hospitalName}`);
  });

  socket.on("reroute_confirmed", async (data) => {
    document.getElementById("reroute-modal").classList.add("hidden");
    document.getElementById("lbl-target-facility").innerText = data.hospitalName;
    document.getElementById("dest-select").value = data.hospitalId;

    if (destinationMarker) map.removeLayer(destinationMarker);
    destinationMarker = L.marker(data.destCoords).addTo(map).bindPopup(data.hospitalName).openPopup();

    // Redraw polyline along curved roads to newly assigned facility
    activeRoutePoints = await fetchOsrmCurvedRoute(currentCoords, data.destCoords);
    currentIndex = 0;

    if (routePolyline) map.removeLayer(routePolyline);
    routePolyline = L.polyline(activeRoutePoints, { color: "#dc2626", weight: 6, opacity: 0.9 }).addTo(map);
    map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });

    document.getElementById("nav-status-badge").innerText = "REROUTED GUIDANCE";
    document.getElementById("nav-status-badge").className = "badge badge-critical";
  });

  socket.on("arrival_event", (data) => {
    const arrivalCard = document.getElementById("arrival-card");
    document.getElementById("arrival-msg").innerText = data.message;
    arrivalCard.classList.remove("hidden");
    playVoiceAlert("Ambulance arrived at Emergency Room. Initiating patient handover.");
  });
}

async function respondReroute(accepted) {
  document.getElementById("reroute-modal").classList.add("hidden");
  await fetch("/api/driver/respond-reroute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accepted }),
  });
}