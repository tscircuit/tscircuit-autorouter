#!/usr/bin/env python3
"""Independent streamed via-versus-raw-obstacle audit; no autorouter DRC imports.

Diagnostic inputs are labelled diagnostic unless --final is explicitly supplied.
Only geometric copper intersections decide failure. Optional clearance findings
are reported separately because obstacle clearance categories can differ.
"""
import argparse
import hashlib
import json
import math
import os
import re
import resource
import sys

EPSILON = 1e-9
META_KEYS = {
    "layerCount", "allowBlindAndBuriedVias", "minViaDiameter",
    "minViaPadDiameter", "min_via_pad_diameter", "minViaHoleDiameter",
    "min_via_hole_diameter", "solved", "failed", "phase",
}


class JsonStream:
    def __init__(self, path):
        self.file = open(path, encoding="utf-8")
        self.buffer = ""
        self.index = 0

    def peek(self):
        if self.index >= len(self.buffer):
            self.buffer = self.file.read(65536)
            self.index = 0
        return self.buffer[self.index] if self.index < len(self.buffer) else ""

    def take(self):
        value = self.peek()
        if value:
            self.index += 1
        return value

    def whitespace(self):
        while self.peek() and self.peek().isspace():
            self.take()

    def expect(self, character):
        self.whitespace()
        actual = self.take()
        if actual != character:
            raise ValueError(f"Expected {character!r}, received {actual!r}")

    def value(self, collect=True):
        self.whitespace()
        first = self.peek()
        if not first:
            raise ValueError("Unexpected EOF in JSON value")
        output = []
        depth = 0
        string = False
        escape = False
        compound = first in "[{"
        quoted = first == '"'
        while True:
            character = self.peek()
            if not character:
                if depth or string:
                    raise ValueError("Truncated JSON value")
                break
            if not compound and not quoted and character in ",]}":
                break
            character = self.take()
            if collect:
                output.append(character)
            if string:
                if escape:
                    escape = False
                elif character == "\\":
                    escape = True
                elif character == '"':
                    string = False
                    if quoted and depth == 0:
                        break
            elif character == '"':
                string = True
            elif character in "[{":
                depth += 1
            elif character in "]}":
                depth -= 1
                if compound and depth == 0:
                    break
        return json.loads("".join(output)) if collect else None

    def array(self):
        self.expect("[")
        self.whitespace()
        if self.peek() == "]":
            self.take()
            return
        while True:
            yield self.value()
            self.whitespace()
            separator = self.take()
            if separator == "]":
                return
            if separator != ",":
                raise ValueError("Invalid JSON array separator")

    def records(self, array_keys):
        try:
            self.whitespace()
            if self.peek() == "[":
                if not ({"routes", "traces"} & array_keys):
                    raise ValueError("Unexpected root array outside a routing-output stream")
                for item in self.array():
                    yield "routes", item
                return
            self.expect("{")
            while True:
                self.whitespace()
                if self.peek() == "}":
                    self.take()
                    return
                key = self.value()
                self.expect(":")
                if key in array_keys:
                    for item in self.array():
                        yield key, item
                elif key in META_KEYS:
                    yield key, self.value()
                else:
                    self.value(collect=False)
                self.whitespace()
                separator = self.take()
                if separator == "}":
                    return
                if separator != ",":
                    raise ValueError("Invalid JSON object separator")
        finally:
            self.file.close()


def z_index(layer, count):
    if isinstance(layer, int):
        z = layer
    elif layer == "top":
        z = 0
    elif layer == "bottom":
        z = count - 1
    elif isinstance(layer, str) and re.fullmatch(r"inner\d+", layer):
        z = int(layer[5:])
    else:
        raise ValueError(f"Unsupported physical layer {layer!r}")
    if not 0 <= z < count:
        raise ValueError(f"Layer {layer!r} outside {count}-layer stack")
    return z


