use crate::{compat::load_serialized_hyper_graph::load_serialized_hyper_graph, core::*, types::*};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap, HashSet};
pub const DUPLICATE_PORT_PROXIMITY: f64 = 0.05;
const EPSILON: f64 = 1e-9;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
pub struct DuplicateCongestedPortSolverOptions {
    #[cfg_attr(feature = "wasm-types", tsify(optional))]
    pub duplicate_port_proximity: Option<f64>,
    #[cfg_attr(feature = "wasm-types", tsify(optional))]
    pub route_solve_options: Option<TinyHyperGraphSolverOptions>,
    #[cfg_attr(feature = "wasm-types", tsify(optional))]
    pub use_serialized_port_penalties: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
pub struct DuplicatedPortSummary {
    pub source_port_id: String,
    pub duplicate_port_ids: Vec<String>,
    pub use_count: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
pub struct DuplicateCongestedPortSolverReport {
    pub port_use_counts: BTreeMap<String, usize>,
    pub duplicated_ports: Vec<DuplicatedPortSummary>,
}

#[derive(Clone, Copy, Debug)]
struct Point {
    x: f64,
    y: f64,
}

#[derive(Clone, Copy, Debug)]
struct Bounds {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
}

fn to_object_record(value: Option<&Value>) -> Value {
    match value {
        Some(v) if v.is_object() => v.clone(),
        None => json!({}),
        Some(v) => json!({"value":v}),
    }
}

fn get_number(value: &Value, fallback: f64) -> f64 {
    value.as_f64().filter(|v| v.is_finite()).unwrap_or(fallback)
}

fn get_port_point(port: &Value) -> Point {
    Point {
        x: get_number(&port["d"]["x"], 0.0),
        y: get_number(&port["d"]["y"], 0.0),
    }
}

fn get_boundary_key(port: &Value) -> String {
    let mut ids = [
        port["region1Id"].as_str().unwrap_or(""),
        port["region2Id"].as_str().unwrap_or(""),
    ];
    ids.sort();
    ids.join("\0")
}

fn get_distance(a: Point, b: Point, hypot: fn(f64, f64) -> f64) -> f64 {
    hypot(a.x - b.x, a.y - b.y)
}

fn normalize(point: Point, hypot: fn(f64, f64) -> f64) -> Option<Point> {
    let length = hypot(point.x, point.y);
    if length <= EPSILON {
        None
    } else {
        Some(Point {
            x: point.x / length,
            y: point.y / length,
        })
    }
}

fn get_region_bounds(region: Option<&Value>) -> Bounds {
    let region = region.unwrap_or(&Value::Null);
    let bounds = &region["d"]["bounds"];
    if ["minX", "maxX", "minY", "maxY"]
        .iter()
        .all(|k| bounds[k].is_number())
    {
        return Bounds {
            min_x: bounds["minX"].as_f64().unwrap(),
            max_x: bounds["maxX"].as_f64().unwrap(),
            min_y: bounds["minY"].as_f64().unwrap(),
            max_y: bounds["maxY"].as_f64().unwrap(),
        };
    }

    let center = &region["d"]["center"];
    let width = get_number(&region["d"]["width"], 0.0);
    let height = get_number(&region["d"]["height"], 0.0);
    if center.is_object() {
        let x = get_number(&center["x"], 0.0);
        let y = get_number(&center["y"], 0.0);
        return Bounds {
            min_x: x - width / 2.0,
            max_x: x + width / 2.0,
            min_y: y - height / 2.0,
            max_y: y + height / 2.0,
        };
    }

    Bounds {
        min_x: 0.0,
        max_x: 0.0,
        min_y: 0.0,
        max_y: 0.0,
    }
}

fn get_region_center(region: Option<&Value>) -> Point {
    if let Some(center) = region
        .and_then(|r| r.get("d"))
        .and_then(|d| d.get("center"))
    {
        if center.is_object() {
            return Point {
                x: get_number(&center["x"], 0.0),
                y: get_number(&center["y"], 0.0),
            };
        }
    }

    let bounds = get_region_bounds(region);
    Point {
        x: (bounds.min_x + bounds.max_x) / 2.0,
        y: (bounds.min_y + bounds.max_y) / 2.0,
    }
}

fn find_nearest_port_on_same_boundary<'a>(source: &Value, ports: &'a [Value], hypot: fn(f64, f64) -> f64) -> Option<&'a Value> {
    let key = get_boundary_key(source);
    let point = get_port_point(source);
    let mut nearest = None;
    let mut distance = f64::INFINITY;

