use std::{cell::RefCell, rc::Rc};
use indexmap::IndexMap;
use serde_json::{Value, json};
use crate::types::{Routes, DrcSnapshot, DrcEvaluator};
use crate::solver_helpers::*;
use crate::solver_config::*;
use crate::drc_snapshot::*;
use crate::drc_snapshot::{is_via_pad_drc_error, is_trace_obstacle_drc_error};
use crate::internal_types::{MutableRoute, Point};
use crate::trace_to_pad_clearance_relaxation::apply_trace_to_pad_clearance_relaxation;
use crate::via_to_pad_clearance_relaxation::apply_via_to_pad_clearance_relaxation;

type Evaluator = Rc<RefCell<dyn DrcEvaluator>>;

#[derive(Clone, Copy)]
enum TopologyVariant {
    Displacement { side: usize },
    Segment { side: usize, half_span: f64, offset: f64, sign: f64 },
    Span { side: usize, expansion: usize, offset: f64, sign: f64 },
    Waypoint { side: usize, expansion: usize, dx: f64, dy: f64 },
}

impl TopologyVariant {
    fn side(self) -> usize {
        match self { Self::Displacement { side } | Self::Segment { side, .. } | Self::Span { side, .. } | Self::Waypoint { side, .. } => side }
    }
}

fn topology_variants(low_count: bool, pair_topology: bool) -> Vec<TopologyVariant> {
    let mut variants = vec![TopologyVariant::Displacement { side: 0 }, TopologyVariant::Displacement { side: 1 }];
    if low_count {
        for sign in [-1.0, 1.0] { for side in [0, 1] { variants.push(TopologyVariant::Segment { side, half_span: 0.4, offset: 1.2, sign }); } }
        for sign in [-1.0, 1.0] { for side in [0, 1] { variants.push(TopologyVariant::Span { side, expansion: 3, offset: 1.8, sign }); } }
        for (dx, dy) in [(-2.4, -0.4), (-2.4, 0.4), (2.4, -0.4), (2.4, 0.4), (-0.4, -2.4), (-0.4, 2.4), (0.4, -2.4), (0.4, 2.4)] { for side in [0, 1] { variants.push(TopologyVariant::Waypoint { side, expansion: 2, dx, dy }); } }
        for (dx, dy) in [(-0.17, 0.0), (0.17, 0.0), (0.0, -0.17), (0.0, 0.17)] { for side in [0, 1] { variants.push(TopologyVariant::Waypoint { side, expansion: 0, dx, dy }); } }
    }
    if low_count || pair_topology {
        for half_span in [0.2, 0.4, 0.8, 1.2] { for offset in [0.2, 0.3, 0.45, 0.6] { for sign in [-1.0, 1.0] { for side in [0, 1] { variants.push(TopologyVariant::Segment { side, half_span, offset, sign }); } } } }
    }
    variants
}

struct TopologyCandidate { routes: Routes, snapshot: DrcSnapshot, via_issue_count: usize, uses_via_in_pad: bool }

pub struct GlobalDrcForceImproveSolver {
    pub params: Value,
    pub input_hd_routes: Routes,
    pub guarded_input_hd_routes: Routes,
    pub output_hd_routes: Routes,
    pub engine: Rc<BroadRepulsionEngine>,
    evaluator: Evaluator,
    reference: Option<Evaluator>,
    pub legacy: bool,
    effort: f64,
    via_hole_diameter: Option<f64>,
    configured_max_iterations: Option<f64>,
    enable_broad_fallback: bool,
    enable_large_board_broad_fallback: bool,
    enable_targeted_error_sweep: bool,
    enable_post_solve_clearance_relaxation: bool,
    enable_safe_trace_layer_moves: bool,
    enable_via_in_pad_layer_moves: bool,
    enable_trace_via_owner_targeting: bool,
    initial_drc_issue_count: Option<usize>,
    initial_repair_drc_issue_count: Option<usize>,
    initial_low_count_errors_have_movable_traces: bool,
    broad_force_accepted: bool,
    targeted_force_accepted: bool,
    candidate_attempts: usize,
    via_in_pad_candidate_attempts: usize,
    via_in_pad_candidates_accepted: usize,
    pad_topology_error_cursor: usize,
    safe_trace_layer_cursor_by_error_id: IndexMap<String, usize>,
    trace_layer_corridor_cursor_by_error_id: IndexMap<String, usize>,
    trace_pair_detour_cursor_by_error_id: IndexMap<String, usize>,
    error_cursor: usize,
    stalled_iterations: usize,
    best_drc_issue_count_seen: Option<usize>,
    best_drc_issue_score_seen: Option<f64>,
    last_drc_count_improvement_check_iteration: usize,
    drc_count_plateau_checks: usize,
    large_board_broad_fallback_misses: usize,
    output_snapshot: Option<DrcSnapshot>,
    legacy_clean_checkpoint: Option<(Routes, DrcSnapshot)>,
    via_pad_repair_rolled_back: bool,
    reference_input_drc_issue_count: Option<usize>,
    reference_candidate_drc_issue_count: Option<usize>,
    reference_candidate_rolled_back: bool,
    reference_input_snapshot: Option<DrcSnapshot>,
    input_snapshot: Option<DrcSnapshot>,
    pub iterations: usize,
    pub max_iterations: f64,
    pub solved: bool,
    pub failed: bool,
    pub error: Option<String>,
    pub progress: f64,
    pub stats: Value,
    pub callback_state: Option<Rc<RefCell<Value>>>,
    pub callback_output: Option<Rc<RefCell<Option<Routes>>>>,
    pub callback_patch: Option<Rc<RefCell<Option<Value>>>>,
}

fn flag(params: &Value, name: &str, default: bool) -> bool { params[name].as_bool().unwrap_or(default) }

pub(crate) fn materialize_native(mut routes: Vec<MutableRoute>, indexes: Option<&[usize]>) -> Routes {
    for (index, route) in routes.iter_mut().enumerate() {
        if indexes.is_none_or(|indexes| indexes.contains(&index)) { route.identity = crate::internal_types::next_identity(); route.via_array_identity = crate::internal_types::next_identity(); route.vias = derive_vias(route); }
    }
    Routes::new(routes)
}

