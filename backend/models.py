"""
models.py
---------
Formal object-oriented domain layer, introduced to close the audit gap
between the Exp 9 class diagram / Exp 4 detailed design (which specify
classes and methods) and the first prototype, which only used raw dict
lookups and ad-hoc SQLite queries directly inside app.py.

Each class below corresponds 1:1 to a class on the Exp 9 class diagram
(see docs/AUDIT_AND_ARCHITECTURE.md for the verification table). Classes
wrap their own persistence calls into db.py so that app.py only ever
talks to objects, never to sqlite3 directly.

Also introduces `Trip`, the explicit state machine requested in Part 1.2
/ 1.3 of the refactor brief: it is the object that remembers whether a
reroute proposal is pending driver confirmation, and debounces repeated
threshold breaches so fluctuating vitals cannot spam reroute proposals
(Edge Case 3).
"""

from __future__ import annotations

import time
import uuid
from typing import Dict, List, Optional

import db
import routing
from graph_data import NODES, HOSPITAL_NODES


# ---------------------------------------------------------------------
# VitalTelemetry  (Exp 9 class diagram: "Patient Vitals")
# ---------------------------------------------------------------------
class VitalTelemetry:
    """One reading of a patient's vitals + the deterministic risk rule.

    Thresholds match Exp 4 (detailed design), Exp 5 (reference code),
    Exp 6 (user stories) and the Exp 10 / Exp 8 diagrams: SpO2 < 90 or
    HR > 120 -> Red. (The audit flagged the SRS's own UC-01 example,
    which instead says SpO2 < 85 -- that figure is the outlier and is
    NOT used here; see finding #2 in the audit report.)
    """

    SPO2_CRITICAL = 90
    SPO2_WARNING = 94
    HR_CRITICAL = 120
    HR_WARNING = 100

    def __init__(self, hr: float, spo2: float, systolic_bp: float, diastolic_bp: float,
                 resp_rate: float = 16, timestamp: float = None):
        self.hr = hr
        self.spo2 = spo2
        self.systolic_bp = systolic_bp
        self.diastolic_bp = diastolic_bp
        self.resp_rate = resp_rate
        self.timestamp = timestamp or time.time()
        self.risk_level: Optional[str] = None

    def evaluate_thresholds(self) -> str:
        """Rule-based evaluation -- deterministic, no ML model (per audit Part 1 Q2)."""
        if self.spo2 < self.SPO2_CRITICAL or self.hr > self.HR_CRITICAL:
            self.risk_level = "Red"
        elif self.spo2 < self.SPO2_WARNING or self.hr > self.HR_WARNING:
            self.risk_level = "Yellow"
        else:
            self.risk_level = "Green"
        return self.risk_level

    def to_dict(self) -> dict:
        return {
            "heart_rate": self.hr,
            "spo2": self.spo2,
            "systolic_bp": self.systolic_bp,
            "diastolic_bp": self.diastolic_bp,
            "respiratory_rate": self.resp_rate,
            "timestamp": self.timestamp,
            "risk_level": self.risk_level,
        }


# ---------------------------------------------------------------------
# Patient  (Exp 9 class diagram: "Patient Vitals" extended with identity)
# ---------------------------------------------------------------------
class Patient:
    """Required-equipment inference is a small deterministic keyword rule
    (not ML) standing in for a real intake form, so RouteEngine has
    something concrete to filter fallback hospitals against (Edge Case 1).
    """

    EQUIPMENT_KEYWORDS = {
        "cath_lab": ["chest pain", "cardiac", "heart attack", "mi", "stemi"],
        "ventilator": ["respiratory", "breathing", "copd", "asthma", "resp failure", "unconscious"],
    }

    def __init__(self, patient_id: str = None, name: str = "Unknown", age: int = None,
                 gender: str = None, chief_complaint: str = "", triage_level: str = "Stable",
                 required_equipment: List[str] = None):
        self.patient_id = patient_id or str(uuid.uuid4())[:8]
        self.name = name
        self.age = age
        self.gender = gender
        self.chief_complaint = chief_complaint or ""
        self.triage_level = triage_level
        self.required_equipment = (
            required_equipment if required_equipment is not None else self._derive_equipment()
        )

    def _derive_equipment(self) -> List[str]:
        text = self.chief_complaint.lower()
        return [equip for equip, kws in self.EQUIPMENT_KEYWORDS.items() if any(k in text for k in kws)]

    def update_triage(self, risk_level: str):
        self.triage_level = {"Red": "Critical", "Yellow": "Urgent", "Green": "Stable"}.get(risk_level, self.triage_level)
        return self.triage_level

    def to_dict(self) -> dict:
        return {
            "patient_id": self.patient_id, "name": self.name, "age": self.age, "gender": self.gender,
            "chief_complaint": self.chief_complaint, "triage_level": self.triage_level,
            "required_equipment": self.required_equipment,
        }


