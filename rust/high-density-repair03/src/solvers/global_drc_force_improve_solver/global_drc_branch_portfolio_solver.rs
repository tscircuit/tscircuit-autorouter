use std::{cell::RefCell, rc::Rc};
use serde_json::{Value, json};
use crate::solvers::global_drc_force_improve_solver::types::{Routes, DrcSnapshot, DrcEvaluator};
use crate::solvers::global_drc_force_improve_solver::solver_helpers::*;
use crate::solvers::global_drc_force_improve_solver::drc_snapshot::*;
use crate::solvers::global_drc_force_improve_solver::drc_snapshot::is_via_pad_drc_error;
use crate::solvers::global_drc_force_improve_solver::global_drc_force_improve_solver::{GlobalDrcForceImproveSolver, materialize_native};

type Evaluator = Rc<RefCell<dyn DrcEvaluator>>;
type Solver = Rc<RefCell<GlobalDrcForceImproveSolver>>;

#[derive(Clone, Copy, PartialEq)]
enum PortfolioPhase { Start, Baseline, Broad, SafeTraceLayer, MixedSafeTraceLayer, ViaInPad, Done }

pub struct GlobalDrcBranchPortfolioSolver {
    pub params: Value,
    pub input_hd_routes: Routes,
    pub guarded_input_hd_routes: Routes,
    pub output_hd_routes: Routes,
    broad_max_iterations: f64,
    broad_pass_multiplier: f64,
    engine: Rc<BroadRepulsionEngine>,
    evaluator: Evaluator,
    reference: Option<Evaluator>,
    via_in_pad_evaluator: Option<Evaluator>,
    phase: PortfolioPhase,
    input_snapshot: Option<DrcSnapshot>,
    baseline_solver: Option<Solver>,
    baseline_snapshot: Option<DrcSnapshot>,
    broad_input_snapshot: Option<DrcSnapshot>,
    broad_snapshot: Option<DrcSnapshot>,
    broad_solver: Option<Solver>,
    safe_trace_layer_input_routes: Option<Routes>,
    safe_trace_layer_input_snapshot: Option<DrcSnapshot>,
    safe_trace_layer_solver: Option<Solver>,
    safe_trace_layer_phase_accepted: bool,
    mixed_safe_trace_layer_solver: Option<Solver>,
    mixed_safe_trace_layer_phase_accepted: bool,
    legacy_safe_trace_layer_routes: Option<Routes>,
    legacy_safe_trace_layer_snapshot: Option<DrcSnapshot>,
    legacy_safe_trace_layer_selected_solver: Option<Solver>,
    via_in_pad_solver: Option<Solver>,
    portfolio_selected_solver: Option<Solver>,
    selected_solver: Option<Solver>,
    reference_input_drc_issue_count: Option<usize>,
    reference_candidate_drc_issue_count: Option<usize>,
    reference_candidate_rolled_back: bool,
    mixed_reference_input_drc_issue_count: Option<usize>,
    mixed_reference_candidate_drc_issue_count: Option<usize>,
    reference_input_snapshot: Option<DrcSnapshot>,
    pub active_sub_solver: Option<Solver>,
    pub iterations: usize,
    pub solved: bool,
    pub failed: bool,
    pub error: Option<String>,
    pub progress: f64,
    pub stats: Value,
}

