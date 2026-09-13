use super::math::{Point, do_segments_intersect};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossingCounts {
    pub num_same_layer_crossings: usize,
    pub num_entry_exit_layer_changes: usize,
    pub num_transition_pair_crossings: usize,
}
struct Pair {
    name: String,
    z: f64,
    points: Vec<(Point, f64)>,
}

pub fn get_intra_node_crossings(node: &Value) -> CrossingCounts {
    let ports = node["portPoints"]
        .as_array()
        .expect("portPoints is required");
    let mut pairs: Vec<Pair> = Vec::new();
    let mut transitions: Vec<Pair> = Vec::new();
    for a in ports {
        let name = a["connectionName"]
            .as_str()
            .expect("connectionName is required");
        if pairs.iter().any(|p| p.name == name) || transitions.iter().any(|p| p.name == name) {
            continue;
        }
        let point = Point::from_value(a);
        let z = a["z"].as_f64().unwrap_or(f64::NAN);
        let integer = |p: Point| Point {
            x: crate::solvers::high_density_solver::geometry::js_round(p.x * 10000.0),
            y: crate::solvers::high_density_solver::geometry::js_round(p.y * 10000.0),
        };
        let mut pair = Pair {
            name: name.to_owned(),
            z,
            points: vec![(integer(point), z)],
        };
        for b in ports {
            if a["connectionName"] != b["connectionName"] {
                continue;
            }
            let bpoint = Point::from_value(b);
            if point.x == bpoint.x && point.y == bpoint.y {
                continue;
            }
            pair.points
                .push((integer(bpoint), b["z"].as_f64().unwrap_or(f64::NAN)));
        }
        if pair.points.iter().any(|p| p.1 != pair.z) {
            transitions.push(pair);
            continue;
        }
        pairs.push(pair);
    }
    pairs.retain(|p| p.points.len() > 1);
    let mut result = CrossingCounts {
        num_entry_exit_layer_changes: transitions.len(),
        ..Default::default()
    };
    for i in 0..pairs.len() {
        for j in i + 1..pairs.len() {
            let a = &pairs[i];
            let b = &pairs[j];
            if a.z == b.z
                && do_segments_intersect(a.points[0].0, a.points[1].0, b.points[0].0, b.points[1].0)
            {
                result.num_same_layer_crossings += 1;
            }
        }
    }
    for i in 0..transitions.len() {
        for j in i + 1..transitions.len() {
            let a = &transitions[i];
            let b = &transitions[j];
            if do_segments_intersect(a.points[0].0, a.points[1].0, b.points[0].0, b.points[1].0) {
                result.num_transition_pair_crossings += 1;
            }
        }
    }
    result
}