def point_segment_distance(x, y, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = dx * dx + dy * dy
    t = max(0.0, min(1.0, ((x-a[0])*dx+(y-a[1])*dy)/length)) if length else 0.0
    return math.hypot(x-a[0]-t*dx, y-a[1]-t*dy)


def polygon_distance(x, y, points):
    inside = False
    distance = math.inf
    for index, a in enumerate(points):
        b = points[(index + 1) % len(points)]
        distance = min(distance, point_segment_distance(x, y, a, b))
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            inside = not inside
    return 0.0 if inside else distance


def compile_obstacle(raw, index, count):
    kind = raw.get("type", "rect")
    shape = raw.get("shape")
    layers = raw.get("__zLayers") or raw.get("zLayers") or raw.get("layers")
    if not layers:
        raise ValueError(f"Raw obstacle {index} has no physical layers")
    zs = frozenset(z_index(layer, count) for layer in layers)
    connected = raw.get("connectedTo", [])
    if not isinstance(connected, list):
        raise ValueError(f"Raw obstacle {index} has invalid connectedTo")
    identity = raw.get("obstacleId")
    metadata = raw.get("circuitJsonMetadata") or {}
    keepout = bool(raw.get("isKeepout")) or str(identity or "").startswith("pcb_keepout") or "pcb_keepout_id" in metadata
    polygon = raw.get("points") or raw.get("outline") if kind == "polygon" or shape == "polygon" else None
    if polygon:
        points = [(p["x"], p["y"]) for p in polygon]
        if len(points) < 3 or not all(math.isfinite(v) for p in points for v in p):
            raise ValueError(f"Raw polygon obstacle {index} is invalid")
        geometry = ("polygon", points)
        box = (min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points))
    else:
        center = raw["center"]
        x, y, width, height = center["x"], center["y"], raw["width"], raw["height"]
        angle = math.radians(raw.get("ccwRotationDegrees", 0))
        if not all(math.isfinite(v) for v in [x, y, width, height, angle]) or width <= 0 or height <= 0:
            raise ValueError(f"Raw obstacle {index} has invalid geometry")
        if kind not in ["rect", "oval", "circle"] or shape not in [None, "rect", "oval", "circle"]:
            raise ValueError(f"Unsupported raw obstacle geometry {kind!r}/{shape!r}")
        if kind == "circle" or shape == "circle":
            if abs(width-height) > EPSILON:
                raise ValueError(f"Raw circle obstacle {index} is not circular")
            geometry = ("circle", x, y, width/2)
            box = (x-width/2, y-width/2, x+width/2, y+width/2)
        else:
            cosine, sine = math.cos(angle), math.sin(angle)
            geometry = ("oval" if kind == "oval" or shape == "oval" else "rect", x, y, width/2, height/2, cosine, sine)
            hx = (abs(cosine)*width + abs(sine)*height)/2
            hy = (abs(sine)*width + abs(cosine)*height)/2
            box = (x-hx, y-hy, x+hx, y+hy)
    # Keep compact source-net aliases; retain the physical identity separately.
    nets = frozenset(value for value in connected if value.startswith("source_net_") or not value.startswith(("pcb_", "source_port_", "source_trace_", "connectivity_net")))
    return {"index": index, "identity": identity, "metadata": metadata, "layers": zs,
            "geometry": geometry, "box": box, "nets": nets,
            "unowned": not connected, "keepout": keepout,
            "assignable": raw.get("isAssignableVia") is True or (raw.get("netIsAssignable") is True and len(zs) > 1),
            "assignableIds": frozenset(value for value in connected if value.startswith("pcb_via")) | ({identity} if identity else set())}


def obstacle_distance(x, y, obstacle):
    g = obstacle["geometry"]
    if g[0] == "polygon":
        return polygon_distance(x, y, g[1])
    if g[0] == "circle":
        return max(0.0, math.hypot(x-g[1], y-g[2])-g[3])
    _, cx, cy, hx, hy, cosine, sine = g
    dx, dy = x-cx, y-cy
    px, py = dx*cosine+dy*sine, -dx*sine+dy*cosine
    if g[0] == "oval":
        radius = min(hx, hy)
        if hx >= hy:
            return max(0.0, math.hypot(max(abs(px)-(hx-hy), 0.0), py)-radius)
        return max(0.0, math.hypot(px, max(abs(py)-(hy-hx), 0.0))-radius)
    return math.hypot(max(abs(px)-hx, 0.0), max(abs(py)-hy, 0.0))


def route_nets(route):
    names = [route.get(k) for k in ["connection_name", "connectionName", "rootConnectionName", "netConnectionName"]]
    names.extend(route.get("__rootConnectionNames", []))
    names.extend(route.get("connectsTo", []))
    result = set()
    for name in names:
        if isinstance(name, str):
            result.add(name)
            result.add(re.sub(r"_mst\d+(?:_.*)?$", "", name))
    source_roots = {re.sub(r"_mst\d+(?:_.*)?$", "", name) for name in result if name.startswith("source_net_")}
    if len(source_roots) > 1:
        raise ValueError(f"Ambiguous multiple-source-net route ownership: {sorted(source_roots)!r}")
    return result