impl GlobalDrcBranchPortfolioSolver {
    pub fn new(params: Value, routes: Routes, engine: Rc<BroadRepulsionEngine>, evaluator: Evaluator, reference: Option<Evaluator>, via_in_pad_evaluator: Option<Evaluator>) -> Result<Self, String> {
        let multiplier = params["broadPassMultiplier"].as_f64().expect("broadPassMultiplier must be a finite number");
        assert!(multiplier.is_finite(), "broadPassMultiplier must be a finite number");
        assert!(multiplier > 0.0, "broadPassMultiplier must be greater than zero");
        let broad_max = params["broadMaxIterations"].as_f64().expect("broadMaxIterations must be an integer");
        assert!(broad_max.is_finite() && broad_max.fract() == 0.0, "broadMaxIterations must be an integer");
        assert!(broad_max > 0.0, "broadMaxIterations must be greater than zero");
        if let Some(max) = params["viaInPadMaxIterations"].as_f64() { assert!(max.is_finite() && max.fract() == 0.0, "viaInPadMaxIterations must be an integer"); assert!(max > 0.0, "viaInPadMaxIterations must be greater than zero"); }
        let reference_input_snapshot = reference.as_ref().map(|e| e.borrow_mut().snapshot(&routes, false, false)).transpose()?;
        Ok(Self {
            params, input_hd_routes: routes.clone(), guarded_input_hd_routes: materialize_native(routes.as_ref().clone(), None), output_hd_routes: routes,
            broad_max_iterations: broad_max, broad_pass_multiplier: multiplier, engine, evaluator, reference, via_in_pad_evaluator,
            phase: PortfolioPhase::Start, input_snapshot: None, baseline_solver: None, baseline_snapshot: None, broad_input_snapshot: None, broad_snapshot: None, broad_solver: None,
            safe_trace_layer_input_routes: None, safe_trace_layer_input_snapshot: None, safe_trace_layer_solver: None, safe_trace_layer_phase_accepted: false,
            mixed_safe_trace_layer_solver: None, mixed_safe_trace_layer_phase_accepted: false, legacy_safe_trace_layer_routes: None, legacy_safe_trace_layer_snapshot: None, legacy_safe_trace_layer_selected_solver: None,
            via_in_pad_solver: None, portfolio_selected_solver: None, selected_solver: None, reference_input_drc_issue_count: None, reference_candidate_drc_issue_count: None, reference_candidate_rolled_back: false,
            mixed_reference_input_drc_issue_count: None, mixed_reference_candidate_drc_issue_count: None, reference_input_snapshot,
            active_sub_solver: None, iterations: 0, solved: false, failed: false, error: None, progress: 0.0, stats: json!({}),
        })
    }

    fn step_branch(&mut self, solver: &Solver, name: &str) -> Result<(), String> {
        self.active_sub_solver = Some(solver.clone()); solver.borrow_mut().step()?;
        let solver = solver.borrow();
        if solver.failed { return Err(format!("{name} DRC repair branch failed: {}", solver.error.as_deref().unwrap_or("null"))); }
        Ok(())
    }

    fn get_snapshot(&self, routes: &Routes) -> Result<DrcSnapshot, String> { self.evaluator.borrow_mut().snapshot(routes, false, false)
    }

