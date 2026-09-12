use crate::bindings::high_density::specialized_base_solver::{BaseSolverState, SpecializedSolver};
use crate::bindings::high_density::specialized_utils::{
    clone_and_shuffle_array::clone_and_shuffle_array,
    generate_color_map_from_node_with_port_points::generate_color_map_from_node_with_port_points,
    get_bounds_from_node_with_port_points::{Bounds, get_bounds_from_node_with_port_points},
    get_port_pairs::{PortPairMap, get_port_pair_map},
    math::{Point, SpecializedMath, clamp, distance, get_segment_intersection},
};
use crate::utils::js_number::js_number_to_string;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::ops::Deref;
use std::rc::Rc;

// Coordinates are cached without validating them: source branches can skip malformed
// points before reading a required coordinate. The original JSON remains immutable.
#[derive(Clone)]
pub struct PathPoint {
    raw: Rc<Value>,
    x: Option<f64>,
    y: Option<f64>,
    z: Option<f64>,
}

impl From<Value> for PathPoint {
    fn from(raw: Value) -> Self {
        Self {
            x: raw["x"].as_f64(),
            y: raw["y"].as_f64(),
            z: raw["z"].as_f64(),
            raw: Rc::new(raw),
        }
    }
}

impl Deref for PathPoint {
    type Target = Value;
    fn deref(&self) -> &Value {
        &self.raw
    }
}

impl Serialize for PathPoint {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.raw.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for PathPoint {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Value::deserialize(deserializer).map(Self::from)
    }
}

impl PathPoint {
    pub fn coordinates(&self) -> (Option<f64>, Option<f64>, Option<f64>) {
        (self.x, self.y, self.z)
    }

    fn point(&self) -> Point {
        Point {
            x: self.x.expect("Point x required"),
            y: self.y.expect("Point y required"),
        }
    }
}

