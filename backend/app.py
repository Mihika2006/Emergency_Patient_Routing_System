"""
app.py
------
RET-RP backend, refactored to an explicit object-oriented domain layer
(models.py) and an explicit Trip state machine, per the sync-with-UML
refactor brief:

  - Risk evaluation: VitalTelemetry.evaluate_thresholds() (deterministic,
    no ML).
  - A Red reading only PROPOSES a reroute (Trip.propose_reroute). The
    destination never changes until the driver calls confirm_reroute.
  - Fallback hospital selection bypasses hospitals without capacity or
    required equipment (RouteEngine.find_fallback_hospital / Edge Case 1).
  - Repeated/fluctuating Red readings while a proposal is pending, or
    within DEBOUNCE_SECONDS of a driver override, do not spam new
    proposals (Trip.can_propose_reroute / Edge Case 3).
  - Every override is written to the audit log with a reason + timestamp
    (Edge Case 2).

Run locally:
    pip install -r requirements.txt
    uvicorn app:app --reload --port 8000
"""

import time
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import db
import routing
from graph_data import NODES, EDGES, HOSPITAL_NODES
from models import (
    Ambulance, Patient, VitalTelemetry, Hospital, RouteEngine, AuditLog,
    Trip, Driver, Paramedic, HospitalCoordinator,
)

app = FastAPI(title="RET-RP: Emergency Telematics & Risk-Aware Routing Platform")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------
# In-memory live object registry (persisted to SQLite by the models
# themselves on every mutation -- see models.py docstring)
# ---------------------------------------------------------------------
VEHICLES: Dict[str, Ambulance] = {}
TRIPS: Dict[str, Trip] = {}
HOSPITALS: Dict[str, Hospital] = Hospital.seed_all()
ROUTE_ENGINE = RouteEngine()


# ---------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------
class ConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, List[WebSocket]] = {}

    async def connect(self, room: str, ws: WebSocket):
        await ws.accept()
        self.rooms.setdefault(room, []).append(ws)

    def disconnect(self, room: str, ws: WebSocket):
        if room in self.rooms and ws in self.rooms[room]:
            self.rooms[room].remove(ws)

    async def broadcast(self, room: str, message: dict):
        dead = []
        for ws in self.rooms.get(room, []):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(room, ws)


manager = ConnectionManager()


# ---------------------------------------------------------------------
# Pydantic request/response models (API wire format only -- domain
# logic lives entirely in models.py)
# ---------------------------------------------------------------------
class VehicleRegistration(BaseModel):
    vehicle_id: str
    fleet_type: str = "Public"
    capability_tier: str = "ALS"
    driver_name: Optional[str] = None
    plate_number: Optional[str] = None


class TripStart(BaseModel):
    vehicle_id: str
    destination_hospital_id: str
    patient_name: Optional[str] = "Unknown"
    age: Optional[int] = None
    gender: Optional[str] = None
    chief_complaint: Optional[str] = ""
    initial_condition: Optional[str] = "Stable"
    required_equipment: Optional[List[str]] = None   # if omitted, derived from chief_complaint


class VitalsIn(BaseModel):
    trip_id: str
    heart_rate: float
    spo2: float
    systolic_bp: float
    diastolic_bp: float
    respiratory_rate: float = 16


class PositionIn(BaseModel):
    vehicle_id: str
    node: str


class OverrideIn(BaseModel):
    reason: str = "Driver override"


class HospitalStatusUpdate(BaseModel):
    icu_beds_available: Optional[int] = None
    cath_lab_available: Optional[bool] = None
    ventilator_available: Optional[bool] = None
    current_status: Optional[str] = None


# ---------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------
@app.on_event("startup")
def startup():
    seed = [
        {
            "hospital_id": hid, "name": h.name,
            "lat": NODES[HOSPITAL_NODES[hid]]["lat"],
            "lng": NODES[HOSPITAL_NODES[hid]]["lng"],
            "trauma_level": h.trauma_level, "icu_beds_available": h.icu_beds,
            "cath_lab_available": h.cath_lab_available, "ventilator_available": h.ventilator_available,
            "status": h.status,
        }
        for hid, h in HOSPITALS.items()
    ]
    db.init_db(seed_hospitals=seed)


# ---------------------------------------------------------------------
# Map / graph data
# ---------------------------------------------------------------------
@app.get("/api/graph")
def get_graph():
    return {
        "nodes": NODES,
        "edges": [{"from": a, "to": b, "distance_km": d, "base_speed_kmh": s} for a, b, d, s in EDGES],
        "hospital_nodes": list(HOSPITAL_NODES),
        "traffic": routing.get_traffic_snapshot(),
    }


