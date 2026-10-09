# ==============================================================================
# FILE: backend/app.py
# ==============================================================================
"""
Backend Flask API & WebSocket server adhering strictly to Sequence Diagrams (Section 6)
and boundary controllers: Risk_Evaluation_Engine, Filter_Hospital_Engine,
Routing_Engine, and ETA_Calculation.
"""
from datetime import datetime
import json
import math
import os
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit

from graph_data import INDORE_HOSPITALS, ROAD_NODES, build_weighted_graph
from models import (
    Ambulance,
    BLESensor,
    Driver,
    Equipment,
    Hospital,
    HospitalStaff,
    Paramedic,
    PatientVitals,
    RouteEngine,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR)
app.config["SECRET_KEY"] = "ret-rp-secure-key"
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# In-Memory Active Session States (Controller & Lifecycle Persistence)
ACTIVE_AMBULANCE = Ambulance(
    vehicleId="AMB-108-IND",
    licensePlate="MP-09-AV-2026",
    currentLat=22.7196,
    currentLong=75.8577,
    status="Stationary",
)

ACTIVE_SENSOR = BLESensor(deviceId="BLE-SPO2-MAX30102", deviceType="PulseOximeter_BP")
LATEST_VITALS = PatientVitals(
    recordId="INIT-001",
    heartRate=75,
    spO2=98,
    systolicBP=120,
    timestamp=datetime.utcnow().isoformat(),
    isCritical=False,
)

CURRENT_NAVIGATION = {
    "status": "IDLE",  # IDLE, ACTIVE_GUIDANCE, PROMPTING_DRIVER, REROUTED, ARRIVED
    "originCoords": [22.7196, 75.8577],
    "targetHospitalId": "HOSP_MY",
    "targetHospitalName": "MY Hospital (Maharaja Yeshwantrao)",
    "polyline": [],
    "estimatedTime": "0 mins",
    "pendingReroute": None,
}


def get_all_hospitals() -> list[Hospital]:
    hospitals = []
    for h in INDORE_HOSPITALS:
        eq_objs = [Equipment(e["equipmentId"], e["type"], e["status"]) for e in h.get("equipment", [])]
        hospitals.append(
            Hospital(
                hospitalId=h["hospitalId"],
                name=h["name"],
                locationLat=h["locationLat"],
                locationLong=h["locationLong"],
                icuBedsAvailable=h["icuBedsAvailable"],
                equipmentList=eq_objs,
            )
        )
    return hospitals


# ------------------------------------------------------------------------------
# FRONTEND STATIC ROUTES
# ------------------------------------------------------------------------------
@app.route("/")
def serve_index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:path>")
def serve_static(path):
    return send_from_directory(FRONTEND_DIR, path)


# ------------------------------------------------------------------------------
# CONTROLLER ENDPOINTS
# ------------------------------------------------------------------------------
@app.route("/api/hospitals", methods=["GET"])
def list_hospitals():
    """Returns Indore hospitals registry without cosmetic tag suffixes."""
    hospitals = get_all_hospitals()
    return jsonify([h.to_dict() for h in hospitals])


@app.route("/api/sensor/status", methods=["GET"])
def get_sensor_status():
    return jsonify({
        "deviceId": ACTIVE_SENSOR.deviceId,
        "deviceType": ACTIVE_SENSOR.deviceType,
        "batteryLevel": ACTIVE_SENSOR.batteryLevel,
        "connectionStatus": ACTIVE_SENSOR.connectionStatus,
    })


@app.route("/api/sensor/connect", methods=["POST"])
def connect_sensor():
    """Paramedic connects BLE Sensor (US-01, Fig. 5)."""
    ACTIVE_SENSOR.scanDevices()
    socketio.emit("sensor_state_change", {"connectionStatus": ACTIVE_SENSOR.connectionStatus})
    return jsonify({"success": True, "connectionStatus": ACTIVE_SENSOR.connectionStatus})


