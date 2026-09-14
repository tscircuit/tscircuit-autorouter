use crate::solvers::global_drc_force_improve_solver::internal_types::Bounds2D;

pub fn do_bounds_overlap(left: &Bounds2D, right: &Bounds2D) -> bool {
    !(left.max_x < right.min_x
        || right.max_x < left.min_x
        || left.max_y < right.min_y
        || right.max_y < left.min_y)
}