impl GlobalDrcForceImproveSolver {
    pub fn new(params: Value, routes: Routes, engine: Rc<BroadRepulsionEngine>, evaluator: Evaluator, reference: Option<Evaluator>) -> Result<Self, String> {
        let via_hole_diameter = params["viaHoleDiameter"].as_f64();
        if via_hole_diameter.is_some_and(|d| !d.is_finite() || d <= 0.0) { panic!("viaHoleDiameter must be a positive finite number"); }
        let effort = params["effort"].as_f64().unwrap_or(1.0);
        let configured_max_iterations = params["maxIterations"].as_f64();
        let reference_input_snapshot = if let Some(snapshot) = params.get("initialReferenceSnapshot") {
            Some(DrcSnapshot { errors: snapshot["errors"].as_array().expect("Reference errors").clone(), count: snapshot["count"].as_u64().expect("Reference count") as usize, issue_score: 0.0, legacy_issue_score: 0.0, trace_route_index_by_id: IndexMap::new() })
        } else { reference.as_ref().map(|e| e.borrow_mut().snapshot(&routes, false, false)).transpose()? };
        Ok(Self {
            guarded_input_hd_routes: materialize_native(routes.as_ref().clone(), None), input_hd_routes: routes.clone(), output_hd_routes: routes,
            engine, evaluator, reference, legacy: false, effort, via_hole_diameter, configured_max_iterations,
            enable_broad_fallback: flag(&params, "enableBroadFallback", true),
            enable_large_board_broad_fallback: flag(&params, "enableLargeBoardBroadFallback", true),
            enable_targeted_error_sweep: flag(&params, "enableTargetedErrorSweep", false),
            enable_post_solve_clearance_relaxation: flag(&params, "enablePostSolveClearanceRelaxation", true),
            enable_safe_trace_layer_moves: flag(&params, "enableSafeTraceLayerMoves", false),
            enable_via_in_pad_layer_moves: flag(&params, "enableViaInPadLayerMoves", false),
            enable_trace_via_owner_targeting: flag(&params, "enableTraceViaOwnerTargeting", false),
            params, initial_drc_issue_count: None, initial_repair_drc_issue_count: None, initial_low_count_errors_have_movable_traces: false,
            broad_force_accepted: false, targeted_force_accepted: false, candidate_attempts: 0, via_in_pad_candidate_attempts: 0, via_in_pad_candidates_accepted: 0,
            pad_topology_error_cursor: 0, safe_trace_layer_cursor_by_error_id: IndexMap::new(), trace_layer_corridor_cursor_by_error_id: IndexMap::new(), trace_pair_detour_cursor_by_error_id: IndexMap::new(),
            error_cursor: 0, stalled_iterations: 0, best_drc_issue_count_seen: None, best_drc_issue_score_seen: None, last_drc_count_improvement_check_iteration: 0, drc_count_plateau_checks: 0, large_board_broad_fallback_misses: 0,
            output_snapshot: None, legacy_clean_checkpoint: None, via_pad_repair_rolled_back: false, reference_input_drc_issue_count: None, reference_candidate_drc_issue_count: None, reference_candidate_rolled_back: false, reference_input_snapshot, input_snapshot: None,
            iterations: 0, max_iterations: configured_max_iterations.unwrap_or_else(|| get_base_max_iterations(effort)), solved: false, failed: false, error: None, progress: 0.0, stats: json!({}), callback_state: None, callback_output: None, callback_patch: None,
        })
    }

    fn get_snapshot(&mut self, routes: &Routes) -> Result<DrcSnapshot, String> {
        if let Some(state) = &self.callback_state { *state.borrow_mut() = self.debug_state(); }
        if let Some(output) = &self.callback_output { *output.borrow_mut() = Some(self.output_hd_routes.clone()); }
        let result = self.evaluator.borrow_mut().snapshot(routes, self.initial_low_count_errors_have_movable_traces, self.legacy);
        let patch = self.callback_patch.as_ref().and_then(|patch| patch.borrow_mut().take());
        if let Some(patch) = patch { self.restore_public_state(&patch); }
        let output = self.callback_output.as_ref().and_then(|output|output.borrow_mut().take());
        if let Some(output)=output { self.output_hd_routes=output; }
        result
    }

    pub fn restore_public_state(&mut self, state: &Value) {
        if let Some(value) = state["iterations"].as_u64() { self.iterations = value as usize; }
        if let Some(value) = state["MAX_ITERATIONS"].as_f64() { self.max_iterations = value; }
        if let Some(value) = state["progress"].as_f64() { self.progress = value; }
        if let Some(value) = state["solved"].as_bool() { self.solved = value; }
        if let Some(value) = state["failed"].as_bool() { self.failed = value; }
        if let Some(value) = state.get("error") { self.error = value.as_str().map(str::to_owned); }
        if let Some(value) = state.get("stats") { self.stats = value.clone(); }
    }

