use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct HighDensityHyperParameters {
    #[serde(
        default,
        rename = "FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR",
        skip_serializing_if = "Option::is_none"
    )]
    pub future_connection_prox_trace_penalty_factor: Option<f64>,
    #[serde(
        default,
        rename = "FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR",
        skip_serializing_if = "Option::is_none"
    )]
    pub future_connection_prox_via_penalty_factor: Option<f64>,
    #[serde(
        default,
        rename = "FUTURE_CONNECTION_PROXIMITY_VD",
        skip_serializing_if = "Option::is_none"
    )]
    pub future_connection_proximity_vd: Option<f64>,
    #[serde(
        default,
        rename = "FUTURE_CONNECTION_TRACE_PROXIMITY",
        skip_serializing_if = "Option::is_none"
    )]
    pub future_connection_trace_proximity: Option<f64>,
    #[serde(
        default,
        rename = "MISALIGNED_DIST_PENALTY_FACTOR",
        skip_serializing_if = "Option::is_none"
    )]
    pub misaligned_dist_penalty_factor: Option<f64>,
    #[serde(
        default,
        rename = "VIA_PENALTY_FACTOR_2",
        skip_serializing_if = "Option::is_none"
    )]
    pub via_penalty_factor_2: Option<f64>,
    #[serde(
        default,
        rename = "SHUFFLE_SEED",
        skip_serializing_if = "Option::is_none"
    )]
    pub shuffle_seed: Option<f64>,
    #[serde(
        default,
        rename = "CELL_SIZE_FACTOR",
        skip_serializing_if = "Option::is_none"
    )]
    pub cell_size_factor: Option<f64>,
    #[serde(
        default,
        rename = "FLIP_TRACE_ALIGNMENT_DIRECTION",
        skip_serializing_if = "Option::is_none"
    )]
    pub flip_trace_alignment_direction: Option<bool>,
    #[serde(
        default,
        rename = "MULTI_HEAD_POLYLINE_SOLVER",
        skip_serializing_if = "Option::is_none"
    )]
    pub multi_head_polyline_solver: Option<bool>,
    #[serde(
        default,
        rename = "SEGMENTS_PER_POLYLINE",
        skip_serializing_if = "Option::is_none"
    )]
    pub segments_per_polyline: Option<f64>,
    #[serde(
        default,
        rename = "BOUNDARY_PADDING",
        skip_serializing_if = "Option::is_none"
    )]
    pub boundary_padding: Option<f64>,
    #[serde(
        default,
        rename = "ITERATION_PENALTY",
        skip_serializing_if = "Option::is_none"
    )]
    pub iteration_penalty: Option<f64>,
    #[serde(
        default,
        rename = "MINIMUM_FINAL_ACCEPTANCE_GAP",
        skip_serializing_if = "Option::is_none"
    )]
    pub minimum_final_acceptance_gap: Option<f64>,
    #[serde(
        default,
        rename = "OBSTACLE_PROX_PENALTY_FACTOR",
        skip_serializing_if = "Option::is_none"
    )]
    pub obstacle_prox_penalty_factor: Option<f64>,
    #[serde(
        default,
        rename = "OBSTACLE_PROX_SIGMA",
        skip_serializing_if = "Option::is_none"
    )]
    pub obstacle_prox_sigma: Option<f64>,
    #[serde(
        default,
        rename = "EDGE_PROX_PENALTY_FACTOR",
        skip_serializing_if = "Option::is_none"
    )]
    pub edge_prox_penalty_factor: Option<f64>,
    #[serde(
        default,
        rename = "EDGE_PROX_SIGMA",
        skip_serializing_if = "Option::is_none"
    )]
    pub edge_prox_sigma: Option<f64>,
    #[serde(
        default,
        rename = "ALLOW_DIAGONAL",
        skip_serializing_if = "Option::is_none"
    )]
    pub allow_diagonal: Option<bool>,
    #[serde(
        default,
        rename = "FUTURE_CONNECTION_JUMPER_PAD_PROXIMITY",
        skip_serializing_if = "Option::is_none"
    )]
    pub future_connection_jumper_pad_proximity: Option<f64>,
    #[serde(
        default,
        rename = "FUTURE_CONNECTION_JUMPER_PAD_PENALTY",
        skip_serializing_if = "Option::is_none"
    )]
    pub future_connection_jumper_pad_penalty: Option<f64>,
    #[serde(
        default,
        rename = "JUMPER_JUMPER_PAD_PROXIMITY",
        skip_serializing_if = "Option::is_none"
    )]
    pub jumper_jumper_pad_proximity: Option<f64>,
    #[serde(
        default,
        rename = "JUMPER_JUMPER_PAD_PENALTY",
        skip_serializing_if = "Option::is_none"
    )]
    pub jumper_jumper_pad_penalty: Option<f64>,
    #[serde(
        default,
        rename = "FUTURE_CONNECTION_LINE_PROXIMITY",
        skip_serializing_if = "Option::is_none"
    )]
    pub future_connection_line_proximity: Option<f64>,
    #[serde(
        default,
        rename = "FUTURE_CONNECTION_LINE_PENALTY",
        skip_serializing_if = "Option::is_none"
    )]
    pub future_connection_line_penalty: Option<f64>,
    #[serde(
        default,
        rename = "MIN_TRAVEL_BEFORE_JUMPER",
        skip_serializing_if = "Option::is_none"
    )]
    pub min_travel_before_jumper: Option<f64>,
}
