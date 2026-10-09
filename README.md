# RET-RP — Real-time Emergency Routing & Patient Monitoring

> **SE Project v2.0** — Class Diagram Compliant (Section 5) · Sequence Diagrams (Section 6) · State Machines (Section 7)

A full-stack emergency ambulance routing system with live BLE vitals streaming, OSRM road navigation, and multi-console real-time sync.

---

## Quick Start (3 Steps)

### Step 1 — Set Up Python Backend

```bash
# Navigate to backend
cd backend

# Create virtual environment
python -m venv venv

# Activate (Windows)
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the server
python app.py
```

Server starts at **http://localhost:5000**

### Step 2 — Open the Frontend

Open `frontend/index.html` in your browser (double-click, or use a local server):

```bash
# Optional: serve with Python
python -m http.server 8080 --directory frontend
# Then open http://localhost:8080
```

### Step 3 — Launch All 3 Consoles

1. On `index.html`, click **"Create Session & Launch Dashboards"**
2. Three links appear — open each in a **separate browser tab**:
   - 🩺 **Paramedic Console** — BLE sensor + vitals
   - 🚑 **Driver Console** — GPS navigation map
   - 🏥 **Hospital Console** — ETA + patient info

---

## End-to-End Demo Flow

| Step | Action | What Happens |
|------|--------|-------------|
| 1 | Paramedic: Click **"Connect Sensor"** | BLE state: Disconnected → Scanning → Connecting → Streaming |
| 2 | Vitals stream auto-starts | SpO₂: 97–99%, HR: 72–80 bpm posted every 3s |
| 3 | Driver: Click **"Start Navigation"** | GPS acquired (or Indore fallback), OSRM route drawn |
| 4 | Paramedic: Click **"Simulate Vital Crash"** | SpO₂ → 84%, HR → 135 bpm |
| 5 | Risk Evaluation Engine triggers | Red alert on all consoles, reroute modal on Driver |
| 6 | Driver: Accept reroute + select hospital | New OSRM polyline drawn, Hospital console gets diversion alert |
| 7 | Previous hospital gets cancellation notice | Old hospital console shows cancellation banner |
| 8 | Ambulance auto-advances to destination | Progress along OSRM road coords |
| 9 | Arrival detected | All 3 consoles show: *"Ambulance [ID] has arrived at [Hospital]. Patient Handover Initiated."* |

---

## Architecture

```
RET-RP/
├── backend/
│   ├── app.py           # Flask + Flask-SocketIO (REST + WebSocket)
│   ├── db.py            # SQLAlchemy + DB seeding
│   ├── models.py        # 10 domain classes (Section 5 class diagram)
│   ├── routing.py       # RouteEngine: Dijkstra + OSRM integration
│   ├── graph_data.py    # 12 Indore hospitals registry
│   ├── requirements.txt
│   └── data/
│       └── ret_rp.db    # SQLite (auto-created on first run)
└── frontend/
    ├── index.html        # Landing / session setup
    ├── paramedic.html    # Paramedic_Dashboard boundary
    ├── driver.html       # Driver_Dashboard boundary
    ├── hospital.html     # Hospital_UI boundary
    ├── css/style.css     # Dark medical theme
    └── js/
        ├── api.js        # Shared fetch + SocketIO helpers
        ├── paramedic.js  # BLE state machine + vitals stream
        ├── driver.js     # OSRM map + reroute flow
        └── hospital.js   # Live dashboard + arrival handling
```

---

## Report Alignment

### Section 5 — 10 Domain Classes

