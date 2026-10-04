# Audit summary
1. **Routing algorithm conflict** – Exp10 sequence diagram 3 uses `executeAStarSearch`; Exp4, Exp5, Exp6, Exp8 (activity) and Exp9 (`computeDijkstraPath`) all say Dijkstra. Fix the sequence diagram (or pick A* everywhere).
2. **SpO2 threshold conflict** – SRS UC-01 says < 85 %; Exp5/6/4 and sequence diagram 1 use < 90 % (and HR > 120). Align the SRS to 90 %; add numeric thresholds to FR-003.
3. **Exp7 (Use Case diagram) is blank** although later experiments depend on it. Add the diagram (actors: Driver, Paramedic, Hospital ER Staff, Dispatch Admin, Traffic API, BLE sensor).
4. **Actor gap** – Dispatch/Fleet Admin appears in SRS (FR-001/010/012) and DFDs but not in the class diagram.
5. **DFD data stores** – D1/D2 mean different things at different levels; "Geofence Safety Constraints" (DFD L1) is defined nowhere else; D2.1 "Threshold Rules DB" is nested under a vitals store.
6. **FR-004 "safety corridor"** is not realised in detailed design/code (only reactive filtering after a Red alert).
7. **Tech stack** – SRS mandates Flutter + PostgreSQL/PostGIS + Redis; this demo uses web UI + SQLite. State this as a scope reduction in the SRS.
8. Sequence diagram naming (Dispatch_System, Filter_Hospital_Engine…) differs from module names in Exp4 (Filter Eligible ER Facilities etc.); align.

**AI/ML needed? No.** Threshold rules + Dijkstra/A* + filter-and-rank are deterministic and meet every FR.

# Data flow
Paramedic/Driver UI → REST POST (`/api/telemetry/vitals`, `/position`) → FastAPI evaluates risk, writes SQLite, on Red runs hospital filter (ICU beds > 0) + Dijkstra ranking → WebSocket push: `REROUTE_PROMPT` to driver, `VITALS_UPDATE` / `INCOMING_DIVERSION` to hospital dashboards.
Telemetry is simulated: sliders + auto-stream (random walk every 5 s) for vitals, timer-driven node-to-node movement for GPS, random congestion factors for traffic.
