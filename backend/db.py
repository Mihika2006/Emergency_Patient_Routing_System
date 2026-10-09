import json
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "ret_rp.db"
DB_PATH.parent.mkdir(exist_ok=True)


def get_conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS vehicle (
    vehicle_id      TEXT PRIMARY KEY,
    fleet_type      TEXT NOT NULL,              -- Public / Private
    capability_tier TEXT NOT NULL,              -- BLS / ALS / MICU
    device_token    TEXT,
    status          TEXT DEFAULT 'Available',   -- Available / En-Route / Diverted
    driver_name     TEXT,
    current_lat     REAL,
    current_lng     REAL,
    current_node    TEXT,
    created_at      REAL
);

CREATE TABLE IF NOT EXISTS patient_session (
    session_id       TEXT PRIMARY KEY,
    vehicle_id       TEXT REFERENCES vehicle(vehicle_id),
    start_time       REAL,
    end_time         REAL,
    initial_condition TEXT,
    destination_hospital_id TEXT,
    risk_level       TEXT DEFAULT 'Green',        -- Green / Yellow / Red
    patient_id       TEXT,
    patient_name     TEXT,
    age              INTEGER,
    gender           TEXT,
    chief_complaint  TEXT,
    triage_level     TEXT DEFAULT 'Stable',
    required_equipment TEXT DEFAULT '[]',          -- JSON list, e.g. ["cath_lab"]
    trip_state       TEXT DEFAULT 'Green',          -- Trip state machine: Green/Yellow/Red/ReroutePending/Diverted
    diverted_flag    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vital_log (
    vital_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT REFERENCES patient_session(session_id),
    timestamp       REAL,
    heart_rate      REAL,
    spo2            REAL,
    systolic_bp     REAL,
    diastolic_bp    REAL,
    respiratory_rate REAL,
    risk_level      TEXT
);

CREATE TABLE IF NOT EXISTS hospital (
    hospital_id       TEXT PRIMARY KEY,
    name              TEXT,
    location_lat      REAL,
    location_lng      REAL,
    trauma_level      TEXT,
    icu_beds_available INTEGER,
    cath_lab_available INTEGER,
    ventilator_available INTEGER,
    current_status    TEXT
);

CREATE TABLE IF NOT EXISTS route_log (
    route_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id        TEXT REFERENCES patient_session(session_id),
    primary_path_geometry TEXT,   -- JSON
    fallback_hospital_ids TEXT,   -- JSON list
    active_diverted_flag INTEGER DEFAULT 0,
    last_calculated_timestamp REAL
);

CREATE TABLE IF NOT EXISTS audit_log (
    audit_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp    REAL,
    event_type   TEXT,     -- e.g. REROUTE, THRESHOLD_ALERT, DRIVER_CONFIRM
    session_id   TEXT,
    vehicle_id   TEXT,
    details      TEXT      -- JSON
);
"""


def init_db(seed_hospitals=None):
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.commit()
    if seed_hospitals:
        cur = conn.cursor()
        for h in seed_hospitals:
            cur.execute(
                """INSERT OR IGNORE INTO hospital
                   (hospital_id, name, location_lat, location_lng, trauma_level,
                    icu_beds_available, cath_lab_available, ventilator_available, current_status)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    h["hospital_id"], h["name"], h.get("lat"), h.get("lng"),
                    h.get("trauma_level"), h.get("icu_beds_available", 0),
                    int(h.get("cath_lab_available", False)),
                    int(h.get("ventilator_available", False)),
                    h.get("status", "Ready"),
                ),
            )
        conn.commit()
    conn.close()


