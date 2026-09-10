use super::graph::get_serialized_region_id;
use super::region_path_solver::RegionPathSolver;
use crate::graphics::GraphicsObject;
use serde_json::{Value, json};

fn region_bounds(solver: &RegionPathSolver, region: usize) -> [f64; 4] {
    if let Some(metadata) = solver
        .region_graph
        .region_metadata
        .as_ref()
        .and_then(|m| m.get(region))
    {
        let b = &metadata["bounds"];
        if let (Some(a), Some(b), Some(c), Some(d)) = (
            b["minX"].as_f64(),
            b["maxX"].as_f64(),
            b["minY"].as_f64(),
            b["maxY"].as_f64(),
        ) {
            return [a, b, c, d];
        }
    }

    let g = &solver.region_graph;
    let w = g.region_width[region];
    let h = g.region_height[region];
    let x = g.region_center_x[region];
    let y = g.region_center_y[region];
    [x - w / 2.0, x + w / 2.0, y - h / 2.0, y + h / 2.0]
}

fn center(solver: &RegionPathSolver, region: i32) -> Value {
    json!({"x":solver.region_graph.region_center_x[region as usize],"y":solver.region_graph.region_center_y[region as usize]})
}

fn layer(solver: &RegionPathSolver, region: i32) -> String {
    solver
        .region_graph
        .region_metadata
        .as_ref()
        .and_then(|m| m.get(region as usize))
        .and_then(|m| m["layer"].as_str())
        .filter(|l| l.starts_with('z'))
        .unwrap_or("z0")
        .to_owned()
}

fn route_label(solver: &RegionPathSolver, route: i32) -> String {
    solver
        .region_problem
        .route_metadata
        .as_ref()
        .and_then(|m| m.get(route as usize))
        .and_then(|m| {
            m["connectionId"]
                .as_str()
                .or_else(|| m["mutuallyConnectedNetworkId"].as_str())
        })
        .map(str::to_owned)
        .unwrap_or_else(|| format!("route-{route}"))
}

fn route_color(solver: &RegionPathSolver, route: i32, alpha: f64) -> String {
    let source = format!(
        "{}:{}",
        solver.region_problem.route_net[route as usize],
        route_label(solver, route)
    );
    let mut hash = 0i32;

    for c in source.encode_utf16() {
        hash = (c as i32)
            .wrapping_mul(17777)
            .wrapping_add(hash.wrapping_shl(5).wrapping_sub(hash));
    }

    format!("hsla({}, 70%, 50%, {alpha})", (hash as i64).abs() % 360)
}

fn region_fill(solver: &RegionPathSolver, region: usize) -> String {
    let utilization = (solver.state.region_usage[region] as f64
        / solver.region_graph.region_capacity[region])
        .max(0.0)
        .min(1.0);
    let red = (216.0 + 23.0 * utilization).round();
    let green = (240.0 - 112.0 * utilization).round();
    let blue = (254.0 - 180.0 * utilization).round();
    let alpha = 0.18 + utilization * 0.55;
    format!("rgba({red}, {green}, {blue}, {alpha:.3})")
}

