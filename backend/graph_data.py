"""
Indore Road Network, Nodes, Edges, and Tertiary Hospitals Registry.
Matches Section 1.3 & Section 2 coverage requirements across Indore.
"""

# Realistic Coordinates for Key Intersections/Road Junctions across Indore
ROAD_NODES = {
    "REGAL_SQ": (22.7196, 75.8710),
    "PALASIA_SQ": (22.7244, 75.8839),
    "VIJAY_NAGAR_SQ": (22.7533, 75.8937),
    "BHANWARKUAN_SQ": (22.6868, 75.8561),
    "GEETA_BHAWAN_SQ": (22.7159, 75.8812),
    "LIG_SQ": (22.7391, 75.8890),
    "BENGALI_SQ": (22.7153, 75.9080),
    "RADISSON_SQ": (22.7485, 75.9031),
    "TOWER_SQ": (22.7001, 75.8612),
    "ANNAPURNA_SQ": (22.6961, 75.8340),
    "RAJWANSHI_SQ": (22.7180, 75.8570),
    "MR10_JUNCTION": (22.7680, 75.8850),
    "BYPASS_JUNCTION": (22.7210, 75.9390),
}

# Major Indore Tertiary Hospitals with real coordinates, trauma readiness, ICU beds, and equipment
INDORE_HOSPITALS = [
    {
        "hospitalId": "HOSP_MY",
        "name": "MY Hospital (Maharaja Yeshwantrao)",
        "locationLat": 22.7150,
        "locationLong": 75.8702,
        "nearestNode": "REGAL_SQ",
        "icuBedsAvailable": 4,
        "equipment": [
            {"equipmentId": "EQ_MY_VENT", "type": "ventilator", "status": "Operational"},
            {"equipmentId": "EQ_MY_CATH", "type": "cath_lab", "status": "Operational"},
        ],
    },
    {
        "hospitalId": "HOSP_BOMBAY",
        "name": "Bombay Hospital Indore",
        "locationLat": 22.7632,
        "locationLong": 75.8924,
        "nearestNode": "VIJAY_NAGAR_SQ",
        "icuBedsAvailable": 6,
        "equipment": [
            {"equipmentId": "EQ_BH_VENT", "type": "ventilator", "status": "Operational"},
            {"equipmentId": "EQ_BH_CATH", "type": "cath_lab", "status": "Operational"},
        ],
    },
    {
        "hospitalId": "HOSP_MEDANTA",
        "name": "Medanta Hospital Indore",
        "locationLat": 22.7565,
        "locationLong": 75.8902,
        "nearestNode": "VIJAY_NAGAR_SQ",
        "icuBedsAvailable": 5,
        "equipment": [
            {"equipmentId": "EQ_MED_VENT", "type": "ventilator", "status": "Operational"},
            {"equipmentId": "EQ_MED_CATH", "type": "cath_lab", "status": "Operational"},
        ],
    },
    {
        "hospitalId": "HOSP_CHL",
        "name": "CHL Hospital (LIG Square)",
        "locationLat": 22.7380,
        "locationLong": 75.8858,
        "nearestNode": "LIG_SQ",
        "icuBedsAvailable": 3,
        "equipment": [
            {"equipmentId": "EQ_CHL_VENT", "type": "ventilator", "status": "Operational"},
            {"equipmentId": "EQ_CHL_CATH", "type": "cath_lab", "status": "Operational"},
        ],
    },
    {
        "hospitalId": "HOSP_APOLLO",
        "name": "Apollo Hospitals Indore",
        "locationLat": 22.7470,
        "locationLong": 75.9080,
        "nearestNode": "RADISSON_SQ",
        "icuBedsAvailable": 7,
        "equipment": [
            {"equipmentId": "EQ_APO_VENT", "type": "ventilator", "status": "Operational"},
            {"equipmentId": "EQ_APO_CATH", "type": "cath_lab", "status": "Operational"},
        ],
    },
    {
        "hospitalId": "HOSP_CHOITHRAM",
        "name": "Choithram Hospital & Research Centre",
        "locationLat": 22.6881,
        "locationLong": 75.8360,
        "nearestNode": "BHANWARKUAN_SQ",
        "icuBedsAvailable": 2,
        "equipment": [
            {"equipmentId": "EQ_CHO_VENT", "type": "ventilator", "status": "Operational"},
            {"equipmentId": "EQ_CHO_CATH", "type": "cath_lab", "status": "Operational"},
        ],
    },
    {
        "hospitalId": "HOSP_SHALBY",
        "name": "Shalby Multispecialty Hospital",
        "locationLat": 22.7161,
        "locationLong": 75.8911,
        "nearestNode": "GEETA_BHAWAN_SQ",
        "icuBedsAvailable": 4,
        "equipment": [
            {"equipmentId": "EQ_SHA_VENT", "type": "ventilator", "status": "Operational"},
            {"equipmentId": "EQ_SHA_CATH", "type": "cath_lab", "status": "Operational"},
        ],
    },
    {
        "hospitalId": "HOSP_APPLE",
        "name": "Apple Hospital (Bhanwarkuan)",
        "locationLat": 22.6912,
        "locationLong": 75.8580,
        "nearestNode": "BHANWARKUAN_SQ",
        "icuBedsAvailable": 0,  # Demonstrates full ICU capacity filtering (Report US-13)
        "equipment": [
            {"equipmentId": "EQ_APP_VENT", "type": "ventilator", "status": "Operational"}
        ],
    },
    {
        "hospitalId": "HOSP_GK",
        "name": "Greater Kailash Hospital",
        "locationLat": 22.7198,
        "locationLong": 75.8810,
        "nearestNode": "PALASIA_SQ",
        "icuBedsAvailable": 2,
        "equipment": [
            {"equipmentId": "EQ_GK_VENT", "type": "ventilator", "status": "Maintenance Needed"}
        ],
    },
    {
        "hospitalId": "HOSP_INDEX",
        "name": "Index Medical College Hospital",
        "locationLat": 22.6850,
        "locationLong": 75.9650,
        "nearestNode": "BYPASS_JUNCTION",
        "icuBedsAvailable": 8,
        "equipment": [
            {"equipmentId": "EQ_IND_VENT", "type": "ventilator", "status": "Operational"},
            {"equipmentId": "EQ_IND_CATH", "type": "cath_lab", "status": "Operational"},
        ],
    },
]

