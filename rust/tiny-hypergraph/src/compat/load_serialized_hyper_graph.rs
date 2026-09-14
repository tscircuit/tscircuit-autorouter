use crate::core::{TinyHyperGraphProblem, TinyHyperGraphSolution, TinyHyperGraphTopology};
use crate::initial_assignments::TinyHyperGraphInitialAssignment;
use crate::layer_labels::{get_available_z_from_mask, get_z_layer_label};
use serde_json::{Value, json};
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

#[derive(serde::Serialize)]
#[cfg_attr(feature = "wasm-types", derive(tsify::Tsify))]
pub struct LoadedHyperGraph {
    pub topology: TinyHyperGraphTopology,
    pub problem: TinyHyperGraphProblem,
    pub solution: TinyHyperGraphSolution,
}

pub(crate) fn items(value: &Value) -> &[Value] {
    match value.as_array() {
        Some(values) => values,
        None if value.is_null() => &[],
        None => panic!("Expected an array"),
    }
}

pub(crate) fn number(value: &Value, default: f64) -> f64 {
    match value {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => {
            if s.trim().is_empty() {
                0.0
            } else {
                s.parse().unwrap_or(f64::NAN)
            }
        }

        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }

        Value::Null => default,
        _ => f64::NAN,
    }
}

fn region_net(region: &Value) -> Option<i32> {
    let data = &region["d"];
    let net = if data["netId"].is_number() {
        &data["netId"]
    } else {
        &data["NetId"]
    };
    net.as_f64().filter(|n| n.is_finite()).map(|n| n as i32)
}

fn filter_obstacle_regions(graph: &Value) -> Cow<'_, Value> {
    let connected: HashSet<&str> = items(&graph["connections"])
        .iter()
        .flat_map(|c| {
            [
                c["startRegionId"].as_str().unwrap(),
                c["endRegionId"].as_str().unwrap(),
            ]
        })
        .collect();
    let removed: HashSet<&str> = items(&graph["regions"])
        .iter()
        .filter(|r| {
            r["d"]["_containsObstacle"] == true
                && (region_net(r).is_none() || region_net(r) == Some(-1))
                && !connected.contains(r["regionId"].as_str().unwrap())
        })
        .map(|r| r["regionId"].as_str().unwrap())
        .collect();
    if removed.is_empty() {
        return Cow::Borrowed(graph);
    }

    let mut result = graph.clone();
    result["regions"] = json!(
        items(&graph["regions"])
            .iter()
            .filter(|r| !removed.contains(r["regionId"].as_str().unwrap()))
            .collect::<Vec<_>>()
    );
    result["ports"] = json!(
        items(&graph["ports"])
            .iter()
            .filter(|p| !removed.contains(p["region1Id"].as_str().unwrap())
                && !removed.contains(p["region2Id"].as_str().unwrap()))
            .collect::<Vec<_>>()
    );

    for c in items(&graph["connections"]) {
        assert!(
            !removed.contains(c["startRegionId"].as_str().unwrap())
                && !removed.contains(c["endRegionId"].as_str().unwrap()),
            "Connection {} references full-obstacle region",
            c["connectionId"]
        );
    }

    Cow::Owned(result)
}

pub(crate) fn metadata(data: &Value, key: &str, id: &Value, layer: String) -> Value {
    let mut result = if data.is_object() {
        data.clone()
    } else {
        json!({"value": data})
    };
    result["layer"] = json!(layer);
    // Rust JSON has no non-enumerable properties; converters remove this transport key.
    result[key] = id.clone();
    result
}

pub(crate) fn get_region_bounds(region: &Value) -> [f64; 4] {
    let d = &region["d"];
    if d["bounds"].is_object() {
        let b = &d["bounds"];
        return [
            number(&b["minX"], 0.0),
            number(&b["maxX"], 0.0),
            number(&b["minY"], 0.0),
            number(&b["maxY"], 0.0),
        ];
    }

    if let (Some(x), Some(y), Some(w), Some(h)) = (
        d["center"]["x"].as_f64(),
        d["center"]["y"].as_f64(),
        d["width"].as_f64(),
        d["height"].as_f64(),
    ) {
        return [x - w / 2.0, x + w / 2.0, y - h / 2.0, y + h / 2.0];
    }

    [0.0; 4]
}