    fn update_stats(&mut self, snapshot: &DrcSnapshot) {
        self.stats = json!({
            "initialDrcIssueCount": self.initial_drc_issue_count.unwrap_or(snapshot.count), "finalDrcIssueCount": snapshot.count,
            "globalDrcForceImproveMaxIterations": self.max_iterations,
            "globalDrcForceImproveBroadForceAccepted": self.broad_force_accepted,
            "globalDrcForceImproveTargetedForceAccepted": self.targeted_force_accepted,
            "globalDrcForceImproveCandidateAttempts": self.candidate_attempts,
            "globalDrcForceImproveViaInPadCandidateAttempts": self.via_in_pad_candidate_attempts,
            "globalDrcForceImproveViaInPadCandidatesAccepted": self.via_in_pad_candidates_accepted,
            "globalDrcForceImproveStalledIterations": self.stalled_iterations,
            "globalDrcForceImproveBestDrcIssueCountSeen": self.best_drc_issue_count_seen.unwrap_or(snapshot.count),
            "globalDrcForceImproveBestDrcIssueScoreSeen": self.best_drc_issue_score_seen.unwrap_or(snapshot.issue_score),
            "globalDrcForceImproveDrcCountPlateauChecks": self.drc_count_plateau_checks,
            "globalDrcForceImproveLargeBoardBroadFallbackMisses": self.large_board_broad_fallback_misses,
            "globalDrcForceImproveViaPadRepairRolledBack": self.via_pad_repair_rolled_back,
        });
        if let Some(count) = self.reference_input_drc_issue_count { self.stats["globalDrcForceImproveReferenceInputDrcIssueCount"] = json!(count); }
        if let Some(count) = self.reference_candidate_drc_issue_count { self.stats["globalDrcForceImproveReferenceCandidateDrcIssueCount"] = json!(count); }
        self.stats["globalDrcForceImproveReferenceCandidateRolledBack"] = json!(self.reference_candidate_rolled_back);
    }

    fn finish_at_legacy_clean_checkpoint(&mut self) -> bool {
        let Some((routes, snapshot)) = self.legacy_clean_checkpoint.clone() else { return false; };
        self.output_hd_routes = routes; self.output_snapshot = Some(snapshot.clone()); self.via_pad_repair_rolled_back = true;
        self.update_stats(&snapshot); self.solved = true; true
    }

    fn increase_max_iterations_for_drc_issue_count(&mut self, count: usize) {
        if let Some(max) = self.configured_max_iterations { self.max_iterations = max; return; }
        self.max_iterations = self.max_iterations.max(get_drc_scaled_max_iterations(count as f64, self.effort)).max(get_route_complexity_min_iterations(self.input_hd_routes.len(), count));
    }

    fn accept_solved_routes(&mut self, routes: Routes, snapshot: DrcSnapshot) -> Result<(), String> {
        let trace_relaxed = if self.enable_post_solve_clearance_relaxation { apply_trace_to_pad_clearance_relaxation(&self.engine.srj.source, &routes, self.engine.conn_map.as_ref(), self.engine.math) } else { routes.clone() };
        let relaxed = if self.enable_post_solve_clearance_relaxation { apply_via_to_pad_clearance_relaxation(&self.engine.srj.source, &trace_relaxed, self.engine.conn_map.as_ref(), self.engine.math) } else { routes.clone() };
        let relaxed_snapshot = if Routes::ptr_eq(&relaxed, &routes) { snapshot.clone() } else { self.get_snapshot(&relaxed)? };
        let no_worse = relaxed_snapshot.count < snapshot.count || (relaxed_snapshot.count == snapshot.count && relaxed_snapshot.issue_score <= snapshot.issue_score);
        let mut accepted_routes = if no_worse { relaxed } else { routes };
        let mut accepted_snapshot = if no_worse { relaxed_snapshot } else { snapshot };
        let input_snapshot = match self.input_snapshot.clone() { Some(snapshot) => snapshot, None => self.get_snapshot(&self.guarded_input_hd_routes.clone())? };
        if let Some(reference) = self.reference.clone() {
            let input_count = self.reference_input_snapshot.as_ref().expect("Reference input snapshot required").count;
            if let Some(state) = &self.callback_state { *state.borrow_mut() = self.debug_state(); }
        if let Some(output) = &self.callback_output { *output.borrow_mut() = Some(self.output_hd_routes.clone()); }
            let candidate_result = reference.borrow_mut().snapshot(&accepted_routes, false, false);
            let patch = self.callback_patch.as_ref().and_then(|patch| patch.borrow_mut().take());
            if let Some(patch) = patch { self.restore_public_state(&patch); }
            let output = self.callback_output.as_ref().and_then(|output|output.borrow_mut().take());
            if let Some(output)=output { self.output_hd_routes=output; }
            let candidate=candidate_result?;
            self.reference_input_drc_issue_count = Some(input_count); self.reference_candidate_drc_issue_count = Some(candidate.count);
            if candidate.count > input_count { accepted_routes = self.guarded_input_hd_routes.clone(); accepted_snapshot = input_snapshot; self.reference_candidate_rolled_back = true; }
        }
        self.output_hd_routes = accepted_routes; self.output_snapshot = Some(accepted_snapshot.clone()); self.stalled_iterations = 0;
        self.update_stats(&accepted_snapshot); self.solved = true;
        Ok(())
    }

    fn update_drc_count_plateau_state(&mut self, snapshot: &DrcSnapshot) {
        let count = get_repair_drc_issue_count(snapshot); let score = get_repair_drc_issue_score(snapshot);
        let best_count = *self.best_drc_issue_count_seen.get_or_insert(count); let best_score = *self.best_drc_issue_score_seen.get_or_insert(score);
        let initial = self.initial_repair_drc_issue_count.unwrap_or(count);
        let large = self.input_hd_routes.len() > BROAD_FALLBACK_SMALL_ROUTE_LIMIT && initial > 0;
        if (initial >= LARGE_DRC_COUNT_THRESHOLD || large) && (self.iterations as f64) < MIN_ITERATIONS_FOR_LARGE_BOARD_BROAD_FALLBACK {
            if count < best_count || (count == best_count && score < best_score) { self.best_drc_issue_count_seen = Some(count); self.best_drc_issue_score_seen = Some(score); }
            if large && self.large_board_broad_fallback_misses >= MAX_LARGE_BOARD_BROAD_FALLBACK_MISSES { self.solved = true; }
            return;
        }
        if self.iterations - self.last_drc_count_improvement_check_iteration < get_drc_count_improvement_check_interval(initial) { return; }
        self.last_drc_count_improvement_check_iteration = self.iterations;
        if count < best_count || (count == best_count && score < best_score) { self.best_drc_issue_count_seen = Some(count); self.best_drc_issue_score_seen = Some(score); self.drc_count_plateau_checks = 0; return; }
        self.drc_count_plateau_checks += 1;
        if self.drc_count_plateau_checks >= MAX_DRC_COUNT_PLATEAU_CHECKS { self.solved = true; }
    }