@app.post("/api/traffic/refresh")
def refresh_traffic():
    return {"traffic": routing.refresh_traffic()}


# ---------------------------------------------------------------------
# Vehicle / Fleet registration  (FR-001) -- now backed by Ambulance
# ---------------------------------------------------------------------
@app.post("/api/vehicles/register")
def register_vehicle(payload: VehicleRegistration):
    vehicle = Ambulance(
        vehicle_id=payload.vehicle_id,
        plate_number=payload.plate_number,
        capability_tier=payload.capability_tier,
        driver_name=payload.driver_name,
        fleet_type=payload.fleet_type,
    )
    VEHICLES[vehicle.vehicle_id] = vehicle
    db.upsert_vehicle(vehicle.vehicle_id, vehicle.fleet_type, vehicle.capability_tier, vehicle.driver_name)
    AuditLog.record("VEHICLE_REGISTERED", vehicle_id=vehicle.vehicle_id, details=vehicle.to_dict())
    return vehicle.to_dict()


@app.get("/api/vehicles")
def list_vehicles():
    return [v.to_dict() for v in VEHICLES.values()]


# ---------------------------------------------------------------------
# Trip lifecycle  (Exp 9 "Patient Session" realised as models.Trip)
# ---------------------------------------------------------------------
@app.post("/api/session/start")
def start_trip(payload: TripStart):
    """Kept at the original URL for frontend compatibility; the object
    created is a full models.Trip, not a dict."""
    if payload.vehicle_id not in VEHICLES:
        raise HTTPException(404, "Vehicle not registered")
    vehicle = VEHICLES[payload.vehicle_id]

    patient = Patient(
        name=payload.patient_name, age=payload.age, gender=payload.gender,
        chief_complaint=payload.chief_complaint, required_equipment=payload.required_equipment,
    )

    trip_id = vehicle.vehicle_id[:3].upper() + "-" + str(int(time.time()))[-6:]
    start_node = vehicle.current_location if vehicle.current_location in NODES else "A"
    dest_node = HOSPITAL_NODES.get(payload.destination_hospital_id, payload.destination_hospital_id)
    route = ROUTE_ENGINE.calculate_optimal_path(start_node, dest_node)

    # THIS LINE WAS MISSING:
    trip = Trip(trip_id, vehicle, patient, payload.destination_hospital_id, route)
    TRIPS[trip_id] = trip

    vehicle.set_status("En-Route")
    db.create_patient_session(
        trip_id, vehicle.vehicle_id, payload.initial_condition, payload.destination_hospital_id,
        patient_id=patient.patient_id, patient_name=patient.name, age=patient.age, gender=patient.gender,
        chief_complaint=patient.chief_complaint, triage_level=patient.triage_level,
        required_equipment=patient.required_equipment,
    )
    db.save_route(trip_id, route["polyline"] if route else [], [])

    if route:
        ROUTE_ENGINE.compute_safety_corridor(route["path"], HOSPITALS)

    AuditLog.record("TRIP_STARTED", trip_id, vehicle.vehicle_id, {"destination": payload.destination_hospital_id})
    return trip.to_dict()


@app.get("/api/session/{trip_id}")
@app.get("/api/trips/{trip_id}")
def get_trip(trip_id: str):
    trip = _require_trip(trip_id)
    return trip.to_dict()


@app.get("/api/sessions")
@app.get("/api/trips")
def list_trips():
    return [t.to_dict() for t in TRIPS.values()]