fn point(value: &Value) -> Point {
    Point {
        x: value["x"].as_f64().expect("Point x required"),
        y: value["y"].as_f64().expect("Point y required"),
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViaPossibilitiesSolver2 {
    #[serde(flatten)]
    pub base: BaseSolverState,
    pub bounds: Bounds,
    pub max_via_count: usize,
    pub port_pair_map: PortPairMap,
    pub color_map: Value,
    pub node_width: f64,
    pub available_z: Vec<f64>,
    pub hyper_parameters: Value,
    #[serde(rename = "VIA_INTERSECTION_BUFFER_DISTANCE")]
    pub via_intersection_buffer_distance: f64,
    #[serde(rename = "PLACEHOLDER_WALL_BUFFER_DISTANCE")]
    pub placeholder_wall_buffer_distance: f64,
    #[serde(rename = "NEW_HEAD_WALL_BUFFER_DISTANCE")]
    pub new_head_wall_buffer_distance: f64,
    pub via_diameter: f64,
    pub unprocessed_connections: Vec<String>,
    pub completed_paths: IndexMap<String, Vec<PathPoint>>,
    pub placeholder_paths: IndexMap<String, Vec<PathPoint>>,
    pub current_head: PathPoint,
    pub current_connection_name: String,
    pub current_path: Vec<PathPoint>,
    pub current_via_count: usize,
    pub stats: Value,
    pub solved_routes: Vec<Value>,
    #[serde(skip)]
    pub math: SpecializedMath,
}

impl ViaPossibilitiesSolver2 {
    pub fn new(params: Value) -> Result<Self, String> {
        Self::new_with_math(params, SpecializedMath::default())
    }

    pub fn new_with_math(params: Value, math: SpecializedMath) -> Result<Self, String> {
        Self::new_from_borrowed_inputs(
            &params["nodeWithPortPoints"],
            params.get("colorMap"),
            &params["hyperParameters"],
            &params["viaDiameter"],
            math,
        )
    }

    pub(crate) fn new_from_borrowed_inputs(
        node: &Value,
        color_map: Option<&Value>,
        hyper_parameters: &Value,
        via_diameter: &Value,
        math: SpecializedMath,
    ) -> Result<Self, String> {
        let bounds = get_bounds_from_node_with_port_points(node);
        let port_pair_map = get_port_pair_map(node);
        let mut unprocessed_connections: Vec<_> = port_pair_map.keys().cloned().collect();
        unprocessed_connections.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        if let Some(seed) = hyper_parameters["SHUFFLE_SEED"]
            .as_f64()
            .filter(|v| *v != 0.0 && !v.is_nan())
        {
            unprocessed_connections = clone_and_shuffle_array(&unprocessed_connections, seed);
        }
        let mut solver = Self {
            base: BaseSolverState {
                max_iterations: 100_000.0,
                ..Default::default()
            },
            bounds,
            max_via_count: 5,
            port_pair_map,
            color_map: color_map
                .filter(|v| !v.is_null())
                .cloned()
                .unwrap_or_else(|| generate_color_map_from_node_with_port_points(node)),
            node_width: bounds.max_x - bounds.min_x,
            available_z: node["availableZ"]
                .as_array()
                .map(|values| {
                    values
                        .iter()
                        .map(|v| v.as_f64().expect("Layer number"))
                        .collect()
                })
                .unwrap_or(vec![0.0, 1.0]),
            hyper_parameters: if hyper_parameters.is_null() {
                json!({"SHUFFLE_SEED":0})
            } else {
                hyper_parameters.clone()
            },
            via_intersection_buffer_distance: 0.05,
            placeholder_wall_buffer_distance: 0.1,
            new_head_wall_buffer_distance: 0.05,
            via_diameter: via_diameter.as_f64().unwrap_or(0.3),
            unprocessed_connections,
            completed_paths: IndexMap::new(),
            placeholder_paths: IndexMap::new(),
            current_head: Value::Null.into(),
            current_connection_name: String::new(),
            current_path: vec![],
            current_via_count: 0,
            stats: json!({"solutionsFound":0}),
            solved_routes: vec![],
            math,
        };
        for (name, pair) in &solver.port_pair_map {
            let start = &pair.start;
            let end = &pair.end;
            if end.is_null() {
                return Err(format!("Missing end port for {name}"));
            }
            let a = point(start);
            let b = point(end);
            let path = if start["z"].as_f64() == end["z"].as_f64() {
                if (a.x - b.x).abs() < 1e-9 || (a.y - b.y).abs() < 1e-9 {
                    vec![
                        start.clone(),
                        solver.pad_by_placeholder_wall_buffer(start),
                        solver.pad_by_placeholder_wall_buffer(end),
                        end.clone(),
                    ]
                } else {
                    vec![start.clone(), end.clone()]
                }
            } else {
                let x = (a.x + b.x) / 2.0;
                let y = (a.y + b.y) / 2.0;
                vec![
                    start.clone(),
                    solver.pad_by_placeholder_wall_buffer(start),
                    solver.pad_by_placeholder_wall_buffer(&json!({"x":x,"y":y,"z":start["z"]})),
                    solver.pad_by_placeholder_wall_buffer(&json!({"x":x,"y":y,"z":end["z"]})),
                    solver.pad_by_placeholder_wall_buffer(end),
                    end.clone(),
                ]
            };
            solver.placeholder_paths.insert(
                name.clone(),
                path.into_iter().map(PathPoint::from).collect(),
            );
        }
        solver.current_connection_name = solver
            .unprocessed_connections
            .pop()
            .ok_or("Missing initial connection")?;
        let start = solver.port_pair_map[&solver.current_connection_name]
            .start
            .clone();
        solver.current_head = solver.pad_by_new_head_wall_buffer(&start).into();
        solver.current_path = vec![start.into(), solver.current_head.clone()];
        solver
            .placeholder_paths
            .shift_remove(&solver.current_connection_name);
        Ok(solver)
    }

    pub fn pad_by_new_head_wall_buffer(&self, value: &Value) -> Value {
        let p = point(value);
        json!({"x":clamp(p.x,self.bounds.min_x+self.new_head_wall_buffer_distance,self.bounds.max_x-self.new_head_wall_buffer_distance),
            "y":clamp(p.y,self.bounds.min_y+self.new_head_wall_buffer_distance,self.bounds.max_y-self.new_head_wall_buffer_distance),"z":value["z"]})
    }

    pub fn pad_by_placeholder_wall_buffer(&self, value: &Value) -> Value {
        let p = point(value);
        json!({"x":clamp(p.x,self.bounds.min_x+self.placeholder_wall_buffer_distance,self.bounds.max_x-self.placeholder_wall_buffer_distance),
            "y":clamp(p.y,self.bounds.min_y+self.placeholder_wall_buffer_distance,self.bounds.max_y-self.placeholder_wall_buffer_distance),"z":value["z"]})
    }

    pub fn visualize(&self, transparentize: &dyn Fn(&str, f64) -> String) -> Value {
        let mut points = vec![];
        let mut lines = vec![
            json!({"points":[{"x":self.bounds.min_x,"y":self.bounds.min_y},{"x":self.bounds.max_x,"y":self.bounds.min_y},
            {"x":self.bounds.max_x,"y":self.bounds.max_y},{"x":self.bounds.min_x,"y":self.bounds.max_y},{"x":self.bounds.min_x,"y":self.bounds.min_y}],"strokeColor":"gray","strokeWidth":0.01}),
        ];
        let mut circles = vec![];
        for (name, pair) in &self.port_pair_map {
            let color = self.color_map[name].as_str().unwrap_or("black");
            for (label, value) in [("Start", &pair.start), ("End", &pair.end)] {
                points.push(json!({"x":value["x"],"y":value["y"],"color":color,
                    "label":format!("Port: {name} {label} (z{})",js_number_to_string(value["z"].as_f64().unwrap()))}));
            }
        }
        for (prefix, paths) in [
            ("Placeholder", &self.placeholder_paths),
            ("Completed", &self.completed_paths),
        ] {
            for (name, path) in paths {
                let color = self.color_map[name].as_str().unwrap_or("black");
                for pair in path.windows(2) {
                    let (a, b) = (&pair[0], &pair[1]);
                    let z = js_number_to_string(a["z"].as_f64().unwrap());
                    if a["x"].as_f64() == b["x"].as_f64()
                        && a["y"].as_f64() == b["y"].as_f64()
                        && a["z"].as_f64() != b["z"].as_f64()
                    {
                        circles.push(json!({"center":{"x":a["x"],"y":a["y"]},"radius":self.via_diameter/2.0,"fill":transparentize(color,0.5),
                            "label":format!("{prefix}: {name} Via (z{z}->z{})",js_number_to_string(b["z"].as_f64().unwrap()))}));
                    } else {
                        let mut line =
                            json!({"points":[a,b],"strokeColor":transparentize(color,0.5)});
                        if a["z"].as_f64() != Some(0.0) {
                            line["strokeDash"] = json!([0.1, 0.1]);
                        }
                        line["strokeWidth"] = json!(0.1);
                        line["label"] = json!(format!("{prefix}: {name} (z{z})"));
                        lines.push(line);
                    }
                }
            }
        }
        if !self.current_path.is_empty() {
            let name = &self.current_connection_name;
            let color = self.color_map[name].as_str().unwrap_or("orange");
            for pair in self.current_path.windows(2) {
                let (a, b) = (&pair[0], &pair[1]);
                let z = js_number_to_string(a["z"].as_f64().unwrap());
                if a["x"].as_f64() == b["x"].as_f64()
                    && a["y"].as_f64() == b["y"].as_f64()
                    && a["z"].as_f64() != b["z"].as_f64()
                {
                    circles.push(json!({"center":{"x":a["x"],"y":a["y"]},"radius":self.via_diameter/2.0,"fill":transparentize(color,0.5),
                        "label":format!("Current: {name} Via (z{z}->z{})",js_number_to_string(b["z"].as_f64().unwrap()))}));
                } else {
                    lines.push(json!({"points":[a,b],"strokeColor":transparentize(color,0.5),"strokeWidth":0.15,"strokeDash":"2,2","label":format!("Current: {name} (z{z})")}));
                }
            }
            points.push(json!({"x":self.current_head["x"],"y":self.current_head["y"],"color":"green", "label":format!("Current Head: {name} (z{})",js_number_to_string(self.current_head["z"].as_f64().unwrap()))}));
        }
        json!({"points":points,"lines":lines,"circles":circles,"rects":[],"title":"Via Possibilities Solver State","coordinateSystem":"cartesian"})
    }
}

impl SpecializedSolver for ViaPossibilitiesSolver2 {
    fn base(&self) -> &BaseSolverState {
        &self.base
    }
    fn base_mut(&mut self) -> &mut BaseSolverState {
        &mut self.base
    }
    fn get_solver_name(&self) -> &'static str {
        "ViaPossibilitiesSolver2"
    }

    fn _step(&mut self) -> Result<(), String> {
        if self.base.solved {
            return Ok(());
        }
        let end = self.port_pair_map[&self.current_connection_name]
            .end
            .clone();
        let head = self.current_head.point();
        let head_z = self.current_head.z;
        let target = point(&end);
        let mut closest: Option<(Point, f64, Option<f64>)> = None;
        for paths in [&self.completed_paths, &self.placeholder_paths] {
            for path in paths.values() {
                for pair in path.windows(2) {
                    let (a, b) = (&pair[0], &pair[1]);
                    if a.x == b.x && a.y == b.y {
                        continue;
                    }
                    if a.z != head_z {
                        continue;
                    }
                    if let Some(intersection) =
                        get_segment_intersection(head, target, a.point(), b.point())
                    {
                        let d = distance(head, intersection);
                        if d < 1e-6 {
                            continue;
                        }
                        if closest.as_ref().is_none_or(|(_, best, _)| d < *best) {
                            closest = Some((intersection, d, a.z));
                        }
                    }
                }
            }
        }
        let needs_z_change = head_z != end["z"].as_f64();
        if closest.is_some() || needs_z_change {
            self.current_via_count += 1;
            if self.current_via_count >= self.max_via_count {
                self.base.failed = true;
                self.base.error = Some(format!("Exceeded max via count of {}", self.max_via_count));
                return Ok(());
            }
        }
        if let Some((intersection, d, intersected_z)) = closest {
            let (x, y) = if d <= self.via_intersection_buffer_distance + 1e-6 {
                (
                    (head.x + intersection.x) / 2.0,
                    (head.y + intersection.y) / 2.0,
                )
            } else {
                let ratio = (d - self.via_intersection_buffer_distance) / d;
                (
                    head.x + (intersection.x - head.x) * ratio,
                    head.y + (intersection.y - head.y) * ratio,
                )
            };
            let Some(next_z) = self
                .available_z
                .iter()
                .find(|&&z| Some(z) != intersected_z)
                .copied()
            else {
                self.base.error =
                    Some("Could not determine next Z level for via placement!".into());
                self.base.failed = true;
                return Ok(());
            };
            let first = PathPoint::from(json!({"x":x,"y":y,"z":self.current_head["z"]}));
            let second = PathPoint::from(json!({"x":x,"y":y,"z":next_z}));
            self.current_path.extend([first, second.clone()]);
            self.current_head = second;
        } else if needs_z_change {
            let d = distance(head, target);
            let (x, y) = if d < self.via_intersection_buffer_distance {
                ((head.x + target.x) / 2.0, (head.y + target.y) / 2.0)
            } else {
                let ratio = (d - self.via_intersection_buffer_distance) / d;
                (
                    head.x + (target.x - head.x) * ratio,
                    head.y + (target.y - head.y) * ratio,
                )
            };
            let first = PathPoint::from(json!({"x":x,"y":y,"z":self.current_head["z"]}));
            let second = PathPoint::from(json!({"x":x,"y":y,"z":end["z"]}));
            self.current_path.extend([first, second.clone()]);
            self.current_head = second;
        } else {
            self.current_path.push(end.into());
            self.completed_paths.insert(
                self.current_connection_name.clone(),
                self.current_path.clone(),
            );
            if self.unprocessed_connections.is_empty() {
                self.base.solved = true;
                self.stats["solutionsFound"] = json!(1);
            } else {
                self.current_connection_name = self.unprocessed_connections.pop().unwrap();
                let start = self.port_pair_map[&self.current_connection_name]
                    .start
                    .clone();
                self.current_head = self.pad_by_new_head_wall_buffer(&start).into();
                self.current_path = vec![start.into(), self.current_head.clone()];
                self.current_via_count = 0;
                self.placeholder_paths
                    .shift_remove(&self.current_connection_name);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_paths_preserve_raw_metadata_restore_and_skipped_invalid_points() {
        let raw: Value = serde_json::from_str(
            r#"{"metadata":{"label":"retained"},"y":-0.0,"x":1.25,"z":0,"tail":[1,null]}"#,
        )
        .unwrap();
        let typed = PathPoint::from(raw.clone());
        assert_eq!(
            serde_json::to_string(&typed).unwrap(),
            serde_json::to_string(&raw).unwrap()
        );
        assert!(Rc::ptr_eq(&typed.raw, &typed.clone().raw));
        let mut solver = ViaPossibilitiesSolver2::new(json!({
            "nodeWithPortPoints": {"center":{"x":0,"y":0},"width":4,"height":4,"availableZ":[0,1],
                "portPoints":[{"connectionName":"a","x":-1,"y":0,"z":0,"metadata":{"source":1}},
                    {"connectionName":"a","x":1,"y":0,"z":0,"metadata":{"source":2}}]}
        }))
        .unwrap();
        let borrowed_node = json!({"center":{"x":0,"y":0},"width":4,"height":4,"availableZ":[0,1],
            "portPoints":[{"connectionName":"a","x":-1,"y":0,"z":0,"metadata":{"source":1}},
                {"connectionName":"a","x":1,"y":0,"z":0,"metadata":{"source":2}}]});
        let before = borrowed_node.clone();
        let borrowed = ViaPossibilitiesSolver2::new_from_borrowed_inputs(
            &borrowed_node,
            None,
            &Value::Null,
            &Value::Null,
            SpecializedMath::default(),
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(&borrowed).unwrap(),
            serde_json::to_value(&solver).unwrap()
        );
        assert_eq!(borrowed_node, before);
        assert_eq!(borrowed.via_diameter, 0.3);
        assert_eq!(borrowed.hyper_parameters, json!({"SHUFFLE_SEED":0}));
        let mut snapshot = serde_json::to_value(&solver).unwrap();
        snapshot["currentHead"] = json!({"metadata":{"restored":true},"x":-0.75,"y":0,"z":1});
        snapshot["currentPath"][1] = snapshot["currentHead"].clone();
        snapshot["portPairMap"]["a"]["end"]["z"] = json!(1);
        // Missing coordinates are skipped for identical points; differing invalid
        // coordinates are skipped when the segment is on a different layer.
        snapshot["placeholderPaths"] = json!({"invalid":[{"z":1},{"z":1}],
            "otherLayer":[{"x":"bad","y":0,"z":0},{"x":1,"y":1,"z":0}]});
        solver = serde_json::from_value(snapshot.clone()).unwrap();
        assert_eq!(
            solver.current_head.coordinates(),
            (Some(-0.75), Some(0.0), Some(1.0))
        );
        assert_eq!(serde_json::to_value(&solver).unwrap(), snapshot);
        solver._step().unwrap();
        assert!(solver.base.solved);
        assert_eq!(solver.current_via_count, 0);
        let output = serde_json::to_value(&solver.completed_paths["a"]).unwrap();
        assert_eq!(output[1], snapshot["currentHead"]);
        assert_eq!(output[2], snapshot["portPairMap"]["a"]["end"]);
        let padded =
            solver.pad_by_new_head_wall_buffer(&json!({"x":-9,"y":9,"z":"raw-layer","extra":true}));
        assert_eq!(padded, json!({"x":-1.95,"y":1.95,"z":"raw-layer"}));
    }
}
