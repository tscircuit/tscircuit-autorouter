use capacity_autorouter::bindings::high_density::specialized_base_solver::SpecializedSolver;
use capacity_autorouter::bindings::trace_simplification::graph_codec::GraphCodec;
use capacity_autorouter::bindings::trace_simplification::types::*;
use capacity_autorouter::solvers::same_net_via_merger_solver::same_net_via_merger_solver::{
    SameNetViaMergerSolver, SameNetViaMergerSolverInput,
};
use capacity_autorouter::solvers::simplified_path_solver::{
    multi_simplified_path_solver::{
        MultiSimplifiedPathParams, MultiSimplifiedPathSolver, PathChild, PathChildKind,
        PathChildRef,
    },
    single_simplified_path_solver::{SingleSimplifiedPathParams, SingleSimplifiedPathSolver},
    single_simplified_path_solver5_deg45::SingleSimplifiedPathSolver5,
    vertex_shortcut_path_solver::VertexShortcutPathSolver,
};
use capacity_autorouter::solvers::useless_via_removal_solver::{
    single_route_useless_via_removal_solver::{
        SingleRouteUselessViaRemovalSolver, SingleRouteUselessViaRemovalSolverParams,
    },
    useless_via_removal_solver::{UselessViaRemovalSolver, UselessViaRemovalSolverInput},
};
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::{Rc, Weak},
};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

use capacity_autorouter::bindings::trace_simplification::connectivity_read_barrier::{
    self, ReadScope,
};
use capacity_autorouter::solvers::crossing_via_reduction_solver::crossing_via_reduction_solver::{
    CrossingViaReductionSolver, CrossingViaReductionSolverInput,
};
use capacity_autorouter::solvers::trace_simplification_solver::trace_simplification_solver::{
    TraceChild, TraceChildKind, TraceSimplificationParams, TraceSimplificationSolver,
};

// The phantom value type follows decoded values through the identity-preserving
// graph codec. It is erased at runtime; graph fields keep their existing format.
#[wasm_bindgen(typescript_custom_section)]
const TRACE_METHOD_TYPES: &str = r#"
export type TraceMethodGraph<T> = TraceGraphPacket & { readonly __traceValue?: T };
type TraceRoute = import("lib/types/high-density-types").HighDensityRoute;
type TracePoint = TraceRoute["route"][number];
type TraceObstacle = import("lib/types").Obstacle;
type TraceRouteSection = import("lib/solvers/UselessViaRemovalSolver/route-section").RouteSection;
type TraceVia = import("lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver").Via;
type TraceViaPairShortcut = import("lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver").ViaPairShortcut;
type TraceObstacleDetourPath = import("lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver").ObstacleDetourPath;
type TraceMultilayerSectionCollapse = import("lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver").MultilayerSectionCollapse;
"#;

