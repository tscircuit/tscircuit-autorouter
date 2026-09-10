use crate::compat::load_serialized_hyper_graph;
use crate::core::{SegmentGeometryScratch, TinyHyperGraphSolver};
use crate::graphics::GraphicsObject;
use crate::layer_labels::{get_available_z_from_mask, get_z_layer_label};
pub use crate::poly_types::*;
use crate::section_solver::tiny_hyper_graph_section_pipeline_solver::{
    TinyHyperGraphSectionPipelineInput, TinyHyperGraphSectionPipelineSolver,
};
use serde_json::{Value, json};
use std::collections::HashMap;
const MIN_REGION_DIMENSION: f64 = 1e-9;
const BOTTOM_LAYER_TRACE_COLOR: &str = "rgba(52, 152, 219, 0.95)";
const BOTTOM_LAYER_TRACE_DASH: &str = "3 2";
const TRANSITION_CROSSING_COLOR: &str = "rgba(22, 160, 133, 0.95)";
const TRANSITION_CROSSING_DASH: &str = "2 4 2";
const ZERO_COST_REGION_FILL: &str = "rgba(128, 128, 128, 0.2)";
const MULTI_LAYER_POLYGON_STROKE: &str = "rgba(128, 128, 128, 0.85)";
const MULTI_LAYER_POLYGON_DASH: &str = "4 3";
const POLY_LAYER_COLORS: [(&str, &str); 4] = [
    ("rgba(220, 38, 38, 0.65)", "rgba(220, 38, 38, 0.95)"),
    ("rgba(37, 99, 235, 0.65)", "rgba(37, 99, 235, 0.95)"),
    ("rgba(22, 163, 74, 0.65)", "rgba(22, 163, 74, 0.95)"),
    ("rgba(249, 115, 22, 0.65)", "rgba(249, 115, 22, 0.95)"),
];
const FALLBACK_LAYER_COLOR: (&str, &str) =
    ("rgba(107, 114, 128, 0.55)", "rgba(107, 114, 128, 0.95)");

fn serialized_bounds(region: &Value) -> PolyBounds {
    let d = &region["d"];
    let b = &d["bounds"];
    if let (Some(min_x), Some(max_x), Some(min_y), Some(max_y)) = (
        b["minX"].as_f64(),
        b["maxX"].as_f64(),
        b["minY"].as_f64(),
        b["maxY"].as_f64(),
    ) {
        return PolyBounds {
            min_x,
            max_x,
            min_y,
            max_y,
        };
    }

    let w = d["width"].as_f64().filter(|n| n.is_finite()).unwrap_or(0.0);
    let h = d["height"]
        .as_f64()
        .filter(|n| n.is_finite())
        .unwrap_or(0.0);
    if let (Some(x), Some(y)) = (d["center"]["x"].as_f64(), d["center"]["y"].as_f64()) {
        return PolyBounds {
            min_x: x - w / 2.0,
            max_x: x + w / 2.0,
            min_y: y - h / 2.0,
            max_y: y + h / 2.0,
        };
    }

    PolyBounds {
        min_x: 0.0,
        max_x: MIN_REGION_DIMENSION,
        min_y: 0.0,
        max_y: MIN_REGION_DIMENSION,
    }
}

fn rect_polygon(bounds: PolyBounds) -> ConvexPolygon {
    let min_x = bounds.min_x.min(bounds.max_x);
    let mut max_x = bounds.min_x.max(bounds.max_x);
    let min_y = bounds.min_y.min(bounds.max_y);
    let mut max_y = bounds.min_y.max(bounds.max_y);
    if max_x <= min_x {
        max_x = min_x + MIN_REGION_DIMENSION;
    }

    if max_y <= min_y {
        max_y = min_y + MIN_REGION_DIMENSION;
    }

    vec![
        PolyPoint { x: max_x, y: min_y },
        PolyPoint { x: max_x, y: max_y },
        PolyPoint { x: min_x, y: max_y },
        PolyPoint { x: min_x, y: min_y },
    ]
}

fn signed_double_area(points: &[PolyPoint]) -> f64 {
    let mut area = 0.0;

    for i in 0..points.len() {
        let p = points[i];
        let next = points[(i + 1) % points.len()];
        area += p.x * next.y - p.y * next.x;
    }

    area
}

