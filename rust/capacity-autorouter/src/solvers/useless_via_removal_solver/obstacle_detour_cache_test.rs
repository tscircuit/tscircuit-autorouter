use super::*;
use crate::bindings::trace_simplification::types::route_from_value;

#[test]
fn reuses_segment_clearance_while_finding_late_detours() {
    let route = route_from_value(&json!({
        "connectionName":"detour_net","traceThickness":0.15,"viaDiameter":0.3,
        "route":[{"x":-2,"y":0,"z":0},{"x":-1,"y":0,"z":0},
            {"x":-1,"y":0,"z":1},{"x":1,"y":0,"z":1},
            {"x":1,"y":0,"z":0},{"x":2,"y":0,"z":0}],
        "vias":[{"x":-1,"y":0},{"x":1,"y":0}]
    }));
    let blocking_route = route_from_value(&json!({
        "connectionName":"blocking_net","traceThickness":0.15,"viaDiameter":0.3,
        "route":[{"x":0,"y":-0.2,"z":0},{"x":0,"y":0.2,"z":0}],"vias":[]
    }));
    let hd_route_shi = Rc::new(RefCell::new(HighDensityRouteSpatialIndex::new(
        vec![route.clone(), blocking_route],
        0.4,
    )));
    let mut solver =
        SingleRouteUselessViaRemovalSolver::new(SingleRouteUselessViaRemovalSolverParams {
            obstacle_shi: Rc::new(RefCell::new(ObstacleSpatialHashIndex::new_flatbush(vec![]))),
            hd_route_shi: hd_route_shi.clone(),
            unsimplified_route: route,
            conn_map: Rc::new(ConnectivityMap::new(indexmap::IndexMap::from([
                ("detour_net".into(), vec!["detour_net".into()]),
                ("blocking_net".into(), vec!["blocking_net".into()]),
            ]))),
            outline: None,
            terminal_layers: None,
            math: Math::default(),
            options: json!({"enableGeometryShortcuts":false,"enableObstacleDetourShortcuts":true}),
        });
    let mut candidates: Vec<_> = (0..1000)
        .map(|_| ViaPairShortcut {
            path: vec![fresh_point(-1.0, 0.0, 0.0), fresh_point(1.0, 0.0, 0.0)],
            previous_point_index: 1,
            next_point_index: 0,
            saved_length: 0.0,
            validation_first_segment_index: Some(0),
        })
        .collect();
    candidates.push(ViaPairShortcut {
        path: vec![
            fresh_point(-1.0, 0.0, 0.0),
            fresh_point(-1.0, 0.5, 0.0),
            fresh_point(1.0, 0.5, 0.0),
            fresh_point(1.0, 0.0, 0.0),
        ],
        previous_point_index: 1,
        next_point_index: 0,
        saved_length: -1.0,
        validation_first_segment_index: Some(0),
    });
    let shortcut = solver
        .find_valid_obstacle_detour_shortcut(candidates, 0.0)
        .unwrap()
        .unwrap();
    assert_eq!(shortcut.path.len(), 4);
    assert_eq!(
        solver.stats["obstacleDetourCandidatesValidated"],
        json!(1001)
    );
    assert_eq!(hd_route_shi.borrow().segment_clearance_queries.get(), 4);
    solver.current_section_index = 1;
    solver.apply_geometry_shortcut(shortcut);
    assert!(solver.get_optimized_hd_route().borrow().vias.is_empty());
}