def number_from(*values):
    for value in values:
        if value is not None:
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise ValueError(f"Invalid positive physical diameter {value!r}")
            return float(value)
    raise ValueError("Missing physical diameter")


def proved_own_plated_transition(route, start, end, start_z, end_z, obstacles, plated_id=None, width=None):
    nets = route_nets(route)
    contact_radius = number_from(width, route.get("traceThickness"), 0.1) / 2
    # The wire may reach an existing plated anchor from outside its pad. Only
    # the layer-change anchor must contact that own full-span plated copper;
    # this check does not certify the intervening wire's clearance.
    return any(
        o["metadata"].get("pcb_plated_hole_id")
        and (not plated_id or o["metadata"]["pcb_plated_hole_id"] == plated_id)
        and not o["unowned"] and not o["keepout"] and bool(nets & o["nets"])
        and set(range(min(start_z,end_z), max(start_z,end_z)+1)) <= o["layers"]
        and o["geometry"][0] in ["rect", "circle", "oval"]
        and (obstacle_distance(start["x"], start["y"], o) < contact_radius-EPSILON
             or obstacle_distance(end["x"], end["y"], o) < contact_radius-EPSILON)
        for o in obstacles)


def audit_string_layer_transitions(route, metadata, obstacles):
    previous_wire = None
    between = []
    nets = route_nets(route)
    count = metadata["layerCount"]
    near = lambda a,b: math.hypot(a["x"]-b["x"], a["y"]-b["y"]) < 1e-6
    for point in route.get("route", []):
        if point.get("route_type") != "wire":
            between.append(point)
            continue
        if previous_wire is not None and point["layer"] != previous_wire["layer"]:
            start_z, end_z = z_index(previous_wire["layer"], count), z_index(point["layer"], count)
            covered = False
            for marker in between:
                if marker.get("route_type") not in ["via", "through_obstacle"]:
                    continue
                from_z, to_z = z_index(marker["from_layer"], count), z_index(marker["to_layer"], count)
                if (from_z, to_z) != (start_z, end_z):
                    continue
                if marker["route_type"] == "via":
                    covered = near(previous_wire, marker) and near(point, marker)
                elif near(previous_wire, marker["start"]) and near(point, marker["end"]):
                    # Existing plated copper can conduct between layers without
                    # manufacturing a new via. Prove it from the immutable raw
                    # source rather than trusting the exported marker alone.
                    plated_id = (marker.get("circuitJsonMetadata") or {}).get("pcb_plated_hole_id")
                    covered = proved_own_plated_transition(route, previous_wire, point, start_z, end_z, obstacles, plated_id, number_from(marker.get("width")))
                if covered:
                    break
            if not covered:
                raise ValueError(f"Unproved string-layer transition in {route.get('connection_name', route.get('connectionName'))!r}")
        previous_wire = point
        between = []