fn compute_port_angle(port: &Value, region: &Value) -> i32 {
    let [min_x, max_x, min_y, max_y] = get_region_bounds(region);
    let x = number(&port["d"]["x"], 0.0);
    let y = number(&port["d"]["y"], 0.0);
    let within_x = min_x <= x && x <= max_x;
    let within_y = min_y <= y && y <= max_y;
    let width = (max_x - min_x).max(1e-9);
    let height = (max_y - min_y).max(1e-9);
    let round = |v: f64| (v + 0.5).floor() as i32;
    if within_y && x >= max_x {
        return round((y - min_y) / height * 9000.0);
    }

    if within_x && y >= max_y {
        return 9000 + round((max_x - x) / width * 9000.0);
    }

    if within_y && x <= min_x {
        return 18000 + round((max_y - y) / height * 9000.0);
    }

    if within_x && y <= min_y {
        return 27000 + round((x - min_x) / width * 9000.0);
    }

    let left = (x - min_x).abs();
    let right = (x - max_x).abs();
    let bottom = (y - min_y).abs();
    let top = (y - max_y).abs();
    let closest = left.min(right).min(bottom).min(top);
    if closest == right {
        round((y - min_y) / height * 9000.0)
    } else if closest == top {
        9000 + round((max_x - x) / width * 9000.0)
    } else if closest == left {
        18000 + round((max_y - y) / height * 9000.0)
    } else {
        27000 + round((x - min_x) / width * 9000.0)
    }
}

fn centermost_port(region: &Value, ports: &HashMap<String, &Value>) -> Option<String> {
    let mut ids: Vec<String> = items(&region["pointIds"])
        .iter()
        .map(|p| p.as_str().unwrap().to_owned())
        .collect();
    ids.sort_by(|a, b| {
        let pa = ports.get(a).copied().unwrap_or(&Value::Null);
        let pb = ports.get(b).copied().unwrap_or(&Value::Null);
        number(&pa["d"]["distToCentermostPortOnZ"], f64::INFINITY)
            .total_cmp(&number(&pb["d"]["distToCentermostPortOnZ"], f64::INFINITY))
            .then_with(|| number(&pa["d"]["z"], 0.0).total_cmp(&number(&pb["d"]["z"], 0.0)))
            .then_with(|| a.cmp(b))
    });
    ids.into_iter().next()
}