def create_patient_session(session_id, vehicle_id, initial_condition, destination_hospital_id,
                            patient_id=None, patient_name=None, age=None, gender=None,
                            chief_complaint=None, triage_level="Stable", required_equipment=None):
    conn = get_conn()
    conn.execute(
        """INSERT INTO patient_session
           (session_id, vehicle_id, start_time, initial_condition, destination_hospital_id, risk_level,
            patient_id, patient_name, age, gender, chief_complaint, triage_level, required_equipment,
            trip_state, diverted_flag)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (session_id, vehicle_id, time.time(), initial_condition, destination_hospital_id, "Green",
         patient_id, patient_name, age, gender, chief_complaint, triage_level,
         json.dumps(required_equipment or []), "Green", 0),
    )
    conn.commit()
    conn.close()


def update_session_risk(session_id, risk_level, diverted=None, destination_hospital_id=None):
    conn = get_conn()
    if diverted is not None and destination_hospital_id is not None:
        conn.execute(
            "UPDATE patient_session SET risk_level=?, destination_hospital_id=? WHERE session_id=?",
            (risk_level, destination_hospital_id, session_id),
        )
    else:
        conn.execute(
            "UPDATE patient_session SET risk_level=? WHERE session_id=?",
            (risk_level, session_id),
        )
    conn.commit()
    conn.close()


def update_trip_state(session_id, trip_state, diverted_flag=None, destination_hospital_id=None, triage_level=None):
    """Persist the Trip state machine."""
    conn = get_conn()
    fields, params = ["trip_state=?"], [trip_state]
    if diverted_flag is not None:
        fields.append("diverted_flag=?"); params.append(int(diverted_flag))
    if destination_hospital_id is not None:
        fields.append("destination_hospital_id=?"); params.append(destination_hospital_id)
    if triage_level is not None:
        fields.append("triage_level=?"); params.append(triage_level)
    params.append(session_id)
    conn.execute(f"UPDATE patient_session SET {', '.join(fields)} WHERE session_id=?", params)
    conn.commit()
    conn.close()


def sync_hospital(hospital_id, icu_beds_available=None, cath_lab_available=None,
                   ventilator_available=None, current_status=None):
    """Persist mutations made through models.Hospital."""
    conn = get_conn()
    fields, params = [], []
    if icu_beds_available is not None:
        fields.append("icu_beds_available=?"); params.append(icu_beds_available)
    if cath_lab_available is not None:
        fields.append("cath_lab_available=?"); params.append(int(cath_lab_available))
    if ventilator_available is not None:
        fields.append("ventilator_available=?"); params.append(int(ventilator_available))
    if current_status is not None:
        fields.append("current_status=?"); params.append(current_status)
    if not fields:
        conn.close()
        return
    params.append(hospital_id)
    conn.execute(f"UPDATE hospital SET {', '.join(fields)} WHERE hospital_id=?", params)
    conn.commit()
    conn.close()


def log_audit(event_type: str, session_id: str = None, vehicle_id: str = None, details: dict = None):
    conn = get_conn()
    conn.execute(
        "INSERT INTO audit_log (timestamp, event_type, session_id, vehicle_id, details) VALUES (?,?,?,?,?)",
        (time.time(), event_type, session_id, vehicle_id, json.dumps(details or {})),
    )
    conn.commit()
    conn.close()


def insert_vital(session_id, hr, spo2, sbp, dbp, rr, risk_level):
    conn = get_conn()
    conn.execute(
        """INSERT INTO vital_log (session_id, timestamp, heart_rate, spo2,
           systolic_bp, diastolic_bp, respiratory_rate, risk_level)
           VALUES (?,?,?,?,?,?,?,?)""",
        (session_id, time.time(), hr, spo2, sbp, dbp, rr, risk_level),
    )
    conn.commit()
    conn.close()


def upsert_vehicle(vehicle_id, fleet_type, capability_tier, driver_name):
    conn = get_conn()
    conn.execute(
        """INSERT INTO vehicle (vehicle_id, fleet_type, capability_tier, driver_name, created_at)
           VALUES (?,?,?,?,?)
           ON CONFLICT(vehicle_id) DO UPDATE SET
             fleet_type=excluded.fleet_type,
             capability_tier=excluded.capability_tier,
             driver_name=excluded.driver_name""",
        (vehicle_id, fleet_type, capability_tier, driver_name, time.time()),
    )
    conn.commit()
    conn.close()


def update_vehicle_position(vehicle_id, lat, lng, node, status=None):
    conn = get_conn()
    if status:
        conn.execute(
            "UPDATE vehicle SET current_lat=?, current_lng=?, current_node=?, status=? WHERE vehicle_id=?",
            (lat, lng, node, status, vehicle_id),
        )
    else:
        conn.execute(
            "UPDATE vehicle SET current_lat=?, current_lng=?, current_node=? WHERE vehicle_id=?",
            (lat, lng, node, vehicle_id),
        )
    conn.commit()
    conn.close()


def save_route(session_id, path_geometry, fallback_ids, diverted=False):
    conn = get_conn()
    conn.execute(
        """INSERT INTO route_log (session_id, primary_path_geometry, fallback_hospital_ids,
           active_diverted_flag, last_calculated_timestamp) VALUES (?,?,?,?,?)""",
        (session_id, json.dumps(path_geometry), json.dumps(fallback_ids), int(diverted), time.time()),
    )
    conn.commit()
    conn.close()


def get_recent_vitals(session_id, limit=20):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM vital_log WHERE session_id=? ORDER BY timestamp DESC LIMIT ?",
        (session_id, limit),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_audit_trail(limit=100):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
