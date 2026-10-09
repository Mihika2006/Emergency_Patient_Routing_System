import heapq
import random
import time

from graph_data import ROAD_EDGES, ROAD_NODES, INDORE_HOSPITALS

_congestion = {}


def _edge_key(a, b):
    return "-".join(sorted((a, b)))


def init_traffic():
    for a, b, dist, speed in ROAD_EDGES:
        _congestion[_edge_key(a, b)] = 1.0


def refresh_traffic(seed=None):
    """Simulate a live traffic pull: randomly congest some segments."""
    rng = random.Random(seed)
    for key in _congestion:
        _congestion[key] = round(rng.uniform(0.4, 1.0), 2)
    return dict(_congestion)


def get_traffic_snapshot():
    return dict(_congestion)


def _edge_weight_minutes(a, b, dist_km, base_speed_kmh):
    factor = _congestion.get(_edge_key(a, b), 1.0)
    effective_speed = max(base_speed_kmh * factor, 5.0)
    return (dist_km / effective_speed) * 60.0


def compute_shortest_time_path(start: str, destination: str):
    """Compute Shortest Time Path using Dijkstra's algorithm."""
    adj = {}
    for u, v, dist, speed in ROAD_EDGES:
        w = _edge_weight_minutes(u, v, dist, speed)
        if u not in adj: adj[u] = []
        if v not in adj: adj[v] = []
        adj[u].append((v, w))
        adj[v].append((u, w))

    if start not in ROAD_NODES or destination not in ROAD_NODES:
        return None

    dist = {n: float("inf") for n in ROAD_NODES}
    prev = {n: None for n in ROAD_NODES}
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
        for (v, w) in adj.get(u, []):
            if v in visited:
                continue
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))

    if dist[destination] == float("inf"):
        return None

    path = []
    node = destination
    while node is not None:
        path.append(node)
        node = prev[node]
    path.reverse()

    polyline = [{"lat": ROAD_NODES[n][0], "lng": ROAD_NODES[n][1], "node": n} for n in path]

    return {
        "path": path,
        "eta_minutes": round(dist[destination], 1),
        "polyline": polyline,
        "calculated_at": time.time(),
    }


init_traffic()