    pub fn step(&mut self) -> Result<(), String> {
        if self.solved || self.failed { return Ok(()); }
        self.iterations += 1;
        self.step_inner()?;
        if !self.solved && !self.failed && self.iterations as f64 >= self.max_iterations { self.try_final_acceptance()?; }
        Ok(())
    }

    pub fn step_inner(&mut self) -> Result<(), String> {
        let engine = self.engine.clone();
        let srj = &engine.srj; let conn = engine.conn_map.as_ref(); let math = engine.math;
        let mut best_routes = self.output_hd_routes.clone();
        let mut best_snapshot = match self.output_snapshot.clone() { Some(snapshot) => snapshot, None => self.get_snapshot(&best_routes)? };
        let non_via_pad = get_non_via_pad_drc_issue_count(&best_snapshot);
        if self.legacy_clean_checkpoint.is_some() && non_via_pad > 0 { self.finish_at_legacy_clean_checkpoint(); return Ok(()); }
        if self.legacy_clean_checkpoint.is_none() && non_via_pad == 0 && best_snapshot.errors.iter().any(is_via_pad_drc_error) { self.legacy_clean_checkpoint = Some((materialize_native(best_routes.as_ref().clone(), None), best_snapshot.clone())); }
        if self.initial_drc_issue_count.is_none() {
            self.input_snapshot = Some(best_snapshot.clone()); self.initial_drc_issue_count = Some(best_snapshot.count); self.initial_repair_drc_issue_count = Some(get_repair_drc_issue_count(&best_snapshot));
            let repair_errors = get_legacy_first_repair_errors(&best_snapshot.errors);
            self.initial_low_count_errors_have_movable_traces = self.initial_repair_drc_issue_count.unwrap() > 0 && self.initial_repair_drc_issue_count.unwrap() <= 3 && repair_errors.iter().all(|error| get_trace_route_index_for_error(error, &best_snapshot.trace_route_index_by_id).is_some());
            if self.initial_low_count_errors_have_movable_traces { best_snapshot = self.get_snapshot(&best_routes)?; }
            self.best_drc_issue_count_seen = Some(get_repair_drc_issue_count(&best_snapshot)); self.best_drc_issue_score_seen = Some(get_repair_drc_issue_score(&best_snapshot)); self.increase_max_iterations_for_drc_issue_count(get_repair_drc_issue_count(&best_snapshot));
        }
        if best_snapshot.count == 0 { self.accept_solved_routes(best_routes, best_snapshot)?; return Ok(()); }
        let mut best_count = get_repair_drc_issue_count(&best_snapshot); let mut best_score = get_repair_drc_issue_score(&best_snapshot); let mut best_via = get_via_drc_issue_count(&best_snapshot, true);
        let centered = get_centered_errors(&best_snapshot.errors);
        if centered.is_empty() { self.accept_solved_routes(best_routes, best_snapshot)?; return Ok(()); }
        let max_attempts = get_max_targeted_candidate_attempts_for_effort(self.effort) as usize;
        let mut attempts = 0; let mut safe_attempts = 0; let mut detour_attempted = false; let mut accepted = false; let mut periodic_attempted = false;
        let active = get_legacy_first_repair_errors(&centered);
        let same_via = if self.enable_targeted_error_sweep { active.iter().position(|error| error["type"] == "pcb_via_clearance_error" && error["pcb_via_pair_net_relation"] == "same_net") } else { None };
        let priority_via = same_via.or_else(|| if self.enable_targeted_error_sweep && (self.iterations - 1) % 8 == 0 { active.iter().position(|error| error["type"] == "pcb_via_clearance_error") } else { None });
        let mut prioritized = Vec::new();
        if let Some(index) = priority_via { prioritized.push(active[index].clone()); }
        prioritized.extend(active.iter().enumerate().filter(|(index, _)| Some(*index) != priority_via).map(|(_, error)| error.clone()));
        let max_errors = prioritized.len().min(self.effort.ceil().max(1.0) as usize);
        let start_error_index = if priority_via.is_some() { 0 } else { self.error_cursor % prioritized.len() };
        let sweep = if self.enable_targeted_error_sweep { get_targeted_clearance_sweep_errors(&centered, self.effort) } else { Vec::new() };
        let pair_topology = best_count <= 1 || self.initial_low_count_errors_have_movable_traces;
        let corridor = !self.initial_low_count_errors_have_movable_traces && best_count <= 8 && srj.layer_count > 1;
        let pad_errors: Vec<Value> = if priority_via.is_some() { Vec::new() } else { centered.iter().filter(|error| error["type"] == "pcb_pad_trace_clearance_error" || ((self.enable_safe_trace_layer_moves || pair_topology || corridor) && error["type"] == "pcb_trace_error")).cloned().collect() };
        let ordered: Vec<(usize, Value)> = (0..pad_errors.len()).map(|offset| { let i = (self.pad_topology_error_cursor + offset) % pad_errors.len(); (i, pad_errors[i].clone()) }).collect();
        for (pad_index, error) in if self.enable_safe_trace_layer_moves || self.enable_via_in_pad_layer_moves { ordered } else { Vec::new() } {
            if accepted || ((!self.enable_safe_trace_layer_moves || safe_attempts >= max_attempts) && (!self.enable_via_in_pad_layer_moves || attempts >= max_attempts)) { break; }
            self.pad_topology_error_cursor = (pad_index + 1) % pad_errors.len();
            let mut topology: Option<TopologyCandidate> = None;
            let key = error["pcb_trace_error_id"].as_str().or_else(|| error["pcb_trace_id"].as_str()).map(str::to_owned);
            let route_index = get_trace_route_index_for_error(&error, &best_snapshot.trace_route_index_by_id);
            let route_pair = get_trace_route_pair_for_error(&error, &best_snapshot.trace_route_index_by_id);
            if self.enable_trace_via_owner_targeting && route_index.is_some() && error["pcb_via_ids"].as_array().is_some_and(|ids| ids.len() == 1) && attempts < max_attempts {
                let mut candidate = best_routes.as_ref().clone();
                if apply_via_only_displacement_for_trace_error(srj, &mut candidate, &error, &best_snapshot.trace_route_index_by_id, route_index.unwrap(), conn, math) {
                    let routes = materialize_native(candidate, None); let snapshot = self.get_snapshot(&routes)?; let via = get_via_drc_issue_count(&snapshot, true);
                    attempts += 1; self.candidate_attempts += 1;
                    if via <= best_via && is_drc_snapshot_count_better(&snapshot, &best_snapshot) { topology = Some(TopologyCandidate { routes, snapshot, via_issue_count: via, uses_via_in_pad: false }); }
                }
            }
            if self.enable_safe_trace_layer_moves && route_index.is_some() {
                let safe_indexes = route_pair.map(|p| p.to_vec()).unwrap_or_else(|| vec![route_index.unwrap()]);
                let local_count = safe_indexes.len() * srj.layer_count * 3;
                let full_count = safe_indexes.len() * srj.layer_count * SAFE_TRACE_LAYER_DIRECTION_VARIANT_COUNT;
                let variant_count = local_count + full_count;
                let full_first = is_trace_obstacle_drc_error(&error);
                let full_offset = if full_first { 0 } else { local_count };
                let local_offset = if full_first { full_count } else { 0 };
                let mut cursor = key.as_ref().and_then(|key| self.safe_trace_layer_cursor_by_error_id.get(key)).copied().unwrap_or(0);
                let mut checked = 0;
                while safe_attempts < max_attempts && checked < variant_count {
                    let variant = cursor; cursor = (cursor + 1) % variant_count; checked += 1;
                    let full = variant >= full_offset && variant < full_offset + full_count;
                    let mode = variant - if full { full_offset } else { local_offset };
                    let side = mode % safe_indexes.len(); let layer_variant = mode / safe_indexes.len(); let target_z = layer_variant % srj.layer_count;
                    let expansion = if full { SafeTraceLayerMoveSpanExpansion::Full } else { SafeTraceLayerMoveSpanExpansion::Count((layer_variant / srj.layer_count) % 3) };
                    let direction = if full { layer_variant / srj.layer_count } else { 0 };
                    let changed_index = safe_indexes[side]; let mut evaluated_direction = false;
                    for adjust in [false, true] {
                        let mut candidate = clone_routes_for_indexes(&best_routes, &[changed_index]);
                        if !apply_safe_trace_layer_move_for_error(srj, &mut candidate, &error, changed_index, target_z as f64, expansion, conn, direction, adjust, math, &engine.pad_context) { continue; }
                        let routes = materialize_native(candidate, Some(&[changed_index])); evaluated_direction = true; self.candidate_attempts += 1;
                        let snapshot = self.get_snapshot(&routes)?; let via = get_via_drc_issue_count(&snapshot, true);
                        let comparison = topology.as_ref().map(|c| &c.snapshot).unwrap_or(&best_snapshot); let comparison_via = topology.as_ref().map(|c| c.via_issue_count).unwrap_or(best_via);
                        if via <= comparison_via && (is_drc_snapshot_count_better(&snapshot, comparison) || (topology.is_some() && get_repair_drc_issue_count(&snapshot) == get_repair_drc_issue_count(comparison) && snapshot.count < comparison.count)) { topology = Some(TopologyCandidate { routes, snapshot, via_issue_count: via, uses_via_in_pad: false }); }
                    }
                    if evaluated_direction { safe_attempts += 1; }
                }
                if let Some(key) = &key { self.safe_trace_layer_cursor_by_error_id.insert(key.clone(), cursor); }
            }
            if self.enable_safe_trace_layer_moves && corridor && key.is_some() && route_pair.is_some() {
                let key = key.as_ref().unwrap(); let pair = route_pair.unwrap();
                let mut cursor = self.trace_layer_corridor_cursor_by_error_id.get(key).copied().unwrap_or(0); let mut checked = 0;
                while attempts < max_attempts && checked < 16 {
                    let variant = cursor % 16; cursor += 1; checked += 1;
                    let side = variant % 2; let reverse = (variant / 2) % 2 == 1; let tangent = if (variant / 4) % 2 == 0 { 1.0 } else { -1.0 }; let normal = if variant / 8 == 0 { 1.0 } else { -1.0 };
                    let index = pair[side];
                    let Some(original_z) = best_routes.get(index).and_then(|r| r.route.first()).map(|p| p.borrow().z) else { continue; };
                    let target_z = (original_z + 1.0) % srj.layer_count as f64;
                    let mut candidate = clone_routes_for_indexes(&best_routes, &[index]);
                    if !apply_trace_layer_corridor_for_error(srj, &mut candidate, &error, index, target_z, normal, tangent, reverse, math) { continue; }
                    let routes = materialize_native(candidate, Some(&[index])); attempts += 1; self.candidate_attempts += 1;
                    let snapshot = self.get_snapshot(&routes)?; let via = get_via_drc_issue_count(&snapshot, true);
                    let comparison = topology.as_ref().map(|c| &c.snapshot).unwrap_or(&best_snapshot); let comparison_via = topology.as_ref().map(|c| c.via_issue_count).unwrap_or(best_via);
                    if via <= comparison_via && is_drc_snapshot_count_better(&snapshot, comparison) { topology = Some(TopologyCandidate { routes, snapshot, via_issue_count: via, uses_via_in_pad: false }); }
                }
                self.trace_layer_corridor_cursor_by_error_id.insert(key.clone(), cursor);
            }
            if self.enable_safe_trace_layer_moves && key.is_some() && ((self.initial_low_count_errors_have_movable_traces && (route_pair.is_some() || route_index.is_some())) || (!self.initial_low_count_errors_have_movable_traces && route_pair.is_some())) {
                let variants = topology_variants(self.initial_low_count_errors_have_movable_traces, pair_topology);
                let indexes = route_pair.map(|pair| pair.to_vec()).unwrap_or_else(|| vec![route_index.unwrap()]);
                let key = key.as_ref().unwrap(); let mut cursor = self.trace_pair_detour_cursor_by_error_id.get(key).copied().unwrap_or(0); let mut checked = 0;
                while attempts < max_attempts && checked < variants.len() {
                    let variant = variants[cursor % variants.len()]; cursor += 1; checked += 1;
                    let Some(&index) = indexes.get(variant.side()) else { continue; };
                    let mut topology_error = error.clone();
                    if self.initial_low_count_errors_have_movable_traces && !error["worst_contact_center"].is_null() {
                        topology_error["center"] = error["worst_contact_center"].clone();
                        if !error["worst_contact_message"].is_null() { topology_error["message"] = error["worst_contact_message"].clone(); }
                        if !error["worst_actual_clearance"].is_null() { topology_error["actual_clearance"] = error["worst_actual_clearance"].clone(); }
                    }
                    if let TopologyVariant::Displacement { side } = variant {
                        let mut candidate = best_routes.as_ref().clone();
                        let Some(displacement) = apply_trace_pair_segment_displacement_for_error(srj, &mut candidate, &topology_error, &best_snapshot.trace_route_index_by_id, side, math) else { continue; };
                        detour_attempted = true; attempts += 1; self.candidate_attempts += 1;
                        let mut routes = materialize_native(candidate, None); let mut snapshot = self.get_snapshot(&routes)?; let mut via = get_via_drc_issue_count(&snapshot, true); let mut count = get_repair_drc_issue_count(&snapshot);
                        if count > 0 && attempts < max_attempts {
                            let mut propagated_routes = routes.as_ref().clone(); let mut propagated = false;
                            for chain_error in &snapshot.errors { propagated = apply_via_only_displacement_for_trace_error(srj, &mut propagated_routes, chain_error, &snapshot.trace_route_index_by_id, displacement.moved_route_index, conn, math) || propagated; }
                            if propagated {
                                attempts += 1; self.candidate_attempts += 1; let candidate_routes = materialize_native(propagated_routes, None); let candidate_snapshot = self.get_snapshot(&candidate_routes)?; let candidate_via = get_via_drc_issue_count(&candidate_snapshot, true);
                                if is_better_drc_snapshot(&candidate_snapshot, candidate_via, count, get_repair_drc_issue_score(&snapshot), via, Some(&snapshot)) { routes = candidate_routes; snapshot = candidate_snapshot; via = candidate_via; count = get_repair_drc_issue_count(&snapshot); }
                            }
                        }
                        let comparison = topology.as_ref().map(|c| &c.snapshot).unwrap_or(&best_snapshot); let comparison_via = topology.as_ref().map(|c| c.via_issue_count).unwrap_or(best_via);
                        let comparison_count = topology.as_ref().map(|c| get_repair_drc_issue_count(&c.snapshot)).unwrap_or(best_count); let comparison_score = topology.as_ref().map(|c| get_repair_drc_issue_score(&c.snapshot)).unwrap_or(best_score);
                        if via <= comparison_via && is_better_drc_snapshot(&snapshot, via, comparison_count, comparison_score, comparison_via, Some(comparison)) { topology = Some(TopologyCandidate { routes, snapshot, via_issue_count: via, uses_via_in_pad: false }); }
                        if count == 0 { break; }
                        continue;
                    }
                    let mut candidate = clone_routes_for_indexes(&best_routes, &[index]);
                    let changed = match variant {
                        TopologyVariant::Segment { half_span, offset, sign, .. } => apply_trace_detour_for_error(&mut candidate, &topology_error, index, half_span, offset, sign, math),
                        TopologyVariant::Span { expansion, offset, sign, .. } => apply_trace_span_detour_for_error(srj, &mut candidate, &topology_error, index, expansion, offset, sign, math),
                        TopologyVariant::Waypoint { expansion, dx, dy, .. } => apply_trace_waypoint_detour_for_error(srj, &mut candidate, &topology_error, index, expansion, Point { x: topology_error["center"]["x"].as_f64().expect("Topology error x required") + dx, y: topology_error["center"]["y"].as_f64().expect("Topology error y required") + dy }, math),
                        TopologyVariant::Displacement { .. } => unreachable!(),
                    };
                    if !changed { continue; }
                    let routes = materialize_native(candidate, Some(&[index])); detour_attempted = true; attempts += 1; self.candidate_attempts += 1;
                    let snapshot = self.get_snapshot(&routes)?; let via = get_via_drc_issue_count(&snapshot, true);
                    let comparison = topology.as_ref().map(|c| &c.snapshot).unwrap_or(&best_snapshot); let comparison_via = topology.as_ref().map(|c| c.via_issue_count).unwrap_or(best_via);
                    let comparison_count = topology.as_ref().map(|c| get_repair_drc_issue_count(&c.snapshot)).unwrap_or(best_count); let comparison_score = topology.as_ref().map(|c| get_repair_drc_issue_score(&c.snapshot)).unwrap_or(best_score);
                    let better = if self.initial_low_count_errors_have_movable_traces { is_better_drc_snapshot(&snapshot, via, comparison_count, comparison_score, comparison_via, Some(comparison)) } else { via <= comparison_via && is_drc_snapshot_count_better(&snapshot, comparison) };
                    if better { topology = Some(TopologyCandidate { routes, snapshot, via_issue_count: via, uses_via_in_pad: false }); }
                }
                self.trace_pair_detour_cursor_by_error_id.insert(key.clone(), cursor);
            }
            for side in if self.enable_via_in_pad_layer_moves { vec![EndpointSide::Start, EndpointSide::End] } else { Vec::new() } {
                if attempts >= max_attempts || route_index.is_none() { break; }
                let index = route_index.unwrap(); let mut candidate = clone_routes_for_indexes(&best_routes, &[index]);
                if !apply_terminal_via_relocation_for_error(srj, &mut candidate, &error, &best_snapshot.trace_route_index_by_id, side, conn, self.via_hole_diameter, math) { continue; }
                let routes = materialize_native(candidate, Some(&[index])); self.via_in_pad_candidate_attempts += 1; attempts += 1; self.candidate_attempts += 1;
                let snapshot = self.get_snapshot(&routes)?; let via = get_via_drc_issue_count(&snapshot, true);
                let comparison = topology.as_ref().map(|c| &c.snapshot).unwrap_or(&best_snapshot); let comparison_via = topology.as_ref().map(|c| c.via_issue_count).unwrap_or(best_via);
                let comparison_count = topology.as_ref().map(|c| get_repair_drc_issue_count(&c.snapshot)).unwrap_or(best_count); let comparison_score = topology.as_ref().map(|c| get_repair_drc_issue_score(&c.snapshot)).unwrap_or(best_score);
                if is_better_drc_snapshot(&snapshot, via, comparison_count, comparison_score, comparison_via, Some(comparison)) { topology = Some(TopologyCandidate { routes, snapshot, via_issue_count: via, uses_via_in_pad: true }); }
            }
            for target_z in 0..if self.enable_via_in_pad_layer_moves { srj.layer_count } else { 0 } {
                if attempts >= max_attempts || route_index.is_none() { break; }
                let index = route_index.unwrap(); let mut candidate = clone_routes_for_indexes(&best_routes, &[index]);
                if !apply_via_in_pad_layer_move_for_error(srj, &mut candidate, &error, &best_snapshot.trace_route_index_by_id, target_z as f64, conn, self.via_hole_diameter, math) { continue; }
                let routes = materialize_native(candidate, Some(&[index])); self.via_in_pad_candidate_attempts += 1; attempts += 1; self.candidate_attempts += 1;
                let snapshot = self.get_snapshot(&routes)?; let via = get_via_drc_issue_count(&snapshot, true);
                let comparison = topology.as_ref().map(|c| &c.snapshot).unwrap_or(&best_snapshot); let comparison_via = topology.as_ref().map(|c| c.via_issue_count).unwrap_or(best_via);
                let comparison_count = topology.as_ref().map(|c| get_repair_drc_issue_count(&c.snapshot)).unwrap_or(best_count); let comparison_score = topology.as_ref().map(|c| get_repair_drc_issue_score(&c.snapshot)).unwrap_or(best_score);
                if is_better_drc_snapshot(&snapshot, via, comparison_count, comparison_score, comparison_via, Some(comparison)) { topology = Some(TopologyCandidate { routes, snapshot, via_issue_count: via, uses_via_in_pad: true }); }
            }
            if self.enable_via_in_pad_layer_moves && pair_topology && route_pair.is_some() {
                let pair = route_pair.unwrap(); let sides = if self.iterations % 2 == 0 { [0, 1] } else { [1, 0] }; let expansion = self.iterations % 3;
                for side in sides {
                    for target_z in 0..srj.layer_count {
                        if attempts >= max_attempts { break; }
                        let index = pair[side]; let mut candidate = clone_routes_for_indexes(&best_routes, &[index]);
                        if !apply_trace_pair_layer_move_for_error(srj, &mut candidate, &error, &best_snapshot.trace_route_index_by_id, side, target_z as f64, expansion, conn, self.via_hole_diameter, math) { continue; }
                        let routes = materialize_native(candidate, Some(&[index])); self.via_in_pad_candidate_attempts += 1; attempts += 1; self.candidate_attempts += 1;
                        let snapshot = self.get_snapshot(&routes)?; let via = get_via_drc_issue_count(&snapshot, true);
                        let comparison = topology.as_ref().map(|c| &c.snapshot).unwrap_or(&best_snapshot); let comparison_via = topology.as_ref().map(|c| c.via_issue_count).unwrap_or(best_via);
                        let comparison_count = topology.as_ref().map(|c| get_repair_drc_issue_count(&c.snapshot)).unwrap_or(best_count); let comparison_score = topology.as_ref().map(|c| get_repair_drc_issue_score(&c.snapshot)).unwrap_or(best_score);
                        if is_better_drc_snapshot(&snapshot, via, comparison_count, comparison_score, comparison_via, Some(comparison)) { topology = Some(TopologyCandidate { routes, snapshot, via_issue_count: via, uses_via_in_pad: true }); }
                    }
                }
            }
            if let Some(topology) = topology {
                best_routes = topology.routes; best_snapshot = topology.snapshot; best_count = get_repair_drc_issue_count(&best_snapshot); best_score = get_repair_drc_issue_score(&best_snapshot); best_via = topology.via_issue_count;
                self.targeted_force_accepted = true; if topology.uses_via_in_pad { self.via_in_pad_candidates_accepted += 1; } accepted = true;
            }
        }
        if !accepted && sweep.len() >= 2 {
            let mut candidate = best_routes.as_ref().clone(); let mut changed = false;
            for error in &sweep { changed = apply_drc_error_forces(srj, &mut candidate, std::slice::from_ref(error), &best_snapshot.trace_route_index_by_id, 1.0, conn, true, self.enable_targeted_error_sweep, false, self.enable_trace_via_owner_targeting, math) || changed; }
            if changed {
                let routes = materialize_native(candidate, None); attempts += 1; self.candidate_attempts += 1; let snapshot = self.get_snapshot(&routes)?; let via = get_via_drc_issue_count(&snapshot, true);
                if is_better_drc_snapshot(&snapshot, via, best_count, best_score, best_via, Some(&best_snapshot)) {
                    best_routes = routes; best_snapshot = snapshot; best_count = get_repair_drc_issue_count(&best_snapshot); best_score = get_repair_drc_issue_score(&best_snapshot); best_via = via; self.targeted_force_accepted = true; accepted = true;
                    if best_snapshot.count == 0 { self.accept_solved_routes(best_routes, best_snapshot)?; return Ok(()); }
                }
            }
        }
        for offset in 0..max_errors {
            if attempts >= max_attempts || accepted { break; }
            let index = (start_error_index + offset) % prioritized.len(); let error = &prioritized[index]; self.error_cursor = (index + 1) % prioritized.len();
            let shared = best_count == 1;
            for scale in get_force_scales_for_effort(self.effort) {
                if attempts >= max_attempts { break; }
                let mut candidate = best_routes.as_ref().clone();
                if !apply_drc_error_forces(srj, &mut candidate, std::slice::from_ref(error), &best_snapshot.trace_route_index_by_id, scale, conn, true, self.enable_targeted_error_sweep, shared, self.enable_trace_via_owner_targeting, math) { continue; }
                let routes = materialize_native(candidate, None); attempts += 1; self.candidate_attempts += 1; let snapshot = self.get_snapshot(&routes)?; let via = get_via_drc_issue_count(&snapshot, true);
                if is_better_drc_snapshot(&snapshot, via, best_count, best_score, best_via, Some(&best_snapshot)) {
                    best_routes = routes; best_snapshot = snapshot; best_count = get_repair_drc_issue_count(&best_snapshot); best_score = get_repair_drc_issue_score(&best_snapshot); best_via = via; self.targeted_force_accepted = true; accepted = true;
                    if best_snapshot.count == 0 { self.accept_solved_routes(best_routes, best_snapshot)?; return Ok(()); }
                    break;
                }
            }
            if accepted { break; }
        }
        let affordable = best_routes.len() <= BROAD_FALLBACK_SMALL_ROUTE_LIMIT;
        let cadence = get_large_board_broad_fallback_cadence(centered.len() as f64) as usize;
        let periodic = self.enable_large_board_broad_fallback && self.max_iterations >= MIN_ITERATIONS_FOR_LARGE_BOARD_BROAD_FALLBACK && !affordable && self.stalled_iterations > 0 && self.stalled_iterations % cadence == 0;
        if self.enable_broad_fallback && !accepted && (affordable || (self.effort >= 2.0 && self.stalled_iterations >= 2) || periodic) {
            periodic_attempted = periodic;
            for multiplier in [1, EXTENDED_BROAD_FORCE_PASS_MULTIPLIER] {
                let mut candidate = best_routes.as_ref().clone();
                if !apply_broad_repulsion_forces_compiled(srj, &mut candidate, self.effort, multiplier as f64, conn, !flag(&self.params, "hasCustomDrcEvaluator", true), false, math) { continue; }
                let routes = materialize_native(candidate, None); let snapshot = self.get_snapshot(&routes)?; let via = get_via_drc_issue_count(&snapshot, true);
                if !is_better_drc_snapshot(&snapshot, via, best_count, best_score, best_via, Some(&best_snapshot)) { continue; }
                best_routes = routes; best_snapshot = snapshot; best_count = get_repair_drc_issue_count(&best_snapshot); best_score = get_repair_drc_issue_score(&best_snapshot); best_via = via; self.broad_force_accepted = true; accepted = true;
                if best_snapshot.count == 0 { self.accept_solved_routes(best_routes, best_snapshot)?; return Ok(()); }
            }
        }
        if accepted { self.large_board_broad_fallback_misses = 0; } else if periodic_attempted { self.large_board_broad_fallback_misses += 1; }
        self.output_hd_routes = best_routes.clone(); self.output_snapshot = Some(best_snapshot.clone()); self.stalled_iterations = if accepted { 0 } else { self.stalled_iterations + 1 };
        if !detour_attempted { self.update_drc_count_plateau_state(&best_snapshot); }
        self.update_stats(&best_snapshot);
        if self.solved || best_count == 0 { self.accept_solved_routes(best_routes, best_snapshot)?; }
        Ok(())
    }