pub fn load_serialized_hyper_graph(graph: &Value) -> LoadedHyperGraph {
    let filtered = filter_obstacle_regions(graph);
    let regions = items(&filtered["regions"]);
    let ports = items(&filtered["ports"]);
    let region_ids: HashMap<String, i32> = regions
        .iter()
        .enumerate()
        .map(|(i, r)| (r["regionId"].as_str().unwrap().to_owned(), i as i32))
        .collect();
    let port_ids: HashMap<String, i32> = ports
        .iter()
        .enumerate()
        .map(|(i, p)| (p["portId"].as_str().unwrap().to_owned(), i as i32))
        .collect();
    let port_by_id: HashMap<String, &Value> = ports
        .iter()
        .map(|p| (p["portId"].as_str().unwrap().to_owned(), p))
        .collect();
    let solved: HashMap<String, &Value> = items(&filtered["solvedRoutes"])
        .iter()
        .map(|r| {
            (
                r["connection"]["connectionId"].as_str().unwrap().to_owned(),
                r,
            )
        })
        .collect();
    let region_count = regions.len();
    let port_count = ports.len();
    let region_incident_ports: Vec<Vec<i32>> = regions
        .iter()
        .map(|r| {
            items(&r["pointIds"])
                .iter()
                .filter_map(|p| port_ids.get(p.as_str().unwrap()).copied())
                .collect()
        })
        .collect();
    let mut incident_port_region = vec![vec![]; port_count];
    let mut region_width = vec![0.0; region_count];
    let mut region_height = region_width.clone();
    let mut region_center_x = region_width.clone();
    let mut region_center_y = region_width.clone();
    let mut region_available_z_mask = vec![0; region_count];
    let mut region_net_id = vec![-1; region_count];
    let mut has_serialized_net = vec![false; region_count];

    for (i, r) in regions.iter().enumerate() {
        let [min_x, max_x, min_y, max_y] = get_region_bounds(r);
        let d = &r["d"];
        region_width[i] = d["width"].as_f64().unwrap_or(max_x - min_x);
        region_height[i] = d["height"].as_f64().unwrap_or(max_y - min_y);
        region_center_x[i] = d["center"]["x"].as_f64().unwrap_or((min_x + max_x) / 2.0);
        region_center_y[i] = d["center"]["y"].as_f64().unwrap_or((min_y + max_y) / 2.0);

        for z in items(&d["availableZ"]) {
            if let Some(z) = z.as_i64()
                && (0..31).contains(&z)
            {
                region_available_z_mask[i] |= 1 << z;
            }
        }

        if let Some(net) = region_net(r) {
            region_net_id[i] = net;
            has_serialized_net[i] = true;
        }
    }

    let mut port_x = vec![0.0; port_count];
    let mut port_y = port_x.clone();
    let mut port_z = vec![0; port_count];
    let mut angle1 = port_z.clone();
    let mut angle2 = port_z.clone();
    let mut shared_region_pairs = HashSet::with_capacity(port_count);

    for (i, p) in ports.iter().enumerate() {
        let a = *region_ids
            .get(p["region1Id"].as_str().unwrap())
            .unwrap_or_else(|| {
                panic!(
                    "Port {} references missing region {}",
                    p["portId"], p["region1Id"]
                )
            });
        let b = *region_ids
            .get(p["region2Id"].as_str().unwrap())
            .unwrap_or_else(|| {
                panic!(
                    "Port {} references missing region {}",
                    p["portId"], p["region2Id"]
                )
            });
        incident_port_region[i] = vec![a, b];
        shared_region_pairs.insert((a.min(b), a.max(b)));
        port_x[i] = number(&p["d"]["x"], 0.0);
        port_y[i] = number(&p["d"]["y"], 0.0);
        let z = number(&p["d"]["z"], 0.0);
        port_z[i] = if z.is_finite() { z as i32 } else { 0 };
        angle1[i] = compute_port_angle(p, &regions[a as usize]);
        angle2[i] = compute_port_angle(p, &regions[b as usize]);
    }

    let region_metadata = regions
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let layer = get_z_layer_label(&get_available_z_from_mask(region_available_z_mask[i]))
                .or_else(|| {
                    get_z_layer_label(
                        &region_incident_ports[i]
                            .iter()
                            .map(|p| port_z[*p as usize])
                            .collect::<Vec<_>>(),
                    )
                })
                .unwrap_or_else(|| "z0".into());
            metadata(&r["d"], "serializedRegionId", &r["regionId"], layer)
        })
        .collect();
    let port_metadata = ports
        .iter()
        .enumerate()
        .map(|(i, p)| {
            metadata(
                &p["d"],
                "serializedPortId",
                &p["portId"],
                get_z_layer_label(&[port_z[i]]).unwrap_or_else(|| "z0".into()),
            )
        })
        .collect();
    let connections = items(&filtered["connections"]);
    let mut nets = HashMap::<String, i32>::new();
    let mut candidates = vec![HashSet::<i32>::new(); region_count];

    for c in connections {
        let key = c["mutuallyConnectedNetworkId"]
            .as_str()
            .or_else(|| c["connectionId"].as_str())
            .unwrap()
            .to_owned();
        let next = nets.len() as i32;
        let net = *nets.entry(key).or_insert(next);

        for endpoint in ["startRegionId", "endRegionId"] {
            let region = *region_ids
                .get(c[endpoint].as_str().unwrap())
                .unwrap_or_else(|| panic!("Connection references missing region {}", c[endpoint]));
            candidates[region as usize].insert(net);
        }
    }

    for i in 0..region_count {
        if !has_serialized_net[i] && candidates[i].len() == 1 {
            region_net_id[i] = *candidates[i].iter().next().unwrap();
        }
    }

    let routable: Vec<&Value> = connections
        .iter()
        .filter(|c| {
            let start = region_ids[c["startRegionId"].as_str().unwrap()];
            let end = region_ids[c["endRegionId"].as_str().unwrap()];
            let shared = shared_region_pairs.contains(&(start.min(end), start.max(end)));
            !shared
                || solved
                    .get(c["connectionId"].as_str().unwrap())
                    .map(|r| items(&r["path"]).len())
                    .unwrap_or(0)
                    > 1
        })
        .collect();
    let route_count = routable.len();
    let mut route_start_port = vec![0; route_count];
    let mut route_end_port = route_start_port.clone();
    let mut route_net = route_start_port.clone();
    let route_ids: HashMap<String, i32> = routable
        .iter()
        .enumerate()
        .map(|(i, c)| (c["connectionId"].as_str().unwrap().to_owned(), i as i32))
        .collect();

    for (i, c) in routable.iter().enumerate() {
        let route = solved.get(c["connectionId"].as_str().unwrap());
        let path = route.map(|r| items(&r["path"])).unwrap_or(&[]);

        for (field, endpoint, is_start) in [
            ("startRegionId", &mut route_start_port, true),
            ("endRegionId", &mut route_end_port, false),
        ] {
            let region = &regions[*region_ids.get(c[field].as_str().unwrap()).unwrap() as usize];
            let candidate = if is_start { path.first() } else { path.last() };
            let id = candidate
                .and_then(|v| v["portId"].as_str())
                .map(str::to_owned)
                .or_else(|| centermost_port(region, &port_by_id));
            endpoint[i] = id
                .and_then(|id| port_ids.get(&id).copied())
                .unwrap_or_else(|| {
                    panic!(
                        "Connection {} could not be mapped to route endpoints",
                        c["connectionId"]
                    )
                });
        }

        let key = c["mutuallyConnectedNetworkId"]
            .as_str()
            .or_else(|| c["connectionId"].as_str())
            .unwrap();
        route_net[i] = nets[key];
    }

    let mut initial_assignments = vec![];

    for (i, r) in regions.iter().enumerate() {
        for a in items(&r["assignments"]) {
            let route_id = *route_ids
                .get(a["connectionId"].as_str().unwrap())
                .unwrap_or_else(|| {
                    panic!(
                        "Region {} assignment references unknown routable connection {}",
                        r["regionId"], a["connectionId"]
                    )
                });
            let from_port_id = *port_ids
                .get(a["regionPort1Id"].as_str().unwrap())
                .expect("Region assignment references missing from port");
            let to_port_id = *port_ids
                .get(a["regionPort2Id"].as_str().unwrap())
                .expect("Region assignment references missing to port");
            assert!(
                region_incident_ports[i].contains(&from_port_id)
                    && region_incident_ports[i].contains(&to_port_id),
                "Region {} assignment ports must both belong to the region",
                r["regionId"]
            );
            initial_assignments.push(TinyHyperGraphInitialAssignment {
                route_id,
                region_id: i as i32,
                from_port_id,
                to_port_id,
            });
        }
    }

    let penalty: Vec<f64> = ports
        .iter()
        .map(|p| {
            let n = number(&p["d"]["tinyHypergraphPortPenalty"], 0.0);
            if n.is_finite() && n > 0.0 { n } else { 0.0 }
        })
        .collect();
    let topology = TinyHyperGraphTopology {
        port_count,
        region_count,
        region_incident_ports,
        incident_port_region,
        region_width,
        region_height,
        region_center_x,
        region_center_y,
        region_available_z_mask: Some(region_available_z_mask),
        region_metadata: Some(region_metadata),
        port_angle_for_region1: angle1,
        port_angle_for_region2: Some(angle2),
        port_x,
        port_y,
        port_z,
        port_metadata: Some(port_metadata),
    };
    let problem = TinyHyperGraphProblem {
        route_count,
        port_section_mask: vec![1; port_count],
        route_metadata: Some(routable.iter().map(|c| (*c).clone()).collect()),
        route_start_port,
        route_end_port,
        route_net,
        region_net_id,
        initial_assignments: if initial_assignments.is_empty() {
            None
        } else {
            Some(initial_assignments)
        },
        port_penalty: if penalty.iter().any(|n| *n > 0.0) {
            Some(penalty)
        } else {
            None
        },
    };
    let mut segments = vec![];
    let mut segment_regions = vec![];

    for c in routable {
        let path = solved
            .get(c["connectionId"].as_str().unwrap())
            .map(|r| items(&r["path"]))
            .unwrap_or(&[]);
        let mut pairs = vec![];
        let mut ids = vec![];

        for pair in path.windows(2) {
            let a = pair[0]["portId"].as_str().and_then(|id| port_ids.get(id));
            let b = pair[1]["portId"].as_str().and_then(|id| port_ids.get(id));
            if let (Some(a), Some(b)) = (a, b) {
                pairs.push((*a, *b));
                ids.push(
                    pair[0]["nextRegionId"]
                        .as_str()
                        .or_else(|| pair[1]["lastRegionId"].as_str())
                        .and_then(|id| region_ids.get(id).copied()),
                );
            }
        }

        segments.push(pairs);
        segment_regions.push(ids);
    }

    LoadedHyperGraph {
        topology,
        problem,
        solution: TinyHyperGraphSolution {
            solved_route_path_segments: segments,
            solved_route_path_region_ids: Some(segment_regions),
        },
    }
}