# ---------------------------------------------------------------------
# Hospital  (Exp 9 class diagram: "Hospital")
# ---------------------------------------------------------------------
class Hospital:
    def __init__(self, hospital_id: str, name: str, node: str, trauma_level: str,
                 icu_beds: int, ventilator_available: bool, cath_lab_available: bool,
                 status: str = "Ready"):
        self.hospital_id = hospital_id
        self.name = name
        self.node = node
        self.trauma_level = trauma_level
        self.icu_beds = icu_beds
        self.ventilator_available = ventilator_available
        self.cath_lab_available = cath_lab_available
        self.status = status

    def check_availability(self, required_equipment: List[str] = None) -> bool:
        """Edge Case 1: a hospital is eligible only if it is Ready, has an open
        ICU bed, AND has every piece of equipment the patient needs."""
        if self.status != "Ready" or self.icu_beds <= 0:
            return False
        for equip in (required_equipment or []):
            if equip == "cath_lab" and not self.cath_lab_available:
                return False
            if equip == "ventilator" and not self.ventilator_available:
                return False
        return True

    def reserve_bay(self) -> bool:
        """FR-005-adjacent: claim one ICU bed for an inbound diversion."""
        if self.icu_beds <= 0:
            return False
        self.icu_beds -= 1
        db.sync_hospital(self.hospital_id, icu_beds_available=self.icu_beds)
        return True

    def update_status(self, **fields):
        for k, v in fields.items():
            if hasattr(self, k):
                setattr(self, k, v)
        db.sync_hospital(
            self.hospital_id,
            icu_beds_available=self.icu_beds,
            cath_lab_available=self.cath_lab_available,
            ventilator_available=self.ventilator_available,
            current_status=self.status,
        )

    def to_dict(self) -> dict:
        return {
            "hospital_id": self.hospital_id, "name": self.name, "node": self.node,
            "trauma_level": self.trauma_level, "icu_beds_available": self.icu_beds,
            "ventilator_available": self.ventilator_available, "cath_lab_available": self.cath_lab_available,
            "current_status": self.status,
        }

    @classmethod
    def seed_all(cls) -> Dict[str, "Hospital"]:
        from graph_data import HOSPITALS
        return {
            hid: cls(hid, h["name"], hid, h["trauma_level"], h["icu_beds_available"],
                     h["ventilator_available"], h["cath_lab_available"], h["status"])
            for hid, h in HOSPITALS.items()
        }


# ---------------------------------------------------------------------
# Ambulance / Vehicle  (Exp 9 class diagram: "Ambulance")
# ---------------------------------------------------------------------
class Ambulance:
    def __init__(self, vehicle_id: str, plate_number: str = None, capability_tier: str = "ALS",
                 driver_name: str = None, fleet_type: str = "Public",
                 status: str = "Available", current_location: str = "N1", speed: float = 0):
        self.vehicle_id = vehicle_id
        self.plate_number = plate_number or vehicle_id
        self.capability_tier = capability_tier
        self.driver_name = driver_name
        self.fleet_type = fleet_type
        self.status = status
        self.current_location = current_location
        self.speed = speed
        self.trip_id: Optional[str] = None

    def update_location(self, node: str):
        self.current_location = node
        loc = NODES.get(node, {})
        db.update_vehicle_position(self.vehicle_id, loc.get("lat"), loc.get("lng"), node)

    def set_speed(self, speed: float):
        self.speed = speed

    def get_status(self) -> str:
        return self.status

    def set_status(self, status: str):
        self.status = status
        db.update_vehicle_position(self.vehicle_id, NODES[self.current_location]["lat"],
                                    NODES[self.current_location]["lng"], self.current_location, status=status)

    def to_dict(self) -> dict:
        return {
            "vehicle_id": self.vehicle_id, "plate_number": self.plate_number,
            "capability_tier": self.capability_tier, "driver_name": self.driver_name,
            "fleet_type": self.fleet_type, "status": self.status,
            "current_location": self.current_location, "speed": self.speed,
            "trip_id": self.trip_id,
        }


