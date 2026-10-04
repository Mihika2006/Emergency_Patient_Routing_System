"""
routing.py
----------
Deterministic, algorithmic routing engine (no ML/AI model involved).

Per the SRS (FR-004) and the project's own structured-design / class /
activity diagrams, the routing engine:
  1. Pulls live traffic congestion factors for each road segment
     (process_traffic_speeds / 2.1.1 Process Traffic Speeds).
  2. Converts distance + effective speed into a travel-time edge weight
     (dynamic road segment weighting, per Exp6 user story "Calculate
     Dynamic Road Segment Weights").
  3. Runs Dijkstra's shortest-time-path algorithm over the weighted graph
     (2.1.2 Compute Shortest Time Path / class diagram RouteEngine.
     computeDijkstraPath() / activity diagram "Compute Shortest-Time
     Reroute Path (Dijkstra)").

NOTE ON THE AUDIT: one sequence diagram in the submitted document set
(Experiment 10, diagram 3) names the routing call `executeAStarSearch(...)`
instead of Dijkstra. Every other artifact (structured design, class
diagram, activity diagram, user stories, and the reference Python code
in Experiment 5) specifies Dijkstra, so this backend implements Dijkstra
and treats the sequence diagram as the outlier to be corrected in the
documentation (see the audit report).

Dijkstra and A* both return an optimal shortest-time path on a
non-negative-weight graph; A* would simply add a heuristic to explore
fewer nodes, which matters only at road-network scale. Either is a
correct, deterministic choice -- no trained model is required.
"""

import heapq
import random
import time

from graph_data import ADJACENCY, NODES, HOSPITAL_NODES

# Simulated live congestion factor per edge, refreshed periodically by
# /api/traffic/refresh (stands in for polling a real Traffic Service API
# every 30s, per the "Fetch Live Traffic Speeds" user story).
_congestion = {}


def _edge_key(a, b):
    return "-".join(sorted((a, b)))


def init_traffic():
    for a in ADJACENCY:
        for (b, _dist, _speed) in ADJACENCY[a]:
            _congestion[_edge_key(a, b)] = 1.0  # 1.0 = free flow


def refresh_traffic(seed=None):
    """Simulate a live traffic pull: randomly congest some segments."""
    rng = random.Random(seed)
    for key in _congestion:
        # 0.4 (heavy jam) .. 1.0 (free flow)
        _congestion[key] = round(rng.uniform(0.4, 1.0), 2)
    return dict(_congestion)


def get_traffic_snapshot():
    return dict(_congestion)


def _edge_weight_minutes(a, b, dist_km, base_speed_kmh):
    """process_traffic_speeds(): distance / effective_speed * 60 -> minutes."""
    factor = _congestion.get(_edge_key(a, b), 1.0)
    effective_speed = max(base_speed_kmh * factor, 5.0)  # never fully gridlocked
    return (dist_km / effective_speed) * 60.0


def compute_shortest_time_path(start: str, destination: str):
    """
    2.1.2 Compute Shortest Time Path (Dijkstra's algorithm).

    Returns dict: path (list of node ids), eta_minutes, polyline
    (list of {lat,lng}) or None if unreachable.
    """
    if start not in ADJACENCY or destination not in ADJACENCY:
        return None

    dist = {n: float("inf") for n in ADJACENCY}
    prev = {n: None for n in ADJACENCY}
    dist[start] = 0.0
    visited = set()
    pq = [(0.0, start)]

    while pq:
        d, u = heapq.heappop(pq)
        if u in visited:
            continue
        visited.add(u)
        if u == destination:
            break
        for (v, edge_dist, edge_speed) in ADJACENCY[u]:
            if v in visited:
                continue
            w = _edge_weight_minutes(u, v, edge_dist, edge_speed)
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))

    if dist[destination] == float("inf"):
        return None

    # reconstruct path
    path = []
    node = destination
    while node is not None:
        path.append(node)
        node = prev[node]
    path.reverse()

    polyline = [{"lat": NODES[n]["lat"], "lng": NODES[n]["lng"], "node": n} for n in path]

    return {
        "path": path,
        "eta_minutes": round(dist[destination], 1),
        "polyline": polyline,
        "calculated_at": time.time(),
    }


def rank_fallback_hospitals(from_node: str, eligible_hospital_ids):
    """
    Rank fallback hospitals by Dijkstra travel time from the ambulance's
    current node ("Rank Fallback Hospitals by Proximity" user story).
    """
    results = []
    for hid in eligible_hospital_ids:
        if hid not in HOSPITAL_NODES:
            continue
        route = compute_shortest_time_path(from_node, hid)
        if route:
            results.append({"hospital_id": hid, "eta_minutes": route["eta_minutes"], "route": route})
    results.sort(key=lambda r: r["eta_minutes"])
    return results


init_traffic()
