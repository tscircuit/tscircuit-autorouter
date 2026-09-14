use crate::core::TinyHyperGraphSolver;
use crate::layer_labels::{get_available_z_from_mask, get_z_layer_label};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

#[derive(Clone)]
struct RouteSegment {
    region_id: i32,
    from_port_id: i32,
    to_port_id: i32,
}

fn object_record(value: Option<&Value>) -> Value {
    match value {
        Some(v) if v.is_object() => v.clone(),
        Some(v) => json!({"value":v}),
        None => json!({}),
    }
}

pub(crate) fn get_serialized_region_id(solver: &TinyHyperGraphSolver, id: i32) -> String {
    let metadata = solver
        .topology
        .region_metadata
        .as_ref()
        .and_then(|m| m.get(id as usize));

    for key in ["serializedRegionId", "regionId", "capacityMeshNodeId"] {
        if let Some(id) = metadata.and_then(|m| m[key].as_str()) {
            return id.to_owned();
        }
    }

    format!("region-{id}")
}

pub(crate) fn get_serialized_port_id(solver: &TinyHyperGraphSolver, id: i32) -> String {
    let metadata = solver
        .topology
        .port_metadata
        .as_ref()
        .and_then(|m| m.get(id as usize));
    if let Some(id) = metadata.and_then(|m| m["serializedPortId"].as_str()) {
        return id.to_owned();
    }

    if let Some(id) = metadata.and_then(|m| m["portId"].as_str()) {
        return id.split("::").next().unwrap().to_owned();
    }

    format!("port-{id}")
}

fn connection_id(solver: &TinyHyperGraphSolver, id: usize) -> String {
    solver
        .problem
        .route_metadata
        .as_ref()
        .and_then(|m| m.get(id))
        .and_then(|m| m["connectionId"].as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("route-{id}"))
}

fn region_data(solver: &TinyHyperGraphSolver, id: usize) -> Value {
    let t = &solver.topology;
    let mut d = object_record(t.region_metadata.as_ref().and_then(|m| m.get(id)));
    d.as_object_mut().unwrap().remove("serializedRegionId");
    if !d["center"].is_object() {
        d["center"] = json!({"x":t.region_center_x[id],"y":t.region_center_y[id]});
    }

    if !d["width"].is_number() {
        d["width"] = json!(t.region_width[id]);
    }

    if !d["height"].is_number() {
        d["height"] = json!(t.region_height[id]);
    }

    if !d["availableZ"].is_array() {
        let mask = t
            .region_available_z_mask
            .as_ref()
            .map(|m| m[id])
            .unwrap_or(0);
        if mask != 0 {
            d["availableZ"] = json!(get_available_z_from_mask(mask));
        }
    }

    let zs: Vec<i32> = d["availableZ"]
        .as_array()
        .map(|zs| {
            zs.iter()
                .filter_map(|z| z.as_i64().map(|z| z as i32))
                .collect()
        })
        .unwrap_or_default();
    d["layer"] = json!(
        get_z_layer_label(&zs)
            .or_else(|| get_z_layer_label(
                &t.region_incident_ports[id]
                    .iter()
                    .map(|p| t.port_z[*p as usize])
                    .collect::<Vec<_>>()
            ))
            .unwrap_or_else(|| "z0".into())
    );
    d
}

fn port_data(solver: &TinyHyperGraphSolver, id: usize) -> Value {
    let t = &solver.topology;
    let mut d = object_record(t.port_metadata.as_ref().and_then(|m| m.get(id)));
    d.as_object_mut().unwrap().remove("serializedPortId");
    if !d["x"].is_number() {
        d["x"] = json!(t.port_x[id]);
    }

    if !d["y"].is_number() {
        d["y"] = json!(t.port_y[id]);
    }

    if !d["z"].is_number() {
        d["z"] = json!(t.port_z[id]);
    }

    d["layer"] = json!(get_z_layer_label(&[t.port_z[id]]).unwrap_or_else(|| "z0".into()));
    d
}

#[expect(
    clippy::too_many_arguments,
    reason = "Keep the argument list aligned with the TypeScript source."
)]
fn append_simple_path(
    current: i32,
    end: i32,
    segments: &[RouteSegment],
    by_port: &HashMap<i32, Vec<usize>>,
    used: &mut HashSet<usize>,
    visited: &mut HashSet<i32>,
    ports: &mut Vec<i32>,
    regions: &mut Vec<i32>,
) -> bool {
    if current == end {
        return true;
    }

    for index in by_port.get(&current).into_iter().flatten() {
        if used.contains(index) {
            continue;
        }

        let segment = &segments[*index];
        let next = if segment.from_port_id == current {
            segment.to_port_id
        } else {
            segment.from_port_id
        };
        if visited.contains(&next) {
            continue;
        }

        used.insert(*index);
        visited.insert(next);
        regions.push(segment.region_id);
        ports.push(next);
        if append_simple_path(next, end, segments, by_port, used, visited, ports, regions) {
            return true;
        }

        ports.pop();
        regions.pop();
        visited.remove(&next);
        used.remove(index);
    }

    false
}