# ---------------------------------------------------------------------
# RouteEngine / PathFinder  (Exp 9 class diagram: "Route Engine")
# ---------------------------------------------------------------------
class RouteEngine:
    """Thin OOP wrapper around the Dijkstra implementation in routing.py,
    plus the two higher-level behaviours the class diagram names:
    find_fallback_hospital() and compute_safety_corridor().
    """

    def __init__(self):
        self.graph = routing.ADJACENCY if hasattr(routing, "ADJACENCY") else None
        self.active_corridor: List[str] = []

    def calculate_optimal_path(self, start: str, destination: str) -> Optional[dict]:
        return routing.compute_shortest_time_path(start, destination)

    def find_fallback_hospital(self, current_node: str, hospitals: Dict[str, Hospital],
                                required_equipment: List[str] = None,
                                exclude: List[str] = None) -> List[dict]:
        """Edge Case 1: rank only hospitals that pass check_availability()
        (open bed + required equipment); hospitals that fail -- e.g. the
        geometrically nearest one being full -- are bypassed entirely
        rather than ranked last.
        """
        exclude = set(exclude or [])
        eligible = {
            hid: h for hid, h in hospitals.items()
            if hid not in exclude and h.check_availability(required_equipment)
        }
        ranked = []
        for hid, hospital in eligible.items():
            route = self.calculate_optimal_path(current_node, hid)
            if route:
                ranked.append({
                    "hospital_id": hid,
                    "hospital": hospital,
                    "eta_minutes": route["eta_minutes"],
                    "route": route,
                })
        ranked.sort(key=lambda r: r["eta_minutes"])
        return ranked

    def compute_safety_corridor(self, path: List[dict], hospitals: Dict[str, Hospital],
                                 max_hops: int = 2) -> List[str]:
        """FR-004's 'dynamic safety corridor': rather than only computing a
        fallback reactively after a Red alert, maintain a running list of
        hospitals within `max_hops` road segments of ANY point on the
        primary path, refreshed whenever the route is (re)calculated. This
        directly closes audit finding #6 (safety corridor previously
        unimplemented).
        """
        corridor = set()
        nodes_on_path = [step["node"] if isinstance(step, dict) else step for step in path]
        for node in nodes_on_path:
            for hid in HOSPITAL_NODES:
                route = self.calculate_optimal_path(node, hid)
                if route and (len(route["path"]) - 1) <= max_hops:
                    corridor.add(hid)
        self.active_corridor = sorted(corridor)
        return self.active_corridor


# ---------------------------------------------------------------------
# AuditLog  (Exp 9 class diagram: "Audit Log" / FR-011)
# ---------------------------------------------------------------------
class AuditLog:
    """Static convenience wrapper so callers log structured events instead
    of hand-building dicts inline (Edge Case 2 requires an audit entry
    with reason + timestamp on every override)."""

    @staticmethod
    def record(event_type: str, trip_id: str = None, vehicle_id: str = None, details: dict = None):
        db.log_audit(event_type, session_id=trip_id, vehicle_id=vehicle_id, details=details or {})

    @classmethod
    def threshold_alert(cls, trip_id, vehicle_id, vitals: VitalTelemetry):
        cls.record("THRESHOLD_ALERT", trip_id, vehicle_id, vitals.to_dict())

    @classmethod
    def reroute_proposed(cls, trip_id, vehicle_id, hospital_id, eta_minutes):
        cls.record("REROUTE_PROPOSED", trip_id, vehicle_id, {"target_hospital_id": hospital_id, "eta_minutes": eta_minutes})

    @classmethod
    def reroute_confirmed(cls, trip_id, vehicle_id, hospital_id):
        cls.record("DRIVER_CONFIRM_REROUTE", trip_id, vehicle_id, {"target_hospital_id": hospital_id})

    @classmethod
    def reroute_overridden(cls, trip_id, vehicle_id, reason: str):
        cls.record("DRIVER_OVERRIDE_REROUTE", trip_id, vehicle_id, {"reason": reason, "timestamp": time.time()})

    @classmethod
    def reroute_debounced(cls, trip_id, vehicle_id, vitals: VitalTelemetry):
        cls.record("REROUTE_DEBOUNCED", trip_id, vehicle_id,
                    {"reason": "vitals fluctuating near threshold / proposal already pending", **vitals.to_dict()})

    @classmethod
    def no_hospital_available(cls, trip_id, vehicle_id):
        cls.record("REROUTE_FAILED_NO_CAPACITY", trip_id, vehicle_id)