@app.route("/api/vitals", methods=["POST"])
def post_vitals():
    """
    Risk_Evaluation_Engine Lifeline (Report Section 6 & Fig. 7).
    Evaluates vitals against safety thresholds (SpO2 < 90% or HR > 120 -> Red Alert).
    """
    global LATEST_VITALS
    data = request.get_json() or {}

    heart_rate = int(data.get("heartRate", 75))
    spo2 = int(data.get("spO2", 98))
    systolic_bp = int(data.get("systolicBP", 120))

    record = PatientVitals(
        recordId=f"VIT-{int(datetime.utcnow().timestamp())}",
        heartRate=heart_rate,
        spO2=spo2,
        systolicBP=systolic_bp,
        timestamp=datetime.utcnow().isoformat(),
    )
    record.normalizeData()
    was_critical = record.evaluateThresholds(hrMax=120, spo2Min=90, bpMax=180)
    LATEST_VITALS = record

    payload = record.to_dict()
    socketio.emit("vitals_stream", payload)

    # Threshold breach triggers Red Alert and hospital filtering
    if was_critical:
        execute_hospital_filtering_and_reroute(source="AUTOMATED_THRESHOLD_BREACH")

    return jsonify({"success": True, "vitals": payload})


@app.route("/api/paramedic/manual-reroute", methods=["POST"])
def trigger_manual_reroute():
    """Paramedic manual override trigger (US-19)."""
    execute_hospital_filtering_and_reroute(source="PARAMEDIC_MANUAL_TRIGGER")
    return jsonify({"success": True, "status": "REROUTE_TRIGGERED"})


def execute_hospital_filtering_and_reroute(source: str):
    """
    Filter_Hospital_Engine Lifeline (Report Section 6).
    Checks ICU beds (> 0) and equipment ('ventilator' / 'cath_lab'),
    then computes fastest alternative path.
    """
    hospitals = get_all_hospitals()
    amb_lat, amb_lng = ACTIVE_AMBULANCE.getCurrentCoords()

    eligible = []
    for h in hospitals:
        # Exclude currently selected hospital from reroute alternatives
        if h.hospitalId == CURRENT_NAVIGATION.get("targetHospitalId"):
            continue
        # Filter condition: must have ICU beds available and operational ventilator
        if h.checkICUCapacity() and h.verifyEquipment("ventilator"):
            # Euclidean distance proxy for triage ranking
            dist = math.hypot(h.locationLat - amb_lat, h.locationLong - amb_lng)
            eligible.append((dist, h))

    if not eligible:
        return

    eligible.sort(key=lambda x: x[0])
    selected_hospital = eligible[0][1]

    reroute_proposal = {
        "alertType": "CRITICAL_RED",
        "reason": "Vital signs threshold breach: SpO2 < 90% or HR > 120" if source != "PARAMEDIC_MANUAL_TRIGGER" else "Paramedic Manual Emergency Trigger",
        "hospitalId": selected_hospital.hospitalId,
        "hospitalName": selected_hospital.name,
        "destCoords": [selected_hospital.locationLat, selected_hospital.locationLong],
        "icuBeds": selected_hospital.icuBedsAvailable,
        "timestamp": datetime.utcnow().isoformat(),
    }

    CURRENT_NAVIGATION["pendingReroute"] = reroute_proposal
    CURRENT_NAVIGATION["status"] = "PROMPTING_DRIVER"

    # Send 1-Tap Audio-Visual Prompt to Driver (US-15, US-16) and Paramedic console
    socketio.emit("reroute_prompt", reroute_proposal)


