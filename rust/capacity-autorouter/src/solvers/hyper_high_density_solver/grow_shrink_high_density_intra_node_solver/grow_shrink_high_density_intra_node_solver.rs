pub type RouteValidator<'a> =
    dyn FnMut(&[Value], &Value) -> Result<(bool, Option<Value>), String> + 'a;

use serde_json::{Value, json};
use math_utils::{js_min, js_number_to_string};
use crate::solvers::hyper_high_density_solver::grow_shrink_high_density_intra_node_solver::invalid_same_layer_crossing_geometry::{has_impossible_same_layer_crossing_geometry, create_invalid_direct_connection_routes, create_invalid_same_layer_crossing_routes};

pub const DEFAULT_MAX_GROWTH_ATTEMPTS: f64 = 3.0;

#[derive(Clone, Debug)]
pub struct GrowthPortfolioState {
    pub iterations: usize,
    pub max_iterations: f64,
    pub solved: bool,
    pub failed: bool,
    pub progress: f64,
    pub error: Option<String>,
}

pub trait GrowthPortfolio {
    fn id(&self) -> u32;
    fn step(&mut self) -> Result<(), String>;
    fn state(&self) -> GrowthPortfolioState;
    fn set_max_iterations(&mut self, iterations: f64);
    fn solved_routes(&self) -> Result<Vec<Value>, String>;
    fn reject_solution(&mut self, error: &str);
    fn visualize(&self) -> Result<Value, String>;
}

pub fn scale_point(point: &Value, center: &Value, factor: f64) -> Value {
    let mut output = point.clone();
    let cx = center["x"].as_f64().expect("Center x required");
    let cy = center["y"].as_f64().expect("Center y required");
    output["x"] = Value::from(cx + (point["x"].as_f64().expect("Point x required") - cx) * factor);
    output["y"] = Value::from(cy + (point["y"].as_f64().expect("Point y required") - cy) * factor);
    output
}

pub fn scale_node_with_port_points(node: &Value, factor: f64) -> Value {
    let mut output = node.clone();
    output["width"] = Value::from(node["width"].as_f64().expect("Width required") * factor);
    output["height"] = Value::from(node["height"].as_f64().expect("Height required") * factor);
    output["portPoints"] = Value::Array(
        node["portPoints"]
            .as_array()
            .expect("Ports required")
            .iter()
            .map(|point| scale_point(point, &node["center"], factor))
            .collect(),
    );
    if let Some(pairs) = node["portPointsInPairs"].as_array() {
        output["portPointsInPairs"] = Value::Array(
            pairs
                .iter()
                .map(|pair| {
                    json!([
                        scale_point(&pair[0], &node["center"], factor),
                        scale_point(&pair[1], &node["center"], factor)
                    ])
                })
                .collect(),
        );
    } else {
        output.as_object_mut().unwrap().remove("portPointsInPairs");
    }
    output
}

pub fn scale_route(route: &Value, center: &Value, factor: f64) -> Value {
    let mut output = route.clone();
    output["route"] = Value::Array(
        route["route"]
            .as_array()
            .expect("Route points required")
            .iter()
            .map(|point| scale_point(point, center, factor))
            .collect(),
    );
    output["vias"] = Value::Array(
        route["vias"]
            .as_array()
            .expect("Vias required")
            .iter()
            .map(|point| scale_point(point, center, factor))
            .collect(),
    );
    if let Some(jumpers) = route["jumpers"].as_array() {
        output["jumpers"] = Value::Array(
            jumpers
                .iter()
                .map(|jumper| {
                    let mut output = jumper.clone();
                    output["start"] = scale_point(&jumper["start"], center, factor);
                    output["end"] = scale_point(&jumper["end"], center, factor);
                    output
                })
                .collect(),
        );
    } else {
        output.as_object_mut().unwrap().remove("jumpers");
    }
    output
}

const ROUTE_COLORS: [&str; 6] = [
    "#dc2626", "#2563eb", "#16a34a", "#ca8a04", "#9333ea", "#0891b2",
];