macro_rules! graph_method {
    ($name:ident, $method:ident, $engine:ident, $args:ident, $args_type:literal, $result:ident, $result_type:literal) => {
        #[derive(serde::Serialize, serde::Deserialize, Tsify)]
        #[serde(transparent)]
        pub struct $args(#[tsify(type = $args_type)] Value);

        #[derive(serde::Serialize, serde::Deserialize, Tsify)]
        #[serde(transparent)]
        pub struct $result(#[tsify(type = $result_type)] Value);

        #[wasm_bindgen]
        impl TraceSimplificationDispatcher {
            #[wasm_bindgen(js_name = $name)]
            pub fn $method(&self, args: Ts<$args>) -> Result<Ts<$result>, JsValue> {
                self.with_graph(
                    args.to_rust().map_err(js_error)?.0,
                    |engine, args, codec| {
                        let Engine::$engine(solver) = engine else {
                            return Err(concat!(
                                stringify!($name),
                                " requires ",
                                stringify!($engine),
                                " solver"
                            )
                            .into());
                        };
                        solver.borrow_mut().$method(args, codec)
                    },
                )
                .and_then(|value| $result(value).into_ts().map_err(js_error))
            }
        }
    };
}

graph_method!(
    isValidPath,
    is_valid_path_graph,
    Path,
    TraceIsValidPathArgs,
    "TraceMethodGraph<[TracePoint[]]>",
    TraceIsValidPathResult,
    "TraceMethodGraph<boolean>"
);
graph_method!(
    isValidPathSegment,
    is_valid_path_segment_graph,
    Path,
    TraceIsValidPathSegmentArgs,
    "TraceMethodGraph<[TracePoint, TracePoint]>",
    TraceIsValidPathSegmentResult,
    "TraceMethodGraph<boolean>"
);
graph_method!(
    arePointsEqual,
    are_points_equal_graph,
    Path,
    TraceArePointsEqualArgs,
    "TraceMethodGraph<[TracePoint, TracePoint]>",
    TraceArePointsEqualResult,
    "TraceMethodGraph<boolean>"
);
graph_method!(
    getPointAtDistance,
    get_point_at_distance_graph,
    Path,
    TraceGetPointAtDistanceArgs,
    "TraceMethodGraph<[number]>",
    TraceGetPointAtDistanceResult,
    "TraceMethodGraph<TracePoint>"
);
graph_method!(
    getNearestIndexForDistance,
    get_nearest_index_for_distance_graph,
    Path,
    TraceGetNearestIndexForDistanceArgs,
    "TraceMethodGraph<[number]>",
    TraceGetNearestIndexForDistanceResult,
    "TraceMethodGraph<number>"
);
graph_method!(
    find45DegreePath,
    find_45_degree_path_graph,
    Path,
    TraceFind45DegreePathArgs,
    "TraceMethodGraph<[TracePoint, TracePoint]>",
    TraceFind45DegreePathResult,
    "TraceMethodGraph<TracePoint[] | null>"
);
graph_method!(
    addPathToResult,
    add_path_to_result_graph,
    Path,
    TraceAddPathToResultArgs,
    "TraceMethodGraph<[TracePoint[]]>",
    TraceAddPathToResultResult,
    "TraceMethodGraph<void>"
);
graph_method!(
    appendOriginalRouteSlice,
    append_original_route_slice_graph,
    Path,
    TraceAppendOriginalRouteSliceArgs,
    "TraceMethodGraph<[number, number]>",
    TraceAppendOriginalRouteSliceResult,
    "TraceMethodGraph<void>"
);
graph_method!(
    moveHead,
    move_head_graph,
    Path,
    TraceMoveHeadArgs,
    "TraceMethodGraph<[number]>",
    TraceMoveHeadResult,
    "TraceMethodGraph<void>"
);
graph_method!(
    stepBackAndReduceStepSize,
    step_back_and_reduce_step_size_graph,
    Path,
    TraceStepBackAndReduceStepSizeArgs,
    "TraceMethodGraph<[]>",
    TraceStepBackAndReduceStepSizeResult,
    "TraceMethodGraph<void>"
);
graph_method!(
    computePathSegments,
    compute_path_segments_graph,
    Path,
    TraceComputePathSegmentsArgs,
    "TraceMethodGraph<[]>",
    TraceComputePathSegmentsResult,
    "TraceMethodGraph<void>"
);
graph_method!(
    isSameNetRoute,
    is_same_net_route_graph,
    Path,
    TraceIsSameNetRouteArgs,
    "TraceMethodGraph<[TraceRoute]>",
    TraceIsSameNetRouteResult,
    "TraceMethodGraph<boolean>"
);
graph_method!(
    getOptimizedHdRoute,
    get_optimized_hd_route_graph,
    SingleVia,
    TraceGetOptimizedHdRouteArgs,
    "TraceMethodGraph<[]>",
    TraceGetOptimizedHdRouteResult,
    "TraceMethodGraph<TraceRoute>"
);
graph_method!(
    getPathLength,
    get_path_length_graph,
    SingleVia,
    TraceGetPathLengthArgs,
    "TraceMethodGraph<[TracePoint[]]>",
    TraceGetPathLengthResult,
    "TraceMethodGraph<number>"
);
graph_method!(
    normalizeShortcutPath,
    normalize_shortcut_path_graph,
    SingleVia,
    TraceNormalizeShortcutPathArgs,
    "TraceMethodGraph<[{ x: number; y: number }[], TracePoint, TracePoint]>",
    TraceNormalizeShortcutPathResult,
    "TraceMethodGraph<TracePoint[]>"
);
graph_method!(
    shortcutCrossesOutline,
    shortcut_crosses_outline_graph,
    SingleVia,
    TraceShortcutCrossesOutlineArgs,
    "TraceMethodGraph<[TracePoint[]]>",
    TraceShortcutCrossesOutlineResult,
    "TraceMethodGraph<boolean>"
);
graph_method!(
    getObstacleDetourPaths,
    get_obstacle_detour_paths_graph,
    SingleVia,
    TraceGetObstacleDetourPathsArgs,
    "TraceMethodGraph<[TracePoint, TracePoint, number, number]>",
    TraceGetObstacleDetourPathsResult,
    "TraceMethodGraph<TraceObstacleDetourPath[]>"
);
graph_method!(
    getDirectGeometryShortcut,
    get_direct_geometry_shortcut_graph,
    SingleVia,
    TraceGetDirectGeometryShortcutArgs,
    "TraceMethodGraph<[TraceRouteSection, TraceRouteSection, TraceRouteSection]>",
    TraceGetDirectGeometryShortcutResult,
    "TraceMethodGraph<TraceViaPairShortcut | null>"
);
graph_method!(
    getObstacleDetourShortcut,
    get_obstacle_detour_shortcut_graph,
    SingleVia,
    TraceGetObstacleDetourShortcutArgs,
    "TraceMethodGraph<[TraceRouteSection, TraceRouteSection, TraceRouteSection]>",
    TraceGetObstacleDetourShortcutResult,
    "TraceMethodGraph<TraceViaPairShortcut | null>"
);
graph_method!(
    findGeometryShortcut,
    find_geometry_shortcut_graph,
    SingleVia,
    TraceFindGeometryShortcutArgs,
    "TraceMethodGraph<[TraceRouteSection, TraceRouteSection, TraceRouteSection]>",
    TraceFindGeometryShortcutResult,
    "TraceMethodGraph<TraceViaPairShortcut | null>"
);
graph_method!(
    findMultilayerSectionCollapse,
    find_multilayer_section_collapse_graph,
    SingleVia,
    TraceFindMultilayerSectionCollapseArgs,
    "TraceMethodGraph<[TraceRouteSection, TraceRouteSection, TraceRouteSection]>",
    TraceFindMultilayerSectionCollapseResult,
    "TraceMethodGraph<TraceMultilayerSectionCollapse | null>"
);
graph_method!(
    applyGeometryShortcut,
    apply_geometry_shortcut_graph,
    SingleVia,
    TraceApplyGeometryShortcutArgs,
    "TraceMethodGraph<[TraceViaPairShortcut]>",
    TraceApplyGeometryShortcutResult,
    "TraceMethodGraph<void>"
);
graph_method!(
    applyMultilayerSectionCollapse,
    apply_multilayer_section_collapse_graph,
    SingleVia,
    TraceApplyMultilayerSectionCollapseArgs,
    "TraceMethodGraph<[TraceMultilayerSectionCollapse]>",
    TraceApplyMultilayerSectionCollapseResult,
    "TraceMethodGraph<void>"
);
graph_method!(
    getOptimizedHdRoutes,
    get_optimized_hd_routes_graph,
    Via,
    TraceGetOptimizedHdRoutesArgs,
    "TraceMethodGraph<[]>",
    TraceGetOptimizedHdRoutesResult,
    "TraceMethodGraph<TraceRoute[]>"
);
graph_method!(
    getMergedViaHdRoutes,
    get_merged_via_hd_routes_graph,
    Merger,
    TraceGetMergedViaHdRoutesArgs,
    "TraceMethodGraph<[]>",
    TraceGetMergedViaHdRoutesResult,
    "TraceMethodGraph<TraceRoute[]>"
);
graph_method!(
    rebuildVias,
    rebuild_vias_graph,
    Merger,
    TraceRebuildViasArgs,
    "TraceMethodGraph<[]>",
    TraceRebuildViasResult,
    "TraceMethodGraph<void>"
);
graph_method!(
    getViaKey,
    get_via_key_graph,
    Merger,
    TraceGetViaKeyArgs,
    "TraceMethodGraph<[TraceVia]>",
    TraceGetViaKeyResult,
    "TraceMethodGraph<string>"
);
graph_method!(
    dedupeRouteVias,
    dedupe_route_vias_graph,
    Merger,
    TraceDedupeRouteViasArgs,
    "TraceMethodGraph<[TraceRoute]>",
    TraceDedupeRouteViasResult,
    "TraceMethodGraph<void>"
);
graph_method!(
    moveViaTo,
    move_via_to_graph,
    Merger,
    TraceMoveViaToArgs,
    "TraceMethodGraph<[TraceVia, TraceVia, boolean]>",
    TraceMoveViaToResult,
    "TraceMethodGraph<void>"
);
graph_method!(
    getOffendingViaGroupsBatch,
    get_offending_via_groups_batch_graph,
    Merger,
    TraceGetOffendingViaGroupsBatchArgs,
    "TraceMethodGraph<[]>",
    TraceGetOffendingViaGroupsBatchResult,
    "TraceMethodGraph<Array<{ keep: TraceVia; remove: TraceVia[] }>>"
);
graph_method!(
    markThroughObstacleSegments,
    mark_through_obstacle_segments_graph,
    Trace,
    TraceMarkThroughObstacleSegmentsArgs,
    "TraceMethodGraph<[ReadonlyArray<TraceRoute>]>",
    TraceMarkThroughObstacleSegmentsResult,
    "TraceMethodGraph<TraceRoute[]>"
);
graph_method!(
    validatePreservedRouteEndpoints,
    validate_preserved_route_endpoints_graph,
    Trace,
    TraceValidatePreservedRouteEndpointsArgs,
    "TraceMethodGraph<[TraceRoute[]]>",
    TraceValidatePreservedRouteEndpointsResult,
    "TraceMethodGraph<void>"
);
graph_method!(
    isSameNetObstacle,
    is_same_net_obstacle_graph,
    Trace,
    TraceIsSameNetObstacleArgs,
    "TraceMethodGraph<[TraceRoute, TraceObstacle]>",
    TraceIsSameNetObstacleResult,
    "TraceMethodGraph<boolean>"
);
graph_method!(
    getSameNetObstacleForSegment,
    get_same_net_obstacle_for_segment_graph,
    Trace,
    TraceGetSameNetObstacleForSegmentArgs,
    "TraceMethodGraph<[TraceRoute, { x: number; y: number }, { x: number; y: number }]>",
    TraceGetSameNetObstacleForSegmentResult,
    "TraceMethodGraph<TraceObstacle | null>"
);
graph_method!(
    isViaInsideSameNetObstacle,
    is_via_inside_same_net_obstacle_graph,
    Trace,
    TraceIsViaInsideSameNetObstacleArgs,
    "TraceMethodGraph<[TraceRoute, { x: number; y: number }]>",
    TraceIsViaInsideSameNetObstacleResult,
    "TraceMethodGraph<boolean>"
);
graph_method!(
    collapseDetourSection,
    collapse_detour_section_graph,
    Crossing,
    TraceCollapseDetourSectionArgs,
    "TraceMethodGraph<[{ route: TraceRoute; section: TraceRouteSection; targetZ: number }]>",
    TraceCollapseDetourSectionResult,
    "TraceMethodGraph<TraceRoute>"
);
graph_method!(
    relocateTransitionVia,
    relocate_transition_via_graph,
    Crossing,
    TraceRelocateTransitionViaArgs,
    "TraceMethodGraph<[{ route: TraceRoute; section: TraceRouteSection; targetZ: number; side: \"start\" | \"end\"; newViaDistance: number }]>",
    TraceRelocateTransitionViaResult,
    "TraceMethodGraph<{ route: TraceRoute; relocatedVia: { x: number; y: number } } | null>"
);
graph_method!(
    relocateTransitionVias,
    relocate_transition_vias_graph,
    Crossing,
    TraceRelocateTransitionViasArgs,
    "TraceMethodGraph<[{ route: TraceRoute; sections: TraceRouteSection[]; crossingGroups: Array<{ transitionRouteIndex: number; transitionSectionIndex: number; side: \"start\" | \"end\"; crossingDistances: number[] }>; detourZ: number; detourTraceThickness: number }]>",
    TraceRelocateTransitionViasResult,
    "TraceMethodGraph<{ route: TraceRoute; relocatedVias: Array<{ x: number; y: number }> } | null>"
);
graph_method!(
    getReducedHdRoutes,
    get_reduced_hd_routes_graph,
    Crossing,
    TraceGetReducedHdRoutesArgs,
    "TraceMethodGraph<[]>",
    TraceGetReducedHdRoutesResult,
    "TraceMethodGraph<TraceRoute[]>"
);
graph_method!(
    findCrossingReduction,
    find_crossing_reduction_graph,
    Crossing,
    TraceFindCrossingReductionArgs,
    "TraceMethodGraph<[]>",
    TraceFindCrossingReductionResult,
    "TraceMethodGraph<{ detourRouteIndex: number; detourRoute: TraceRoute; transitionUpdates: Array<{ routeIndex: number; route: TraceRoute; relocatedVias: Array<{ x: number; y: number }> }> } | null>"
);

// Graph fields encode solver-specific references and numeric sentinels. Keep the
// existing Value representation so crossing the boundary needs no second walk.
#[derive(serde::Serialize, serde::Deserialize, Tsify)]
#[serde(transparent)]
pub struct TraceGraphPacket(
    #[tsify(
        type = "{ fields: any; points: Record<string, any>[]; routes: Record<string, any>[]; obstacles: Record<string, any>[]; cloneGroups?: { id: number; sources: unknown }[]; captureCloneGroups?: boolean; jumpers?: { id: number; value: any[] }[] }"
    )]
    pub Value,
);

