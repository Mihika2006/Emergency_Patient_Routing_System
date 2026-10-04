"""
graph_data.py
-------------
Defines the road network used by the routing engine.

Since no live GPS/road-network hardware or paid mapping API is wired up for
this demo, we model a small but realistic city road graph ourselves:
  - NODES: intersections / points of interest, each with (lat, lng)
  - EDGES: bidirectional road segments between two nodes, each with a base
    distance (km) and a base free-flow speed (km/h). A live "congestion
    factor" (0.4 - 1.0, simulated) is applied on top of the base speed to
    represent real-time traffic, exactly like the Traffic Service API
    described in the SRS / DFDs.

Coordinates are centered on a fictional downtown grid so the map renders
sensibly in Leaflet without needing any external API key.
"""

# Base coordinates (fictional downtown grid)
BASE_LAT = 21.1702
BASE_LNG = 72.8311

NODES = {
    "N1":  {"lat": BASE_LAT + 0.000, "lng": BASE_LNG + 0.000, "label": "Ambulance Depot"},
    "N2":  {"lat": BASE_LAT + 0.010, "lng": BASE_LNG + 0.004, "label": "Main St & 1st Ave"},
    "N3":  {"lat": BASE_LAT + 0.018, "lng": BASE_LNG + 0.012, "label": "Main St & 2nd Ave"},
    "N4":  {"lat": BASE_LAT + 0.006, "lng": BASE_LNG + 0.018, "label": "River Crossing"},
    "N5":  {"lat": BASE_LAT + 0.024, "lng": BASE_LNG + 0.020, "label": "Market Square"},
    "N6":  {"lat": BASE_LAT - 0.006, "lng": BASE_LNG + 0.010, "label": "South Junction"},
    "N7":  {"lat": BASE_LAT + 0.030, "lng": BASE_LNG + 0.006, "label": "North Bypass"},
    "N8":  {"lat": BASE_LAT + 0.014, "lng": BASE_LNG + 0.026, "label": "East Gate"},
    "H1":  {"lat": BASE_LAT + 0.020, "lng": BASE_LNG + 0.030, "label": "City General Hospital (MICU)"},
    "H2":  {"lat": BASE_LAT - 0.010, "lng": BASE_LNG + 0.022, "label": "St. Anne's Trauma Center (ALS)"},
    "H3":  {"lat": BASE_LAT + 0.034, "lng": BASE_LNG + 0.014, "label": "Riverside Community Hospital (BLS)"},
}

# distance_km: approximate straight-line/road distance; base_speed_kmh: free-flow speed
EDGES = [
    ("N1", "N2", 1.6, 45),
    ("N2", "N3", 1.9, 40),
    ("N3", "N4", 2.1, 35),
    ("N3", "N5", 1.5, 40),
    ("N4", "N5", 1.4, 35),
    ("N4", "H2", 2.0, 30),
    ("N1", "N6", 1.7, 45),
    ("N6", "H2", 2.4, 35),
    ("N2", "N7", 2.3, 50),
    ("N7", "N5", 2.6, 45),
    ("N5", "N8", 1.8, 35),
    ("N8", "H1", 1.2, 30),
    ("N7", "H3", 2.0, 45),
    ("N5", "H1", 2.5, 35),
    ("N8", "H3", 2.4, 35),
    ("N6", "N4", 2.2, 30),
]

HOSPITAL_NODES = {"H1", "H2", "H3"}

HOSPITALS = {
    "H1": {
        "id": "H1",
        "name": "MY Hospital (MGM Medical Indore)",
        "node": "D",
        "lat": 22.7150,
        "lng": 75.8700,
        "capability": "MICU",
        "trauma_level": 1,
        "icu_beds": 12,
        "icu_beds_available": 12,
        "cath_lab": True,
        "cath_lab_available": True,
        "ventilator": True,
        "ventilator_available": True,
        "status": "Ready"
    },
    "H2": {
        "id": "H2",
        "name": "Bombay Hospital Indore",
        "node": "J",
        "lat": 22.7600,
        "lng": 75.8900,
        "capability": "ALS",
        "trauma_level": 2,
        "icu_beds": 6,
        "icu_beds_available": 6,
        "cath_lab": True,
        "cath_lab_available": True,
        "ventilator": True,
        "ventilator_available": True,
        "status": "Ready"
    },
    "H3": {
        "id": "H3",
        "name": "Medanta Super Specialty Hospital Indore",
        "node": "M",
        "lat": 22.7533,
        "lng": 75.8937,
        "capability": "BLS",
        "trauma_level": 3,
        "icu_beds": 2,
        "icu_beds_available": 2,
        "cath_lab": False,
        "cath_lab_available": False,
        "ventilator": False,
        "ventilator_available": False,
        "status": "Ready"
    }
}

def build_adjacency():
    """Return an adjacency list: node -> list of (neighbor, distance_km, base_speed_kmh)."""
    adj = {n: [] for n in NODES}
    for a, b, dist, speed in EDGES:
        adj[a].append((b, dist, speed))
        adj[b].append((a, dist, speed))
    return adj

#COMMENTED VERSION IS THE UPDATED ONE BUT WO ERROR DE RHA HAI , WHI SAMAJH NAHI AA RHI HAI 

# # ADJACENCY = build_adjacency()"""
# from typing import Dict, List, Tuple


# # ---------------------------------------------------------------------
# # Road network centered on Indore, Madhya Pradesh, India
# # ---------------------------------------------------------------------

