use math_utils::{js_max, js_min};
use serde_json::Value;

const BASE_MAX_TARGETED_CANDIDATE_ATTEMPTS: f64 = 3.0;
const BASE_MAX_ITERATIONS_PER_EFFORT: f64 = 48.0;
const DEEP_ERROR_FORCE_SCALES: [f64; 3] = [1.0, 1.75, -1.0];
const FAST_ERROR_FORCE_SCALES: [f64; 3] = [1.0, 1.75, -1.0];
const LARGE_DRC_COUNT_IMPROVEMENT_CHECK_INTERVAL: usize = 8;
const LOW_DRC_COUNT_IMPROVEMENT_CHECK_INTERVAL: usize = 1;
const MAX_ITERATIONS_PER_DRC_ERROR: f64 = 8.0 / 3.0;
const MIN_MAX_ITERATIONS: f64 = 48.0;
const SMALL_DRC_COUNT_IMPROVEMENT_CHECK_INTERVAL: usize = 2;

pub const POSITION_EPSILON: f64 = 1e-6;
pub const COORDINATE_EPSILON: f64 = 1e-3;
pub const MAX_ERROR_MOVE: f64 = 0.14;
pub const BROAD_FORCE_PASSES: usize = 12;
pub const EXTENDED_BROAD_FORCE_PASS_MULTIPLIER: usize = 2;
pub const BROAD_MAX_MOVE: f64 = 0.035;
pub const BROAD_FALLBACK_SMALL_ROUTE_LIMIT: usize = 120;
pub const MIN_ITERATIONS_FOR_LARGE_BOARD_BROAD_FALLBACK: f64 = 192.0;
pub const CLEARANCE_SLACK: f64 = 0.015;
pub const VIA_PAIR_REPAIR_MAX_MOVE: f64 = 0.16;
pub const TRACE_PAD_REPAIR_MAX_MOVE: f64 = 0.3;
pub const PREFERRED_TRACE_TO_PAD_CLEARANCE: f64 = 0.16;
pub const PREFERRED_VIA_TO_PAD_CLEARANCE: f64 = 0.1;
pub const LARGE_DRC_COUNT_THRESHOLD: usize = 20;
pub const MAX_DRC_COUNT_PLATEAU_CHECKS: usize = 2;
pub const MAX_LARGE_BOARD_BROAD_FALLBACK_MISSES: usize = 2;
pub const BROAD_SPATIAL_CELL_SIZE_MIN: f64 = 1.0;

pub fn get_trace_to_pad_edge_clearance(srj: &Value) -> f64 {
    srj["minTraceToPadEdgeClearance"]
        .as_f64()
        .unwrap_or(PREFERRED_TRACE_TO_PAD_CLEARANCE)
}

pub fn get_via_edge_to_pad_edge_clearance(srj: &Value) -> f64 {
    srj["minViaEdgeToPadEdgeClearance"]
        .as_f64()
        .unwrap_or(PREFERRED_VIA_TO_PAD_CLEARANCE)
}

pub fn js_round(value: f64) -> f64 {
    if !value.is_finite() || value == 0.0 {
        return value;
    }
    if (-0.5..0.0).contains(&value) {
        return -0.0;
    }
    let floor = value.floor();
    if value - floor < 0.5 {
        floor
    } else {
        floor + 1.0
    }
}

pub fn get_base_max_iterations(effort: f64) -> f64 {
    js_max(
        MIN_MAX_ITERATIONS,
        js_round(BASE_MAX_ITERATIONS_PER_EFFORT * js_max(1.0, effort)),
    )
}

pub fn get_drc_scaled_max_iterations(drc_issue_count: f64, effort: f64) -> f64 {
    js_max(
        get_base_max_iterations(effort),
        (drc_issue_count * MAX_ITERATIONS_PER_DRC_ERROR * js_max(1.0, effort)).ceil(),
    )
}

pub fn get_route_complexity_min_iterations(route_count: usize, drc_issue_count: usize) -> f64 {
    if route_count > BROAD_FALLBACK_SMALL_ROUTE_LIMIT && drc_issue_count > 0 {
        MIN_ITERATIONS_FOR_LARGE_BOARD_BROAD_FALLBACK
    } else {
        MIN_MAX_ITERATIONS
    }
}

pub fn get_large_board_broad_fallback_cadence(centered_drc_issue_count: f64) -> f64 {
    js_max(16.0, js_min(64.0, centered_drc_issue_count * 2.0))
}

pub fn get_drc_count_improvement_check_interval(initial_drc_issue_count: usize) -> usize {
    if initial_drc_issue_count >= LARGE_DRC_COUNT_THRESHOLD {
        LARGE_DRC_COUNT_IMPROVEMENT_CHECK_INTERVAL
    } else if initial_drc_issue_count <= 2 {
        LOW_DRC_COUNT_IMPROVEMENT_CHECK_INTERVAL
    } else {
        SMALL_DRC_COUNT_IMPROVEMENT_CHECK_INTERVAL
    }
}

pub fn get_force_scales_for_effort(effort: f64) -> [f64; 3] {
    if effort >= 2.0 {
        DEEP_ERROR_FORCE_SCALES
    } else {
        FAST_ERROR_FORCE_SCALES
    }
}

pub fn get_max_targeted_candidate_attempts_for_effort(effort: f64) -> f64 {
    js_max(
        1.0,
        js_round(BASE_MAX_TARGETED_CANDIDATE_ATTEMPTS * js_max(1.0, effort)),
    )
}