#[derive(serde::Serialize, serde::Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct TraceObstacleQuery {
    index_id: u64,
    method: String,
    args: Vec<f64>,
}

#[derive(serde::Serialize, serde::Deserialize, Tsify)]
pub struct TraceConnectivityUpdate {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(type = "{ netMap: Record<string, string[]>; idToNetMap: Record<string, string> }")]
    connectivity: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    graph: Option<TraceGraphPacket>,
}

#[derive(serde::Serialize, Tsify)]
#[serde(transparent)]
pub struct TraceSolverState(
    #[tsify(
        type = "{ MAX_ITERATIONS: number; iterations: number; solved: boolean; failed: boolean; error: string | null; progress: number }"
    )]
    capacity_autorouter::bindings::high_density::specialized_base_solver::BaseSolverState,
);

#[derive(serde::Deserialize, Tsify)]
#[serde(transparent)]
pub struct TraceCloneGroupIds(Vec<u64>);

fn connectivity_scope(
    query: Option<&js_sys::Function>,
    codec: &GraphCodec,
    callback_error: &Rc<RefCell<Option<JsValue>>>,
    read_codec: &Rc<RefCell<GraphCodec>>,
) -> Option<ReadScope> {
    let query = query?.clone();
    let maps = codec.connectivity_refs.clone();
    let retained_maps = maps.values().cloned().collect();
    let error_slot = callback_error.clone();
    let read_codec = read_codec.clone();
    {
        let mut inputs = read_codec.borrow_mut();
        if inputs.obstacle_refs.len() != codec.obstacle_refs.len() {
            inputs.obstacle_refs = codec.obstacle_refs.clone();
        }
        inputs.connectivity_refs = maps.clone();
        inputs.terminal_layers_refs = codec.terminal_layers_refs.clone();
        inputs.net_names_refs = codec.net_names_refs.clone();
        inputs.layer_set_refs = codec.layer_set_refs.clone();
    }
    Some(ReadScope::new(
        Rc::new(move |map| {
            // A default map that has never been exposed has no JS source to synchronize.
            let Some(identity) = maps
                .iter()
                .find_map(|(identity, known)| Rc::ptr_eq(known, map).then_some(*identity))
            else {
                return Ok(());
            };
            let result = query
                .call1(&JsValue::UNDEFINED, &JsValue::from_f64(identity as f64))
                .map_err(|error| {
                    let message = js_sys::JsString::from(error.clone())
                        .as_string()
                        .unwrap_or_else(|| "Connectivity synchronization failed".into());
                    *error_slot.borrow_mut() = Some(error);
                    message
                })?;
            if result.is_undefined() {
                return Ok(());
            }
            let response = Ts::<TraceConnectivityUpdate>::new_unchecked(result)
                .to_rust()
                .map_err(|error| error.to_string())?;
            if let Some(value) = response.connectivity {
                let updated: ConnectivityMap =
                    serde_json::from_value(value).map_err(|error| error.to_string())?;
                map.replace_from(&updated);
            }
            if let Some(graph) = response.graph {
                let _imported = read_codec.borrow_mut().import_graph(&graph.0)?;
            }
            Ok(())
        }),
        retained_maps,
    ))
}