    fn finish_with_output(&mut self, routes: Routes, snapshot: DrcSnapshot, selected: Option<Solver>) -> Result<(), String> {
        let mut accepted_routes = routes; let mut accepted_snapshot = snapshot.clone();
        if let Some(reference) = &self.reference {
            let input = self.reference_input_snapshot.as_ref().expect("Reference input snapshot required");
            let candidate = reference.borrow_mut().snapshot(&accepted_routes, false, false)?;
            self.reference_input_drc_issue_count = Some(input.count); self.reference_candidate_drc_issue_count = Some(candidate.count);
            if candidate.count > input.count || (candidate.count == input.count && has_new_drc_error_identities(&candidate.errors, &input.errors)) { accepted_routes = self.guarded_input_hd_routes.clone(); accepted_snapshot = self.input_snapshot.clone().expect("Input snapshot required"); self.reference_candidate_rolled_back = true; }
        }
        self.output_hd_routes = accepted_routes; self.selected_solver = selected.clone(); self.active_sub_solver = None; self.phase = PortfolioPhase::Done; self.progress = 1.0;
        self.stats = self.portfolio_selected_solver.as_ref().map(|s| s.borrow().stats.clone()).unwrap_or(json!({}));
        if let Some(selected) = &selected { for (key, value) in selected.borrow().stats.as_object().expect("Solver stats object required") { self.stats[key] = value.clone(); } }
        let additions = [
            ("finalDrcIssueCount", Some(json!(accepted_snapshot.count))),
            ("drcBranchPortfolioInitialDrcIssueCount", Some(json!(self.input_snapshot.as_ref().map(|s| s.count).unwrap_or(snapshot.count)))),
            ("drcBranchPortfolioBaselineDrcIssueCount", Some(json!(self.baseline_snapshot.as_ref().map(|s| s.count).unwrap_or(snapshot.count)))),
            ("drcBranchPortfolioBroadInitialDrcIssueCount", self.broad_input_snapshot.as_ref().map(|s| json!(s.count))),
            ("drcBranchPortfolioBroadFinalDrcIssueCount", self.broad_snapshot.as_ref().map(|s| json!(s.count))),
            ("drcBranchPortfolioBroadMaxIterations", Some(json!(self.broad_max_iterations))),
            ("drcBranchPortfolioBroadBranchAttempted", Some(json!(self.broad_solver.is_some()))),
            ("drcBranchPortfolioBroadBranchAccepted", Some(json!(self.portfolio_selected_solver.as_ref().zip(self.broad_solver.as_ref()).is_some_and(|(a,b)| Rc::ptr_eq(a,b))))),
            ("drcBranchPortfolioSafeTraceLayerPhaseAttempted", Some(json!(self.safe_trace_layer_solver.is_some()))),
            ("drcBranchPortfolioSafeTraceLayerPhaseAccepted", Some(json!(self.safe_trace_layer_phase_accepted))),
            ("drcBranchPortfolioMixedSafeTraceLayerPhaseAttempted", Some(json!(self.mixed_safe_trace_layer_solver.is_some()))),
            ("drcBranchPortfolioMixedSafeTraceLayerPhaseAccepted", Some(json!(self.mixed_safe_trace_layer_phase_accepted))),
            ("drcBranchPortfolioViaInPadPhaseAttempted", Some(json!(self.via_in_pad_solver.is_some()))),
            ("drcBranchPortfolioViaInPadMaxIterations", self.params.get("viaInPadMaxIterations").filter(|v| !v.is_null()).cloned()),
            ("drcBranchPortfolioFinalNonViaPadDrcIssueCount", Some(json!(get_non_via_pad_drc_issue_count(&accepted_snapshot)))),
            ("drcBranchPortfolioReferenceInputDrcIssueCount", self.reference_input_drc_issue_count.map(|count| json!(count))),
            ("drcBranchPortfolioReferenceCandidateDrcIssueCount", self.reference_candidate_drc_issue_count.map(|count| json!(count))),
            ("drcBranchPortfolioReferenceCandidateRolledBack", Some(json!(self.reference_candidate_rolled_back))),
            ("drcBranchPortfolioMixedReferenceInputDrcIssueCount", self.mixed_reference_input_drc_issue_count.map(|count| json!(count))),
            ("drcBranchPortfolioMixedReferenceCandidateDrcIssueCount", self.mixed_reference_candidate_drc_issue_count.map(|count| json!(count))),
        ];
        for (key, value) in additions { if let Some(value) = value { self.stats[key] = value; } }
        self.solved = true;
        Ok(())
    }

    fn branch(&self, mut params: Value, routes: Routes, legacy: bool, reference: Option<Evaluator>, evaluator: Option<Evaluator>) -> Result<Solver, String> {
        if legacy { params["hasCustomDrcEvaluator"] = json!(true); }
        let mut solver = GlobalDrcForceImproveSolver::new(params, routes, self.engine.clone(), evaluator.unwrap_or_else(|| self.evaluator.clone()), reference)?; solver.legacy = legacy; Ok(Rc::new(RefCell::new(solver)))
    }

    fn start_baseline_branch(&mut self) -> Result<(), String> {
        let mut params = self.params.clone(); params["enableSafeTraceLayerMoves"] = json!(false); params["enableViaInPadLayerMoves"] = json!(false);
        let solver = self.branch(params, self.input_hd_routes.clone(), true, None, None)?; self.active_sub_solver = Some(solver.clone()); self.baseline_solver = Some(solver); self.phase = PortfolioPhase::Baseline;
        Ok(())
    }

