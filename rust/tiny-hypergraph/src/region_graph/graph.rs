use crate::core::{TinyHyperGraphProblem, TinyHyperGraphTopology};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct RegionGraphEdge {
    pub edge_id: usize,
    pub region_id_a: i32,
    pub region_id_b: i32,
    pub port_ids: Vec<i32>,
    pub representative_port_id: i32,
    pub center_distance: f64,
}

#[derive(Clone, Debug)]
pub struct RegionGraph {
    pub region_count: usize,
    pub edge_count: usize,
    pub region_center_x: Vec<f64>,
    pub region_center_y: Vec<f64>,
    pub region_width: Vec<f64>,
    pub region_height: Vec<f64>,
    pub region_capacity: Vec<f64>,
    pub region_metadata: Option<Vec<Value>>,
    pub edges: Vec<RegionGraphEdge>,
    pub incident_edges: Vec<Vec<RegionGraphEdge>>,
}

#[derive(Clone, Debug)]
pub struct RegionPathProblem {
    pub route_count: usize,
    pub route_start_region: Vec<i32>,
    pub route_end_region: Vec<i32>,
    pub route_net: Vec<i32>,
    pub route_metadata: Option<Vec<Value>>,
    pub region_net_id: Vec<i32>,
}

fn metadata_id(metadata: Option<&Value>) -> Option<String> {
    for key in ["serializedRegionId", "regionId", "capacityMeshNodeId"] {
        if let Some(id) = metadata.and_then(|m| m[key].as_str()) {
            return Some(id.to_owned());
        }
    }

    None
}

fn endpoint_region(topology: &TinyHyperGraphTopology, nets: &[i32], net: i32, port: i32) -> i32 {
    let regions = &topology.incident_port_region[port as usize];
    if let Some(region) = regions.iter().find(|r| nets[**r as usize] == net) {
        return *region;
    }

    if let Some(region) = regions.iter().find(|r| nets[**r as usize] == -1) {
        return *region;
    }

    *regions
        .first()
        .unwrap_or_else(|| panic!("Port {port} has no incident regions"))
}

pub fn create_region_graph(topology: &TinyHyperGraphTopology) -> RegionGraph {
    let mut edges = Vec::<RegionGraphEdge>::new();
    let mut pairs = HashMap::<(i32, i32), usize>::new();

    for port in 0..topology.port_count {
        let incident = &topology.incident_port_region[port];
        if incident.len() < 2 {
            continue;
        }

        let a = incident[0];
        let b = incident[1];
        let key = (a.min(b), a.max(b));
        if let Some(index) = pairs.get(&key) {
            edges[*index].port_ids.push(port as i32);
            continue;
        }

        let dx = topology.region_center_x[a as usize] - topology.region_center_x[b as usize];
        let dy = topology.region_center_y[a as usize] - topology.region_center_y[b as usize];
        let index = edges.len();
        pairs.insert(key, index);
        edges.push(RegionGraphEdge {
            edge_id: index,
            region_id_a: a,
            region_id_b: b,
            port_ids: vec![port as i32],
            representative_port_id: port as i32,
            center_distance: dx.hypot(dy),
        });
    }

    let mut incident_edges = vec![vec![]; topology.region_count];

    for edge in &edges {
        incident_edges[edge.region_id_a as usize].push(edge.clone());
        incident_edges[edge.region_id_b as usize].push(edge.clone());
    }

    RegionGraph {
        region_count: topology.region_count,
        edge_count: edges.len(),
        region_center_x: topology.region_center_x.clone(),
        region_center_y: topology.region_center_y.clone(),
        region_width: topology.region_width.clone(),
        region_height: topology.region_height.clone(),
        region_capacity: (0..topology.region_count)
            .map(|r| (topology.region_width[r] * topology.region_height[r]).max(1e-6))
            .collect(),
        region_metadata: topology.region_metadata.clone(),
        edges,
        incident_edges,
    }
}

pub fn create_region_path_problem(
    topology: &TinyHyperGraphTopology,
    problem: &TinyHyperGraphProblem,
) -> RegionPathProblem {
    let ids: HashMap<String, i32> = (0..topology.region_count)
        .filter_map(|r| {
            metadata_id(topology.region_metadata.as_ref().and_then(|m| m.get(r)))
                .map(|id| (id, r as i32))
        })
        .collect();
    let mut start = vec![0; problem.route_count];
    let mut end = start.clone();

    for route in 0..problem.route_count {
        let metadata = problem.route_metadata.as_ref().and_then(|m| m.get(route));
        start[route] = metadata
            .and_then(|m| m["startRegionId"].as_str())
            .and_then(|id| ids.get(id))
            .copied()
            .unwrap_or_else(|| {
                endpoint_region(
                    topology,
                    &problem.region_net_id,
                    problem.route_net[route],
                    problem.route_start_port[route],
                )
            });
        end[route] = metadata
            .and_then(|m| m["endRegionId"].as_str())
            .and_then(|id| ids.get(id))
            .copied()
            .unwrap_or_else(|| {
                endpoint_region(
                    topology,
                    &problem.region_net_id,
                    problem.route_net[route],
                    problem.route_end_port[route],
                )
            });
    }

    RegionPathProblem {
        route_count: problem.route_count,
        route_start_region: start,
        route_end_region: end,
        route_net: problem.route_net.clone(),
        route_metadata: problem.route_metadata.clone(),
        region_net_id: problem.region_net_id.clone(),
    }
}

pub fn get_serialized_region_id(graph: &RegionGraph, region: i32) -> String {
    metadata_id(
        graph
            .region_metadata
            .as_ref()
            .and_then(|m| m.get(region as usize)),
    )
    .unwrap_or_else(|| format!("region-{region}"))
}