def _require_trip(trip_id: str) -> Trip:
    trip = TRIPS.get(trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    return trip


# ---------------------------------------------------------------------
# Telemetry: vitals ingestion + threshold evaluation
# (FR-002, FR-003). A Red reading PROPOSES a reroute; it does not divert.
# ---------------------------------------------------------------------
@app.post("/api/telemetry/vitals")
async def ingest_vitals(payload: VitalsIn):
    trip = _require_trip(payload.trip_id)

    vitals = VitalTelemetry(payload.heart_rate, payload.spo2, payload.systolic_bp,
                             payload.diastolic_bp, payload.respiratory_rate)
    risk = trip.ingest_vitals(vitals)

    if risk == "Red":
        AuditLog.threshold_alert(trip.trip_id, trip.vehicle.vehicle_id, vitals)

    proposal = None
    if risk == "Red":
        proposal = trip.propose_reroute(ROUTE_ENGINE, HOSPITALS)  # no-op if debounced/pending/diverted
        if proposal:
            await manager.broadcast(f"driver:{trip.vehicle.vehicle_id}", {
                "type": "REROUTE_ALERT",
                "trip_id": trip.trip_id,
                "hospital_id": proposal["hospital_id"],
                "hospital_name": proposal["hospital_name"],
                "eta_minutes": proposal["eta_minutes"],
                "polyline": proposal["route"]["polyline"],
                "message": f"Emergency Diversion Proposed: Nearest capable facility is "
                           f"{proposal['hospital_name']} (ETA: {proposal['eta_minutes']:.1f} mins)",
            })
            await manager.broadcast(f"hospital:{proposal['hospital_id']}", {
                "type": "PRE_ARRIVAL_PROPOSAL",
                "trip_id": trip.trip_id, "vehicle_id": trip.vehicle.vehicle_id,
                "eta_minutes": proposal["eta_minutes"],
                "patient": trip.patient.to_dict(),
            })

    # Live vitals always stream to the CURRENT destination hospital (no
    # diversion has happened yet unless already confirmed in a prior beat)
    await manager.broadcast(f"hospital:{trip.destination_hospital_id}", {
        "type": "VITALS_UPDATE",
        "trip_id": trip.trip_id, "vehicle_id": trip.vehicle.vehicle_id,
        "vitals": vitals.to_dict(), "risk_level": risk,
        "patient": trip.patient.to_dict(),
        "eta_minutes": trip.route["eta_minutes"] if trip.route else None,
    })

    return {"risk_level": risk, "state": trip.state, "proposal": proposal}


# ---------------------------------------------------------------------
# Explicit reroute endpoints (Part 2.2 of the refactor brief)
# ---------------------------------------------------------------------
@app.post("/api/trips/{trip_id}/propose_reroute")
async def propose_reroute(trip_id: str):
    """Manual trigger -- Paramedic.triggerManualReroute(). Forces a fresh
    candidate computation even outside a Red reading, but still will not
    overwrite an already-pending proposal."""
    trip = _require_trip(trip_id)
    paramedic = Paramedic(user_id="paramedic-ui", name="Attending Paramedic")
    proposal = paramedic.trigger_manual_reroute(trip, ROUTE_ENGINE, HOSPITALS)
    if not proposal:
        return {"status": "NO_PROPOSAL", "reason": "No eligible hospital or a decision is already pending."}

    await manager.broadcast(f"driver:{trip.vehicle.vehicle_id}", {
        "type": "REROUTE_ALERT", "trip_id": trip.trip_id,
        "hospital_id": proposal["hospital_id"], "hospital_name": proposal["hospital_name"],
        "eta_minutes": proposal["eta_minutes"], "polyline": proposal["route"]["polyline"],
        "message": f"Emergency Diversion Proposed: Nearest capable facility is "
                   f"{proposal['hospital_name']} (ETA: {proposal['eta_minutes']:.1f} mins)",
    })
    return {"status": "PROPOSED", **{k: v for k, v in proposal.items() if k != "route"}}


@app.post("/api/trips/{trip_id}/confirm_reroute")
async def confirm_reroute(trip_id: str):
    trip = _require_trip(trip_id)
    if not trip.pending_proposal:
        raise HTTPException(400, "No pending reroute proposal for this trip")

    old_hospital_id = trip.destination_hospital_id
    driver = Driver(user_id="driver-ui", name=trip.vehicle.driver_name or "Driver", vehicle=trip.vehicle)
    confirmed = driver.accept_reroute(trip)
    if not confirmed:
        raise HTTPException(400, "Unable to confirm reroute")

    new_hospital = HOSPITALS[confirmed["hospital_id"]]
    new_hospital.reserve_bay()
    ROUTE_ENGINE.compute_safety_corridor(confirmed["route"]["path"], HOSPITALS)

    # 1. Notify the OLD hospital that the patient was diverted away
    await manager.broadcast(f"hospital:{old_hospital_id}", {
        "type": "DIVERSION_CANCELLED",
        "trip_id": trip.trip_id,
        "vehicle_id": trip.vehicle.vehicle_id,
        "new_hospital_name": new_hospital.name,
        "reason": "Critical vitals drop - diverted to nearest capable trauma facility"
    })

    # 2. Notify the NEW hospital of the incoming critical patient
    await manager.broadcast(f"hospital:{confirmed['hospital_id']}", {
        "type": "INCOMING_DIVERSION",
        "trip_id": trip.trip_id,
        "vehicle_id": trip.vehicle.vehicle_id,
        "eta_minutes": confirmed["eta_minutes"],
        "patient": trip.patient.to_dict(),
    })

    # 3. Notify the Driver console to update route and UI
    await manager.broadcast(f"driver:{trip.vehicle.vehicle_id}", {
        "type": "DIVERSION_CONFIRMED",
        "trip_id": trip.trip_id,
        "hospital_id": confirmed["hospital_id"],
        "hospital_name": new_hospital.name,
        "polyline": confirmed["route"]["polyline"],
        "eta_minutes": confirmed["eta_minutes"],
    })

    # 4. Notify Paramedic console of the new destination
    await manager.broadcast(f"paramedic:{trip.trip_id}", {
        "type": "DESTINATION_UPDATED",
        "trip_id": trip.trip_id,
        "hospital_id": confirmed["hospital_id"],
        "hospital_name": new_hospital.name,
        "triage_level": trip.patient.triage_level
    })

    return trip.to_dict()


@app.post("/api/trips/{trip_id}/override_reroute")
async def override_reroute(trip_id: str, payload: OverrideIn):
    """Driver taps 'Override / Stay on Route' (Edge Case 2): logs the
    reason + timestamp and keeps the primary corridor active."""
    trip = _require_trip(trip_id)
    if not trip.pending_proposal:
        raise HTTPException(400, "No pending reroute proposal for this trip")

    driver = Driver(user_id="driver-ui", name=trip.vehicle.driver_name or "Driver", vehicle=trip.vehicle)
    result = driver.decline_reroute(trip, payload.reason)

    await manager.broadcast(f"hospital:{trip.destination_hospital_id}", {
        "type": "REROUTE_OVERRIDDEN", "trip_id": trip.trip_id, "reason": payload.reason,
    })
    return {"status": "OVERRIDDEN", **result, "debounce_until": trip.last_override_at + Trip.DEBOUNCE_SECONDS}


# ---------------------------------------------------------------------
# Driver position updates (GPS simulation)
# ---------------------------------------------------------------------
@app.post("/api/telemetry/position")
async def update_position(payload: PositionIn):
    vehicle = VEHICLES.get(payload.vehicle_id)
    if not vehicle:
        raise HTTPException(404, "Vehicle not registered")
    if payload.node not in NODES:
        raise HTTPException(400, "Unknown node")

    vehicle.update_location(payload.node)
    node = NODES[payload.node]

    trip = TRIPS.get(vehicle.trip_id) if vehicle.trip_id else None
    if trip:
        await manager.broadcast(f"hospital:{trip.destination_hospital_id}", {
            "type": "POSITION_UPDATE", "vehicle_id": vehicle.vehicle_id, "trip_id": trip.trip_id,
            "node": payload.node, "lat": node["lat"], "lng": node["lng"],
        })
    return {"status": "ok", "node": payload.node}

@app.patch("/api/hospitals/{hospital_id}")
async def update_hospital(hospital_id: str, payload: HospitalStatusUpdate):
    hospital = HOSPITALS.get(hospital_id)
    if not hospital:
        raise HTTPException(404, "Hospital not found")
    data = payload.dict(exclude_unset=True)
    field_map = {"icu_beds_available": "icu_beds", "cath_lab_available": "cath_lab_available",
                 "ventilator_available": "ventilator_available", "current_status": "status"}
    hospital.update_status(**{field_map[k]: v for k, v in data.items() if k in field_map})
    AuditLog.record("HOSPITAL_STATUS_UPDATE", details={"hospital_id": hospital_id, **data})

    # RESOURCE CAPACITY CHECK: Check any active trips heading to this hospital
    for trip_id, trip in TRIPS.items():
        if trip.destination_hospital_id == hospital_id and not trip.diverted:
            # Check if hospital can no longer serve this patient's equipment/bed needs
            if not hospital.check_availability(trip.patient.required_equipment):
                # Force an emergency reroute proposal due to hospital resource exhaustion
                proposal = trip.propose_reroute(ROUTE_ENGINE, HOSPITALS, force=True)
                if proposal:
                    await manager.broadcast(f"driver:{trip.vehicle.vehicle_id}", {
                        "type": "REROUTE_ALERT",
                        "trip_id": trip.trip_id,
                        "hospital_id": proposal["hospital_id"],
                        "hospital_name": proposal["hospital_name"],
                        "eta_minutes": proposal["eta_minutes"],
                        "polyline": proposal["route"]["polyline"],
                        "message": f"CRITICAL: {hospital.name} can no longer support required equipment ({', '.join(trip.patient.required_equipment)}). Diversion proposed to {proposal['hospital_name']} (ETA: {proposal['eta_minutes']:.1f} min).",
                    })
                    await manager.broadcast(f"paramedic:{trip.trip_id}", {
                        "type": "DESTINATION_UPDATED",
                        "trip_id": trip.trip_id,
                        "hospital_id": proposal["hospital_id"],
                        "hospital_name": proposal["hospital_name"],
                        "triage_level": "Critical"
                    })
                    AuditLog.record("HOSPITAL_CAPACITY_BREACH", trip.trip_id, trip.vehicle.vehicle_id, {
                        "revoked_hospital": hospital.name,
                        "required_equipment": trip.patient.required_equipment
                    })

    return hospital.to_dict()


# ---------------------------------------------------------------------
# Hospital readiness  (FR-005)
# ---------------------------------------------------------------------
@app.get("/api/hospitals")
def list_hospitals():
    return [h.to_dict() for h in HOSPITALS.values()]


@app.patch("/api/hospitals/{hospital_id}")
def update_hospital(hospital_id: str, payload: HospitalStatusUpdate):
    hospital = HOSPITALS.get(hospital_id)
    if not hospital:
        raise HTTPException(404, "Hospital not found")
    data = payload.dict(exclude_unset=True)
    field_map = {"icu_beds_available": "icu_beds", "cath_lab_available": "cath_lab_available",
                 "ventilator_available": "ventilator_available", "current_status": "status"}
    hospital.update_status(**{field_map[k]: v for k, v in data.items() if k in field_map})
    AuditLog.record("HOSPITAL_STATUS_UPDATE", details={"hospital_id": hospital_id, **data})
    return hospital.to_dict()


# ---------------------------------------------------------------------
# Audit trail  (FR-011)
# ---------------------------------------------------------------------
@app.get("/api/audit")
def audit_trail(limit: int = 100):
    return db.get_audit_trail(limit)


@app.get("/api/session/{trip_id}/vitals-history")
@app.get("/api/trips/{trip_id}/vitals-history")
def vitals_history(trip_id: str, limit: int = 30):
    return db.get_recent_vitals(trip_id, limit)


# ---------------------------------------------------------------------
# WebSockets
# ---------------------------------------------------------------------
@app.websocket("/ws/hospital/{hospital_id}")
async def ws_hospital(websocket: WebSocket, hospital_id: str):
    room = f"hospital:{hospital_id}"
    await manager.connect(room, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(room, websocket)


@app.websocket("/ws/driver/{vehicle_id}")
async def ws_driver(websocket: WebSocket, vehicle_id: str):
    room = f"driver:{vehicle_id}"
    await manager.connect(room, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(room, websocket)
        

@app.websocket("/ws/paramedic/{trip_id}")
async def ws_paramedic(websocket: WebSocket, trip_id: str):
    room = f"paramedic:{trip_id}"
    await manager.connect(room, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(room, websocket)


@app.get("/")
def root():
    return {
        "service": "RET-RP backend",
        "docs": "/docs",
        "portals": ["frontend/driver.html", "frontend/paramedic.html", "frontend/hospital.html"],
    }


# Serve the frontend from the same server -> http://localhost:8000/app/
_FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
if _FRONTEND.exists():
    app.mount("/app", StaticFiles(directory=_FRONTEND, html=True), name="frontend")


class ArrivalIn(BaseModel):
    vehicle_id: str
    trip_id: str
    hospital_id: str

@app.post("/api/trips/arrive")
async def register_arrival(payload: ArrivalIn):
    trip = TRIPS.get(payload.trip_id)
    hospital_name = HOSPITALS[payload.hospital_id].name if payload.hospital_id in HOSPITALS else "Hospital"

    arrival_payload = {
        "type": "AMBULANCE_ARRIVED",
        "trip_id": payload.trip_id,
        "vehicle_id": payload.vehicle_id,
        "hospital_name": hospital_name,
        "message": f"Ambulance {payload.vehicle_id} has arrived at {hospital_name}. Patient Handover Initiated."
    }

    # Broadcast arrival to all 3 endpoints
    await manager.broadcast(f"driver:{payload.vehicle_id}", arrival_payload)
    await manager.broadcast(f"hospital:{payload.hospital_id}", arrival_payload)
    await manager.broadcast(f"paramedic:{payload.trip_id}", arrival_payload)

    AuditLog.record("AMBULANCE_ARRIVED", payload.trip_id, payload.vehicle_id, {"hospital": hospital_name})
    return {"status": "ARRIVED", "message": arrival_payload["message"]}