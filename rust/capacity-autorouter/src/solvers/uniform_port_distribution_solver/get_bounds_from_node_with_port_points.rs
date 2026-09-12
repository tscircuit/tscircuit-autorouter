use crate::solvers::uniform_port_distribution_solver::types::{Bounds, NodeWithPortPoints};

pub fn get_bounds_from_node_with_port_points(node: &NodeWithPortPoints) -> Bounds {
    let mut bounds = Bounds {
        min_x: node.center.x - node.width / 2.0,
        max_x: node.center.x + node.width / 2.0,
        min_y: node.center.y - node.height / 2.0,
        max_y: node.center.y + node.height / 2.0,
    };
    for point in &node.port_points {
        if point.x < bounds.min_x { bounds.min_x = point.x; }
        if point.x > bounds.max_x { bounds.max_x = point.x; }
        if point.y < bounds.min_y { bounds.min_y = point.y; }
        if point.y > bounds.max_y { bounds.max_y = point.y; }
    }
    bounds
}