# Static Graph Topologies: (distance_km, base_speed_kmph)
ROAD_EDGES = [
    ("REGAL_SQ", "PALASIA_SQ", 1.8, 35),
    ("PALASIA_SQ", "GEETA_BHAWAN_SQ", 1.2, 30),
    ("PALASIA_SQ", "LIG_SQ", 1.9, 40),
    ("LIG_SQ", "VIJAY_NAGAR_SQ", 2.1, 42),
    ("VIJAY_NAGAR_SQ", "RADISSON_SQ", 2.3, 45),
    ("RADISSON_SQ", "BENGALI_SQ", 3.1, 40),
    ("BENGALI_SQ", "GEETA_BHAWAN_SQ", 2.2, 35),
    ("REGAL_SQ", "RAJWANSHI_SQ", 1.5, 25),
    ("RAJWANSHI_SQ", "TOWER_SQ", 2.0, 30),
    ("TOWER_SQ", "BHANWARKUAN_SQ", 1.8, 35),
    ("BHANWARKUAN_SQ", "ANNAPURNA_SQ", 2.6, 35),
    ("VIJAY_NAGAR_SQ", "MR10_JUNCTION", 2.0, 50),
    ("RADISSON_SQ", "BYPASS_JUNCTION", 4.5, 55),
    ("BENGALI_SQ", "BYPASS_JUNCTION", 3.8, 50),
]


def build_weighted_graph(traffic_multipliers: dict = None) -> dict:
    """Builds adjacency map with weights in minutes = (distance / dynamic_speed) * 60 (US-09)."""
    multipliers = traffic_multipliers or {}
    graph = {}
    for u, v, dist_km, speed_kmph in ROAD_EDGES:
        mult = multipliers.get(f"{u}-{v}", multipliers.get(f"{v}-{u}", 1.0))
        effective_speed = max(10.0, speed_kmph * mult)
        time_minutes = (dist_km / effective_speed) * 60.0

        if u not in graph:
            graph[u] = {}
        if v not in graph:
            graph[v] = {}
        graph[u][v] = time_minutes
        graph[v][u] = time_minutes
    return graph