enum Engine {
    Path(PathChildRef),
    Multi(Rc<RefCell<MultiSimplifiedPathSolver>>),
    SingleVia(Rc<RefCell<SingleRouteUselessViaRemovalSolver>>),
    Via(Rc<RefCell<UselessViaRemovalSolver>>),
    Merger(Rc<RefCell<SameNetViaMergerSolver>>),
    Trace(Rc<RefCell<TraceSimplificationSolver>>),
    Crossing(Rc<RefCell<CrossingViaReductionSolver>>),
}

impl Engine {
    fn from_trace_child(child: &TraceChild) -> (&'static str, Self) {
        match &child.kind {
            TraceChildKind::Via(s) => ("via-removal", Self::Via(s.clone())),
            TraceChildKind::Merger(s) => ("via-merger", Self::Merger(s.clone())),
            TraceChildKind::Path(s) => ("multi-path", Self::Multi(s.clone())),
            TraceChildKind::Crossing(s) => ("crossing", Self::Crossing(s.clone())),
        }
    }

    fn with_solver<T>(&self, operation: impl FnOnce(&dyn SpecializedSolver) -> T) -> T {
        match self {
            Self::Path(s) => operation(&*s.borrow()),
            Self::Multi(s) => operation(&*s.borrow()),
            Self::SingleVia(s) => operation(&*s.borrow()),
            Self::Via(s) => operation(&*s.borrow()),
            Self::Merger(s) => operation(&*s.borrow()),
            Self::Trace(s) => operation(&*s.borrow()),
            Self::Crossing(s) => operation(&*s.borrow()),
        }
    }

    fn with_solver_mut<T>(&self, operation: impl FnOnce(&mut dyn SpecializedSolver) -> T) -> T {
        match self {
            Self::Path(s) => operation(&mut *s.borrow_mut()),
            Self::Multi(s) => operation(&mut *s.borrow_mut()),
            Self::SingleVia(s) => operation(&mut *s.borrow_mut()),
            Self::Via(s) => operation(&mut *s.borrow_mut()),
            Self::Merger(s) => operation(&mut *s.borrow_mut()),
            Self::Trace(s) => operation(&mut *s.borrow_mut()),
            Self::Crossing(s) => operation(&mut *s.borrow_mut()),
        }
    }

    fn snapshot(&self, codec: &mut GraphCodec) -> Value {
        let mut fields = match self {
            Self::Path(s) => s.borrow().snapshot(codec),
            Self::Multi(s) => s.borrow().snapshot(codec),
            Self::SingleVia(s) => s.borrow().snapshot(codec),
            Self::Via(s) => s.borrow().snapshot(codec),
            Self::Merger(s) => s.borrow().snapshot(codec),
            Self::Trace(s) => s.borrow().snapshot(codec),
            Self::Crossing(s) => s.borrow().snapshot(codec),
        };
        use crate::bindings::trace_simplification_index_codec::{
            encode_hd_route_index, encode_obstacle_index,
        };
        match self {
            Engine::SingleVia(s) => {
                let s = s.borrow();
                let obstacle = s.obstacle_shi.borrow();
                let routes = s.hd_route_shi.borrow();
                fields["obstacleSHI"] = encode_obstacle_index(&obstacle, obstacle.identity, codec);
                fields["hdRouteSHI"] = encode_hd_route_index(&routes, routes.identity, codec);
            }
            Engine::Via(s) => {
                let s = s.borrow();
                let obstacle = s.obstacle_shi.borrow();
                let routes = s.hd_route_shi.borrow();
                let obstacle_index = encode_obstacle_index(&obstacle, obstacle.identity, codec);
                let route_index = encode_hd_route_index(&routes, routes.identity, codec);
                fields["obstacleSHI"] = obstacle_index.clone();
                fields["hdRouteSHI"] = route_index.clone();
                if fields["activeSubSolver"]["fields"].is_object() {
                    fields["activeSubSolver"]["fields"]["obstacleSHI"] = obstacle_index;
                    fields["activeSubSolver"]["fields"]["hdRouteSHI"] = route_index;
                }
            }
            Engine::Merger(s) => {
                let s = s.borrow();
                fields["obstacleSHI"] =
                    encode_obstacle_index(&s.obstacle_shi, s.obstacle_shi.identity, codec);
                fields["hdRouteSHI"] =
                    encode_hd_route_index(&s.hd_route_shi, s.hd_route_shi.identity, codec);
            }
            Engine::Crossing(s) => {
                let s = s.borrow();
                fields["obstacleSHI"] =
                    encode_obstacle_index(&s.obstacle_shi, s.obstacle_shi.identity, codec);
            }
            Engine::Trace(s) => {
                if let Some(child) = s.borrow().active_sub_solver.clone() {
                    let (_, engine) = Engine::from_trace_child(&child);
                    let child_fields = engine.snapshot(codec);
                    fields["activeSubSolver"] = codec.object(child.identity, child_fields);
                }
            }
            _ => {}
        }
        fields
    }
}

fn js_error(error: impl ToString) -> JsValue {
    js_sys::Error::new(&error.to_string()).into()
}

fn raw_field(codec: &GraphCodec, fields: &Value, key: &str) -> Value {
    fields
        .get(key)
        .map(|value| codec.read_raw(value))
        .unwrap_or(Value::Null)
}

fn connectivity(codec: &mut GraphCodec, fields: &Value) -> Result<Rc<ConnectivityMap>, String> {
    let value = raw_field(codec, fields, "connMap");
    if value.is_null() {
        let map = Rc::new(ConnectivityMap::new(Default::default()));
        codec.connectivity_refs.insert(next_identity(), map.clone());
        return Ok(map);
    }
    codec.read_connectivity(&fields["connMap"])
}

