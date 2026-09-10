use std::io::{self, Read};
use std::rc::Rc;
use serde::Deserialize;
use serde_json::{json, Value};
use general_router::clone_and_shuffle_array::{clone_and_shuffle_array, seeded_random};
use general_router::flatbush::Flatbush;
use general_router::geometry::{distance, do_segments_intersect, js_round, point_to_segment_distance};
use general_router::high_density_route_spatial_index::{HighDensityRouteSpatialIndex, RouteConflict};
use general_router::single_route_candidate_priority_queue::{Node, SingleRouteCandidatePriorityQueue};
use general_router::types::{Point, Route};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    queues: Vec<Vec<[f64; 2]>>,
    flatbush: Vec<FlatbushCase>,
    spatial: Vec<SpatialCase>,
    shuffles: Vec<ShuffleCase>,
    geometry: Vec<[Point; 4]>,
    rounds: Vec<f64>,
}

#[derive(Deserialize)]
struct FlatbushCase {
    boxes: Vec<[f64; 4]>,
    queries: Vec<[f64; 4]>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpatialCase {
    routes: Vec<Route>,
    cell_size: f64,
    points: Vec<(Point, f64)>,
    segments: Vec<(Point, Point, f64)>,
    remove: String,
    add: Route,
}

#[derive(Deserialize)]
struct ShuffleCase {
    values: Vec<usize>,
    seed: f64,
}

fn conflicts_value(conflicts: Vec<RouteConflict>) -> Value {
    let values: Vec<Value> = conflicts.into_iter().map(|conflict| {
        json!({
            "connectionName": conflict.conflicting_route.connection_name,
            "distance": conflict.distance,
        })
    }).collect();
    json!(values)
}

fn main() {
    let mut source = String::new();
    io::stdin().read_to_string(&mut source).unwrap();
    let input: Input = serde_json::from_str(&source).unwrap();
    let mut queues = Vec::new();
    for candidates in input.queues {
        let nodes: Vec<Rc<Node>> = candidates.iter().map(|[id, cost]| Rc::new(Node {
            x: *id, y: 0.0, z: 0.0, g: 0.0, h: 0.0, f: *cost, parent: None,
        })).collect();
        let mut queue = SingleRouteCandidatePriorityQueue::new(nodes);
        let mut observations = Vec::new();
        for turn in 0..candidates.len() + 3 {
            observations.push(json!({
                "peek": queue.peek().map(|node| node.x),
                "top": queue.get_top_n(7).iter().map(|node| node.x).collect::<Vec<_>>(),
                "dequeue": queue.dequeue().map(|node| node.x),
            }));
            if turn == 2 {
                queue.enqueue(Rc::new(Node { x: 10000.0, y: 0.0, z: 0.0, g: 0.0, h: 0.0, f: 1.0, parent: None }));
            }
        }
        queues.push(observations);
    }
    let mut flatbush = Vec::new();
    for case in input.flatbush {
        let mut index = Flatbush::new(case.boxes.len());
        let mut ids = Vec::new();
        for [min_x, min_y, max_x, max_y] in case.boxes {
            ids.push(index.add(min_x, min_y, max_x, max_y));
        }
        index.finish();
        let queries: Vec<Vec<usize>> = case.queries.into_iter().map(|[min_x, min_y, max_x, max_y]| {
            index.search(min_x, min_y, max_x, max_y)
        }).collect();
        flatbush.push(json!({ "ids": ids, "queries": queries }));
    }
    let mut spatial = Vec::new();
    for case in input.spatial {
        let mut index = HighDensityRouteSpatialIndex::new(case.routes, case.cell_size);
        let mut states = Vec::new();
        for phase in 0..3 {
            if phase == 1 { index.remove_route(&case.remove); }
            if phase == 2 { index.add_route(case.add.clone()); }
            let points: Vec<Value> = case.points.iter().map(|(point, margin)| {
                conflicts_value(index.get_conflicting_routes_near_point(point, *margin))
            }).collect();
            let segments: Vec<Value> = case.segments.iter().map(|(start, end, margin)| {
                conflicts_value(index.get_conflicting_routes_for_segment(start, end, *margin))
            }).collect();
            states.push(json!({ "points": points, "segments": segments }));
        }
        spatial.push(states);
    }
    let shuffles: Vec<Value> = input.shuffles.into_iter().map(|case| {
        let mut random = seeded_random(case.seed);
        let random_values: Vec<f64> = (0..20).map(|_| random()).collect();
        json!({ "values": clone_and_shuffle_array(&case.values, case.seed), "random": random_values })
    }).collect();
    let geometry: Vec<Value> = input.geometry.into_iter().map(|[a, b, c, d]| {
        json!({
            "distance": distance(&a, &b),
            "pointToSegmentDistance": point_to_segment_distance(&a, &b, &c),
            "intersects": do_segments_intersect(&a, &b, &c, &d),
        })
    }).collect();
    let rounds: Vec<Value> = input.rounds.into_iter().map(|value| {
        let rounded = js_round(value);
        json!({ "value": if rounded == 0.0 { 0.0 } else { rounded }, "negativeZero": rounded == 0.0 && rounded.is_sign_negative() })
    }).collect();
    println!("{}", json!({ "queues": queues, "flatbush": flatbush, "spatial": spatial, "shuffles": shuffles, "geometry": geometry, "rounds": rounds }));
}
