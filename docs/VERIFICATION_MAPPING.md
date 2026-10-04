# Verification mapping (Part 3 of the refactor brief)

## Exp 9 class diagram -> backend/models.py

| Class diagram entity | models.py class | Notes |
|---|---|---|
| Person (base) | `User` | base attrs: user_id, name, role |
| Driver | `Driver(User)` | `accept_reroute()` = class diagram `acceptReroute()`; `decline_reroute()` = `declineReroute()` |
| Paramedic | `Paramedic(User)` | `enter_manual_vitals()` = `enterManualVitals()`; `trigger_manual_reroute()` = `triggerManualReroute()` |
| Hospital Staff | `HospitalCoordinator(User)` | `view_dashboard()` = `viewDashboard()`; `acknowledge_alert()` = `acknowledgeAlert()` |
| Patient Vitals | `VitalTelemetry` | `evaluate_thresholds()`, `to_dict()` present verbatim; fields hr/spo2/systolic_bp/diastolic_bp/timestamp match |
| (new) Patient | `Patient` | not on the original class diagram but required by the refactor brief; carries triage_level + required_equipment used by RouteEngine |
| Hospital | `Hospital` | `check_availability()`, `reserve_bay()` present; adds `update_status()` for the readiness editor |
| Ambulance | `Ambulance` | `update_location()`, `set_speed()`, `get_status()` present; adds `set_status()` used internally |
| Route Engine | `RouteEngine` | `calculate_optimal_path()` (Dijkstra, routing.py), `find_fallback_hospital()`, `compute_safety_corridor()` (closes audit finding #6 / FR-004) |
| Audit Log | `AuditLog` | static methods per event type, all writing through db.log_audit() |
| (new) Trip | `Trip` | not a class-diagram box; it is the realised state machine behind the "Patient Session" / sequence-diagram lifelines (Green/Yellow/Red/ReroutePending/Diverted) |

Gap carried over from the audit (not fixed by this refactor): the class diagram still has no Dispatch/Fleet Admin class, matching SRS FR-001/010/012. Add a `DispatchAdmin(User)` class if that workflow is implemented later.

## Exp 10 sequence diagrams -> API / socket handlers

| Sequence diagram | Lifelines | Backend realisation |
|---|---|---|
| Diagram 1: Risk evaluation & reroute trigger | Paramedic, Paramedic_Dashboard, Risk_Evaluation_Engine, Hospital_DB, Reroute_Engine | `POST /api/telemetry/vitals` -> `VitalTelemetry.evaluate_thresholds()` -> `Trip.propose_reroute()` -> WebSocket `REROUTE_ALERT` to `/ws/driver/{vehicle_id}` |
| Diagram 2: BLE sensor connect | Paramedic, BLE_Manager, BLE_Sensor | Simulated client-side in `paramedic.js` (`onToggleBle`) -- no real BLE hardware available, per Part 2 of the original prompt |
| Diagram 3: Route calculation | Driver, Routing_Engine, Traffic_API | `RouteEngine.calculate_optimal_path()` (Dijkstra, NOT the diagram's `executeAStarSearch` -- see audit finding #1); `POST /api/traffic/refresh` simulates the Traffic_API poll |
| Diagram 4: ETA recalculation | ETA_Calculation, Traffic_API, Hospital_UI | Recomputed as part of every `calculate_optimal_path()` call; pushed via `VITALS_UPDATE` / `INCOMING_DIVERSION` `eta_minutes` field |
| Diagram 5: Hospital capacity query | Dispatch_System, Hospital_DB, Filter_Hospital_Engine | `RouteEngine.find_fallback_hospital()` = `filterFacilities(capacityList)`; iterates `Hospital.check_availability()` per candidate |

## Exp 8 activity diagram -> Trip state machine

| Activity diagram step | Trip method / event |
|---|---|
| Log & Parse Patient Telemetry Vitals | `Trip.ingest_vitals()` |
| Evaluate Vitals Against Safety Thresholds | `VitalTelemetry.evaluate_thresholds()` |
| Trigger Red/Critical Alert | `AuditLog.threshold_alert()` |
| Query PostGIS & Match Nearby ER Capabilities | `RouteEngine.find_fallback_hospital()` (SQLite stand-in for PostGIS, per audit finding #7) |
| Compute Shortest-Time Reroute Path (Dijkstra) | `RouteEngine.calculate_optimal_path()` -> `routing.compute_shortest_time_path()` |
| Display High-Priority 1-Tap Audio-Visual Prompt | WebSocket `REROUTE_ALERT` -> `driver.js: showDiversionModal()` |
| Driver confirms? (decision diamond) | `POST /api/trips/{id}/confirm_reroute` vs `override_reroute` |
| Update Driver Navigation to Fallback ER | `Trip.confirm_reroute()` + `Driver.accept_reroute()` |
| Maintain Route to Original Destination | `Trip.override_reroute()` + `Driver.decline_reroute()` |
| Stream Live Vitals & ETA to New Hospital ER | `INCOMING_DIVERSION` broadcast after confirm |
| Complete Transit Hand-Off & Audit Logging | `AuditLog.reroute_confirmed()` / `reroute_overridden()` |

## Edge cases from Part 1.3

| Edge case | Implementation |
|---|---|
| 1. Nearest hospital at capacity / missing equipment | `Hospital.check_availability(required_equipment)` filters before ranking; `RouteEngine.find_fallback_hospital()` only ranks hospitals that pass |
| 2. Driver override / connectivity blackout | `Trip.override_reroute(reason)` + `AuditLog.reroute_overridden()` records reason + timestamp; primary corridor (`destination_hospital_id`, `route`) is untouched |
| 3. Vital fluctuation / oscillation | `Trip.can_propose_reroute()`: blocks a new proposal while one is pending, while already diverted, or within `DEBOUNCE_SECONDS` (25s) of the last override; blocked attempts are logged as `REROUTE_DEBOUNCED` instead of silently dropped |