fn connection_label(name: &str, root: Option<&str>, extras: &[String]) -> String {
    let mut lines = Vec::new();
    if !name.is_empty() {
        lines.push(name.to_owned());
    }
    if let Some(root) = root.filter(|root| !root.is_empty()) {
        lines.push(format!("rootConnectionName: {root}"));
    }
    lines.extend(extras.iter().filter(|line| !line.is_empty()).cloned());
    lines.join("\n")
}

pub struct GrowShrinkHighDensityIntraNodeSolver {
    pub constructor_params: Value,
    pub node_with_port_points: Value,
    pub solved_routes: Vec<Value>,
    pub failed_solvers: Vec<Box<dyn GrowthPortfolio>>,
    pub active_sub_solver: Option<Box<dyn GrowthPortfolio>>,
    pub winning_solver: Option<Box<dyn GrowthPortfolio>>,
    pub scale_factor: f64,
    pub growth_attempts: f64,
    pub max_growth_attempts: f64,
    pub max_iterations: f64,
    pub iterations: usize,
    pub solved: bool,
    pub failed: bool,
    pub progress: f64,
    pub error: Option<String>,
    pub stats: Value,
}

impl GrowShrinkHighDensityIntraNodeSolver {
    pub fn new(params: Value) -> Self {
        let node = params["nodeWithPortPoints"].clone();
        let max = params["maxGrowthAttempts"]
            .as_f64()
            .unwrap_or(DEFAULT_MAX_GROWTH_ATTEMPTS);
        let max_iterations = 20_000_000.0 * params["effort"].as_f64().unwrap_or(1.0) * (max + 1.0);
        let mut solver = Self {
            constructor_params: params,
            node_with_port_points: node,
            solved_routes: Vec::new(),
            failed_solvers: Vec::new(),
            active_sub_solver: None,
            winning_solver: None,
            scale_factor: 1.0,
            growth_attempts: 0.0,
            max_growth_attempts: max,
            max_iterations,
            iterations: 0,
            solved: false,
            failed: false,
            progress: 0.0,
            error: None,
            stats: json!({}),
        };
        if has_impossible_same_layer_crossing_geometry(&solver.node_with_port_points) {
            if solver.constructor_params["fallbackToInvalidGeometryOnFailure"].as_bool()
                != Some(true)
            {
                solver.failed = true;
                solver.progress = 1.0;
                solver.error = Some("GrowShrinkHighDensityIntraNodeSolver cannot route an impossible single-layer crossing".to_owned());
                return solver;
            }
            solver.solved_routes = create_invalid_same_layer_crossing_routes(
                &solver.node_with_port_points,
                solver.constructor_params["traceWidth"]
                    .as_f64()
                    .unwrap_or(0.15),
                solver.constructor_params["viaDiameter"]
                    .as_f64()
                    .unwrap_or(0.3),
            );
            solver.solved = true;
            solver.progress = 1.0;
            solver.stats = json!({"invalidGeometryFallback":true,"reason":"single-layer node has same-layer crossings"});
        }
        solver
    }

    pub fn compute_progress(&self) -> f64 {
        js_min(
            0.99,
            (self.growth_attempts
                + self
                    .active_sub_solver
                    .as_ref()
                    .map(|solver| solver.state().progress)
                    .unwrap_or(0.0))
                / (self.max_growth_attempts + 1.0),
        )
    }

    pub fn step(
        &mut self,
        factory: &mut dyn FnMut(Value) -> Result<Box<dyn GrowthPortfolio>, String>,
        validator: Option<&mut RouteValidator<'_>>,
    ) -> Result<(), String> {
        if self.solved || self.failed {
            return Ok(());
        }
        self.iterations += 1;
        if let Err(error) = self.step_inner(factory, validator) {
            self.error = Some(format!(
                "GrowShrinkHighDensityIntraNodeSolver error: {error}"
            ));
            self.failed = true;
            return Err(error);
        }
        if !self.solved && self.iterations as f64 > self.max_iterations {
            self.error = Some(format!(
                "GrowShrinkHighDensityIntraNodeSolver ran out of iterations (MAX_ITERATIONS={})",
                js_number_to_string(self.max_iterations)
            ));
            self.failed = true;
        }
        self.progress = self.compute_progress();
        Ok(())
    }

