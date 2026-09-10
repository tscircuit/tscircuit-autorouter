pub const DEFAULT_MIN_VIA_PAD_DIAMETER: f64 = 0.3;
pub const TRACE_VIA_MARGIN: f64 = 0.15;
const IMPOSSIBLE_SINGLE_LAYER_INTERSECTION_COST: f64 = 10.0;

pub fn is_known_single_layer_mask(mask: i32) -> bool {
    mask > 0 && (mask & (mask - 1)) == 0
}

pub fn compute_region_cost(
    region_width: f64,
    region_height: f64,
    num_same_layer_intersections: i32,
    num_cross_layer_intersections: i32,
    num_entry_exit_changes: i32,
    trace_count: usize,
    region_available_z_mask: i32,
    min_via_pad_diameter: f64,
) -> f64 {
    compute_region_cost_for_area(
        region_width * region_height,
        num_same_layer_intersections,
        num_cross_layer_intersections,
        num_entry_exit_changes,
        trace_count,
        region_available_z_mask,
        min_via_pad_diameter,
    )
}

pub fn compute_region_cost_for_area(
    area: f64,
    num_same_layer_intersections: i32,
    num_cross_layer_intersections: i32,
    num_entry_exit_changes: i32,
    trace_count: usize,
    region_available_z_mask: i32,
    min_via_pad_diameter: f64,
) -> f64 {
    let est_vias_required =
        num_same_layer_intersections * 2 + num_cross_layer_intersections + num_entry_exit_changes;
    let via_size_with_margin = min_via_pad_diameter + TRACE_VIA_MARGIN;
    let trace_count_mult = 1.0 + trace_count as f64 / 5.0;
    let impossible_cost = if is_known_single_layer_mask(region_available_z_mask) {
        num_same_layer_intersections as f64 * IMPOSSIBLE_SINGLE_LAYER_INTERSECTION_COST
    } else {
        0.0
    };
    est_vias_required as f64 * via_size_with_margin.powi(2) * trace_count_mult / area
        + impossible_cost
}