fn outline(codec: &GraphCodec, fields: &Value) -> Result<Option<Vec<Point2>>, String> {
    let value = raw_field(codec, fields, "outline");
    if value.is_null() {
        return Ok(None);
    }
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn read_optional_routes(
    codec: &mut GraphCodec,
    fields: &Value,
    key: &str,
) -> Result<Vec<RouteRef>, String> {
    match fields.get(key).filter(|value| !value.is_null()) {
        Some(value) => codec.read_routes(value),
        None => Ok(Vec::new()),
    }
}

fn restore_shared_indexes(
    fields: &Value,
    codec: &mut GraphCodec,
    obstacles: &mut Rc<
        RefCell<capacity_autorouter::data_structures::obstacle_tree::ObstacleSpatialHashIndex>,
    >,
    routes: &mut Rc<RefCell<capacity_autorouter::bindings::trace_simplification::high_density_route_spatial_index::HighDensityRouteSpatialIndex>>,
) -> Result<(), String> {
    if let Some(value) = fields.get("obstacleSHI").filter(|v| !v.is_null()) {
        let incoming =
            crate::bindings::trace_simplification_index_codec::decode_obstacle_index(value, codec)?;
        if incoming.borrow().identity == obstacles.borrow().identity {
            *obstacles.borrow_mut() = incoming.borrow().clone();
        } else {
            *obstacles = incoming;
        }
    }
    if let Some(value) = fields.get("hdRouteSHI").filter(|v| !v.is_null()) {
        let incoming =
            crate::bindings::trace_simplification_index_codec::decode_hd_route_index(value, codec)?;
        if incoming.borrow().identity == routes.borrow().identity {
            *routes.borrow_mut() = incoming.borrow().clone();
        } else {
            *routes = incoming;
        }
    }
    Ok(())
}

#[wasm_bindgen]
pub struct TraceSimplificationDispatcher {
    identity: u64,
    kind: String,
    engine: Rc<Engine>,
    codec: Rc<RefCell<GraphCodec>>,
    children: Rc<RefCell<HashMap<u64, Weak<Engine>>>>,
    callback_error: Rc<RefCell<Option<JsValue>>>,
    connectivity_query: Option<js_sys::Function>,
    read_codec: Rc<RefCell<GraphCodec>>,
    initialized_child: Cell<Option<u64>>,
}

#[wasm_bindgen]
impl TraceSimplificationDispatcher {
    #[wasm_bindgen(constructor)]
    pub fn new(
        kind: &str,
        params_graph: Ts<TraceGraphPacket>,
        #[wasm_bindgen(
            unchecked_param_type = "((request: TraceObstacleQuery) => TraceGraphPacket) | undefined"
        )]
        obstacle_query: Option<js_sys::Function>,
        #[wasm_bindgen(
            unchecked_param_type = "((identity: number) => TraceConnectivityUpdate | undefined) | undefined"
        )]
        connectivity_query: Option<js_sys::Function>,
    ) -> Result<Self, JsValue> {
        let packet = params_graph.to_rust().map_err(js_error)?.0;
        let mut codec = GraphCodec::new();
        let _imported = codec.import_graph(&packet).map_err(js_error)?;
        let callback_error = Rc::new(RefCell::new(None));
        if let Some(query) = obstacle_query {
            let mut callback_codec = GraphCodec::new();
            callback_codec.obstacle_refs = codec.obstacle_refs.clone();
            let callback_codec = RefCell::new(callback_codec);
            let error_slot = callback_error.clone();
            codec.obstacle_query = Some(Rc::new(move |index_id, method, args| {
                let request = TraceObstacleQuery {
                    index_id,
                    method: method.to_owned(),
                    args: args.to_vec(),
                }
                .into_ts()
                .map_err(|error| error.to_string())?;
                let result = query
                    .call1(&JsValue::UNDEFINED, &request.js_value())
                    .map_err(|error| {
                        let message = js_sys::JsString::from(error.clone())
                            .as_string()
                            .unwrap_or_else(|| "Obstacle query failed".into());
                        *error_slot.borrow_mut() = Some(error);
                        message
                    })?;
                connectivity_read_barrier::check_all()?;
                let graph = Ts::<TraceGraphPacket>::new_unchecked(result)
                    .to_rust()
                    .map_err(|error| error.to_string())?
                    .0;
                let mut codec = callback_codec.borrow_mut();
                let _imported = codec.import_graph(&graph)?;
                codec.read_obstacles(&graph["fields"])
            }));
        }
        let fields = &packet["fields"];
        let conn_map = connectivity(&mut codec, fields).map_err(js_error)?;
        let outline = outline(&codec, fields).map_err(js_error)?;
        let color_map = codec
            .read_color_map(
                fields
                    .get("colorMap")
                    .filter(|value| !value.is_null())
                    .unwrap_or(&json!({})),
            )
            .map_err(js_error)?;
        let obstacles = match fields.get("obstacles") {
            Some(value) => codec.read_obstacles(value).map_err(js_error)?,
            None => Vec::new(),
        };
        let others = read_optional_routes(&mut codec, fields, "otherHdRoutes").map_err(js_error)?;
        let math = Math {
            hypot: js_sys::Math::hypot,
        };
        let identity = next_identity();
        let read_codec = Rc::new(RefCell::new(GraphCodec::new()));
        let _read_scope = connectivity_scope(
            connectivity_query.as_ref(),
            &codec,
            &callback_error,
            &read_codec,
        );
        let engine = match kind {
            "path-base" | "path" | "vertex" => {
                let params = SingleSimplifiedPathParams {
                    connectivity: Rc::new(RefCell::new(capacity_autorouter::bindings::trace_simplification::connectivity_context::ConnectivityContext::new(conn_map.clone()))),
                    input_route: codec.read_route(&fields["inputRoute"]).map_err(js_error)?,
                    other_hd_routes: Rc::new(others), obstacles: Rc::new(obstacles), conn_map, color_map,
                    outline: outline.map(Rc::new), min_board_edge_clearance: fields["minBoardEdgeClearance"].as_f64().unwrap_or(0.2),
                    use_trace_width_aware_clearance: fields["useTraceWidthAwareClearance"].as_bool().unwrap_or(false), math,
                };
                let kind = match kind {
                    "path-base" => PathChildKind::Base(SingleSimplifiedPathSolver::new(params)),
                    "path" => PathChildKind::Sampled(SingleSimplifiedPathSolver5::new(params)),
                    _ => PathChildKind::Vertex(VertexShortcutPathSolver::new(params)),
                };
                Engine::Path(Rc::new(RefCell::new(PathChild { identity, kind })))
            }
            "multi-path" => Engine::Multi(Rc::new(RefCell::new(MultiSimplifiedPathSolver::new(
                MultiSimplifiedPathParams {
                    unsimplified_hd_routes: codec
                        .read_routes(&fields["unsimplifiedHdRoutes"])
                        .map_err(js_error)?,
                    other_hd_routes: Rc::new(others),
                    obstacles: Rc::new(obstacles),
                    conn_map,
                    color_map,
                    outline: outline.map(Rc::new),
                    min_board_edge_clearance: fields["minBoardEdgeClearance"]
                        .as_f64()
                        .unwrap_or(0.2),
                    default_via_diameter: fields["defaultViaDiameter"].as_f64().unwrap_or(0.3),
                    use_trace_width_aware_clearance: fields["useTraceWidthAwareClearance"]
                        .as_bool()
                        .unwrap_or(false),
                    enable_vertex_shortcuts: fields["enableVertexShortcuts"]
                        .as_bool()
                        .unwrap_or(false),
                    math,
                },
            )))),
            "via-removal" => {
                let terminal_layers = fields
                    .get("terminalLayerIndicesByPcbPortId")
                    .filter(|value| !value.is_null())
                    .map(|value| codec.read_terminal_layers(value))
                    .transpose()
                    .map_err(js_error)?;
                let mut solver = UselessViaRemovalSolver::new(UselessViaRemovalSolverInput {
                    unsimplified_hd_routes: codec
                        .read_routes(&fields["unsimplifiedHdRoutes"])
                        .map_err(js_error)?,
                    other_hd_routes: others,
                    obstacles,
                    layer_count: fields["layerCount"]
                        .as_f64()
                        .ok_or_else(|| js_error("Missing layerCount"))?,
                    conn_map,
                    outline,
                    terminal_layers,
                    options: fields.clone(),
                    math,
                });
                if let Some(id) = fields["unsimplifiedHdRoutes"]["$array"].as_u64() {
                    solver.unsimplified_routes_array_identity = id;
                }
                Engine::Via(Rc::new(RefCell::new(solver)))
            }
            "single-via-removal" => {
                let terminal_layers = fields
                    .get("terminalLayerIndicesByPcbPortId")
                    .filter(|value| !value.is_null())
                    .map(|value| codec.read_terminal_layers(value))
                    .transpose()
                    .map_err(js_error)?;
                let mut solver = SingleRouteUselessViaRemovalSolver::new(SingleRouteUselessViaRemovalSolverParams {
                    obstacle_shi: crate::bindings::trace_simplification_index_codec::decode_obstacle_index(&fields["obstacleSHI"], &mut codec).map_err(js_error)?,
                    hd_route_shi: crate::bindings::trace_simplification_index_codec::decode_hd_route_index(&fields["hdRouteSHI"], &mut codec).map_err(js_error)?,
                    unsimplified_route: codec.read_route(&fields["unsimplifiedRoute"]).map_err(js_error)?, conn_map, outline,
                    terminal_layers,
                    options: fields.clone(), math,
                });
                solver.identity = identity;
                Engine::SingleVia(Rc::new(RefCell::new(solver)))
            }
            "via-merger" => {
                let explicit = fields
                    .get("netByConnectionName")
                    .filter(|value| !value.is_null())
                    .map(|value| codec.read_net_names(value))
                    .transpose()
                    .map_err(js_error)?;
                let mut solver = SameNetViaMergerSolver::new(SameNetViaMergerSolverInput {
                    input_hd_routes: codec
                        .read_routes(&fields["inputHdRoutes"])
                        .map_err(js_error)?,
                    other_hd_routes: others,
                    obstacles,
                    layer_count: fields["layerCount"]
                        .as_f64()
                        .ok_or_else(|| js_error("Missing layerCount"))?,
                    conn_map,
                    color_map,
                    outline,
                    net_by_connection_name: explicit,
                    preserve_route_endpoints: fields["preserveRouteEndpoints"]
                        .as_bool()
                        .unwrap_or(false),
                })
                .map_err(js_error)?;
                if let Some(id) = fields["inputHdRoutes"]["$array"].as_u64() {
                    solver.input_routes_array_identity = id;
                }
                Engine::Merger(Rc::new(RefCell::new(solver)))
            }
            "trace" => Engine::Trace(Rc::new(RefCell::new(
                TraceSimplificationSolver::new(TraceSimplificationParams {
                    hd_routes: codec.read_routes(&fields["hdRoutes"]).map_err(js_error)?,
                    other_hd_routes: others,
                    obstacles,
                    conn_map,
                    color_map,
                    outline,
                    layer_count: fields["layerCount"]
                        .as_f64()
                        .ok_or_else(|| js_error("Missing layerCount"))?,
                    default_via_diameter: fields["defaultViaDiameter"]
                        .as_f64()
                        .ok_or_else(|| js_error("Missing defaultViaDiameter"))?,
                    terminal_layers: fields
                        .get("terminalLayerIndicesByPcbPortId")
                        .filter(|value| !value.is_null())
                        .map(|value| codec.read_terminal_layers(value))
                        .transpose()
                        .map_err(js_error)?,
                    net_by_connection_name: fields
                        .get("netByConnectionName")
                        .filter(|value| !value.is_null())
                        .map(|value| codec.read_net_names(value))
                        .transpose()
                        .map_err(js_error)?,
                    options: fields.clone(),
                    math,
                })
                .map_err(js_error)?,
            ))),
            "crossing" => Engine::Crossing(Rc::new(RefCell::new(
                CrossingViaReductionSolver::new(CrossingViaReductionSolverInput {
                    input_hd_routes: codec
                        .read_routes(&fields["inputHdRoutes"])
                        .map_err(js_error)?,
                    other_hd_routes: others,
                    obstacles,
                    conn_map,
                    layer_count: fields["layerCount"]
                        .as_f64()
                        .ok_or_else(|| js_error("Missing layerCount"))?,
                    outline,
                    trace_margin: fields["traceMargin"].as_f64().unwrap_or(0.1),
                    obstacle_margin: fields["obstacleMargin"].as_f64().unwrap_or(0.15),
                    math,
                })
                .map_err(js_error)?,
            ))),
            _ => return Err(js_error(format!("Unknown simplification kind: {kind}"))),
        };
        Ok(Self {
            identity,
            kind: kind.to_owned(),
            engine: Rc::new(engine),
            codec: Rc::new(RefCell::new(codec)),
            children: Rc::new(RefCell::new(HashMap::new())),
            callback_error,
            connectivity_query,
            read_codec,
            initialized_child: Cell::new(None),
        })
    }

    pub fn identity(&self) -> f64 {
        self.identity as f64
    }
    pub fn kind(&self) -> String {
        self.kind.clone()
    }
    pub fn iterations(&self) -> usize {
        self.engine.with_solver(|solver| solver.base().iterations)
    }
    pub fn progress(&self) -> f64 {
        self.engine.with_solver(|solver| solver.base().progress)
    }
    pub fn error(&self) -> Option<String> {
        self.engine
            .with_solver(|solver| solver.base().error.clone())
    }

    #[wasm_bindgen(js_name = state)]
    pub fn state(&self) -> Result<Ts<TraceSolverState>, JsValue> {
        self.engine.with_solver(|solver| {
            TraceSolverState(solver.base().clone())
                .into_ts()
                .map_err(js_error)
        })
    }

    pub fn step(&self, iterations: usize, max_iterations: f64) -> Result<u32, JsValue> {
        let _read_scope = connectivity_scope(
            self.connectivity_query.as_ref(),
            &self.codec.borrow(),
            &self.callback_error,
            &self.read_codec,
        );
        let status = self.engine.with_solver_mut(|solver| {
            solver.base_mut().iterations = iterations;
            solver.base_mut().max_iterations = max_iterations;
            solver._step().map_err(|error| {
                self.callback_error
                    .borrow_mut()
                    .take()
                    .unwrap_or_else(|| js_error(error))
            })?;
            Ok::<u32, JsValue>(
                u32::from(solver.base().solved) + 2 * u32::from(solver.base().failed),
            )
        })?;
        Ok(status + self.pending_status())
    }

    #[wasm_bindgen(js_name = resolveExtract)]
    pub fn resolve_extract(&self, graph: Ts<TraceGraphPacket>) -> Result<u32, JsValue> {
        let Engine::Trace(s) = &*self.engine else {
            return Err(js_error("Expected trace simplification extraction"));
        };
        let packet = graph.to_rust().map_err(js_error)?.0;
        let mut codec = self.codec.borrow_mut();
        let _imported = codec.import_graph(&packet).map_err(js_error)?;
        let routes = codec.read_routes(&packet["fields"]).map_err(js_error)?;
        let _read_scope = connectivity_scope(
            self.connectivity_query.as_ref(),
            &codec,
            &self.callback_error,
            &self.read_codec,
        );
        drop(codec);
        let mut solver = s.borrow_mut();
        solver.resolve_extract(routes).map_err(|error| {
            self.callback_error
                .borrow_mut()
                .take()
                .unwrap_or_else(|| js_error(error))
        })?;
        let status = u32::from(solver.base.solved) + 2 * u32::from(solver.base.failed);
        drop(solver);
        Ok(status + self.pending_status())
    }

    #[wasm_bindgen(js_name = acknowledgeCloneGroups)]
    pub fn acknowledge_clone_groups(
        &self,
        identities: Ts<TraceCloneGroupIds>,
    ) -> Result<(), JsValue> {
        let identities = identities.to_rust().map_err(js_error)?.0;
        self.codec
            .borrow_mut()
            .acknowledge_clone_groups(&identities)
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = initialization)]
    pub fn initialization(&self) -> Result<Ts<TraceGraphPacket>, JsValue> {
        let Engine::Trace(s) = &*self.engine else {
            return Err(js_error("Expected trace phase initialization"));
        };
        let child = s
            .borrow()
            .active_sub_solver
            .clone()
            .ok_or_else(|| js_error("Missing trace phase child"))?;
        let mut codec = self.codec.borrow_mut();
        match &child.kind {
            TraceChildKind::Merger(s) => {
                codec.capture_clone_groups(&s.borrow().merged_via_hd_routes)
            }
            TraceChildKind::Crossing(s) => {
                codec.capture_clone_groups(&s.borrow().reduced_hd_routes)
            }
            _ => return Err(js_error("Trace phase does not create a cloned scene")),
        }
        let mut graph = codec.finish(Value::Null);
        graph["captureCloneGroups"] = Value::Bool(true);
        let packet = TraceGraphPacket(graph).into_ts().map_err(js_error)?;
        self.initialized_child.set(Some(child.identity));
        Ok(packet)
    }

    pub fn solve(&self) -> Result<(), JsValue> {
        let _read_scope = connectivity_scope(
            self.connectivity_query.as_ref(),
            &self.codec.borrow(),
            &self.callback_error,
            &self.read_codec,
        );
        self.engine.with_solver_mut(|solver| {
            solver.solve().map_err(|error| {
                self.callback_error
                    .borrow_mut()
                    .take()
                    .unwrap_or_else(|| js_error(error))
            })
        })
    }

    pub fn statistics(&self) -> Result<Ts<TraceGraphPacket>, JsValue> {
        let stats = match &*self.engine {
            Engine::SingleVia(s) => Some(s.borrow().stats.clone()),
            Engine::Via(s) => Some(s.borrow().stats.clone()),
            Engine::Merger(s) => Some(s.borrow().stats.clone()),
            Engine::Trace(s) => Some(s.borrow().stats.clone()),
            Engine::Crossing(s) => Some(s.borrow().stats.clone()),
            Engine::Path(_) | Engine::Multi(_) => None,
        };
        let mut codec = self.codec.borrow_mut();
        let fields = match stats {
            Some(stats) => serde_json::json!({"stats": codec.raw(stats)}),
            None => serde_json::json!({}),
        };
        TraceGraphPacket(codec.finish(fields))
            .into_ts()
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = snapshot)]
    pub fn snapshot(&self) -> Result<Ts<TraceGraphPacket>, JsValue> {
        let mut codec = self.codec.borrow_mut();
        let fields = self.engine.snapshot(&mut codec);
        TraceGraphPacket(codec.finish(fields))
            .into_ts()
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = obstacles)]
    pub fn obstacles(&self) -> Result<Ts<TraceGraphPacket>, JsValue> {
        let mut codec = self.codec.borrow_mut();
        let obstacles = match &*self.engine {
            Engine::Multi(s) => codec.obstacles(&s.borrow().params.obstacles),
            Engine::Via(s) => codec.obstacles(&s.borrow().input.obstacles),
            Engine::Merger(s) => codec.obstacles(&s.borrow().obstacles),
            Engine::Trace(s) => codec.obstacles(&s.borrow().params.obstacles),
            Engine::Crossing(s) => codec.obstacles(&s.borrow().input.obstacles),
            _ => {
                return Err(js_error(
                    "Only parent simplification stages normalize obstacles",
                ));
            }
        };
        TraceGraphPacket(codec.finish(obstacles))
            .into_ts()
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = output)]
    pub fn output(&self) -> Result<Ts<TraceGraphPacket>, JsValue> {
        let mut codec = self.codec.borrow_mut();
        let output = match &*self.engine {
            Engine::Path(s) => codec.route(&s.borrow().simplified_route()),
            Engine::Multi(s) => codec.routes(&s.borrow().simplified_hd_routes),
            Engine::SingleVia(s) => codec.route(&s.borrow().get_optimized_hd_route()),
            Engine::Via(s) => {
                let s = s.borrow();
                codec.route_array(s.optimized_routes_array_identity, &s.optimized_hd_routes)
            }
            Engine::Merger(s) => {
                let s = s.borrow();
                codec.route_array(s.merged_routes_array_identity, &s.merged_via_hd_routes)
            }
            Engine::Trace(s) => {
                let s = s.borrow();
                codec.route_array(s.hd_routes_array_identity, &s.hd_routes)
            }
            Engine::Crossing(s) => {
                let s = s.borrow();
                codec.route_array(s.reduced_routes_array_identity, &s.reduced_hd_routes)
            }
        };
        TraceGraphPacket(codec.finish(output))
            .into_ts()
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = activeChild)]
    pub fn active_child(&self) -> Option<Self> {
        let (identity, kind, engine) = match &*self.engine {
            Engine::Multi(s) => {
                let child = s.borrow().active_sub_solver.clone()?;
                let id = child.borrow().identity;
                let kind = match &child.borrow().kind {
                    PathChildKind::Base(_) => "path-base",
                    PathChildKind::Sampled(_) => "path",
                    PathChildKind::Vertex(_) => "vertex",
                };
                (id, kind, Engine::Path(child))
            }
            Engine::Via(s) => {
                let child = s.borrow().active_sub_solver.clone()?;
                let id = child.borrow().identity;
                (id, "single-via-removal", Engine::SingleVia(child))
            }
            Engine::Trace(s) => {
                let child = s.borrow().active_sub_solver.clone()?;
                let (kind, engine) = Engine::from_trace_child(&child);
                (child.identity, kind, engine)
            }
            _ => return None,
        };
        let engine = self
            .children
            .borrow()
            .get(&identity)
            .and_then(Weak::upgrade)
            .unwrap_or_else(|| Rc::new(engine));
        self.children
            .borrow_mut()
            .insert(identity, Rc::downgrade(&engine));
        Some(Self {
            identity,
            kind: kind.to_owned(),
            engine,
            codec: self.codec.clone(),
            children: self.children.clone(),
            callback_error: self.callback_error.clone(),
            connectivity_query: self.connectivity_query.clone(),
            read_codec: self.read_codec.clone(),
            initialized_child: Cell::new(None),
        })
    }

    #[wasm_bindgen(js_name = restore)]
    pub fn restore(&self, graph: Ts<TraceGraphPacket>) -> Result<(), JsValue> {
        let packet = graph.to_rust().map_err(js_error)?.0;
        let fields = &packet["fields"];
        let mut codec = self.codec.borrow_mut();
        let _imported = codec.import_graph(&packet).map_err(js_error)?;
        match &*self.engine {
            Engine::Trace(s) => {
                if let Some(value) = fields.get("activeSubSolver") {
                    if value.is_null() {
                        s.borrow_mut().active_sub_solver = None;
                    } else {
                        let id = value["$object"]
                            .as_u64()
                            .ok_or_else(|| js_error("Missing trace child identity"))?;
                        if s.borrow()
                            .active_sub_solver
                            .as_ref()
                            .is_none_or(|child| child.identity != id)
                        {
                            let engine = self
                                .children
                                .borrow()
                                .get(&id)
                                .and_then(Weak::upgrade)
                                .ok_or_else(|| js_error("Unknown trace child identity"))?;
                            let kind = match &*engine {
                                Engine::Via(s) => TraceChildKind::Via(s.clone()),
                                Engine::Merger(s) => TraceChildKind::Merger(s.clone()),
                                Engine::Multi(s) => TraceChildKind::Path(s.clone()),
                                Engine::Crossing(s) => TraceChildKind::Crossing(s.clone()),
                                _ => return Err(js_error("Expected trace phase child")),
                            };
                            s.borrow_mut().active_sub_solver =
                                Some(Rc::new(TraceChild { identity: id, kind }));
                        }
                    }
                }
                s.borrow_mut().restore(fields, &mut codec)
            }
            Engine::Crossing(s) => {
                let mut solver = s.borrow_mut();
                if let Some(value) = fields.get("obstacleSHI").filter(|value| !value.is_null()) {
                    solver.obstacle_shi =
                        crate::bindings::trace_simplification_index_codec::decode_obstacle_index(
                            value, &mut codec,
                        )
                        .map_err(js_error)?
                        .borrow()
                        .clone();
                }
                solver.restore(fields, &mut codec)
            }
            Engine::Path(s) => s.borrow_mut().restore(fields, &mut codec),
            Engine::SingleVia(s) => {
                let mut solver = s.borrow_mut();
                let solver = &mut *solver;
                restore_shared_indexes(
                    fields,
                    &mut codec,
                    &mut solver.obstacle_shi,
                    &mut solver.hd_route_shi,
                )
                .map_err(js_error)?;
                solver.restore(fields, &mut codec)
            }
            Engine::Via(s) => {
                if let Some(id) = fields["activeSubSolver"]["$object"].as_u64()
                    && let Some(child) = self.children.borrow().get(&id).and_then(Weak::upgrade)
                {
                    let Engine::SingleVia(child) = &*child else {
                        return Err(js_error("Expected via-removal child"));
                    };
                    s.borrow_mut().active_sub_solver = Some(child.clone());
                }
                let mut solver = s.borrow_mut();
                let solver = &mut *solver;
                restore_shared_indexes(
                    fields,
                    &mut codec,
                    &mut solver.obstacle_shi,
                    &mut solver.hd_route_shi,
                )
                .map_err(js_error)?;
                solver.restore(fields, &mut codec)
            }
            Engine::Merger(s) => {
                let mut solver = s.borrow_mut();
                if let Some(value) = fields.get("obstacleSHI").filter(|v| !v.is_null()) {
                    solver.obstacle_shi =
                        crate::bindings::trace_simplification_index_codec::decode_obstacle_index(
                            value, &mut codec,
                        )
                        .map_err(js_error)?
                        .borrow()
                        .clone();
                }
                if let Some(value) = fields.get("hdRouteSHI").filter(|v| !v.is_null()) {
                    solver.hd_route_shi =
                        crate::bindings::trace_simplification_index_codec::decode_hd_route_index(
                            value, &mut codec,
                        )
                        .map_err(js_error)?
                        .borrow()
                        .clone();
                }
                solver.restore(fields, &mut codec)
            }
            Engine::Multi(s) => {
                let child = if fields.get("activeSubSolver").is_none() {
                    s.borrow().active_sub_solver.clone()
                } else if fields["activeSubSolver"].is_null() {
                    None
                } else {
                    let id = fields["activeSubSolver"]["$object"]
                        .as_u64()
                        .ok_or_else(|| js_error("Missing path child identity"))?;
                    let active = s
                        .borrow()
                        .active_sub_solver
                        .clone()
                        .filter(|child| child.borrow().identity == id);
                    if active.is_some() {
                        active
                    } else {
                        let engine = self
                            .children
                            .borrow()
                            .get(&id)
                            .and_then(Weak::upgrade)
                            .ok_or_else(|| js_error("Unknown path child identity"))?;
                        let Engine::Path(child) = &*engine else {
                            return Err(js_error("Expected path child"));
                        };
                        Some(child.clone())
                    }
                };
                s.borrow_mut().restore(fields, &mut codec, child)
            }
        }
        .map_err(js_error)
    }
}

