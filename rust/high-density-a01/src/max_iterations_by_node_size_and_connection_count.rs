use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaxIterationsByNodeSizeAndConnectionCountInput {
    pub plane_size: f64,
    pub layers: f64,
    pub connection_count: f64,
    pub effort: f64,
    pub max_iterations: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaxIterationsByNodeSizeAndConnectionCountResult {
    pub max_iterations_iters: f64,
    pub base_search_budget_iters: f64,
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if value.is_nan() || min.is_nan() || max.is_nan() {
        return f64::NAN;
    }
    min.max(max.min(value))
}

fn js_round(value: f64) -> f64 {
    if !value.is_finite() || value == 0.0 {
        return value;
    }
    if value >= -0.5 && value < 0.0 {
        return -0.0;
    }
    let floor = value.floor();
    if value - floor < 0.5 { floor } else { floor + 1.0 }
}

pub fn compute_max_iterations_by_node_size_and_connection_count(input: MaxIterationsByNodeSizeAndConnectionCountInput) -> MaxIterationsByNodeSizeAndConnectionCountResult {
    let states = input.plane_size * input.layers;
    let connection_count = input.connection_count;
    let connection_factor = connection_count.sqrt();
    let requested_max_iterations = if input.max_iterations.is_nan() { f64::NAN } else { 1.0_f64.max(input.max_iterations) };

    let base_computed_max_iterations = clamp(
        js_round(states * (8.0 + 1.2 * connection_factor)),
        150_000.0,
        12_000_000.0,
    );
    let computed_max_iters = clamp(
        js_round(base_computed_max_iterations * input.effort),
        150_000.0,
        12_000_000.0,
    );
    let min_iteration_budget_iters = clamp(
        js_round(requested_max_iterations * 0.2),
        150_000.0,
        2_000_000.0,
    );
    let max_iterations_iters = if requested_max_iterations.is_nan() || min_iteration_budget_iters.is_nan() || computed_max_iters.is_nan() {
        f64::NAN
    } else {
        1.0_f64.max(requested_max_iterations.min(min_iteration_budget_iters.max(computed_max_iters)))
    };
    let base_search_budget_iters = clamp(
        js_round(states * (10.0 + 0.8 * connection_factor) * input.effort),
        50_000.0,
        4_000_000.0,
    );

    MaxIterationsByNodeSizeAndConnectionCountResult {
        max_iterations_iters,
        base_search_budget_iters,
    }
}