    pub fn step_inner(
        &mut self,
        factory: &mut dyn FnMut(Value) -> Result<Box<dyn GrowthPortfolio>, String>,
        validator: Option<&mut RouteValidator<'_>>,
    ) -> Result<(), String> {
        if self.active_sub_solver.is_none() {
            let mut params = self.constructor_params.clone();
            params
                .as_object_mut()
                .expect("Params object required")
                .remove("growShrinkSolutionValidator");
            params["nodeWithPortPoints"] =
                scale_node_with_port_points(&self.node_with_port_points, self.scale_factor);
            let mut solver = factory(params)?;
            if let Some(max) = self.constructor_params["maxInnerIterationsPerGrowthAttempt"]
                .as_f64()
                .filter(|max| *max != 0.0 && !max.is_nan())
            {
                solver.set_max_iterations(max);
            }
            self.active_sub_solver = Some(solver);
        }
        self.active_sub_solver.as_mut().unwrap().step()?;
        let solver = self.active_sub_solver.as_ref().unwrap();
        if solver.state().solved {
            let routes = solver.solved_routes()?;
            let routes = if self.scale_factor == 1.0 {
                routes
            } else {
                routes
                    .iter()
                    .map(|route| {
                        scale_route(
                            route,
                            &self.node_with_port_points["center"],
                            1.0 / self.scale_factor,
                        )
                    })
                    .collect()
            };
            let accepted = if let Some(validator) = validator {
                let snapshot = json!({"MAX_ITERATIONS":self.max_iterations,"iterations":self.iterations,
                    "solved":self.solved,"failed":self.failed,"progress":self.progress,"error":self.error,
                    "nodeWithPortPoints":self.node_with_port_points,"scaleFactor":self.scale_factor,
                    "growthAttempts":self.growth_attempts,"maxGrowthAttempts":self.max_growth_attempts,"stats":self.stats,"solvedRoutes":self.solved_routes,
                    "activeId":self.active_sub_solver.as_ref().map(|child|child.id()),
                    "winnerId":self.winning_solver.as_ref().map(|child|child.id()),
                    "failedIds":self.failed_solvers.iter().map(|child|child.id()).collect::<Vec<_>>()});
                let (accepted, patch) = validator(&routes, &snapshot)?;
                if let Some(patch) = patch {
                    if let Some(value) = patch.get("MAX_ITERATIONS") {
                        self.max_iterations = value.as_f64().unwrap_or(f64::NAN);
                    }
                    if let Some(value) = patch.get("iterations").and_then(Value::as_u64) {
                        self.iterations = value as usize;
                    }
                    if let Some(value) = patch.get("solved").and_then(Value::as_bool) {
                        self.solved = value;
                    }
                    if let Some(value) = patch.get("failed").and_then(Value::as_bool) {
                        self.failed = value;
                    }
                    if let Some(value) = patch.get("progress") {
                        self.progress = value.as_f64().unwrap_or(f64::NAN);
                    }
                    if let Some(value) = patch.get("error") {
                        self.error = value.as_str().map(str::to_owned);
                    }
                    if let Some(value) = patch.get("scaleFactor") {
                        self.scale_factor = value.as_f64().unwrap_or(f64::NAN);
                    }
                    if let Some(value) = patch.get("growthAttempts") {
                        self.growth_attempts = value.as_f64().unwrap_or(f64::NAN);
                    }
                    if let Some(value) = patch.get("maxGrowthAttempts") {
                        self.max_growth_attempts = value.as_f64().unwrap_or(f64::NAN);
                    }
                    if let Some(value) = patch.get("nodeWithPortPoints") {
                        self.node_with_port_points = value.clone();
                    }
                    if let Some(value) = patch.get("constructorParams") {
                        self.constructor_params = value.clone();
                    }
                    if let Some(value) = patch.get("stats") {
                        self.stats = value.clone();
                    }
                    if let Some(value) = patch.get("solvedRoutes").and_then(Value::as_array) {
                        self.solved_routes = value.clone();
                    }
                }
                accepted
            } else {
                true
            };
            if accepted {
                self.solved_routes = routes;
                self.solved = true;
                self.failed = false;
                self.winning_solver = self.active_sub_solver.take();
                return Ok(());
            }
            self.active_sub_solver
                .as_mut()
                .unwrap()
                .reject_solution("High-density scale solution rejected by validator");
        }
        if !self.active_sub_solver.as_ref().unwrap().state().failed {
            return Ok(());
        }
        let solver = self.active_sub_solver.take().unwrap();
        self.error = solver.state().error;
        self.failed_solvers.push(solver);
        if self.growth_attempts >= self.max_growth_attempts {
            if self.constructor_params["fallbackToInvalidGeometryOnFailure"].as_bool() == Some(true)
            {
                self.solved_routes = create_invalid_direct_connection_routes(
                    &self.node_with_port_points,
                    self.constructor_params["traceWidth"]
                        .as_f64()
                        .unwrap_or(0.15),
                    self.constructor_params["viaDiameter"]
                        .as_f64()
                        .unwrap_or(0.3),
                );
                self.solved = true;
                self.failed = false;
                self.progress = 1.0;
                self.stats["invalidGeometryFallback"] = Value::Bool(true);
                self.stats["reason"] = Value::from("growth attempts exhausted");
                self.stats["lastError"] =
                    self.error.clone().map(Value::from).unwrap_or(Value::Null);
                self.error = None;
                return Ok(());
            }
            self.failed = true;
            self.error = Some(format!(
                "GrowShrinkHighDensityIntraNodeSolver failed after resizing to {}x. Last error: {}",
                js_number_to_string(self.scale_factor),
                self.error.as_deref().unwrap_or("null")
            ));
            return Ok(());
        }
        self.growth_attempts += 1.0;
        self.scale_factor *= 2.0;
        Ok(())
    }