# NODES: Dict[str, Dict[str, object]] = {
#     "A": {
#         "lat": 22.7196,
#         "lng": 75.8577,
#         "label": "Rajwada / Central Indore",
#     },
#     "B": {
#         "lat": 22.7247,
#         "lng": 75.8528,
#         "label": "MG Road",
#     },
#     "C": {
#         "lat": 22.7305,
#         "lng": 75.8469,
#         "label": "Palasia Junction",
#     },
#     "D": {
#         "lat": 22.7141,
#         "lng": 75.8577,
#         "label": "MY Hospital",
#     },
#     "E": {
#         "lat": 22.7072,
#         "lng": 75.8664,
#         "label": "Bhawarkua",
#     },
#     "F": {
#         "lat": 22.7352,
#         "lng": 75.8685,
#         "label": "Vijay Nagar",
#     },
#     "G": {
#         "lat": 22.7418,
#         "lng": 75.8544,
#         "label": "Geeta Bhawan",
#     },
#     "H": {
#         "lat": 22.7502,
#         "lng": 75.8668,
#         "label": "Bengali Square",
#     },
#     "I": {
#         "lat": 22.7266,
#         "lng": 75.8785,
#         "label": "LIG Square",
#     },
#     "J": {
#         "lat": 22.7015,
#         "lng": 75.8780,
#         "label": "Bombay Hospital",
#     },
#     "K": {
#         "lat": 22.7167,
#         "lng": 75.8892,
#         "label": "Khajrana",
#     },
#     "L": {
#         "lat": 22.7358,
#         "lng": 75.8955,
#         "label": "Scheme 140",
#     },
#     "M": {
#         "lat": 22.6950,
#         "lng": 75.8675,
#         "label": "Medanta Hospital",
#     },
# }

# GRAPH_NODES = NODES


# # ---------------------------------------------------------------------
# # Road edges
# # Each edge is:
# # (start_node, end_node, distance_km, base_speed_kmh)
# # ---------------------------------------------------------------------

# EDGES: List[Tuple[str, str, float, float]] = [
#     ("A", "B", 0.8, 35.0),
#     ("A", "D", 0.7, 30.0),
#     ("A", "E", 1.5, 35.0),
#     ("B", "C", 1.1, 40.0),
#     ("B", "G", 1.7, 35.0),
#     ("C", "G", 1.4, 40.0),
#     ("C", "F", 1.5, 45.0),
#     ("D", "E", 1.3, 35.0),
#     ("D", "M", 2.0, 35.0),
#     ("E", "M", 1.4, 40.0),
#     ("E", "J", 2.4, 40.0),
#     ("F", "G", 1.4, 40.0),
#     ("F", "H", 1.2, 45.0),
#     ("F", "I", 1.3, 40.0),
#     ("G", "H", 1.3, 40.0),
#     ("G", "I", 1.5, 35.0),
#     ("H", "L", 1.8, 45.0),
#     ("I", "J", 2.0, 40.0),
#     ("I", "K", 1.2, 35.0),
#     ("J", "K", 1.5, 40.0),
#     ("J", "M", 1.1, 35.0),
#     ("K", "L", 1.4, 40.0),
#     ("K", "M", 1.8, 35.0),
#     ("L", "M", 2.3, 45.0),
# ]

# ROAD_EDGES = EDGES


# # ---------------------------------------------------------------------
# # Hospital locations
# # ---------------------------------------------------------------------

# HOSPITAL_NODES: Dict[str, str] = {
#     "H1": "D",
#     "H2": "J",
#     "H3": "M",
# }


# # ---------------------------------------------------------------------
# # Hospital data
# # ---------------------------------------------------------------------

# HOSPITALS: Dict[str, Dict[str, object]] = {
#     "H1": {
#         "hospital_id": "H1",
#         "name": "MY Hospital",
#         "lat": NODES[HOSPITAL_NODES["H1"]]["lat"],
#         "lng": NODES[HOSPITAL_NODES["H1"]]["lng"],
#         "node": HOSPITAL_NODES["H1"],
#         "trauma_level": "Level I",
#         "status": "Ready",
#         "icu_beds": 10,
#         "icu_beds_available": 10,
#         "cath_lab": True,
#         "cath_lab_available": True,
#         "ventilator": True,
#         "ventilator_available": True,
#     },
#     "H2": {
#         "hospital_id": "H2",
#         "name": "Bombay Hospital",
#         "lat": NODES["J"]["lat"],
#         "lng": NODES["J"]["lng"],
#         "node": "J",
#         "trauma_level": "Level I",
#         "status": "Ready",
#         "icu_beds": 12,
#         "icu_beds_available": 12,
#         "cath_lab": True,
#         "cath_lab_available": True,
#         "ventilator": True,
#         "ventilator_available": True,
#     },
#     "H3": {
#         "hospital_id": "H3",
#         "name": "Medanta Hospital",
#         "lat": NODES["M"]["lat"],
#         "lng": NODES["M"]["lng"],
#         "node": "M",
#         "trauma_level": "Level I",
#         "status": "Ready",
#         "icu_beds": 8,
#         "icu_beds_available": 8,
#         "cath_lab": True,
#         "cath_lab_available": True,
#         "ventilator": True,
#         "ventilator_available": True,
#     },
# }


# # ---------------------------------------------------------------------
# # Pre-computed bidirectional adjacency list
# # ---------------------------------------------------------------------

# ADJACENCY: Dict[str, List[Tuple[str, float, float]]] = {
#     node: [] for node in NODES
# }

# for u, v, distance_km, speed_kmh in EDGES:
#     ADJACENCY[u].append((v, distance_km, speed_kmh))
#     ADJACENCY[v].append((u, distance_km, speed_kmh))


# # ---------------------------------------------------------------------
# # Compatibility helper functions
# # ---------------------------------------------------------------------

# def build_adjacency_list() -> Dict[str, List[Tuple[str, float, float]]]:
#     return ADJACENCY


# def build_adjacency() -> Dict[str, List[Tuple[str, float, float]]]:
#     return ADJACENCY