fn ordered_route_path(
    solver: &TinyHyperGraphSolver,
    route: usize,
    segments: &[RouteSegment],
) -> (Vec<i32>, Vec<i32>) {
    assert!(!segments.is_empty(), "Route {route} has no solved segments");
    let start = solver.problem.route_start_port[route];
    let end = solver.problem.route_end_port[route];
    let mut by_port = HashMap::<i32, Vec<usize>>::new();

    for (i, s) in segments.iter().enumerate() {
        by_port.entry(s.from_port_id).or_default().push(i);
        by_port.entry(s.to_port_id).or_default().push(i);
    }

    let mut ports = vec![start];
    let mut regions = vec![];
    assert!(
        append_simple_path(
            start,
            end,
            segments,
            &by_port,
            &mut HashSet::new(),
            &mut HashSet::from([start]),
            &mut ports,
            &mut regions
        ),
        "Route {route} is not a single ordered path from {start} to {end}"
    );
    (ports, regions)
}

fn serialized_route(
    solver: &TinyHyperGraphSolver,
    route: usize,
    segments: &[RouteSegment],
) -> (Value, Value) {
    let (ports, regions) = ordered_route_path(solver, route, segments);
    let first = *regions
        .first()
        .unwrap_or_else(|| panic!("Route {route} could not determine endpoint regions"));
    let last = *regions.last().unwrap();
    let opposite = |port: i32, region: i32| -> i32 {
        *solver.topology.incident_port_region[port as usize]
            .iter()
            .find(|r| **r != region)
            .unwrap_or_else(|| {
                panic!("Port {port} is not incident to a region outside route region {region}")
            })
    };
    let start = get_serialized_region_id(solver, opposite(ports[0], first));
    let end = get_serialized_region_id(solver, opposite(*ports.last().unwrap(), last));
    let metadata = solver
        .problem
        .route_metadata
        .as_ref()
        .and_then(|m| m.get(route));
    let connection = json!({"connectionId":connection_id(solver,route),"startRegionId":metadata.and_then(|m|m["startRegionId"].as_str()).unwrap_or(&start),"endRegionId":metadata.and_then(|m|m["endRegionId"].as_str()).unwrap_or(&end),"mutuallyConnectedNetworkId":metadata.and_then(|m|m["mutuallyConnectedNetworkId"].as_str()).map(str::to_owned).unwrap_or_else(||format!("net-{}",solver.problem.route_net[route]))});
    let path:Vec<Value>=ports.iter().enumerate().map(|(i,p)| {
        let mut candidate=json!({"portId":get_serialized_port_id(solver,*p),"g":i,"h":0,"f":i,"hops":i,"ripRequired":false,"nextRegionId":if i<regions.len(){json!(get_serialized_region_id(solver,regions[i]))}else{connection["endRegionId"].clone()}});
        if i>0 {candidate["lastPortId"]=json!(get_serialized_port_id(solver,ports[i-1]));candidate["lastRegionId"]=json!(get_serialized_region_id(solver,regions[i-1]));}
        candidate
    }).collect();
    let solved = json!({"connection":connection,"path":path,"requiredRip":false});
    (connection, solved)
}

pub fn convert_to_serialized_hyper_graph(solver: &TinyHyperGraphSolver) -> Value {
    assert!(
        solver.solved && !solver.failed,
        "convertToSerializedHyperGraph requires a solved, non-failed solver"
    );
    let t = &solver.topology;
    let mut by_route = vec![vec![]; solver.problem.route_count];

    for (region, segments) in solver.state.region_segments.iter().enumerate() {
        for &(route, from, to) in segments {
            by_route[route as usize].push(RouteSegment {
                region_id: region as i32,
                from_port_id: from,
                to_port_id: to,
            });
        }
    }

    let regions:Vec<Value>=(0..t.region_count).map(|r| {
        let assignments:Vec<Value>=solver.state.region_segments[r].iter().map(|&(route,from,to)|json!({"regionPort1Id":get_serialized_port_id(solver,from),"regionPort2Id":get_serialized_port_id(solver,to),"connectionId":connection_id(solver,route as usize)})).collect();
        let mut region=json!({"regionId":get_serialized_region_id(solver,r as i32),"pointIds":t.region_incident_ports[r].iter().map(|p|get_serialized_port_id(solver,*p)).collect::<Vec<_>>(),"d":region_data(solver,r)});
        if !assignments.is_empty(){region["assignments"]=json!(assignments);} region
    }).collect();
    let ports:Vec<Value>=(0..t.port_count).map(|p| {
        let incident=&t.incident_port_region[p];assert!(incident.len()>=2,"Port {p} is missing incident regions");
        json!({"portId":get_serialized_port_id(solver,p as i32),"region1Id":get_serialized_region_id(solver,incident[0]),"region2Id":get_serialized_region_id(solver,incident[1]),"d":port_data(solver,p)})
    }).collect();
    let routes: Vec<(Value, Value)> = by_route
        .iter()
        .enumerate()
        .map(|(i, s)| serialized_route(solver, i, s))
        .collect();
    json!({"regions":regions,"ports":ports,"connections":routes.iter().map(|r|&r.0).collect::<Vec<_>>(),"solvedRoutes":routes.iter().map(|r|&r.1).collect::<Vec<_>>()})
}