    for port in ports {
        if port["portId"] == source["portId"] || get_boundary_key(port) != key {
            continue;
        }

        let current = get_distance(point, get_port_point(port), hypot);
        if current <= EPSILON || current >= distance {
            continue;
        }

        nearest = Some(port);
        distance = current;
    }

    nearest
}

fn get_fallback_boundary_direction(source: &Value, regions: &HashMap<String, Value>, hypot: fn(f64, f64) -> f64) -> Point {
    let first = get_region_center(source["region1Id"].as_str().and_then(|id| regions.get(id)));
    let second = get_region_center(source["region2Id"].as_str().and_then(|id| regions.get(id)));
    normalize(Point {
        x: -(second.y - first.y),
        y: second.x - first.x,
    }, hypot)
    .unwrap_or(Point { x: 1.0, y: 0.0 })
}

fn get_duplicate_direction(
    source: &Value,
    nearest: Option<&Value>,
    regions: &HashMap<String, Value>,
    hypot: fn(f64, f64) -> f64,
) -> Point {
    let point = get_port_point(source);
    if let Some(nearest) = nearest {
        let nearest = get_port_point(nearest);
        if let Some(direction) = normalize(Point {
            x: point.x - nearest.x,
            y: point.y - nearest.y,
        }, hypot) {
            return direction;
        }
    }

    get_fallback_boundary_direction(source, regions, hypot)
}

fn create_duplicate_port_id(source: &str, index: usize, used: &mut HashSet<String>) -> String {
    let base = format!("{source}::dup{index}");
    if used.insert(base.clone()) {
        return base;
    }

    let mut collision = 2;

    loop {
        let id = format!("{base}-{collision}");
        if used.insert(id.clone()) {
            return id;
        }

        collision += 1;
    }
}

fn insert_duplicate_port_ids_after_source(
    points: &mut Vec<Value>,
    source: &str,
    duplicates: &[String],
) -> () {
    let index = points
        .iter()
        .position(|p| p.as_str() == Some(source))
        .map(|i| i + 1)
        .unwrap_or(points.len());
    points.splice(index..index, duplicates.iter().map(|s| json!(s)));
}

fn get_serialized_port_id(topology: &TinyHyperGraphTopology, port: PortId) -> String {
    if let Some(metadata) = topology
        .port_metadata
        .as_ref()
        .and_then(|m| m.get(port as usize))
    {
        if let Some(id) = metadata["serializedPortId"]
            .as_str()
            .or_else(|| metadata["portId"].as_str())
        {
            return id.to_owned();
        }
    }

    format!("port-{port}")
}

fn create_single_route_problem(
    problem: &TinyHyperGraphProblem,
    route: RouteId,
) -> TinyHyperGraphProblem {
    let r = route as usize;
    TinyHyperGraphProblem {
        route_count: 1,
        port_section_mask: problem.port_section_mask.clone(),
        route_metadata: problem.route_metadata.as_ref().map(|m| vec![m[r].clone()]),
        route_start_port: vec![problem.route_start_port[r]],
        route_end_port: vec![problem.route_end_port[r]],
        route_net: vec![problem.route_net[r]],
        region_net_id: problem.region_net_id.clone(),
        port_penalty: problem.port_penalty.clone(),
        initial_assignments: None,
    }
}