    pub fn try_final_acceptance(&mut self) -> Result<(), String> {
        let snapshot = match self.output_snapshot.clone() { Some(snapshot) => snapshot, None => self.get_snapshot(&self.output_hd_routes.clone())? };
        if self.legacy_clean_checkpoint.is_some() && get_non_via_pad_drc_issue_count(&snapshot) > 0 && self.finish_at_legacy_clean_checkpoint() { return Ok(()); }
        self.accept_solved_routes(self.output_hd_routes.clone(), snapshot)?;
        Ok(())
    }

    pub fn debug_state(&self) -> Value {
        json!({
            "iterations": self.iterations,
            "MAX_ITERATIONS": self.max_iterations,
            "solved": self.solved,
            "failed": self.failed,
            "error": self.error,
            "progress": self.progress,
            "stats": self.stats,
            "initialDrcIssueCount": self.initial_drc_issue_count,
            "initialRepairDrcIssueCount": self.initial_repair_drc_issue_count,
            "initialLowCountErrorsHaveMovableTraces": self.initial_low_count_errors_have_movable_traces,
            "candidateAttempts": self.candidate_attempts,
            "viaInPadCandidateAttempts": self.via_in_pad_candidate_attempts,
            "viaInPadCandidatesAccepted": self.via_in_pad_candidates_accepted,
            "padTopologyErrorCursor": self.pad_topology_error_cursor,
            "safeTraceLayerCursorByErrorId": self.safe_trace_layer_cursor_by_error_id,
            "traceLayerCorridorCursorByErrorId": self.trace_layer_corridor_cursor_by_error_id,
            "tracePairDetourCursorByErrorId": self.trace_pair_detour_cursor_by_error_id,
            "errorCursor": self.error_cursor,
            "stalledIterations": self.stalled_iterations,
            "bestDrcIssueCountSeen": self.best_drc_issue_count_seen,
            "bestDrcIssueScoreSeen": self.best_drc_issue_score_seen,
            "lastDrcCountImprovementCheckIteration": self.last_drc_count_improvement_check_iteration,
            "drcCountPlateauChecks": self.drc_count_plateau_checks,
            "largeBoardBroadFallbackMisses": self.large_board_broad_fallback_misses,
            "outputSnapshot": self.output_snapshot,
        })
    }

    pub fn get_output(&self) -> Routes { self.output_hd_routes.clone() }
}
