# RET-RP – Emergency Telematics & Risk-Aware Routing Platform (demo)

```
project/
├── backend/            FastAPI + SQLite (stdlib) – REST + WebSocket
│   ├── app.py           endpoints, calls into models.py (no raw SQL / dict logic)
│   ├── models.py        OOP domain layer: Ambulance, Patient, VitalTelemetry,
│   │                     Hospital, RouteEngine, AuditLog, Trip (state machine),
│   │                     User/Driver/Paramedic/HospitalCoordinator
│   ├── routing.py       Dijkstra shortest-time routing + simulated live traffic
│   ├── graph_data.py    mock road graph + 3 hospitals
│   ├── db.py            SQLite schema (SRS 3.4, extended with patient + trip-state columns)
│   └── requirements.txt
├── frontend/            plain HTML/CSS/JS + Leaflet (no build step)
│   ├── index.html  driver.html  paramedic.html  hospital.html
│   ├── css/style.css
│   └── js/api.js  driver.js  paramedic.js  hospital.js
└── docs/
    ├── AUDIT_AND_ARCHITECTURE.md
    └── VERIFICATION_MAPPING.md      class-diagram / sequence-diagram -> code mapping
```

## What changed in this refactor
- **OOP domain layer** (`backend/models.py`): every class on the Exp 9 class diagram now exists
  as a real Python class with the methods it specifies, wrapping its own SQLite persistence.
  `app.py` no longer touches `sqlite3` or raw dicts directly for domain data.
- **Explicit Trip state machine**: `Green -> Yellow -> Red -> ReroutePending -> Diverted`.
  A Red vital reading only **proposes** a reroute; the destination, route and DB record
  change only when the driver calls `confirm_reroute`. `override_reroute` keeps the
  primary corridor and logs a reason + timestamp.
- **New endpoints**: `POST /api/trips/{id}/propose_reroute`, `confirm_reroute`,
  `override_reroute` (old `/api/route/...` endpoints are removed; `/api/session/start` is
  kept as an alias of trip-start for compatibility, but now returns a full `Trip` object).
- **Edge Case 1**: `Hospital.check_availability(required_equipment)` bypasses hospitals
  with no open ICU bed or missing cath-lab/ventilator before ranking by Dijkstra ETA.
  Required equipment is inferred from the patient's chief complaint (demo heuristic).
- **Edge Case 2**: every override is written to the audit log with a reason and timestamp.
- **Edge Case 3**: `Trip.can_propose_reroute()` debounces further proposals for 25s after
  an override, and while a proposal is already pending, so fluctuating vitals can't spam
  the driver with repeated prompts.
- **Frontend**: the driver console now shows a high-priority modal with
  `[Confirm Diversion]` / `[Override · Stay on Route]`, pauses route simulation while a
  decision is pending, and only redraws the map path after confirmation. The hospital
  console shows incoming patient triage level and required equipment, and distinguishes
  a *proposed* pre-arrival notice from a *confirmed* diversion.

## Run
```bash
cd backend
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```
Open **http://localhost:8000/app/** (backend serves the frontend). Internet is needed
only for Leaflet and map tiles (CDN). API docs: http://localhost:8000/docs

## Demo script (3 browser tabs)
1. **Hospital tab** – choose City General (H1) → *Connect Dashboard*.
2. **Driver tab** – Vehicle ID `AMB-07` → *Register* → pick H1 as destination, fill in a chief complaint like
   "chest pain" (infers `cath_lab` as required equipment) → *Start Patient Transport Trip*. Copy the Trip ID.
   Turn on *Live route traversal*.
3. **Paramedic tab** – paste Trip ID → *Link Session*. Send normal vitals (Green), watch the Hospital tab update
   with the patient's name, triage level and required equipment.
4. Drag SpO2 below 90 (or HR above 120) → *Sync*. Status turns **Red**. The backend only **proposes** a
   reroute — the driver tab pops the high-priority modal ("Emergency Diversion Proposed: ... ETA: X mins")
   with **Confirm Diversion** / **Override · Stay on Route**. Route traversal pauses until a decision is made.
   - *Confirm* → destination, map path and hospital dashboard all update; the target hospital's ICU bed count drops by one.
   - *Override* → type a reason, route stays unchanged, and further Red readings are debounced for ~25s
     (watch the audit log fill with `REROUTE_DEBOUNCED` entries if you keep sending critical vitals).
5. In the hospital tab, set a hospital's ICU beds to 0 (or toggle off cath lab/ventilator) and trigger another
   Red alert on a fresh trip — the engine bypasses it and proposes the next eligible hospital instead
   (Edge Case 1). Check `GET /api/audit` or `/docs` to see every event logged.

## Notes
- No AI/ML: Dijkstra + rule thresholds (SpO2 < 90 or HR > 120 = Red; SpO2 < 94 or HR > 100 = Yellow).
- Simplifications vs. SRS: SQLite instead of PostgreSQL/PostGIS, web UI instead of Flutter, no auth/TLS (FR-012, encryption not implemented), offline caching (FR-009) not implemented.
- Reset data: stop the server and delete `backend/data/ret_rp.db`.