fn get_used_port_ids_for_solved_route(solver: &TinyHyperGraphSolver) -> HashSet<PortId> {
    let mut used = HashSet::new();

    for segments in &solver.state.region_segments {
        for &(_, from, to) in segments {
            used.insert(from);
            used.insert(to);
        }
    }

    if used.is_empty() && solver.problem.route_count == 1 {
        used.insert(solver.problem.route_start_port[0]);
        used.insert(solver.problem.route_end_port[0]);
    }

    used
}

pub struct DuplicateCongestedPortSolver {
    pub serialized_hyper_graph: Value,
    pub options: DuplicateCongestedPortSolverOptions,
    pub revised_serialized_hyper_graph: Option<Value>,
    pub report: DuplicateCongestedPortSolverReport,
    pub solved: bool,
    pub failed: bool,
    pub error: Option<String>,
    pub stats: Value,
    pub hypot: fn(f64, f64) -> f64,
    pub compare_port_ids: fn(&str, &str) -> std::cmp::Ordering,
}

impl DuplicateCongestedPortSolver {
    pub fn new(graph: Value, options: DuplicateCongestedPortSolverOptions) -> Self {
        Self {
            serialized_hyper_graph: graph,
            options,
            revised_serialized_hyper_graph: None,
            report: Default::default(),
            solved: false,
            failed: false,
            error: None,
            stats: json!({}),
            hypot: f64::hypot,
            compare_port_ids: |a, b| a.cmp(b),
        }
    }

    pub fn get_duplicate_port_proximity(&self) -> f64 {
        self.options
            .duplicate_port_proximity
            .unwrap_or(DUPLICATE_PORT_PROXIMITY)
    }

    pub fn get_individual_route_solve_options(&self) -> TinyHyperGraphSolverOptions {
        let mut options = self.options.route_solve_options.clone().unwrap_or_default();
        if options.rip_threshold_ramp_attempts.is_none() {
            options.rip_threshold_ramp_attempts = Some(0.0);
        }

        if options.static_reachability_precheck.is_none() {
            options.static_reachability_precheck = Some(false);
        }

        options
    }

    pub fn get_port_use_counts(&self) -> Result<BTreeMap<String, usize>, String> {
        let loaded = load_serialized_hyper_graph(&self.serialized_hyper_graph);
        let topology = loaded.topology;
        let mut problem = loaded.problem;
        if self.options.use_serialized_port_penalties == Some(false) {
            problem.port_penalty = None;
        }

        let mut counts = BTreeMap::new();

        for route in 0..problem.route_count {
            let route_problem = create_single_route_problem(&problem, route as i32);
            let mut solver = TinyHyperGraphSolver::new(
                topology.clone(),
                route_problem,
                Some(self.get_individual_route_solve_options()),
            );
            solver.solve();
            if !solver.solved || solver.failed {
                return Err(format!(
                    "Route {route} could not be solved independently: {}",
                    solver.error.as_deref().unwrap_or("unknown error")
                ));
            }

            for port in get_used_port_ids_for_solved_route(&solver) {
                *counts
                    .entry(get_serialized_port_id(&topology, port))
                    .or_insert(0) += 1;
            }
        }

        Ok(counts)
    }

