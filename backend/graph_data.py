"""
Pre-seeded regional topological road graph and emergency facility database.
Expanded to 10 major tertiary hospitals across the Indore Urban Metropolitan Area.
"""

from typing import Dict, List, Tuple

NODES: Dict[str, Dict[str, object]] = {
    # Central & South Corridors
    "A": {"lat": 22.7196, "lng": 75.8577, "label": "Rajwada / Central Indore"},
    "B": {"lat": 22.7247, "lng": 75.8528, "label": "MG Road / Regal Square"},
    "C": {"lat": 22.7305, "lng": 75.8469, "label": "Palasia Junction"},
    "D": {"lat": 22.7141, "lng": 75.8577, "label": "MY Hospital Trauma Node"},
    "E": {"lat": 22.7072, "lng": 75.8664, "label": "Bhawarkua Square"},
    
    # Eastern & Northern Hubs
    "F": {"lat": 22.7533, "lng": 75.8937, "label": "Vijay Nagar Square"},
    "G": {"lat": 22.7170, "lng": 75.8880, "label": "Geeta Bhawan / AB Road"},
    "H": {"lat": 22.7502, "lng": 75.8668, "label": "Bengali Square"},
    "I": {"lat": 22.7410, "lng": 75.8820, "label": "LIG Square / AB Road"},
    "J": {"lat": 22.7600, "lng": 75.8900, "label": "Bombay Hospital Node"},
    "K": {"lat": 22.7167, "lng": 75.8892, "label": "Khajrana Junction"},
    "L": {"lat": 22.7358, "lng": 75.8955, "label": "Ring Road Scheme 140"},
    "M": {"lat": 22.7510, "lng": 75.8980, "label": "Medanta Super Specialty Node"},

    # Extended Radial Road Intersections
    "N": {"lat": 22.7425, "lng": 75.8910, "label": "Anoop Nagar Junction"},
    "O": {"lat": 22.7680, "lng": 75.9050, "label": "Indore Bypass / MR-10 Hub"},
    "P": {"lat": 22.6850, "lng": 75.8420, "label": "Manik Bagh / Manikbagh Road"},
    "Q": {"lat": 22.7750, "lng": 75.9200, "label": "Nemawar Road / Index Node"},
    "R": {"lat": 22.7380, "lng": 75.8650, "label": "Old Palasia / Janjeerwala"},
    "S": {"lat": 22.6980, "lng": 75.8580, "label": "Tower Square / Khatiwala Tank"},
    "T": {"lat": 22.7100, "lng": 75.8810, "label": "Old AB Road / Palasia Hub"},
}

GRAPH_NODES = NODES

# Bidirectional edges: (node_1, node_2, distance_km, speed_kmh)
EDGES: List[Tuple[str, str, float, float]] = [
    ("A", "B", 1.2, 35.0),
    ("A", "D", 0.9, 30.0),
    ("A", "S", 1.6, 35.0),
    ("B", "C", 1.4, 40.0),
    ("B", "D", 1.1, 35.0),
    ("C", "R", 1.0, 40.0),
    ("C", "G", 1.5, 40.0),
    ("D", "G", 1.8, 35.0),
    ("D", "S", 1.3, 30.0),
    ("E", "S", 1.2, 35.0),
    ("E", "P", 2.1, 40.0),
    ("G", "T", 1.0, 40.0),
    ("G", "K", 2.2, 45.0),
    ("R", "I", 1.7, 45.0),
    ("I", "F", 1.8, 45.0),
    ("I", "N", 1.1, 40.0),
    ("F", "J", 1.2, 40.0),
    ("F", "M", 1.5, 45.0),
    ("F", "O", 2.8, 55.0),
    ("J", "O", 2.2, 50.0),
    ("M", "O", 2.4, 50.0),
    ("N", "H", 1.9, 45.0),
    ("H", "L", 2.1, 45.0),
    ("H", "K", 2.0, 40.0),
    ("L", "K", 2.5, 45.0),
    ("L", "Q", 4.2, 55.0),
    ("K", "Q", 5.0, 50.0),
    ("P", "S", 1.8, 35.0),
    ("T", "H", 2.4, 40.0),
]

ROAD_EDGES = EDGES