# ---------------------------------------------------------------------
# User roles  (Exp 9 class diagram: Person -> Driver / Paramedic / HospitalStaff)
# ---------------------------------------------------------------------
class User:
    def __init__(self, user_id: str, name: str, role: str):
        self.user_id = user_id
        self.name = name
        self.role = role


class Driver(User):
    def __init__(self, user_id: str, name: str, vehicle: Ambulance):
        super().__init__(user_id, name, "Driver")
        self.vehicle = vehicle

    def accept_reroute(self, trip: "Trip") -> Optional[dict]:
        """Exp 9: Driver.acceptReroute() -- confirms the pending proposal."""
        confirmed = trip.confirm_reroute()
        if confirmed:
            AuditLog.reroute_confirmed(trip.trip_id, self.vehicle.vehicle_id, confirmed["hospital_id"])
        return confirmed

    def decline_reroute(self, trip: "Trip", reason: str = "Driver override") -> dict:
        """Exp 9: Driver.declineReroute() -- Edge Case 2."""
        result = trip.override_reroute(reason)
        AuditLog.reroute_overridden(trip.trip_id, self.vehicle.vehicle_id, reason)
        return result


class Paramedic(User):
    def __init__(self, user_id: str, name: str):
        super().__init__(user_id, name, "Paramedic")

    def enter_manual_vitals(self, trip: "Trip", vitals: VitalTelemetry) -> str:
        """Exp 9: Paramedic.enterManualVitals()."""
        return trip.ingest_vitals(vitals)

    def trigger_manual_reroute(self, trip: "Trip", route_engine: RouteEngine,
                                hospitals: Dict[str, Hospital]) -> Optional[dict]:
        """Exp 9: Paramedic.triggerManualReroute() -- manual emergency override,
        bypasses the usual Red-threshold gate but still respects the Trip
        state machine (no duplicate proposals)."""
        return trip.propose_reroute(route_engine, hospitals, force=True)


class HospitalCoordinator(User):
    def __init__(self, user_id: str, name: str, hospital: Hospital):
        super().__init__(user_id, name, "HospitalCoordinator")
        self.hospital = hospital

    def acknowledge_alert(self, trip: "Trip"):
        """Exp 9: HospitalStaff.acknowledgeAlert()."""
        AuditLog.record("HOSPITAL_ACKNOWLEDGED", trip.trip_id, details={"hospital_id": self.hospital.hospital_id})

    def view_dashboard(self) -> dict:
        return self.hospital.to_dict()