    pub fn visualize(&self) -> Result<Value, String> {
        if let Some(solver) = self
            .active_sub_solver
            .as_ref()
            .or(self.winning_solver.as_ref())
        {
            return solver.visualize();
        }
        if self.solved_routes.is_empty() {
            return Ok(json!({"lines":[],"points":[],"rects":[],"circles":[]}));
        }
        let invalid = self.stats["invalidGeometryFallback"].as_bool() == Some(true);
        let mut lines = Vec::new();
        for (route_index, route) in self.solved_routes.iter().enumerate() {
            for pair in route["route"]
                .as_array()
                .expect("Route points required")
                .windows(2)
            {
                let layer = format!(
                    "z{}",
                    js_number_to_string(pair[0]["z"].as_f64().expect("Point z required"))
                );
                let mut extras = vec![layer.clone()];
                if invalid {
                    extras.push("invalid fallback route".to_owned());
                }
                lines.push(json!({"points":pair,"strokeColor":ROUTE_COLORS[route_index % ROUTE_COLORS.len()],
                    "strokeWidth":route["traceThickness"],"layer":layer,"label":connection_label(route["connectionName"].as_str().unwrap(),route["rootConnectionName"].as_str(),&extras)}));
            }
        }
        let points: Vec<Value> = self.node_with_port_points["portPoints"].as_array().expect("Ports required").iter().map(|point| {
            let index = self.solved_routes.iter().position(|route| route["connectionName"] == point["connectionName"]).unwrap_or(0);
            json!({"x":point["x"],"y":point["y"],"color":ROUTE_COLORS[index % ROUTE_COLORS.len()],
                "label":connection_label(point["connectionName"].as_str().unwrap(), point["rootConnectionName"].as_str(), &[format!("z{}",js_number_to_string(point["z"].as_f64().unwrap()))])})
        }).collect();
        let label = [
            self.node_with_port_points["capacityMeshNodeId"].as_str(),
            self.stats["reason"].as_str(),
        ]
        .into_iter()
        .flatten()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
        Ok(
            json!({"title":if invalid {"Invalid same-layer crossing geometry"} else {"Grow/shrink high density routes"},"lines":lines,"points":points,
            "rects":[{"center":self.node_with_port_points["center"],"width":self.node_with_port_points["width"],"height":self.node_with_port_points["height"],
                "fill":if invalid {"rgba(245, 158, 11, 0.12)"} else {"rgba(14, 165, 233, 0.08)"},
                "stroke":if invalid {"rgba(217, 119, 6, 0.8)"} else {"rgba(14, 165, 233, 0.55)"},"label":label}],"circles":[]}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakePortfolio {
        id: u32,
        state: GrowthPortfolioState,
        routes: Vec<Value>,
    }

    impl GrowthPortfolio for FakePortfolio {
        fn id(&self) -> u32 {
            self.id
        }
        fn step(&mut self) -> Result<(), String> {
            self.state.iterations += 1;
            self.state.solved = true;
            Ok(())
        }
        fn state(&self) -> GrowthPortfolioState {
            self.state.clone()
        }
        fn set_max_iterations(&mut self, iterations: f64) {
            self.state.max_iterations = iterations;
        }
        fn solved_routes(&self) -> Result<Vec<Value>, String> {
            Ok(self.routes.clone())
        }
        fn reject_solution(&mut self, error: &str) {
            self.state.solved = false;
            self.state.failed = true;
            self.state.error = Some(error.into());
        }
        fn visualize(&self) -> Result<Value, String> {
            Ok(json!({"title":self.id}))
        }
    }

    #[test]
    fn rejected_attempt_then_scaled_winner_preserves_child_ids_and_limits() {
        let mut solver = GrowShrinkHighDensityIntraNodeSolver::new(json!({
            "nodeWithPortPoints":{"capacityMeshNodeId":"node","center":{"x":2,"y":3},
                "width":2,"height":4,"availableZ":[0,1],"portPoints":[]},
            "maxGrowthAttempts":2,"maxInnerIterationsPerGrowthAttempt":7
        }));
        let mut next_id = 0;
        let mut factory = |params: Value| -> Result<Box<dyn GrowthPortfolio>, String> {
            next_id += 1;
            assert_eq!(
                params["nodeWithPortPoints"]["width"],
                json!(2.0 * next_id as f64)
            );
            Ok(Box::new(FakePortfolio {
                id: next_id,
                state: GrowthPortfolioState {
                    iterations: 0,
                    max_iterations: 1000.0,
                    solved: false,
                    failed: false,
                    progress: 0.25,
                    error: None,
                },
                routes: vec![json!({"connectionName":"a","route":[{"x":4,"y":5,"z":0}],"vias":[]})],
            }))
        };
        let mut validations = 0;
        let mut validator =
            |routes: &[Value], _state: &Value| -> Result<(bool, Option<Value>), String> {
                validations += 1;
                assert_eq!(
                    routes[0]["route"][0]["x"].as_f64(),
                    Some(if validations == 1 { 4.0 } else { 3.0 })
                );
                Ok((validations == 2, None))
            };
        solver.step(&mut factory, Some(&mut validator)).unwrap();
        assert_eq!(solver.failed_solvers[0].id(), 1);
        assert_eq!(solver.failed_solvers[0].state().max_iterations, 7.0);
        assert!(!solver.failed_solvers[0].state().solved);
        assert!(solver.failed_solvers[0].state().failed);
        assert_eq!(solver.scale_factor, 2.0);
        assert_eq!(solver.progress, 1.0 / 3.0);
        solver.step(&mut factory, Some(&mut validator)).unwrap();
        assert!(solver.solved);
        assert!(solver.active_sub_solver.is_none());
        assert_eq!(solver.winning_solver.as_ref().unwrap().id(), 2);
        assert_eq!(
            solver
                .winning_solver
                .as_ref()
                .unwrap()
                .state()
                .max_iterations,
            7.0
        );
        assert_eq!(solver.solved_routes[0]["route"][0]["y"].as_f64(), Some(4.0));
        assert_eq!(solver.visualize().unwrap(), json!({"title":2}));
        solver.step(&mut factory, None).unwrap();
        assert_eq!(solver.iterations, 2);
    }
}