# 10 Hospitals registered with verified locations and clinical capabilities
HOSPITALS: Dict[str, Dict[str, object]] = {
    "H1": {
        "id": "H1",
        "hospital_id": "H1",
        "name": "MY Hospital (MGM Medical College)",
        "lat": NODES["D"]["lat"],
        "lng": NODES["D"]["lng"],
        "node": "D",
        "trauma_level": "Level I",
        "status": "Ready",
        "capability": "MICU",
        "icu_beds": 14,
        "icu_beds_available": 14,
        "cath_lab": True,
        "cath_lab_available": True,
        "ventilator": True,
        "ventilator_available": True,
    },
    "H2": {
        "id": "H2",
        "hospital_id": "H2",
        "name": "Bombay Hospital Indore",
        "lat": NODES["J"]["lat"],
        "lng": NODES["J"]["lng"],
        "node": "J",
        "trauma_level": "Level I",
        "status": "Ready",
        "capability": "ALS",
        "icu_beds": 10,
        "icu_beds_available": 10,
        "cath_lab": True,
        "cath_lab_available": True,
        "ventilator": True,
        "ventilator_available": True,
    },
    "H3": {
        "id": "H3",
        "hospital_id": "H3",
        "name": "Medanta Super Specialty Hospital",
        "lat": NODES["M"]["lat"],
        "lng": NODES["M"]["lng"],
        "node": "M",
        "trauma_level": "Level I",
        "status": "Ready",
        "capability": "MICU",
        "icu_beds": 12,
        "icu_beds_available": 12,
        "cath_lab": True,
        "cath_lab_available": True,
        "ventilator": True,
        "ventilator_available": True,
    },
    "H4": {
        "id": "H4",
        "hospital_id": "H4",
        "name": "CHL Hospital Indore",
        "lat": NODES["N"]["lat"],
        "lng": NODES["N"]["lng"],
        "node": "N",
        "trauma_level": "Level II",
        "status": "Ready",
        "capability": "ALS",
        "icu_beds": 8,
        "icu_beds_available": 8,
        "cath_lab": True,
        "cath_lab_available": True,
        "ventilator": True,
        "ventilator_available": True,
    },
    "H5": {
        "id": "H5",
        "hospital_id": "H5",
        "name": "Apollo Hospitals Indore (Vijay Nagar)",
        "lat": NODES["F"]["lat"],
        "lng": NODES["F"]["lng"],
        "node": "F",
        "trauma_level": "Level I",
        "status": "Ready",
        "capability": "MICU",
        "icu_beds": 11,
        "icu_beds_available": 11,
        "cath_lab": True,
        "cath_lab_available": True,
        "ventilator": True,
        "ventilator_available": True,
    },
    "H6": {
        "id": "H6",
        "hospital_id": "H6",
        "name": "Choithram Hospital & Research Centre",
        "lat": NODES["P"]["lat"],
        "lng": NODES["P"]["lng"],
        "node": "P",
        "trauma_level": "Level I",
        "status": "Ready",
        "capability": "MICU",
        "icu_beds": 9,
        "icu_beds_available": 9,
        "cath_lab": True,
        "cath_lab_available": True,
        "ventilator": True,
        "ventilator_available": True,
    },
    "H7": {
        "id": "H7",
        "hospital_id": "H7",
        "name": "Shalby Multi-Specialty Hospital",
        "lat": NODES["R"]["lat"],
        "lng": NODES["R"]["lng"],
        "node": "R",
        "trauma_level": "Level II",
        "status": "Ready",
        "capability": "MICU",
        "icu_beds": 6,
        "icu_beds_available": 6,
        "cath_lab": False,
        "cath_lab_available": False,
        "ventilator": True,
        "ventilator_available": True,
    },
    "H8": {
        "id": "H8",
        "hospital_id": "H8",
        "name": "Apple Hospital (Bhawarkua)",
        "lat": NODES["E"]["lat"],
        "lng": NODES["E"]["lng"],
        "node": "E",
        "trauma_level": "Level III",
        "status": "Ready",
        "capability": "BLS",
        "icu_beds": 4,
        "icu_beds_available": 4,
        "cath_lab": False,
        "cath_lab_available": False,
        "ventilator": True,
        "ventilator_available": True,
    },
    "H9": {
        "id": "H9",
        "hospital_id": "H9",
        "name": "Greater Kailash Hospital",
        "lat": NODES["T"]["lat"],
        "lng": NODES["T"]["lng"],
        "node": "T",
        "trauma_level": "Level II",
        "status": "Ready",
        "capability": "ALS",
        "icu_beds": 5,
        "icu_beds_available": 5,
        "cath_lab": True,
        "cath_lab_available": True,
        "ventilator": False,
        "ventilator_available": False,
    },
    "H10": {
        "id": "H10",
        "hospital_id": "H10",
        "name": "Index Medical College Hospital (Bypass)",
        "lat": NODES["Q"]["lat"],
        "lng": NODES["Q"]["lng"],
        "node": "Q",
        "trauma_level": "Level II",
        "status": "Ready",
        "capability": "ALS",
        "icu_beds": 7,
        "icu_beds_available": 7,
        "cath_lab": False,
        "cath_lab_available": False,
        "ventilator": True,
        "ventilator_available": True,
    },
}

HOSPITAL_NODES: Dict[str, str] = {
    hid: hdata["node"] for hid, hdata in HOSPITALS.items()
}

ADJACENCY: Dict[str, List[Tuple[str, float, float]]] = {
    node: [] for node in NODES
}
for u, v, distance_km, speed_kmh in EDGES:
    ADJACENCY[u].append((v, distance_km, speed_kmh))
    ADJACENCY[v].append((u, distance_km, speed_kmh))

def build_adjacency_list() -> Dict[str, List[Tuple[str, float, float]]]:
    return ADJACENCY

def build_adjacency() -> Dict[str, List[Tuple[str, float, float]]]:
    return ADJACENCY