    pub fn duplicate_congested_ports(
        &mut self,
        counts: BTreeMap<String, usize>,
    ) -> Result<Value, String> {
        let proximity = self.get_duplicate_port_proximity();
        if !(proximity > 0.0) {
            return Err("duplicatePortProximity must be greater than zero".into());
        }

        let mut graph = self.serialized_hyper_graph.clone();
        graph
            .as_object_mut()
            .expect("serialized graph object")
            .remove("solvedRoutes");
        let mut regions = graph["regions"].as_array().expect("regions").clone();
        let mut ports = graph["ports"].as_array().expect("ports").clone();
        let mut region_by_id: HashMap<String, Value> = regions
            .iter()
            .map(|r| {
                (
                    r["regionId"].as_str().expect("region id").to_owned(),
                    r.clone(),
                )
            })
            .collect();
        let source_by_id: HashMap<String, Value> = ports
            .iter()
            .map(|p| (p["portId"].as_str().expect("port id").to_owned(), p.clone()))
            .collect();
        let mut used: HashSet<_> = source_by_id.keys().cloned().collect();
        let mut duplicated = vec![];

        let mut ordered_counts: Vec<_> = counts.iter().collect();
        ordered_counts.sort_by(|(a, _), (b, _)| (self.compare_port_ids)(a, b));
        for (source_id, &use_count) in ordered_counts {
            if use_count <= 1 {
                continue;
            }

            let Some(source) = source_by_id.get(source_id) else {
                continue;
            };
            let duplicate_count = use_count - 1;
            let nearest = find_nearest_port_on_same_boundary(
                source,
                self.serialized_hyper_graph["ports"]
                    .as_array()
                    .expect("ports"),
                self.hypot,
            );
            let direction = get_duplicate_direction(source, nearest, &region_by_id, self.hypot);
            let point = get_port_point(source);
            let mut ids = vec![];

            for index in 1..=duplicate_count {
                let id = create_duplicate_port_id(source_id, index, &mut used);
                let offset = proximity * index as f64 / (duplicate_count + 1) as f64;
                let mut data = to_object_record(source.get("d"));
                data["x"] = json!(point.x + direction.x * offset);
                data["y"] = json!(point.y + direction.y * offset);
                data["duplicatedFromPortId"] = json!(source_id);
                data["duplicateIndex"] = json!(index);
                data["duplicatePortUseCount"] = json!(use_count);
                data["duplicatePortProximity"] = json!(proximity);
                data["repairReason"] = json!("congested-port");
                let mut duplicate = source.clone();
                duplicate["portId"] = json!(id);
                duplicate["d"] = data;
                ports.push(duplicate);
                ids.push(id);
            }

            for region_id in [source["region1Id"].as_str(), source["region2Id"].as_str()]
                .into_iter()
                .flatten()
            {
                if let Some(region) = region_by_id.get_mut(region_id) {
                    insert_duplicate_port_ids_after_source(
                        region["pointIds"].as_array_mut().expect("region point ids"),
                        source_id,
                        &ids,
                    );
                }
            }

            duplicated.push(DuplicatedPortSummary {
                source_port_id: source_id.clone(),
                duplicate_port_ids: ids,
                use_count,
            });
        }

        for region in &mut regions {
            *region = region_by_id
                .remove(region["regionId"].as_str().expect("region id"))
                .expect("retained region");
        }

        self.report = DuplicateCongestedPortSolverReport {
            port_use_counts: counts,
            duplicated_ports: duplicated,
        };
        graph["regions"] = json!(regions);
        graph["ports"] = json!(ports);
        Ok(graph)
    }

    pub fn setup(&mut self) -> () {
        let result = self
            .get_port_use_counts()
            .and_then(|counts| self.duplicate_congested_ports(counts));
        match result {
            Ok(graph) => {
                self.revised_serialized_hyper_graph = Some(graph);
                self.stats["duplicateSourcePortCount"] = json!(self.report.duplicated_ports.len());
                self.stats["duplicatedPortCount"] = json!(
                    self.report
                        .duplicated_ports
                        .iter()
                        .map(|p| p.duplicate_port_ids.len())
                        .sum::<usize>()
                );
                self.solved = true;
            }

            Err(error) => {
                self.failed = true;
                self.error = Some(error);
            }
        }
    }

    pub fn step(&mut self) -> () {
        if !self.failed {
            self.solved = true;
        }
    }

    pub fn solve(&mut self) -> () {
        self.setup();
    }

    pub fn get_output(&self) -> &Value {
        assert!(
            !self.failed,
            "DuplicateCongestedPortSolver does not have a repaired topology output"
        );
        self.revised_serialized_hyper_graph
            .as_ref()
            .expect("DuplicateCongestedPortSolver does not have a repaired topology output")
    }
}