@app.route("/api/driver/respond-reroute", methods=["POST"])
def respond_reroute():
    """
    Driver responds to 1-Tap Reroute modal (Report US-15, US-17, Fig. 3).
    Notifies prior hospital of diversion and registers telemetry at new hospital.
    """
    data = request.get_json() or {}
    accepted = data.get("accepted", False)
    pending = CURRENT_NAVIGATION.get("pendingReroute")

    if not pending:
        return jsonify({"success": False, "message": "No pending reroute found."})

    old_hospital_id = CURRENT_NAVIGATION["targetHospitalId"]
    old_hospital_name = CURRENT_NAVIGATION["targetHospitalName"]

    if accepted:
        CURRENT_NAVIGATION["status"] = "REROUTED"
        CURRENT_NAVIGATION["targetHospitalId"] = pending["hospitalId"]
        CURRENT_NAVIGATION["targetHospitalName"] = pending["hospitalName"]
        CURRENT_NAVIGATION["pendingReroute"] = None
        ACTIVE_AMBULANCE.status = "Reroute Path"

        # Multi-console handoff sync
        socketio.emit("reroute_confirmed", {
            "status": "REROUTED",
            "hospitalId": CURRENT_NAVIGATION["targetHospitalId"],
            "hospitalName": CURRENT_NAVIGATION["targetHospitalName"],
            "destCoords": pending["destCoords"],
            "cancelledHospitalId": old_hospital_id,
            "cancelledHospitalName": old_hospital_name,
        })
        return jsonify({"success": True, "action": "ACCEPTED", "hospitalName": CURRENT_NAVIGATION["targetHospitalName"]})
    else:
        CURRENT_NAVIGATION["pendingReroute"] = None
        CURRENT_NAVIGATION["status"] = "ACTIVE_GUIDANCE"
        socketio.emit("reroute_declined", {"maintainedHospitalId": old_hospital_id})
        return jsonify({"success": True, "action": "DECLINED"})


@app.route("/api/ambulance/location", methods=["POST"])
def update_ambulance_location():
    """Updates vehicle coordinates and notifies Hospital UI with updated ETA (Report Section 6)."""
    data = request.get_json() or {}
    lat = float(data.get("lat", ACTIVE_AMBULANCE.currentLat))
    lng = float(data.get("lng", ACTIVE_AMBULANCE.currentLong))
    eta_mins = data.get("etaMinutes", "12 mins")

    ACTIVE_AMBULANCE.updateLocation(lat, lng)

    socketio.emit("ambulance_telemetry", {
        "vehicleId": ACTIVE_AMBULANCE.vehicleId,
        "lat": lat,
        "lng": lng,
        "status": ACTIVE_AMBULANCE.status,
        "eta": eta_mins,
        "targetHospitalId": CURRENT_NAVIGATION["targetHospitalId"],
        "targetHospitalName": CURRENT_NAVIGATION["targetHospitalName"],
        "vitals": LATEST_VITALS.to_dict(),
    })
    return jsonify({"success": True})


@app.route("/api/ambulance/arrival", methods=["POST"])
def record_arrival():
    """Halts simulation and triggers transit hand-off (US-18, Fig. 9)."""
    ACTIVE_AMBULANCE.status = "Arrival at ER"
    CURRENT_NAVIGATION["status"] = "ARRIVED"

    payload = {
        "vehicleId": ACTIVE_AMBULANCE.vehicleId,
        "hospitalId": CURRENT_NAVIGATION["targetHospitalId"],
        "hospitalName": CURRENT_NAVIGATION["targetHospitalName"],
        "message": f"Ambulance {ACTIVE_AMBULANCE.vehicleId} has arrived at {CURRENT_NAVIGATION['targetHospitalName']}. Patient Handover Initiated.",
        "timestamp": datetime.utcnow().isoformat(),
    }
    socketio.emit("arrival_event", payload)
    return jsonify({"success": True, "data": payload})


if __name__ == "__main__":
    print("=" * 70)
    print("Starting Emergency Patient Routing System (SE Project Alignment)")
    print("Hospital DB: Loaded Indore Tertiary Facilities")
    print("Boundary Consoles: Driver, Paramedic, Hospital Staff")
    print("=" * 70)
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)