    fn phase_params(&self) -> Value {
        let mut params = self.params.clone();
        params["maxIterations"] = if !params["viaInPadMaxIterations"].is_null() { params["viaInPadMaxIterations"].clone() } else { params["maxIterations"].clone() };
        params["enableLargeBoardBroadFallback"] = json!(false); params["enableTargetedErrorSweep"] = json!(false); params["enablePostSolveClearanceRelaxation"] = json!(false);
        params
    }

    fn start_safe_trace_layer_phase(&mut self, routes: Routes, snapshot: DrcSnapshot, selected: Option<Solver>) -> Result<(), String> {
        self.portfolio_selected_solver = selected.clone();
        if self.params["enableSafeTraceLayerMoves"] != true { self.start_via_in_pad_phase(routes, snapshot, selected)?; return Ok(()); }
        self.safe_trace_layer_input_routes = Some(routes.clone()); self.safe_trace_layer_input_snapshot = Some(snapshot);
        let mut params = self.phase_params(); params["enableSafeTraceLayerMoves"] = json!(true); params["enableViaInPadLayerMoves"] = json!(false);
        let solver = self.branch(params, routes, true, None, None)?; self.active_sub_solver = Some(solver.clone()); self.safe_trace_layer_solver = Some(solver); self.phase = PortfolioPhase::SafeTraceLayer;
        Ok(())
    }

    fn start_via_in_pad_phase(&mut self, routes: Routes, snapshot: DrcSnapshot, selected: Option<Solver>) -> Result<(), String> {
        self.portfolio_selected_solver = selected.clone();
        let topology = self.params["enableViaInPadLayerMoves"] == true && self.via_in_pad_evaluator.is_some();
        if !snapshot.errors.iter().any(is_via_pad_drc_error) && !topology { self.finish_with_output(routes, snapshot, selected)?; return Ok(()); }
        let mut params = self.phase_params(); params["enableSafeTraceLayerMoves"] = json!(false); params["enableViaInPadLayerMoves"] = self.params["enableViaInPadLayerMoves"].clone();
        let solver = self.branch(params, routes, false, self.reference.clone(), self.via_in_pad_evaluator.clone())?; self.active_sub_solver = Some(solver.clone()); self.via_in_pad_solver = Some(solver); self.phase = PortfolioPhase::ViaInPad;
        Ok(())
    }

    fn start_mixed_safe_trace_layer_phase(&mut self, routes: Routes, snapshot: DrcSnapshot, selected: Option<Solver>) -> Result<(), String> {
        self.legacy_safe_trace_layer_routes = Some(routes); self.legacy_safe_trace_layer_snapshot = Some(snapshot); self.legacy_safe_trace_layer_selected_solver = selected;
        let mut params = self.phase_params(); params["enableSafeTraceLayerMoves"] = json!(true); params["enableViaInPadLayerMoves"] = json!(false);
        let solver = self.branch(params, self.safe_trace_layer_input_routes.clone().expect("Safe trace input routes required"), false, None, None)?;
        self.active_sub_solver = Some(solver.clone()); self.mixed_safe_trace_layer_solver = Some(solver); self.phase = PortfolioPhase::MixedSafeTraceLayer;
        Ok(())
    }

    fn start_broad_branch(&mut self) -> Result<(), String> {
        let mut routes = self.input_hd_routes.as_ref().clone();
        let changed = apply_broad_repulsion_forces_compiled(&self.engine.srj, &mut routes, self.params["effort"].as_f64().unwrap_or(1.0), self.broad_pass_multiplier, self.engine.conn_map.as_ref(), false, true, self.engine.math);
        let routes = if changed { materialize_native(routes, None) } else { self.input_hd_routes.clone() };
        let snapshot = self.get_snapshot(&routes)?; self.broad_input_snapshot = Some(snapshot.clone());
        if !is_drc_snapshot_count_better(&snapshot, self.baseline_snapshot.as_ref().expect("Baseline snapshot required")) {
            let solver = self.baseline_solver.clone().unwrap(); let output = solver.borrow().get_output(); self.start_safe_trace_layer_phase(output, self.baseline_snapshot.clone().unwrap(), Some(solver))?; return Ok(());
        }
        let mut params = self.params.clone(); params["maxIterations"] = json!(self.broad_max_iterations); params["enableSafeTraceLayerMoves"] = json!(false); params["enableViaInPadLayerMoves"] = json!(false);
        let solver = self.branch(params, routes, true, None, None)?; self.active_sub_solver = Some(solver.clone()); self.broad_solver = Some(solver); self.phase = PortfolioPhase::Broad;
        Ok(())
    }

