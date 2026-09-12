use std::cell::{RefCell, OnceCell};
use std::rc::Rc;
use indexmap::IndexMap;
use serde::{Serialize, Deserialize};
use serde_json::Value;
use crate::solvers::global_drc_force_improve_solver::internal_types::MutableRoute;

#[derive(Debug)]
struct RouteVersion {
    routes: Vec<MutableRoute>,
    next: OnceCell<Box<RouteVersion>>,
}

#[derive(Clone, Debug)]
pub struct Routes(Rc<RouteVersion>);

impl Routes {
    pub fn new(routes: Vec<MutableRoute>) -> Self {
        Self(Rc::new(RouteVersion { routes, next: OnceCell::new() }))
    }

    pub fn ptr_eq(left: &Self, right: &Self) -> bool {
        Rc::ptr_eq(&left.0, &right.0)
    }

    pub fn as_ref(&self) -> &Vec<MutableRoute> {
        self
    }

    pub fn replace(&self, routes: Vec<MutableRoute>) {
        let mut version = self.0.as_ref();
        while let Some(next) = version.next.get() { version = next; }
        // Older versions stay alive so references held across an explicit JS
        // callback remain valid; cloned handles subsequently read the new version.
        version.next.set(Box::new(RouteVersion { routes, next: OnceCell::new() })).expect("Route version already replaced");
    }
}

impl std::ops::Deref for Routes {
    type Target = Vec<MutableRoute>;
    fn deref(&self) -> &Self::Target {
        let mut version = self.0.as_ref();
        while let Some(next) = version.next.get() { version = next; }
        &version.routes
    }
}
pub type Evaluator = Rc<RefCell<dyn DrcEvaluator>>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrcSnapshot {
    pub errors: Vec<Value>,
    pub count: usize,
    pub issue_score: f64,
    pub legacy_issue_score: f64,
    pub trace_route_index_by_id: IndexMap<String, usize>,
}

pub trait DrcEvaluator {
    fn snapshot(&mut self, routes: &Routes, topology: bool, legacy: bool) -> Result<DrcSnapshot, String>;
}