def trace_vias(route, metadata, obstacles=(), skip_transition_coverage=False):
    points = route.get("route", [])
    occurrences = [p for p in points if p.get("route_type") == "via"]
    if not occurrences:
        occurrences = route.get("vias", [])
    # A missing HD via declaration must not silently become an audit pass merely
    # because another route did contain vias. Refuse any unrepresented physical
    # z-transition; an intentional plated-terminal transition needs separate proof.
    transitions = [(a, b) for a,b in zip(points, points[1:])
                   if isinstance(a.get("z"), int) and isinstance(b.get("z"), int)
                   and a["z"] != b["z"]]
    for start, end in ([] if skip_transition_coverage else transitions):
        if not any(math.hypot(start["x"]-item["x"], start["y"]-item["y"]) < 1e-6
                   and math.hypot(end["x"]-item["x"], end["y"]-item["y"]) < 1e-6
                   for item in occurrences):
            plated_id = (start.get("toNextSegmentCircuitJsonMetadata") or {}).get("pcb_plated_hole_id")
            if start.get("toNextSegmentType") == "through_obstacle" and proved_own_plated_transition(route, start, end, start["z"], end["z"], obstacles, plated_id):
                continue
            raise ValueError(f"Unrepresented physical z-transition in {route.get('connection_name', route.get('connectionName'))!r}")
    for item in occurrences:
        if not all(isinstance(item.get(axis), (int, float)) and math.isfinite(item[axis]) for axis in ["x", "y"]):
            raise ValueError("Via coordinates must be finite physical positions")
        pad = number_from(item.get("via_diameter"), item.get("outer_diameter"), item.get("diameter"), route.get("viaDiameter"), metadata.get("min_via_pad_diameter"), metadata.get("minViaPadDiameter"), metadata.get("minViaDiameter"), 0.3)
        hole = number_from(item.get("via_hole_diameter"), item.get("hole_diameter"), route.get("viaHoleDiameter"), metadata.get("min_via_hole_diameter"), metadata.get("minViaHoleDiameter"), pad/2)
        if hole > pad + EPSILON:
            raise ValueError("Via hole diameter exceeds its copper pad diameter")
        count = metadata["layerCount"]
        if metadata.get("allowBlindAndBuriedVias") is not True:
            layers = frozenset(range(count))
        elif item.get("layers"):
            explicit = [z_index(layer, count) for layer in item["layers"]]
            layers = frozenset(range(min(explicit), max(explicit)+1))
        elif item.get("from_layer") is not None and item.get("to_layer") is not None:
            start, end = z_index(item["from_layer"], count), z_index(item["to_layer"], count)
            layers = frozenset(range(min(start, end), max(start, end)+1))
        else:
            transitions = [(a["z"], b["z"]) for a,b in zip(points, points[1:]) if a.get("z") != b.get("z") and math.hypot(a["x"]-item["x"], a["y"]-item["y"]) < 1e-6 and math.hypot(b["x"]-item["x"], b["y"]-item["y"]) < 1e-6]
            if not transitions:
                raise ValueError("Cannot determine physical span of an allowed blind via")
            layers = frozenset(z for a,b in transitions for z in range(min(a,b),max(a,b)+1))
        yield {"x": item["x"], "y": item["y"], "padDiameter": pad, "holeDiameter": hole,
               "layers": layers, "id": item.get("pcb_via_id") or item.get("via_id"),
               "route": route.get("connection_name", route.get("connectionName")), "nets": route_nets(route)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="/workspace/sample24-audit-original.srj.json")
    parser.add_argument("--routes", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--final", action="store_true")
    parser.add_argument("--clearance", type=float, default=0.0)
    parser.add_argument("--allow-exact-assignable-reuse", action="store_true")
    parser.add_argument("--continue-on-coverage-errors", action="store_true", help="Diagnostic only: scan all declared physical vias while recording unproved transitions")
    args = parser.parse_args()
    if args.final and args.continue_on_coverage_errors:
        raise ValueError("A final audit cannot bypass transition-coverage errors")
    if not math.isfinite(args.clearance) or args.clearance < 0:
        raise ValueError("Optional clearance must be finite and nonnegative")
    metadata = {}
    # LayerCount is written after the obstacle array in the source. Read scalar
    # metadata once without retaining that array, then compile one obstacle at a time.
    for key, value in JsonStream(args.input).records(set()):
        metadata[key] = value
    if not isinstance(metadata.get("layerCount"), int) or metadata["layerCount"] <= 0:
        raise ValueError("Original SRJ must declare its physical layer count")
    obstacles = []
    for key, value in JsonStream(args.input).records({"obstacles"}):
        if key == "obstacles":
            obstacles.append(compile_obstacle(value, len(obstacles), metadata["layerCount"]))
    intersections, clearance_only, exceptions, coverage_errors = [], [], [], []
    seen = set()
    raw_count = via_count = same_net_exemptions = 0
    for key, route in JsonStream(args.routes).records({"traces", "routes"}):
        if key not in ["traces", "routes"]:
            continue
        try:
            audit_string_layer_transitions(route, metadata, obstacles)
            route_vias = list(trace_vias(route, metadata, obstacles))
        except ValueError as error:
            if not args.continue_on_coverage_errors:
                raise
            coverage_error = {"kind": "TRANSITION_COVERAGE_NOT_CERTIFIED", "route": route.get("connection_name", route.get("connectionName")), "reason": str(error)}
            coverage_errors.append(coverage_error)
            print(json.dumps(coverage_error), flush=True)
            route_vias = list(trace_vias(route, metadata, obstacles, skip_transition_coverage=True))
        for via in route_vias:
            raw_count += 1
            fingerprint = (via["x"], via["y"], via["padDiameter"], via["holeDiameter"], tuple(sorted(via["layers"])), tuple(sorted(via["nets"])), via["id"])
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            via_count += 1
            radius = via["padDiameter"] / 2
            query_radius = radius + args.clearance
            for obstacle in obstacles:
                if not (via["layers"] & obstacle["layers"]):
                    continue
                if not obstacle["unowned"] and not obstacle["keepout"] and via["nets"] & obstacle["nets"]:
                    same_net_exemptions += 1
                    continue
                min_x,min_y,max_x,max_y = obstacle["box"]
                if via["x"]+query_radius < min_x or via["x"]-query_radius > max_x or via["y"]+query_radius < min_y or via["y"]-query_radius > max_y:
                    continue
                distance = obstacle_distance(via["x"], via["y"], obstacle)
                if distance >= query_radius-EPSILON:
                    continue
                exact_reuse = args.allow_exact_assignable_reuse and obstacle["assignable"] and via["id"] in obstacle["assignableIds"] and obstacle["layers"] == via["layers"] and obstacle["geometry"][0] == "circle" and math.hypot(via["x"]-obstacle["geometry"][1], via["y"]-obstacle["geometry"][2]) < EPSILON and abs(via["padDiameter"]-2*obstacle["geometry"][3]) < EPSILON
                if exact_reuse:
                    exceptions.append({"reason": "explicit identity-matched assignable via reuse", "viaId": via["id"], "obstacleIndex": obstacle["index"]})
                    continue
                hit = {"kind": "GEOMETRIC_COPPER_INTERSECTION" if distance < radius-EPSILON else "CLEARANCE_ONLY", "route": via["route"], "via": {"x": via["x"], "y": via["y"], "padDiameter": via["padDiameter"], "holeDiameter": via["holeDiameter"], "physicalZ": sorted(via["layers"])}, "obstacleIndex": obstacle["index"], "obstacleId": obstacle["identity"], "metadata": obstacle["metadata"], "obstacleZ": sorted(obstacle["layers"]), "unownedConnectedToEmpty": obstacle["unowned"], "keepout": obstacle["keepout"], "assignableVia": obstacle["assignable"], "distanceToObstacleGeometry": distance, "copperEdgeGap": distance-radius}
                (intersections if hit["kind"] == "GEOMETRIC_COPPER_INTERSECTION" else clearance_only).append(hit)
                print(json.dumps(hit), flush=True)
    def file_sha256(path):
        digest = hashlib.sha256()
        with open(path, "rb") as source:
            for block in iter(lambda: source.read(65536), b""):
                digest.update(block)
        return digest.hexdigest()
    report = {"scope": "FINAL_OUTPUT" if args.final else "DIAGNOSTIC_OUTPUT_NOT_FINAL", "inputPath": os.path.abspath(args.input), "inputSha256": file_sha256(args.input), "routesPath": os.path.abspath(args.routes), "routesSha256": file_sha256(args.routes), "layerCount": metadata["layerCount"], "allowBlindAndBuriedVias": metadata.get("allowBlindAndBuriedVias", False), "rawObstacleCount": len(obstacles), "unownedObstacleCount": sum(o["unowned"] for o in obstacles), "keepoutObstacleCount": sum(o["keepout"] for o in obstacles), "assignableViaObstacleCount": sum(o["assignable"] for o in obstacles), "viaOccurrences": raw_count, "uniqueViaCount": via_count, "geometricCopperIntersectionCount": len(intersections), "clearanceOnlyCount": len(clearance_only), "sameNetExemptions": same_net_exemptions, "explicitAssignableReuseExceptions": exceptions, "geometricCopperIntersections": intersections, "clearanceOnlyFindings": clearance_only, "peakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024, "qualification": "Unowned obstacles and keepouts are always foreign. Copper overlap is positive overlap beyond 1e-9 mm; exact tangency is not certified clear. Optional clearance-category checks are separate. This audit does not evaluate trace/trace, via/via, connectivity, or whole-board DRC."}
    if raw_count == 0:
        raise ValueError("No physical vias found; refusing a vacuous pass")
    report["transitionCoverageCertified"] = not coverage_errors
    report["requestedClearance"] = args.clearance
    report["transitionCoverageErrorCount"] = len(coverage_errors)
    report["transitionCoverageErrors"] = coverage_errors
    with open(args.report, "w") as output:
        json.dump(report, output, indent=2)
    print(json.dumps({k:v for k,v in report.items() if k not in ["geometricCopperIntersections", "clearanceOnlyFindings"]}), flush=True)
    return 2 if coverage_errors else 1 if intersections else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, TypeError, AttributeError, OSError) as error:
        print(json.dumps({"auditError": str(error), "scope": "NO_VALIDATION_RESULT"}), flush=True)
        sys.exit(2)