impl TraceSimplificationDispatcher {
    fn with_graph(
        &self,
        packet: Value,
        run: impl FnOnce(&Engine, &Value, &mut GraphCodec) -> Result<Value, String>,
    ) -> Result<Value, JsValue> {
        let mut codec = self.codec.borrow_mut();
        let _imported = codec.import_graph(&packet).map_err(js_error)?;
        let _read_scope = connectivity_scope(
            self.connectivity_query.as_ref(),
            &codec,
            &self.callback_error,
            &self.read_codec,
        );
        let output = run(&self.engine, &packet["fields"], &mut codec).map_err(|error| {
            self.callback_error
                .borrow_mut()
                .take()
                .unwrap_or_else(|| js_error(error))
        })?;
        Ok(codec.finish(output))
    }

    fn pending_status(&self) -> u32 {
        let Engine::Trace(s) = &*self.engine else {
            return 0;
        };
        let solver = s.borrow();
        let initialize = solver.active_sub_solver.as_ref().is_some_and(|child| {
            self.initialized_child.get() != Some(child.identity)
                && matches!(
                    &child.kind,
                    TraceChildKind::Merger(_) | TraceChildKind::Crossing(_)
                )
        });
        4 * u32::from(solver.awaiting_extract) + 8 * u32::from(initialize)
    }
}