| Class | Location | Key Attributes |
|-------|----------|----------------|
| `Person` | `models.py` | `personId`, `name`, `phone` |
| `Paramedic(Person)` | `models.py` | `badgeNumber`, `certificationLevel` |
| `Driver(Person)` | `models.py` | `driverLicenseId`, `shiftStatus` |
| `HospitalStaff(Person)` | `models.py` | `staffId`, `department` |
| `Ambulance` | `models.py` | `vehicleId`, `licensePlate`, `currentLat`, `currentLong`, `status` |
| `BLESensor` | `models.py` | `deviceId`, `deviceType`, `batteryLevel`, `connectionStatus` |
| `PatientVitals` | `models.py` | `recordId`, `heartRate`, `spO2`, `systolicBP`, `timestamp`, `isCritical` |
| `RouteEngine` | `models.py` + `routing.py` | `routeId`, `originCoords`, `destinationCoords`, `estimatedTime` |
| `Hospital` | `models.py` + `graph_data.py` | `hospitalId`, `name`, `locationLat`, `locationLong`, `icuBedsAvailable` |
| `Equipment` | `models.py` | `equipmentId`, `type`, `status` |

### Section 6 — Controllers

| Controller | Endpoint | Logic |
|------------|----------|-------|
| `Risk_Evaluation_Engine` | `POST /api/vitals` | SpO₂ < 90% OR HR > 120 → `is_critical=True` → emit `reroute_request` |
| `Routing_Engine` | `POST /api/route` | Dijkstra + OSRM `generatePolyline()` |
| `Filter_Hospital_Engine` | `GET /api/hospitals` | `icuBedsAvailable > 0` + optional equipment flags |
| `ETA_Calculation` | `GET /api/eta` | OSRM duration with haversine fallback |

### Section 7 — State Machines

| Fig. | Class | States |
|------|-------|--------|
| Fig. 5 | `BLESensor` | Disconnected → Scanning → Connecting → Streaming |
| Fig. 6 | `RouteEngine` | Idle → Calculating Initial → Active Guidance → Filtering → Re-calculating → Prompting Driver → Navigation Updated |
| Fig. 7 | `PatientVitals` | Raw Input → Normalized → Normal / Critical |
| Fig. 9 | `Ambulance` | Stationary → Transporting Patient → Reroute Path → Arrival at ER |

---

## Hospitals Covered

| ID | Hospital | ICU Beds | Trauma |
|----|----------|----------|--------|
| H001 | MY Hospital (Maharaja Yeshwantrao) | 8 | Level I |
| H002 | Bombay Hospital Indore | 5 | Level II |
| H003 | Medanta Hospital Indore | 10 | Level I |
| H004 | CHL Apollo Hospital | 6 | Level II |
| H005 | Apollo Hospital Indore | 4 | Level II |
| H006 | Choithram Hospital & Research Centre | 7 | Level II |
| H007 | Shalby Hospital Indore | 3 | Level II |
| H008 | Apple Hospital | 2 | Level III |
| H009 | Greater Kailash Hospital | 4 | Level II |
| H010 | Index Medical College Hospital | 9 | Level I |
| H011 | Vishesh Jupiter Hospital | 5 | Level II |
| H012 | Arihant Hospital | 3 | Level III |

---

## Troubleshooting

**Backend won't start:**
```bash
pip install eventlet==0.37.0  # if eventlet issues
```

**CORS errors in browser:**
- Ensure backend is running on `http://localhost:5000`
- Do not open HTML files via `file://` — use a local server or VS Code Live Server

**Map not showing:**
- Check internet connection (OpenStreetMap tiles + OSRM API require internet)
- OSRM fallback (straight-line) works offline

**GPS denied:**
- Browser falls back to Indore centre coordinates automatically
- To enable GPS: serve frontend over HTTPS or localhost

---

## Tech Stack

- **Backend:** Python 3.11 · Flask 3.0 · Flask-SocketIO 5.3 · SQLAlchemy 2.0 · SQLite · Eventlet
- **Frontend:** Vanilla JS · Leaflet.js 1.9 · Socket.IO 4.7 · OpenStreetMap · OSRM Public API
- **Navigation:** OSRM `router.project-osrm.org` (driving mode, GeoJSON polyline)
