"""Retain authored zone constraints, never saved copper or track teardrops.

Input vertices are KiCad board-world mm (+X right, +Y down). Output vertices
are circuit board-world mm (+X right, +Y up), translated by the board center.
All vertices are positions. Polygon operations happen before that transform.
"""
from shapely.geometry import LineString, Polygon
from shapely.ops import split, unary_union
from kicad_source import many, one


def solid_polygons(geometry):
    """Split holed regions into touching, hole-free authoring outlines."""
    pending = [geometry]
    result = []
    while pending:
        polygon = pending.pop()
        if polygon.is_empty:
            continue
        if polygon.geom_type in ("MultiPolygon", "GeometryCollection"):
            pending.extend(polygon.geoms)
            continue
        if polygon.geom_type != "Polygon":
            continue
        if not polygon.interiors:
            result.append(polygon)
            continue
        hole = Polygon(polygon.interiors[0])
        point = hole.representative_point()
        min_x, _, max_x, _ = polygon.bounds
        pieces = list(split(polygon, LineString([(min_x-1, point.y), (max_x+1, point.y)])).geoms)
        if sum(len(piece.interiors) for piece in pieces) >= len(polygon.interiors):
            raise ValueError("Unable to preserve zone cutout as simple outlines")
        pending.extend(pieces)
    return result


def extract_plane_intent(tree, native_net_names, layer_map, edge, center, clearance):
    board = Polygon(edge)
    zones = []
    keepouts = []
    skipped_teardrops = 0
    for index, zone in enumerate(many(tree, "zone")):
        if many(one(zone, "attr", []), "teardrop"):
            skipped_teardrops += 1
            continue
        native_layers = one(zone, "layers", one(zone, "layer"))
        layers = list(layer_map) if native_layers == ["*.Cu"] else native_layers
        polygons = [Polygon([tuple(map(float, xy[1:])) for xy in many(one(polygon, "pts"), "xy")])
                    for polygon in many(zone, "polygon")]
        if not polygons or any(not polygon.is_valid for polygon in polygons):
            raise ValueError("Zone has an invalid or missing authored boundary")
        geometry = unary_union(polygons)
        keepout = one(zone, "keepout")
        if keepout:
            keepouts.append({"layers": layers, "geometry": geometry,
                             "blocksPours": one(keepout, "copperpour") == ["not_allowed"]})
            continue
        native_name = native_net_names.get(one(zone, "net", ["0"])[0])
        if not native_name:
            raise ValueError("Copper zone has no declared source net")
        connect_pads = one(zone, "connect_pads")
        zone_clearance = float(one(connect_pads, "clearance", [str(clearance)])[0])
        for native_layer in layers:
            if native_layer not in layer_map:
                raise ValueError(f"Unknown zone copper layer {native_layer}")
            zones.append({"name": f"ZONE_{index}_{layer_map[native_layer]}",
                          "nativeName": native_name, "layer": layer_map[native_layer],
                          "nativeLayer": native_layer, "geometry": geometry,
                          "priority": int(one(zone, "priority", ["0"])[0]),
                          "clearance": zone_clearance,
                          "useThermalReliefs": not any(value in ("yes", "no") for value in connect_pads if isinstance(value, str))})
    result = []
    for zone in zones:
        exclusions = [other["geometry"].buffer(max(zone["clearance"], other["clearance"]), join_style=2)
                      for other in zones if other["layer"] == zone["layer"]
                      and other["nativeName"] != zone["nativeName"]
                      and other["priority"] >= zone["priority"]]
        exclusions.extend(keepout["geometry"].buffer(zone["clearance"], join_style=2)
                          for keepout in keepouts if keepout["blocksPours"]
                          and zone["nativeLayer"] in keepout["layers"])
        geometry = zone["geometry"].intersection(board)
        if exclusions:
            geometry = geometry.difference(unary_union(exclusions))
        def vertices(polygon):
            return [{"x": x-center[0], "y": center[1]-y}
                    for x, y in list(polygon.exterior.coords)[:-1]]
        result.append({key: value for key, value in zone.items()
                       if key not in ("geometry", "nativeLayer")} | {
                           "sourceOutlines": [vertices(polygon) for polygon in solid_polygons(zone["geometry"])],
                           "outlines": [vertices(polygon) for polygon in solid_polygons(geometry)],
                           "unbroken": zone["layer"].startswith("inner"),
                       })
    return {"zones": result, "skippedTeardrops": skipped_teardrops,
            "sourceKeepouts": len(keepouts), "savedCopperImported": False}
