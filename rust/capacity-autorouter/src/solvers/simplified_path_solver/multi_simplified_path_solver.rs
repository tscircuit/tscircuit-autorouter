use super::{
    single_simplified_path_solver::{SingleSimplifiedPathParams, SingleSimplifiedPathSolver},
    single_simplified_path_solver5_deg45::SingleSimplifiedPathSolver5,
    vertex_shortcut_path_solver::VertexShortcutPathSolver,
};
use crate::bindings::high_density::specialized_base_solver::{BaseSolverState, SpecializedSolver};
use crate::bindings::trace_simplification::math_utils::max;
use crate::bindings::trace_simplification::types::*;
use std::cell::RefCell;
use std::rc::Rc;

pub enum PathChildKind {
    Base(SingleSimplifiedPathSolver),
    Sampled(SingleSimplifiedPathSolver5),
    Vertex(VertexShortcutPathSolver),
}
pub struct PathChild {
    pub identity: u64,
    pub kind: PathChildKind,
}
pub type PathChildRef = Rc<RefCell<PathChild>>;
impl PathChild {
    pub fn base_solver(&self) -> &SingleSimplifiedPathSolver {
        match &self.kind {
            PathChildKind::Base(s) => s,
            PathChildKind::Sampled(s) => &s.inner,
            PathChildKind::Vertex(s) => &s.inner.inner,
        }
    }
    pub fn base_solver_mut(&mut self) -> &mut SingleSimplifiedPathSolver {
        match &mut self.kind {
            PathChildKind::Base(s) => s,
            PathChildKind::Sampled(s) => &mut s.inner,
            PathChildKind::Vertex(s) => &mut s.inner.inner,
        }
    }
    pub fn sampled(&self) -> Option<&SingleSimplifiedPathSolver5> {
        match &self.kind {
            PathChildKind::Base(_) => None,
            PathChildKind::Sampled(s) => Some(s),
            PathChildKind::Vertex(s) => Some(&s.inner),
        }
    }
    pub fn sampled_mut(&mut self) -> Option<&mut SingleSimplifiedPathSolver5> {
        match &mut self.kind {
            PathChildKind::Base(_) => None,
            PathChildKind::Sampled(s) => Some(s),
            PathChildKind::Vertex(s) => Some(&mut s.inner),
        }
    }
    pub fn simplified_route(&self) -> RouteRef {
        self.base_solver().simplified_route()
    }
}
impl SpecializedSolver for PathChild {
    fn base(&self) -> &BaseSolverState {
        &self.base_solver().base
    }
    fn base_mut(&mut self) -> &mut BaseSolverState {
        &mut self.base_solver_mut().base
    }
    fn get_solver_name(&self) -> &'static str {
        match &self.kind {
            PathChildKind::Vertex(_) => "VertexShortcutPathSolver",
            _ => "SingleSimplifiedPathSolver",
        }
    }
    fn _step(&mut self) -> Result<(), String> {
        match &mut self.kind {
            PathChildKind::Base(s) => s._step(),
            PathChildKind::Sampled(s) => s._step(),
            PathChildKind::Vertex(s) => s._step(),
        }
    }
}
#[derive(Clone)]
pub struct MultiSimplifiedPathParams {
    pub unsimplified_hd_routes: Vec<RouteRef>,
    pub other_hd_routes: Rc<Vec<RouteRef>>,
    pub obstacles: Rc<Vec<ObstacleRef>>,
    pub conn_map: Rc<ConnectivityMap>,
    pub color_map: ColorMapRef,
    pub outline: Option<Rc<Vec<Point2>>>,
    pub min_board_edge_clearance: f64,
    pub default_via_diameter: f64,
    pub use_trace_width_aware_clearance: bool,
    pub enable_vertex_shortcuts: bool,
    pub math: Math,
}
pub struct MultiSimplifiedPathSolver {
    pub base: BaseSolverState,
    pub simplified_hd_routes: Vec<RouteRef>,
    pub current_unsimplified_hd_route_index: usize,
    pub active_sub_solver: Option<PathChildRef>,
    pub params: MultiSimplifiedPathParams,
    pub connectivity: Rc<
        RefCell<crate::bindings::trace_simplification::connectivity_context::ConnectivityContext>,
    >,
}
impl MultiSimplifiedPathSolver {
    pub fn new(mut params: MultiSimplifiedPathParams) -> Self {
        let mut layers = 2.0;
        for route in params
            .unsimplified_hd_routes
            .iter()
            .chain(params.other_hd_routes.iter())
        {
            for point in &route.borrow().route {
                layers = max(layers, point.borrow().z + 1.0);
            }
        }
        if layers == 0.0 || layers.is_nan() {
            layers = 2.0;
        }
        params.obstacles = Rc::new(
            crate::utils::create_objects_with_z_layers::normalize_obstacles(
                params.obstacles.as_ref().clone(),
                layers,
            ),
        );
        let connectivity = Rc::new(RefCell::new(
            crate::bindings::trace_simplification::connectivity_context::ConnectivityContext::new(
                params.conn_map.clone(),
            ),
        ));
        Self {
            connectivity,
            base: BaseSolverState {
                max_iterations: 100e6,
                ..Default::default()
            },
            simplified_hd_routes: Vec::new(),
            current_unsimplified_hd_route_index: 0,
            active_sub_solver: None,
            params,
        }
    }
    fn child_params(
        &self,
        input: RouteRef,
        others: Rc<Vec<RouteRef>>,
    ) -> SingleSimplifiedPathParams {
        SingleSimplifiedPathParams {
            connectivity: self.connectivity.clone(),
            input_route: input,
            other_hd_routes: others,
            obstacles: self.params.obstacles.clone(),
            conn_map: self.params.conn_map.clone(),
            color_map: self.params.color_map.clone(),
            outline: self.params.outline.clone(),
            min_board_edge_clearance: self.params.min_board_edge_clearance,
            use_trace_width_aware_clearance: self.params.use_trace_width_aware_clearance,
            math: self.params.math,
        }
    }
    pub fn _step(&mut self) -> Result<(), String> {
        if self.active_sub_solver.is_none() {
            let Some(route) = self
                .params
                .unsimplified_hd_routes
                .get(self.current_unsimplified_hd_route_index)
                .cloned()
            else {
                self.base.solved = true;
                return Ok(());
            };
            crate::bindings::trace_simplification::connectivity_read_barrier::check(
                &self.params.conn_map,
            )?;
            let mut others = self.params.other_hd_routes.as_ref().clone();
            others.extend_from_slice(
                &self.params.unsimplified_hd_routes[self.current_unsimplified_hd_route_index + 1..],
            );
            others.extend(self.simplified_hd_routes.iter().cloned());
            self.active_sub_solver = Some(Rc::new(RefCell::new(PathChild {
                identity: next_identity(),
                kind: PathChildKind::Sampled(SingleSimplifiedPathSolver5::new(
                    self.child_params(route, Rc::new(others)),
                )),
            })));
            self.current_unsimplified_hd_route_index += 1;
            return Ok(());
        }
        let child = self.active_sub_solver.as_ref().unwrap().clone();
        child.borrow_mut().step()?;
        if child.borrow().base().solved {
            if self.params.enable_vertex_shortcuts
                && !matches!(&child.borrow().kind, PathChildKind::Vertex(_))
            {
                crate::bindings::trace_simplification::connectivity_read_barrier::check(
                    &self.params.conn_map,
                )?;
                let params = self.child_params(
                    child.borrow().simplified_route(),
                    child.borrow().base_solver().params.other_hd_routes.clone(),
                );
                self.active_sub_solver = Some(Rc::new(RefCell::new(PathChild {
                    identity: next_identity(),
                    kind: PathChildKind::Vertex(VertexShortcutPathSolver::new(params)),
                })));
                return Ok(());
            }
            self.simplified_hd_routes
                .push(child.borrow().simplified_route());
            self.active_sub_solver = None;
        }
        Ok(())
    }
}
impl SpecializedSolver for MultiSimplifiedPathSolver {
    fn base(&self) -> &BaseSolverState {
        &self.base
    }
    fn base_mut(&mut self) -> &mut BaseSolverState {
        &mut self.base
    }
    fn get_solver_name(&self) -> &'static str {
        "MultiSimplifiedPathSolver"
    }
    fn _step(&mut self) -> Result<(), String> {
        MultiSimplifiedPathSolver::_step(self)
    }
}
