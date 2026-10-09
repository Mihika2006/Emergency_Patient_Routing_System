"""
Domain models strictly matching Section 5 (Class Diagram) of the SE Project Report.
Contains exactly the 10 domain classes defined in the report.
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import math


class Person:
    """Base class for project actors (Report Fig. 5)."""
    def __init__(self, personId: str, name: str, phone: str):
        self.personId: str = personId
        self.name: str = name
        self.phone: str = phone

    def to_dict(self) -> dict:
        return {"personId": self.personId, "name": self.name, "phone": self.phone}


class Paramedic(Person):
    """Paramedic operator (Report Fig. 5)."""
    def __init__(self, personId: str, name: str, phone: str, badgeNumber: str, certificationLevel: str):
        super().__init__(personId, name, phone)
        self.badgeNumber: str = badgeNumber
        self.certificationLevel: str = certificationLevel

    def connectSensor(self, sensor: "BLESensor") -> bool:
        return sensor.scanDevices() and sensor.connectionStatus == "Connected"

    def enterManualVitals(self, heartRate: int, spO2: int, systolicBP: int) -> "PatientVitals":
        vitals = PatientVitals(
            recordId=f"MANUAL-{int(datetime.utcnow().timestamp())}",
            heartRate=heartRate,
            spO2=spO2,
            systolicBP=systolicBP,
            timestamp=datetime.utcnow().isoformat(),
        )
        vitals.normalizeData()
        vitals.evaluateThresholds()
        return vitals

    def triggerManualReroute(self, reason: str = "Clinical Deterioration") -> dict:
        return {"manualOverride": True, "reason": reason, "timestamp": datetime.utcnow().isoformat()}


class Driver(Person):
    """Ambulance driver (Report Fig. 5)."""
    def __init__(self, personId: str, name: str, phone: str, driverLicenseId: str, shiftStatus: str = "On Duty"):
        super().__init__(personId, name, phone)
        self.driverLicenseId: str = driverLicenseId
        self.shiftStatus: str = shiftStatus

    def acceptReroute(self, routeId: str) -> dict:
        return {"action": "ACCEPTED", "routeId": routeId, "timestamp": datetime.utcnow().isoformat()}

    def declineReroute(self, routeId: str) -> dict:
        return {"action": "DECLINED", "routeId": routeId, "timestamp": datetime.utcnow().isoformat()}


class HospitalStaff(Person):
    """Emergency room staff (Report Fig. 5)."""
    def __init__(self, personId: str, name: str, phone: str, staffId: str, department: str = "Emergency"):
        super().__init__(personId, name, phone)
        self.staffId: str = staffId
        self.department: str = department

    def viewDashboard(self, hospitalId: str, telemetryData: dict) -> dict:
        return {"hospitalId": hospitalId, "telemetry": telemetryData, "viewedAt": datetime.utcnow().isoformat()}

    def acknowledgeAlert(self, alertId: str) -> dict:
        return {"alertId": alertId, "acknowledged": True, "timestamp": datetime.utcnow().isoformat()}


class Ambulance:
    """Ambulance vehicle entity (Report Fig. 5)."""
    def __init__(
        self,
        vehicleId: str,
        licensePlate: str,
        currentLat: float,
        currentLong: float,
        status: str = "Stationary",
    ):
        self.vehicleId: str = vehicleId
        self.licensePlate: str = licensePlate
        self.currentLat: float = float(currentLat)
        self.currentLong: float = float(currentLong)
        self.status: str = status

    def updateLocation(self, lat: float, lng: float) -> None:
        self.currentLat = float(lat)
        self.currentLong = float(lng)

    def getCurrentCoords(self) -> Tuple[float, float]:
        return (self.currentLat, self.currentLong)

    def to_dict(self) -> dict:
        return {
            "vehicleId": self.vehicleId,
            "licensePlate": self.licensePlate,
            "currentLat": self.currentLat,
            "currentLong": self.currentLong,
            "status": self.status,
        }


class BLESensor:
    """BLE Patient Sensor (Report Fig. 5 & Fig. 6)."""
    def __init__(
        self,
        deviceId: str,
        deviceType: str = "PulseOximeter_BP",
        batteryLevel: str = "98%",
        connectionStatus: str = "Disconnected",
    ):
        self.deviceId: str = deviceId
        self.deviceType: str = deviceType
        self.batteryLevel: str = batteryLevel
        self.connectionStatus: str = connectionStatus

    def scanDevices(self) -> bool:
        self.connectionStatus = "Scanning"
        self.connectionStatus = "Connecting"
        self.connectionStatus = "Streaming"
        return True

    def readRawPacket(self, hexString: str) -> bytes:
        return bytes.fromhex(hexString.replace(" ", ""))

    def validateChecksum(self, packet: bytes) -> bool:
        if len(packet) < 2:
            return False
        calc = sum(packet[:-1]) & 0xFF
        return calc == packet[-1]


class PatientVitals:
    """Patient Telemetry Vitals & Evaluation (Report Fig. 5, Fig. 7)."""
    def __init__(
        self,
        recordId: str,
        heartRate: int,
        spO2: int,
        systolicBP: int,
        timestamp: Optional[str] = None,
        isCritical: bool = False,
    ):
        self.recordId: str = recordId
        self.heartRate: int = int(heartRate)
        self.spO2: int = int(spO2)
        self.systolicBP: int = int(systolicBP)
        self.timestamp: str = timestamp or datetime.utcnow().isoformat()
        self.isCritical: bool = isCritical

    def parseHexData(self, hexString: str) -> dict:
        raw = bytes.fromhex(hexString.replace(" ", ""))
        if len(raw) >= 3:
            self.heartRate = int(raw[0])
            self.spO2 = int(raw[1])
            self.systolicBP = int(raw[2])
        return {"heartRate": self.heartRate, "spO2": self.spO2, "systolicBP": self.systolicBP}

    def normalizeData(self) -> None:
        self.heartRate = max(30, min(240, self.heartRate))
        self.spO2 = max(50, min(100, self.spO2))
        self.systolicBP = max(50, min(250, self.systolicBP))

    def evaluateThresholds(self, hrMax: int = 120, spo2Min: int = 90, bpMax: int = 180) -> bool:
        if self.spO2 < spo2Min or self.heartRate > hrMax or self.systolicBP > bpMax:
            self.isCritical = True
        else:
            self.isCritical = False
        return self.isCritical

    def to_dict(self) -> dict:
        return {
            "recordId": self.recordId,
            "heartRate": self.heartRate,
            "spO2": self.spO2,
            "systolicBP": self.systolicBP,
            "timestamp": self.timestamp,
            "isCritical": self.isCritical,
        }


class RouteEngine:
    """Graph Routing and Dynamic Pathfinding (Report Fig. 5, Fig. 6)."""
    def __init__(
        self,
        routeId: str,
        originCoords: Tuple[float, float],
        destinationCoords: Tuple[float, float],
        estimatedTime: str = "0 mins",
    ):
        self.routeId: str = routeId
        self.originCoords: Tuple[float, float] = originCoords
        self.destinationCoords: Tuple[float, float] = destinationCoords
        self.estimatedTime: str = estimatedTime

    def fetchTrafficSpeeds(self, baseSpeedKmph: float = 40.0, congestionFactor: float = 1.0) -> float:
        return max(10.0, baseSpeedKmph * congestionFactor)

    def computeDijkstraPath(self, graph: dict, startNode: str, goalNode: str) -> Tuple[List[str], float]:
        import heapq
        queue: List[Tuple[float, str, List[str]]] = [(0.0, startNode, [startNode])]
        visited: Dict[str, float] = {}

        while queue:
            (cost, current, path) = heapq.heappop(queue)
            if current in visited and visited[current] <= cost:
                continue
            visited[current] = cost
            if current == goalNode:
                self.estimatedTime = f"{round(cost, 1)} mins"
                return path, cost

            for neighbor, weight in graph.get(current, {}).items():
                if neighbor not in visited:
                    heapq.heappush(queue, (cost + weight, neighbor, path + [neighbor]))
        return [], float("inf")

    def generatePolyline(self, coordinates: List[Tuple[float, float]]) -> List[List[float]]:
        return [[lat, lng] for lat, lng in coordinates]


class Equipment:
    """Hospital Medical Equipment (Report Fig. 5, Fig. 10)."""
    def __init__(self, equipmentId: str, type: str, status: str = "Operational"):
        self.equipmentId: str = equipmentId
        self.type: str = type
        self.status: str = status

    def isOperational(self) -> bool:
        return self.status.lower() == "operational"

    def to_dict(self) -> dict:
        return {"equipmentId": self.equipmentId, "type": self.type, "status": self.status}


class Hospital:
    """Hospital facility entity (Report Fig. 5, Fig. 8)."""
    def __init__(
        self,
        hospitalId: str,
        name: str,
        locationLat: float,
        locationLong: float,
        icuBedsAvailable: int,
        equipmentList: Optional[List[Equipment]] = None,
    ):
        self.hospitalId: str = hospitalId
        self.name: str = name
        self.locationLat: float = float(locationLat)
        self.locationLong: float = float(locationLong)
        self.icuBedsAvailable: int = int(icuBedsAvailable)
        self.equipmentList: List[Equipment] = equipmentList or []

    def checkICUCapacity(self) -> bool:
        return self.icuBedsAvailable > 0

    def verifyEquipment(self, requiredType: str) -> bool:
        for eq in self.equipmentList:
            if eq.type.lower() == requiredType.lower() and eq.isOperational():
                return True
        return False

    def to_dict(self) -> dict:
        return {
            "hospitalId": self.hospitalId,
            "name": self.name,
            "locationLat": self.locationLat,
            "locationLong": self.locationLong,
            "icuBedsAvailable": self.icuBedsAvailable,
            "equipment": [eq.to_dict() for eq in self.equipmentList],
        }