    pub fn step(&mut self) -> Result<(), String> {
        if self.solved || self.failed { return Ok(()); }
        self.iterations += 1; self.step_inner()?;
        if !self.solved && self.iterations >= 100000 { self.failed = true; self.error = Some("GlobalDrcBranchPortfolioSolver ran out of iterations".into()); }
        Ok(())
    }

    pub fn step_inner(&mut self) -> Result<(), String> {
        match self.phase {
            PortfolioPhase::Start => {
                let snapshot = self.get_snapshot(&self.input_hd_routes)?; self.input_snapshot = Some(snapshot.clone());
                if get_non_via_pad_drc_issue_count(&snapshot) == 0 { self.start_via_in_pad_phase(self.input_hd_routes.clone(), snapshot, None)?; } else { self.start_baseline_branch()?; }
            }
            PortfolioPhase::Baseline => {
                let solver = self.baseline_solver.clone().unwrap(); self.step_branch(&solver, "baseline")?; if !solver.borrow().solved { return Ok(()); }
                let routes = solver.borrow().get_output(); let snapshot = self.get_snapshot(&routes)?; self.baseline_snapshot = Some(snapshot.clone());
                if get_non_via_pad_drc_issue_count(&snapshot) == 0 { self.start_via_in_pad_phase(routes, snapshot, Some(solver))?; return Ok(()); }
                if self.params["enableSafeTraceLayerMoves"] == true && snapshot.count <= 3 { self.start_safe_trace_layer_phase(routes, snapshot, Some(solver))?; } else { self.start_broad_branch()?; }
            }
            PortfolioPhase::Broad => {
                let solver = self.broad_solver.clone().unwrap(); self.step_branch(&solver, "broad")?; if !solver.borrow().solved { return Ok(()); }
                let routes = solver.borrow().get_output(); let snapshot = self.get_snapshot(&routes)?; self.broad_snapshot = Some(snapshot.clone());
                if is_drc_snapshot_count_better(&snapshot, self.baseline_snapshot.as_ref().unwrap()) { self.start_safe_trace_layer_phase(routes, snapshot, Some(solver))?; }
                else { let solver = self.baseline_solver.clone().unwrap(); let routes = solver.borrow().get_output(); self.start_safe_trace_layer_phase(routes, self.baseline_snapshot.clone().unwrap(), Some(solver))?; }
            }
            PortfolioPhase::SafeTraceLayer => {
                let solver = self.safe_trace_layer_solver.clone().unwrap(); self.step_branch(&solver, "safe trace-layer")?; if !solver.borrow().solved { return Ok(()); }
                let routes = solver.borrow().get_output(); let snapshot = self.get_snapshot(&routes)?; let input = self.safe_trace_layer_input_snapshot.as_ref().unwrap();
                let input_via = get_via_drc_issue_count(input, false); let via = get_via_drc_issue_count(&snapshot, false);
                self.safe_trace_layer_phase_accepted = via <= input_via && is_better_drc_snapshot(&snapshot, via, input.count, input.issue_score, input_via, Some(input));
                let routes = if self.safe_trace_layer_phase_accepted { routes } else { self.safe_trace_layer_input_routes.clone().unwrap() };
                let snapshot = if self.safe_trace_layer_phase_accepted { snapshot } else { input.clone() };
                let selected = if self.safe_trace_layer_phase_accepted { Some(solver) } else { self.portfolio_selected_solver.clone() };
                if snapshot.count > 0 && self.broad_input_snapshot.is_none() { self.start_broad_branch()?; return Ok(()); }
                if get_non_via_pad_drc_issue_count(&snapshot) > 0 && self.safe_trace_layer_input_snapshot.as_ref().unwrap().errors.iter().any(is_via_pad_drc_error) { self.start_mixed_safe_trace_layer_phase(routes, snapshot, selected)?; return Ok(()); }
                self.start_via_in_pad_phase(routes, snapshot, selected)?;
            }
            PortfolioPhase::MixedSafeTraceLayer => {
                let solver = self.mixed_safe_trace_layer_solver.clone().unwrap(); self.step_branch(&solver, "mixed safe trace-layer")?; if !solver.borrow().solved { return Ok(()); }
                let routes = solver.borrow().get_output(); let snapshot = self.get_snapshot(&routes)?;
                let no_regression = get_non_via_pad_drc_issue_count(&snapshot) <= get_non_via_pad_drc_issue_count(self.legacy_safe_trace_layer_snapshot.as_ref().unwrap());
                let mut improves_reference = true;
                if let Some(reference) = &self.reference {
                    let input = reference.borrow_mut().snapshot(self.legacy_safe_trace_layer_routes.as_ref().unwrap(), false, false)?;
                    let candidate = reference.borrow_mut().snapshot(&routes, false, false)?;
                    self.mixed_reference_input_drc_issue_count = Some(input.count); self.mixed_reference_candidate_drc_issue_count = Some(candidate.count); improves_reference = candidate.count <= input.count;
                }
                self.mixed_safe_trace_layer_phase_accepted = no_regression && improves_reference;
                self.start_via_in_pad_phase(if self.mixed_safe_trace_layer_phase_accepted { routes } else { self.legacy_safe_trace_layer_routes.clone().unwrap() }, if self.mixed_safe_trace_layer_phase_accepted { snapshot } else { self.legacy_safe_trace_layer_snapshot.clone().unwrap() }, if self.mixed_safe_trace_layer_phase_accepted { Some(solver) } else { self.legacy_safe_trace_layer_selected_solver.clone() })?;
            }
            PortfolioPhase::ViaInPad => {
                let solver = self.via_in_pad_solver.clone().unwrap(); self.step_branch(&solver, "via-in-pad")?; if !solver.borrow().solved { return Ok(()); }
                let routes = solver.borrow().get_output(); let snapshot = self.via_in_pad_evaluator.as_ref().unwrap_or(&self.evaluator).borrow_mut().snapshot(&routes, false, false)?; self.finish_with_output(routes, snapshot, Some(solver))?;
            }
            PortfolioPhase::Done => {}
        }
        Ok(())
    }

    pub fn debug_state(&self) -> Value {
        let phase = match self.phase {
            PortfolioPhase::Start => "start", PortfolioPhase::Baseline => "baseline",
            PortfolioPhase::Broad => "broad", PortfolioPhase::SafeTraceLayer => "safeTraceLayer",
            PortfolioPhase::MixedSafeTraceLayer => "mixedSafeTraceLayer", PortfolioPhase::ViaInPad => "viaInPad", PortfolioPhase::Done => "done",
        };
        let mut state = json!({ "phase": phase, "iterations": self.iterations, "solved": self.solved, "failed": self.failed, "stats": self.stats });
        for (key, solver) in [
            ("baselineSolver", &self.baseline_solver), ("broadSolver", &self.broad_solver),
            ("safeTraceLayerSolver", &self.safe_trace_layer_solver), ("mixedSafeTraceLayerSolver", &self.mixed_safe_trace_layer_solver),
            ("viaInPadSolver", &self.via_in_pad_solver), ("activeSubSolver", &self.active_sub_solver),
        ] {
            state[key] = solver.as_ref().map(|solver| solver.borrow().debug_state()).unwrap_or(Value::Null);
        }
        state
    }

    pub fn get_output(&self) -> Routes { self.output_hd_routes.clone() }
}