# ---------------------------------------------------------------------
# Trip  (the Exp 10 sequence-diagram / Exp 8 activity-diagram state
# machine: SRS "Patient Session" entity, extended with the explicit
# ReroutePending state the refactor brief asks for)
# ---------------------------------------------------------------------
class Trip:
    """
    States: Green -> Yellow -> Red -> ReroutePending -> Diverted
                                   \\-> Red (override, debounced) -/

    - A Red vital reading only PROPOSES a reroute (propose_reroute);
      it never changes `destination_hospital_id` by itself.
    - `destination_hospital_id` / `route` change only inside
      confirm_reroute(), which is only reachable via Driver.accept_reroute().
    - Edge Case 3 (oscillating vitals): once a proposal is pending, or
      once the trip has already diverted, or during the post-override
      debounce window, propose_reroute() is a no-op (logged, not spammed).
    """

    DEBOUNCE_SECONDS = 25

    def __init__(self, trip_id: str, vehicle: Ambulance, patient: Patient,
                 destination_hospital_id: str, route: dict):
        self.trip_id = trip_id
        self.vehicle = vehicle
        self.patient = patient
        self.destination_hospital_id = destination_hospital_id
        self.route = route
        self.state = "Green"
        self.diverted = False
        self.pending_proposal: Optional[dict] = None
        self.last_vitals: Optional[VitalTelemetry] = None
        self.last_override_at: Optional[float] = None
        self.start_time = time.time()
        vehicle.trip_id = trip_id

    # -- vitals -----------------------------------------------------
    def ingest_vitals(self, vitals: VitalTelemetry) -> str:
        vitals.evaluate_thresholds()
        self.last_vitals = vitals
        self.patient.update_triage(vitals.risk_level)
        if self.pending_proposal is None and not self.diverted:
            self.state = vitals.risk_level
        db.insert_vital(self.trip_id, vitals.hr, vitals.spo2, vitals.systolic_bp,
                         vitals.diastolic_bp, vitals.resp_rate, vitals.risk_level)
        db.update_session_risk(self.trip_id, vitals.risk_level)
        db.update_trip_state(self.trip_id, self.state, triage_level=self.patient.triage_level)
        return vitals.risk_level

    # -- reroute workflow (requirement 2 + edge cases 1 & 3) ----------
    def can_propose_reroute(self) -> bool:
        if self.pending_proposal is not None:
            return False
        if self.diverted:
            return False
        if self.last_override_at and (time.time() - self.last_override_at) < self.DEBOUNCE_SECONDS:
            return False
        return True

    def propose_reroute(self, route_engine: RouteEngine, hospitals: Dict[str, Hospital], force: bool = False) -> Optional[dict]:
        if not force and not self.can_propose_reroute():
            if self.last_vitals:
                AuditLog.reroute_debounced(self.trip_id, self.vehicle.vehicle_id, self.last_vitals)
            return None
        if force and self.pending_proposal is not None:
            return None  # a decision is already awaited; don't overwrite it mid-flight

        ranked = route_engine.find_fallback_hospital(
            self.vehicle.current_location, hospitals,
            required_equipment=self.patient.required_equipment,
            exclude=[self.destination_hospital_id],
        )
        if not ranked:
            AuditLog.no_hospital_available(self.trip_id, self.vehicle.vehicle_id)
            return None

        best = ranked[0]
        self.pending_proposal = {
            "hospital_id": best["hospital_id"],
            "hospital_name": best["hospital"].name,
            "route": best["route"],
            "eta_minutes": best["eta_minutes"],
            "proposed_at": time.time(),
            "candidates": [{"hospital_id": r["hospital_id"], "eta_minutes": r["eta_minutes"]} for r in ranked],
        }
        self.state = "ReroutePending"
        self.vehicle.set_status("Reroute-Pending")
        db.update_trip_state(self.trip_id, self.state)
        AuditLog.reroute_proposed(self.trip_id, self.vehicle.vehicle_id, best["hospital_id"], best["eta_minutes"])
        return self.pending_proposal

    def confirm_reroute(self) -> Optional[dict]:
        if not self.pending_proposal:
            return None
        proposal = self.pending_proposal
        self.destination_hospital_id = proposal["hospital_id"]
        self.route = proposal["route"]
        self.diverted = True
        self.state = "Diverted"
        self.pending_proposal = None
        self.vehicle.set_status("Diverted-En-Route")
        db.update_trip_state(self.trip_id, self.state, diverted_flag=True,
                              destination_hospital_id=proposal["hospital_id"])
        return proposal

    def override_reroute(self, reason: str = "Driver override") -> dict:
        snapshot = self.pending_proposal
        self.pending_proposal = None
        self.last_override_at = time.time()
        self.state = self.last_vitals.risk_level if self.last_vitals else "Green"
        self.vehicle.set_status("En-Route")
        db.update_trip_state(self.trip_id, self.state)
        return {"declined_hospital_id": snapshot["hospital_id"] if snapshot else None, "reason": reason}

    def to_dict(self) -> dict:
        return {
            "trip_id": self.trip_id,
            "session_id": self.trip_id,  # backward-compat alias used by the first prototype's frontend
            "vehicle_id": self.vehicle.vehicle_id,
            "patient": self.patient.to_dict(),
            "destination_hospital_id": self.destination_hospital_id,
            "route": self.route,
            "risk_level": self.last_vitals.risk_level if self.last_vitals else "Green",
            "state": self.state,
            "diverted": self.diverted,
            "pending_reroute": self.pending_proposal,
            "last_vitals": self.last_vitals.to_dict() if self.last_vitals else None,
        }