fn region_label(solver: &RegionPathSolver, region: usize) -> String {
    let usage = solver.state.region_usage[region];
    let capacity = solver.region_graph.region_capacity[region];
    let utilization = usage as f64 / capacity;
    let net = solver.region_problem.region_net_id[region];
    let routes = &solver.state.region_assigned_routes[region];
    let mut label = format!(
        "region: {}\ncapacity: {capacity:.3}\nusage: {usage}\nfill: {:.1}%\nnet: {}",
        get_serialized_region_id(&solver.region_graph, region as i32),
        utilization * 100.0,
        if net == -1 {
            "free".into()
        } else {
            net.to_string()
        }
    );
    if !routes.is_empty() {
        label.push_str(&format!(
            "\nroutes: {}",
            routes
                .iter()
                .map(|r| route_label(solver, *r))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    label
}

fn push_route_hints(solver: &RegionPathSolver, graphics: &mut Value) -> () {
    for route in 0..solver.region_problem.route_count {
        let start = solver.region_problem.route_start_region[route];
        let end = solver.region_problem.route_end_region[route];
        graphics["lines"].as_array_mut().unwrap().push(json!({"points":[center(solver,start),center(solver,end)],"strokeColor":route_color(solver,route as i32,0.28),"strokeDash":"4 4","layer":layer(solver,start),"label":format!("{} (hint)\nstart: {}\nend: {}",route_label(solver,route as i32),get_serialized_region_id(&solver.region_graph,start),get_serialized_region_id(&solver.region_graph,end))}));
    }
}

fn push_solved_routes(solver: &RegionPathSolver, graphics: &mut Value) -> () {
    for (route, path) in solver.state.solved_route_region_ids.iter().enumerate() {
        if path.len() < 2 {
            continue;
        }

        graphics["lines"].as_array_mut().unwrap().push(json!({"points":path.iter().map(|r|center(solver,*r)).collect::<Vec<_>>(),"strokeColor":route_color(solver,route as i32,0.95),"layer":layer(solver,path[0]),"label":format!("route: {}\ncost: {:.3}",route_label(solver,route as i32),solver.state.solved_route_costs[route])}));
    }
}

fn push_route_endpoints(solver: &RegionPathSolver, graphics: &mut Value) -> () {
    for route in 0..solver.region_problem.route_count {
        for (region, endpoint) in [
            (solver.region_problem.route_start_region[route], "start"),
            (solver.region_problem.route_end_region[route], "end"),
        ] {
            let mut point = center(solver, region);
            point["color"] = json!(route_color(solver, route as i32, 1.0));
            point["layer"] = json!(layer(solver, region));
            point["label"] = json!(format!(
                "route: {}\nendpoint: {endpoint}\nregion: {}",
                route_label(solver, route as i32),
                get_serialized_region_id(&solver.region_graph, region)
            ));
            graphics["points"].as_array_mut().unwrap().push(point);
        }
    }
}

fn push_active_frontier(solver: &RegionPathSolver, graphics: &mut Value) -> () {
    let mut candidates = solver.state.candidate_queue.to_array();
    candidates.sort_by(|a, b| a.f.total_cmp(&b.f));
    candidates.truncate(128);

    for candidate in candidates {
        let mut point = center(solver, candidate.region_id);
        point["color"] = json!("rgba(245, 158, 11, 0.95)");
        point["layer"] = json!(layer(solver, candidate.region_id));
        point["label"] = json!(format!(
            "frontier: {}\ng: {:.3}\nf: {:.3}",
            get_serialized_region_id(&solver.region_graph, candidate.region_id),
            candidate.g,
            candidate.f
        ));
        graphics["points"].as_array_mut().unwrap().push(point);
    }
}

pub fn visualize_region_graph(solver: &RegionPathSolver) -> GraphicsObject {
    let mut graphics = json!({"arrows":[],"circles":[],"infiniteLines":[],"lines":[],"points":[],"polygons":[],"rects":[],"texts":[],"title":"Region Path Graph","coordinateSystem":"cartesian"});

    for region in 0..solver.region_graph.region_count {
        let [a, b, c, d] = region_bounds(solver, region);
        let endpoint = solver
            .state
            .current_route_id
            .map(|route| {
                solver.region_problem.route_start_region[route as usize] == region as i32
                    || solver.region_problem.route_end_region[route as usize] == region as i32
            })
            .unwrap_or(false);
        graphics["rects"].as_array_mut().unwrap().push(json!({"center":center(solver,region as i32),"width":(b-a-0.05).max(0.05),"height":(d-c-0.05).max(0.05),"fill":region_fill(solver,region),"stroke":if endpoint{"rgba(17, 24, 39, 0.9)"}else{"rgba(148, 163, 184, 0.5)"},"layer":layer(solver,region as i32),"label":region_label(solver,region)}));
    }

    push_route_hints(solver, &mut graphics);
    push_solved_routes(solver, &mut graphics);
    push_route_endpoints(solver, &mut graphics);
    if solver.state.current_route_id.is_some() {
        push_active_frontier(solver, &mut graphics);
    }

    graphics
}