fn serialized_polygon(region: &Value) -> ConvexPolygon {
    let bounds = serialized_bounds(region);
    let d = &region["d"];
    let raw = d
        .get("polygon")
        .filter(|v| !v.is_null())
        .or_else(|| d.get("points").filter(|v| !v.is_null()))
        .or_else(|| d.get("vertices"));
    let mut points: Vec<PolyPoint> = raw
        .and_then(Value::as_array)
        .map(|points| {
            points
                .iter()
                .filter_map(|p| {
                    Some(PolyPoint {
                        x: p["x"].as_f64()?,
                        y: p["y"].as_f64()?,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    if points.len() > 1 {
        let a = points[0];
        let b = *points.last().unwrap();
        if a.x == b.x && a.y == b.y {
            points.pop();
        }
    }

    if points.len() < 3 {
        points = rect_polygon(bounds);
    }

    points.retain(|p| p.x.is_finite() && p.y.is_finite());
    if points.len() < 3 {
        points = rect_polygon(bounds);
    }

    let area = signed_double_area(&points);
    if area.abs() <= f64::EPSILON {
        return rect_polygon(bounds);
    }

    if area < 0.0 {
        points.reverse();
    }

    assert!(
        points.len() >= 3,
        "Convex polygon requires at least three points"
    );
    points
}

struct PolygonGeometry {
    area: f64,
    perimeter: f64,
    center_x: f64,
    center_y: f64,
    bounds: PolyBounds,
}

fn compute_polygon_geometry(polygon: &[PolyPoint]) -> PolygonGeometry {
    let mut area = 0.0;
    let mut nx = 0.0;
    let mut ny = 0.0;
    let mut perimeter = 0.0;
    let mut bounds = PolyBounds {
        min_x: f64::INFINITY,
        max_x: f64::NEG_INFINITY,
        min_y: f64::INFINITY,
        max_y: f64::NEG_INFINITY,
    };
    let mut average = PolyPoint { x: 0.0, y: 0.0 };

    for i in 0..polygon.len() {
        let p = polygon[i];
        let n = polygon[(i + 1) % polygon.len()];
        let cross = p.x * n.y - n.x * p.y;
        area += cross;
        nx += (p.x + n.x) * cross;
        ny += (p.y + n.y) * cross;
        perimeter += (n.x - p.x).hypot(n.y - p.y);
        bounds.min_x = bounds.min_x.min(p.x);
        bounds.max_x = bounds.max_x.max(p.x);
        bounds.min_y = bounds.min_y.min(p.y);
        bounds.max_y = bounds.max_y.max(p.y);
        average.x += p.x / polygon.len() as f64;
        average.y += p.y / polygon.len() as f64;
    }

    let divisor = if area.abs() > f64::EPSILON {
        3.0 * area
    } else {
        f64::NAN
    };
    PolygonGeometry {
        area: area.abs() / 2.0,
        perimeter,
        center_x: if divisor.is_finite() {
            nx / divisor
        } else {
            average.x
        },
        center_y: if divisor.is_finite() {
            ny / divisor
        } else {
            average.y
        },
        bounds,
    }
}

fn project_boundary(
    point: PolyPoint,
    polygon: &[PolyPoint],
    perimeter: f64,
    scale: f64,
) -> (i32, i32, f64) {
    if perimeter <= 0.0 {
        return (0, 0, 0.0);
    }

    let mut best = f64::INFINITY;
    let mut edge = 0;
    let mut best_t = 0.0;
    let mut best_along = 0.0;
    let mut along = 0.0;

    for i in 0..polygon.len() {
        let a = polygon[i];
        let b = polygon[(i + 1) % polygon.len()];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let len_sq = dx * dx + dy * dy;
        let len = len_sq.sqrt();
        let raw = if len_sq <= f64::EPSILON {
            0.0
        } else {
            ((point.x - a.x) * dx + (point.y - a.y) * dy) / len_sq
        };
        let t = raw.max(0.0).min(1.0);
        let ex = point.x - (a.x + dx * t);
        let ey = point.y - (a.y + dy * t);
        let dist = ex * ex + ey * ey;
        if dist < best {
            best = dist;
            edge = i;
            best_t = t;
            best_along = along + len * t;
        }

        along += len;
    }

    (
        (((best_along / perimeter * scale) + 0.5).floor() % scale) as i32,
        edge as i32,
        best_t,
    )
}

fn serialized_id(metadata: &Option<Vec<Value>>, id: usize, key: &str, prefix: &str) -> String {
    metadata
        .as_ref()
        .and_then(|m| m.get(id))
        .and_then(|m| m[key].as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{prefix}-{id}"))
}

pub fn load_serialized_hyper_graph_as_poly(
    graph: &Value,
    options: Option<RectToPolyHyperGraphAdapterOptions>,
) -> PolyHyperGraphLoadResult {
    let scale = options
        .and_then(|o| o.boundary_coordinate_scale)
        .unwrap_or(36000.0);
    let loaded = load_serialized_hyper_graph(graph);
    let mut base = loaded.topology;
    let n = base.region_count;
    let p = base.port_count;
    let by_id: HashMap<&str, &Value> = graph["regions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (r["regionId"].as_str().unwrap(), r))
        .collect();
    let polygons: Vec<ConvexPolygon> = (0..n)
        .map(|r| {
            let id = serialized_id(&base.region_metadata, r, "serializedRegionId", "region");
            by_id
                .get(id.as_str())
                .map(|r| serialized_polygon(r))
                .unwrap_or_else(|| {
                    rect_polygon(PolyBounds {
                        min_x: base.region_center_x[r] - base.region_width[r] / 2.0,
                        max_x: base.region_center_x[r] + base.region_width[r] / 2.0,
                        min_y: base.region_center_y[r] - base.region_height[r] / 2.0,
                        max_y: base.region_center_y[r] + base.region_height[r] / 2.0,
                    })
                })
        })
        .collect();
    let mut topology = PolyHyperGraphTopology {
        base: base.clone(),
        region_vertex_start: vec![0; n],
        region_vertex_count: vec![0; n],
        region_vertex_x: vec![],
        region_vertex_y: vec![],
        region_area: vec![0.0; n],
        region_perimeter: vec![0.0; n],
        region_bounds_min_x: vec![0.0; n],
        region_bounds_max_x: vec![0.0; n],
        region_bounds_min_y: vec![0.0; n],
        region_bounds_max_y: vec![0.0; n],
        port_boundary_position_for_region1: vec![0; p],
        port_boundary_position_for_region2: vec![0; p],
        port_edge_index_for_region1: vec![0; p],
        port_edge_index_for_region2: vec![0; p],
        port_edge_t_for_region1: vec![0.0; p],
        port_edge_t_for_region2: vec![0.0; p],
    };
    let mut metadata = vec![];

    for r in 0..n {
        let polygon = &polygons[r];
        let g = compute_polygon_geometry(polygon);
        let side = g.area.max(MIN_REGION_DIMENSION).sqrt();
        topology.region_vertex_start[r] = topology.region_vertex_x.len() as i32;
        topology.region_vertex_count[r] = polygon.len() as i32;
        topology.region_area[r] = g.area;
        topology.region_perimeter[r] = g.perimeter;
        base.region_center_x[r] = g.center_x;
        base.region_center_y[r] = g.center_y;
        base.region_width[r] = side;
        base.region_height[r] = side;
        topology.region_bounds_min_x[r] = g.bounds.min_x;
        topology.region_bounds_max_x[r] = g.bounds.max_x;
        topology.region_bounds_min_y[r] = g.bounds.min_y;
        topology.region_bounds_max_y[r] = g.bounds.max_y;
        let original = base.region_metadata.as_ref().and_then(|m| m.get(r));
        let mut m = match original {
            Some(v) if v.is_object() => v.clone(),
            Some(v) => json!({"value":v}),
            None => json!({}),
        };
        m["polygon"] = json!(polygon);
        m["sourceBounds"] = json!(g.bounds);
        m["serializedRegionId"] = json!(serialized_id(
            &base.region_metadata,
            r,
            "serializedRegionId",
            "region"
        ));
        metadata.push(m);

        for point in polygon {
            topology.region_vertex_x.push(point.x);
            topology.region_vertex_y.push(point.y);
        }
    }

    for port in 0..p {
        let point = PolyPoint {
            x: base.port_x[port],
            y: base.port_y[port],
        };

        for (side, region) in base.incident_port_region[port].iter().take(2).enumerate() {
            let (pos, edge, t) = project_boundary(
                point,
                &polygons[*region as usize],
                topology.region_perimeter[*region as usize],
                scale,
            );
            if side == 0 {
                topology.port_boundary_position_for_region1[port] = pos;
                topology.port_edge_index_for_region1[port] = edge;
                topology.port_edge_t_for_region1[port] = t;
            } else {
                topology.port_boundary_position_for_region2[port] = pos;
                topology.port_edge_index_for_region2[port] = edge;
                topology.port_edge_t_for_region2[port] = t;
            }
        }
    }

    for r in 0..n {
        metadata[r]["layer"] = json!(
            get_z_layer_label(&get_available_z_from_mask(
                base.region_available_z_mask
                    .as_ref()
                    .map(|m| m[r])
                    .unwrap_or(0)
            ))
            .or_else(|| get_z_layer_label(
                &base.region_incident_ports[r]
                    .iter()
                    .map(|p| base.port_z[*p as usize])
                    .collect::<Vec<_>>()
            ))
            .unwrap_or_else(|| "z0".into())
        );
    }

    base.region_metadata = Some(metadata);
    base.port_angle_for_region1 = topology.port_boundary_position_for_region1.clone();
    base.port_angle_for_region2 = Some(topology.port_boundary_position_for_region2.clone());
    topology.base = base;
    let mut mapping = PolyHyperGraphSourceMapping {
        serialized_region_id_to_region_id: HashMap::new(),
        serialized_port_id_to_port_id: HashMap::new(),
        connection_id_to_route_id: HashMap::new(),
        net_id_to_net_index: HashMap::new(),
    };

    for r in 0..n {
        mapping.serialized_region_id_to_region_id.insert(
            serialized_id(
                &topology.base.region_metadata,
                r,
                "serializedRegionId",
                "region",
            ),
            r as i32,
        );
    }

    for p in 0..p {
        mapping.serialized_port_id_to_port_id.insert(
            serialized_id(&topology.base.port_metadata, p, "serializedPortId", "port"),
            p as i32,
        );
    }

    for r in 0..loaded.problem.route_count {
        if let Some(m) = loaded
            .problem
            .route_metadata
            .as_ref()
            .and_then(|m| m.get(r))
        {
            if let Some(id) = m["connectionId"].as_str() {
                mapping
                    .connection_id_to_route_id
                    .insert(id.to_owned(), r as i32);
            }

            if let Some(net) = m["mutuallyConnectedNetworkId"]
                .as_str()
                .or_else(|| m["connectionId"].as_str())
            {
                mapping
                    .net_id_to_net_index
                    .insert(net.to_owned(), loaded.problem.route_net[r]);
            }
        }
    }

    PolyHyperGraphLoadResult {
        topology,
        problem: loaded.problem,
        solution: loaded.solution,
        mapping,
    }
}
pub use load_serialized_hyper_graph_as_poly as load_poly_hyper_graph;

pub struct PolyHyperGraphSolver {
    pub core: TinyHyperGraphSolver,
    pub topology: PolyHyperGraphTopology,
}

impl PolyHyperGraphSolver {
    pub fn new(
        topology: PolyHyperGraphTopology,
        problem: PolyHyperGraphProblem,
        options: Option<PolyHyperGraphSolverOptions>,
    ) -> Self {
        let mut core = TinyHyperGraphSolver::new(topology.base.clone(), problem, options);
        core.region_area = Some(topology.region_area.clone());
        Self { core, topology }
    }

    pub fn populate_segment_geometry_scratch(
        &self,
        region: i32,
        a: i32,
        b: i32,
    ) -> SegmentGeometryScratch {
        let position = |p: i32| {
            let incident = &self.topology.base.incident_port_region[p as usize];
            if incident.first() == Some(&region) || incident.get(1) != Some(&region) {
                self.topology.port_boundary_position_for_region1[p as usize]
            } else {
                self.topology.port_boundary_position_for_region2[p as usize]
            }
        };
        let p1 = position(a);
        let p2 = position(b);
        let z1 = self.topology.base.port_z[a as usize];
        let z2 = self.topology.base.port_z[b as usize];
        SegmentGeometryScratch {
            lesser_angle: p1.min(p2),
            greater_angle: p1.max(p2),
            layer_mask: (1 << z1) | (1 << z2),
            entry_exit_layer_changes: if z1 != z2 { 1 } else { 0 },
        }
    }

    pub fn step(&mut self) -> () {
        self.core.step();
    }

    pub fn solve(&mut self) -> () {
        self.core.solve();
    }

    pub fn get_output(&self) -> Value {
        self.core.get_output()
    }

    pub fn visualize(&self) -> GraphicsObject {
        visualize_poly_hyper_graph(self)
    }
}

fn route_label(solver: &PolyVisualizationView, route: i32) -> String {
    solver
        .core
        .problem
        .route_metadata
        .as_ref()
        .and_then(|m| m.get(route as usize))
        .and_then(|m| {
            m["connectionId"]
                .as_str()
                .or_else(|| m["mutuallyConnectedNetworkId"].as_str())
        })
        .map(str::to_owned)
        .unwrap_or_else(|| format!("route-{route}"))
}

fn route_color(solver: &PolyVisualizationView, route: i32, alpha: f64) -> String {
    let source = format!(
        "{}:{}",
        solver.core.problem.route_net[route as usize],
        route_label(solver, route)
    );
    let mut hash = 0i32;

    for character in source.encode_utf16() {
        hash = (character as i32)
            .wrapping_mul(17777)
            .wrapping_add(hash.wrapping_shl(5).wrapping_sub(hash));
    }

    format!("hsla({}, 70%, 45%, {alpha})", (hash as i64).abs() % 360)
}

fn region_layers(solver: &PolyVisualizationView, region: usize) -> Vec<i32> {
    let t = &solver.topology.base;
    let layers = get_available_z_from_mask(
        t.region_available_z_mask
            .as_ref()
            .map(|m| m[region])
            .unwrap_or(0),
    );
    if !layers.is_empty() {
        return layers;
    }

    let mut layers: Vec<i32> = t.region_incident_ports[region]
        .iter()
        .map(|p| t.port_z[*p as usize])
        .filter(|z| *z >= 0)
        .collect();
    layers.sort();
    layers.dedup();
    if layers.is_empty() { vec![0] } else { layers }
}

fn region_polygon(topology: &PolyHyperGraphTopology, region: usize) -> Vec<PolyPoint> {
    let start = topology.region_vertex_start[region] as usize;
    let count = topology.region_vertex_count[region] as usize;
    (start..start + count)
        .map(|i| PolyPoint {
            x: topology.region_vertex_x[i],
            y: topology.region_vertex_y[i],
        })
        .collect()
}

fn region_fill(solver: &PolyVisualizationView, region: usize) -> String {
    let cost = solver
        .core
        .state
        .region_intersection_caches
        .get(region)
        .map(|c| c.existing_region_cost)
        .unwrap_or(0.0);
    if cost == 0.0 {
        return ZERO_COST_REGION_FILL.into();
    }

    let hotness = cost.powf(0.8).max(0.0).min(1.0);
    let blue = (245.0 - hotness * 105.0).round();
    let green = (248.0 - hotness * 168.0).round();
    format!("rgba(245, {green}, {blue}, {})", 0.18 + hotness * 0.48)
}

fn region_label(solver: &PolyVisualizationView, region: usize) -> String {
    let cache = solver.core.state.region_intersection_caches.get(region);
    let id = serialized_id(
        &solver.topology.base.region_metadata,
        region,
        "serializedRegionId",
        "region",
    );
    let net = solver.core.problem.region_net_id[region];
    let net = if net == -1 {
        "free".into()
    } else {
        net.to_string()
    };
    format!(
        "region: {id}\nnet: {net}\narea: {:.3}\ncost: {:.3}\nsame layer X: {}\ntrans X: {}\nentry exit X: {}",
        solver.topology.region_area[region],
        cache.map(|c| c.existing_region_cost).unwrap_or(0.0),
        cache
            .map(|c| c.existing_same_layer_intersections)
            .unwrap_or(0),
        cache
            .map(|c| c.existing_crossing_layer_intersections)
            .unwrap_or(0),
        cache
            .map(|c| c.existing_entry_exit_layer_changes)
            .unwrap_or(0)
    )
}

fn port_point(solver: &PolyVisualizationView, port: i32) -> Value {
    json!({"x":solver.topology.base.port_x[port as usize],"y":solver.topology.base.port_y[port as usize]})
}

fn port_layer(solver: &PolyVisualizationView, port: i32) -> String {
    get_z_layer_label(&[solver.topology.base.port_z[port as usize]]).unwrap_or_else(|| "z0".into())
}

fn port_label(solver: &PolyVisualizationView, port: i32) -> String {
    let t = &solver.topology.base;
    let incident = &t.incident_port_region[port as usize];
    let id = serialized_id(&t.port_metadata, port as usize, "serializedPortId", "port");
    format!(
        "port: {id}\nconnects: {} <-> {}\nz: {}",
        incident
            .first()
            .map(ToString::to_string)
            .unwrap_or_else(|| "?".into()),
        incident
            .get(1)
            .map(ToString::to_string)
            .unwrap_or_else(|| "?".into()),
        t.port_z[port as usize]
    )
}

fn segment_style(solver: &PolyVisualizationView, route: i32, a: i32, b: i32) -> Value {
    let z1 = solver.topology.base.port_z[a as usize];
    let z2 = solver.topology.base.port_z[b as usize];
    if z1 != z2 {
        json!({"strokeColor":TRANSITION_CROSSING_COLOR,"strokeDash":TRANSITION_CROSSING_DASH})
    } else if z1 > 0 {
        json!({"strokeColor":BOTTOM_LAYER_TRACE_COLOR,"strokeDash":BOTTOM_LAYER_TRACE_DASH})
    } else {
        json!({"strokeColor":route_color(solver,route,0.85)})
    }
}

fn push_route_endpoints(solver: &PolyVisualizationView, graphics: &mut Value) -> () {
    for route in 0..solver.core.problem.route_count {
        let label = route_label(solver, route as i32);
        let color = route_color(solver, route as i32, 0.85);

        for (port, endpoint) in [
            (solver.core.problem.route_start_port[route], "start"),
            (solver.core.problem.route_end_port[route], "end"),
        ] {
            let mut point = port_point(solver, port);
            point["color"] = json!(color);
            point["layer"] = json!(port_layer(solver, port));
            point["label"] = json!(format!(
                "route: {label}\nendpoint: {endpoint}\n{}",
                port_label(solver, port)
            ));
            graphics["points"].as_array_mut().unwrap().push(point);
        }
    }
}

fn push_solved_segments(solver: &PolyVisualizationView, graphics: &mut Value) -> () {
    for (region, segments) in solver.core.state.region_segments.iter().enumerate() {
        for &(route, a, b) in segments {
            let mut line = segment_style(solver, route, a, b);
            line["points"] = json!([port_point(solver, a), port_point(solver, b)]);
            line["layer"] = json!(
                get_z_layer_label(&[
                    solver.topology.base.port_z[a as usize],
                    solver.topology.base.port_z[b as usize]
                ])
                .unwrap_or_else(|| "z0".into())
            );
            line["label"] = json!(format!(
                "route: {}\nregion: {}",
                route_label(solver, route),
                serialized_id(
                    &solver.topology.base.region_metadata,
                    region,
                    "serializedRegionId",
                    "region"
                )
            ));
            graphics["lines"].as_array_mut().unwrap().push(line);
        }
    }
}

fn push_candidate_frontier(solver: &PolyVisualizationView, graphics: &mut Value) -> () {
    if solver.core.solved {
        return;
    }

    let mut candidates = solver.core.state.candidate_queue.to_array();
    candidates.sort_by(|a, b| a.f.total_cmp(&b.f));
    candidates.truncate(10);

    for (index, candidate) in candidates.iter().enumerate() {
        let mut point = port_point(solver, candidate.port_id);
        point["color"] = json!(if index == 0 {
            "green"
        } else {
            "rgba(128, 128, 128, 0.4)"
        });
        point["layer"] = json!(port_layer(solver, candidate.port_id));
        point["label"] = json!(format!(
            "{}\ng: {:.2}\nh: {:.2}\nf: {:.2}",
            port_label(solver, candidate.port_id),
            candidate.g,
            candidate.h,
            candidate.f
        ));
        graphics["points"].as_array_mut().unwrap().push(point);
    }

    let Some(current) = candidates.first() else {
        return;
    };
    let mut path = vec![];
    let mut cursor = Some(current);

    while let Some(candidate) = cursor {
        path.insert(0, port_point(solver, candidate.port_id));
        cursor = candidate.prev_candidate.as_deref();
    }

    if path.len() <= 1 {
        return;
    }

    let route = solver.core.state.current_route_id;
    let mut lines = vec![];
    if let Some(route) = route {
        lines.push(format!("route: {}", route_label(solver, route)));
    }

    lines.push("active candidate path".into());
    lines.push(format!(
        "candidate port: {}",
        serialized_id(
            &solver.topology.base.port_metadata,
            current.port_id as usize,
            "serializedPortId",
            "port"
        )
    ));
    graphics["lines"].as_array_mut().unwrap().push(json!({"points":path,"strokeColor":route.map(|r|route_color(solver,r,0.95)).unwrap_or_else(||"rgba(0, 160, 120, 0.95)".into()),"strokeDash":"4 3","layer":port_layer(solver,current.port_id),"label":lines.join("\n")}));
}

pub fn visualize_poly_hyper_graph(solver: &PolyHyperGraphSolver) -> GraphicsObject {
    visualize_poly_hyper_graph_parts(&solver.core, &solver.topology)
}

struct PolyVisualizationView<'a> {
    core: &'a TinyHyperGraphSolver,
    topology: &'a PolyHyperGraphTopology,
}

pub fn visualize_poly_hyper_graph_parts(
    core: &TinyHyperGraphSolver,
    topology: &PolyHyperGraphTopology,
) -> GraphicsObject {
    let view = PolyVisualizationView { core, topology };
    let solver = &view;
    let mut graphics = json!({"arrows":[],"circles":[],"infiniteLines":[],"lines":[],"points":[],"polygons":[],"rects":[],"texts":[],"title":"Poly HyperGraph","coordinateSystem":"cartesian"});

    for region in 0..solver.topology.base.region_count {
        let mut points = region_polygon(&solver.topology, region);
        let layers = region_layers(solver, region);
        let multi = layers.len() > 1;
        let colors = layers
            .first()
            .and_then(|z| POLY_LAYER_COLORS.get(*z as usize))
            .copied()
            .unwrap_or(FALLBACK_LAYER_COLOR);
        let layer = get_z_layer_label(&layers).unwrap_or_else(|| "z0".into());
        graphics["polygons"].as_array_mut().unwrap().push(json!({"points":points,"fill":region_fill(solver,region),"stroke":if multi{MULTI_LAYER_POLYGON_STROKE}else{colors.1},"layer":layer,"label":region_label(solver,region)}));
        if multi && !points.is_empty() {
            points.push(points[0]);
            graphics["lines"].as_array_mut().unwrap().push(json!({"points":points,"strokeColor":MULTI_LAYER_POLYGON_STROKE,"strokeDash":MULTI_LAYER_POLYGON_DASH,"layer":layer,"label":format!("layer outline: {}\n{}",serialized_id(&solver.topology.base.region_metadata,region,"serializedRegionId","region"),region_label(solver,region))}));
        }
    }

    for port in 0..solver.topology.base.port_count {
        let colors = POLY_LAYER_COLORS
            .get(solver.topology.base.port_z[port] as usize)
            .copied()
            .unwrap_or(FALLBACK_LAYER_COLOR);
        graphics["circles"].as_array_mut().unwrap().push(json!({"center":port_point(solver,port as i32),"radius":0.05,"fill":colors.0,"stroke":colors.1,"layer":port_layer(solver,port as i32),"label":port_label(solver,port as i32)}));
    }

    push_route_endpoints(solver, &mut graphics);
    push_solved_segments(solver, &mut graphics);
    push_candidate_frontier(solver, &mut graphics);
    let pending = solver.core.state.unrouted_routes.len()
        + usize::from(solver.core.state.current_route_id.is_some());
    graphics["title"] = json!(format!(
        "Poly HyperGraph | iter={} | pending={} | {}",
        solver.core.iterations,
        pending,
        if solver.core.failed {
            "failed"
        } else if solver.core.solved {
            "solved"
        } else {
            "running"
        }
    ));
    graphics
}

pub struct PolyHyperGraphSectionPipelineSolver {
    pub base: TinyHyperGraphSectionPipelineSolver,
}

impl PolyHyperGraphSectionPipelineSolver {
    pub fn new(input: TinyHyperGraphSectionPipelineInput) -> Self {
        let mut base = TinyHyperGraphSectionPipelineSolver::new(input);
        base.poly_mode = true;
        Self { base }
    }

    pub fn step(&mut self) -> () {
        self.base.step();
    }

    pub fn solve(&mut self) -> () {
        self.base.solve();
    }

    pub fn get_output(&self) -> Value {
        self.base.get_output()
    }

    pub fn visualize(&mut self) -> GraphicsObject {
        self.base.visualize()
    }
}
