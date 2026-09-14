use crate::core::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct PolyPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolyBounds {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
}
/// Vertices follow the perimeter; loading normalizes clockwise input to CCW.
pub type ConvexPolygon = Vec<PolyPoint>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolyHyperGraphTopology {
    #[serde(flatten)]
    pub base: TinyHyperGraphTopology,
    pub region_vertex_start: Vec<i32>,
    pub region_vertex_count: Vec<i32>,
    pub region_vertex_x: Vec<f64>,
    pub region_vertex_y: Vec<f64>,
    pub region_area: Vec<f64>,
    pub region_perimeter: Vec<f64>,
    pub region_bounds_min_x: Vec<f64>,
    pub region_bounds_max_x: Vec<f64>,
    pub region_bounds_min_y: Vec<f64>,
    pub region_bounds_max_y: Vec<f64>,
    pub port_boundary_position_for_region1: Vec<i32>,
    pub port_boundary_position_for_region2: Vec<i32>,
    pub port_edge_index_for_region1: Vec<i32>,
    pub port_edge_index_for_region2: Vec<i32>,
    pub port_edge_t_for_region1: Vec<f64>,
    pub port_edge_t_for_region2: Vec<f64>,
}
pub type PolyHyperGraphProblem = TinyHyperGraphProblem;
pub type PolyHyperGraphSolution = TinyHyperGraphSolution;
pub type PolyHyperGraphSolverOptions = TinyHyperGraphSolverOptions;

pub struct PolyHyperGraph {
    pub topology: PolyHyperGraphTopology,
    pub problem: PolyHyperGraphProblem,
    pub solution: Option<PolyHyperGraphSolution>,
}

pub struct PolyHyperGraphLoadResult {
    pub topology: PolyHyperGraphTopology,
    pub problem: PolyHyperGraphProblem,
    pub solution: PolyHyperGraphSolution,
    pub mapping: PolyHyperGraphSourceMapping,
}
pub type RectToPolyHyperGraphAdapterResult = PolyHyperGraphLoadResult;

pub struct PolyHyperGraphSourceMapping {
    pub serialized_region_id_to_region_id: HashMap<String, i32>,
    pub serialized_port_id_to_port_id: HashMap<String, i32>,
    pub connection_id_to_route_id: HashMap<String, i32>,
    pub net_id_to_net_index: HashMap<String, i32>,
}
pub type PolyHyperGraphRegionMetadata = Value;
pub type PolyHyperGraphPortMetadata = Value;

#[derive(Clone, Default)]
pub struct RectToPolyHyperGraphAdapterOptions {
    pub boundary_coordinate_scale: Option<f64>,
}
