use super::graph::*;
use super::visualize_region_graph::visualize_region_graph;
use crate::core::{TinyHyperGraphProblem, TinyHyperGraphTopology};
use crate::graphics::GraphicsObject;
use crate::min_heap::MinHeap;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::rc::Rc;

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct RegionPathSolverOptions {
    #[serde(rename = "MM_COST_FOR_FULL_REGION")]
    pub mm_cost_for_full_region: Option<f64>,
    #[serde(rename = "MAX_ITERATIONS")]
    pub max_iterations: Option<usize>,
}

#[derive(Clone, Debug)]
pub struct RegionPathCandidate {
    pub region_id: i32,
    pub prev_candidate: Option<Rc<RegionPathCandidate>>,
    pub prev_region_id: Option<i32>,
    pub g: f64,
    pub h: f64,
    pub f: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionPathSolvedRoute {
    pub route_id: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    pub start_region_id: String,
    pub end_region_id: String,
    pub region_ids: Vec<String>,
    pub cost: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionPathSolverOutput {
    pub route_count: usize,
    pub solved_routes: Vec<RegionPathSolvedRoute>,
}

pub struct RegionPathWorkingState {
    pub region_usage: Vec<i32>,
    pub region_assigned_routes: Vec<Vec<i32>>,
    pub solved_route_region_ids: Vec<Vec<i32>>,
    pub solved_route_costs: Vec<f64>,
    pub current_route_id: Option<i32>,
    pub current_route_net_id: Option<i32>,
    pub goal_region_id: i32,
    pub unrouted_routes: Vec<i32>,
    pub candidate_queue: MinHeap<RegionPathCandidate>,
    pub candidate_best_cost_by_region_id: Vec<f64>,
    pub candidate_best_cost_generation_by_region_id: Vec<u32>,
    pub candidate_best_cost_generation: u32,
}

pub struct RegionPathSolver {
    pub topology: TinyHyperGraphTopology,
    pub problem: TinyHyperGraphProblem,
    pub region_graph: RegionGraph,
    pub region_problem: RegionPathProblem,
    pub mm_cost_for_full_region: f64,
    pub max_iterations: usize,
    pub state: RegionPathWorkingState,
    pub solved: bool,
    pub failed: bool,
    pub error: Option<String>,
    pub iterations: usize,
    pub stats: Value,
}

impl RegionPathSolver {
    pub fn new(
        topology: TinyHyperGraphTopology,
        problem: TinyHyperGraphProblem,
        options: Option<RegionPathSolverOptions>,
    ) -> Self {
        let region_graph = create_region_graph(&topology);
        let region_problem = create_region_path_problem(&topology, &problem);
        let options = options.unwrap_or_default();
        let n = region_graph.region_count;
        let r = region_problem.route_count;
        let state = RegionPathWorkingState {
            region_usage: vec![0; n],
            region_assigned_routes: vec![vec![]; n],
            solved_route_region_ids: vec![vec![]; r],
            solved_route_costs: vec![0.0; r],
            current_route_id: None,
            current_route_net_id: None,
            goal_region_id: -1,
            unrouted_routes: (0..r as i32).collect(),
            candidate_queue: MinHeap::new(
                vec![],
                |a: &RegionPathCandidate, b: &RegionPathCandidate| a.f - b.f,
            ),
            candidate_best_cost_by_region_id: vec![0.0; n],
            candidate_best_cost_generation_by_region_id: vec![0; n],
            candidate_best_cost_generation: 1,
        };
        let mut solver = Self {
            topology,
            problem,
            region_graph,
            region_problem,
            mm_cost_for_full_region: options.mm_cost_for_full_region.unwrap_or(20.0),
            max_iterations: options.max_iterations.unwrap_or(1_000_000),
            state,
            solved: false,
            failed: false,
            error: None,
            iterations: 0,
            stats: json!({}),
        };
        solver.update_stats();
        solver
    }

    pub fn step(&mut self) -> () {
        if self.solved || self.failed {
            return;
        }

        self.iterations += 1;
        if self.iterations > self.max_iterations {
            self.failed = true;
            self.error = Some("Maximum iterations exceeded".into());
            return;
        }

        self.step_internal();
    }

    pub fn solve(&mut self) -> () {
        while !self.solved && !self.failed {
            self.step();
        }
    }

    pub fn step_internal(&mut self) -> () {
        if self.state.current_route_id.is_none() {
            if self.state.unrouted_routes.is_empty() {
                self.solved = true;
                self.update_stats();
                return;
            }

            let route = self.state.unrouted_routes.remove(0);
            self.state.current_route_id = Some(route);
            self.state.current_route_net_id = Some(self.region_problem.route_net[route as usize]);
            let Some(&start) = self.region_problem.route_start_region.get(route as usize) else {
                self.failed = true;
                self.error = Some(format!("Route {route} is missing region endpoints"));
                return;
            };
            let Some(&goal) = self.region_problem.route_end_region.get(route as usize) else {
                self.failed = true;
                self.error = Some(format!("Route {route} is missing region endpoints"));
                return;
            };
            self.state.goal_region_id = goal;
            self.state.candidate_queue.clear();
            self.reset_candidate_best_costs();
            let cost = self.compute_region_entry_cost(start);
            let candidate = RegionPathCandidate {
                region_id: start,
                prev_candidate: None,
                prev_region_id: None,
                g: cost,
                h: 0.0,
                f: cost,
            };
            self.set_candidate_best_cost(start, cost);
            self.state.candidate_queue.queue(candidate.clone());
            self.update_stats();
            if start == goal {
                self.on_path_found(candidate);
                return;
            }
        }

        let Some(current) = self.state.candidate_queue.dequeue() else {
            self.failed = true;
            self.error = Some(format!(
                "No region path found for route {}",
                self.state.current_route_id.unwrap()
            ));
            return;
        };
        if current.g > self.get_candidate_best_cost(current.region_id) + f64::EPSILON {
            return;
        }

        if current.region_id == self.state.goal_region_id {
            self.on_path_found(current);
            return;
        }

        if self.is_region_reserved_for_different_net(current.region_id) {
            return;
        }

        let current = Rc::new(current);

        for edge in self.region_graph.incident_edges[current.region_id as usize].clone() {
            let next = if edge.region_id_a == current.region_id {
                edge.region_id_b
            } else {
                edge.region_id_a
            };
            if self.is_region_reserved_for_different_net(next) {
                continue;
            }

            let g = current.g + self.compute_region_entry_cost(next);
            if !g.is_finite() || g >= self.get_candidate_best_cost(next) - f64::EPSILON {
                continue;
            }

            self.set_candidate_best_cost(next, g);
            self.state.candidate_queue.queue(RegionPathCandidate {
                region_id: next,
                prev_region_id: Some(current.region_id),
                prev_candidate: Some(current.clone()),
                g,
                h: 0.0,
                f: g,
            });
        }
    }

    pub fn reset_candidate_best_costs(&mut self) -> () {
        if self.state.candidate_best_cost_generation == u32::MAX {
            self.state
                .candidate_best_cost_generation_by_region_id
                .fill(0);
            self.state.candidate_best_cost_generation = 1;
            return;
        }

        self.state.candidate_best_cost_generation += 1;
    }

    pub fn get_candidate_best_cost(&self, region: i32) -> f64 {
        if self.state.candidate_best_cost_generation_by_region_id[region as usize]
            == self.state.candidate_best_cost_generation
        {
            self.state.candidate_best_cost_by_region_id[region as usize]
        } else {
            f64::INFINITY
        }
    }

    pub fn set_candidate_best_cost(&mut self, region: i32, cost: f64) -> () {
        self.state.candidate_best_cost_generation_by_region_id[region as usize] =
            self.state.candidate_best_cost_generation;
        self.state.candidate_best_cost_by_region_id[region as usize] = cost;
    }

    pub fn is_region_reserved_for_different_net(&self, region: i32) -> bool {
        let net = self.region_problem.region_net_id[region as usize];
        net != -1 && Some(net) != self.state.current_route_net_id
    }

    pub fn compute_region_entry_cost(&self, region: i32) -> f64 {
        let next = self.state.region_usage[region as usize] + 1;
        next as f64 / self.region_graph.region_capacity[region as usize]
            * self.mm_cost_for_full_region
    }

    pub fn get_solved_region_path(&self, final_candidate: &RegionPathCandidate) -> Vec<i32> {
        let mut path = vec![];
        let mut cursor = Some(final_candidate);

        while let Some(candidate) = cursor {
            path.insert(0, candidate.region_id);
            cursor = candidate.prev_candidate.as_deref();
        }

        path
    }

    pub fn on_path_found(&mut self, final_candidate: RegionPathCandidate) -> () {
        let Some(route) = self.state.current_route_id else {
            return;
        };
        let path = self.get_solved_region_path(&final_candidate);
        self.state.solved_route_region_ids[route as usize] = path.clone();
        self.state.solved_route_costs[route as usize] = final_candidate.g;

        for region in path {
            self.state.region_usage[region as usize] += 1;
            self.state.region_assigned_routes[region as usize].push(route);
        }

        self.state.current_route_id = None;
        self.state.current_route_net_id = None;
        self.state.goal_region_id = -1;
        self.state.candidate_queue.clear();
        self.update_stats();
    }

    pub fn update_stats(&mut self) -> () {
        let mut max_usage = 0;
        let mut max_utilization: f64 = 0.0;

        for r in 0..self.region_graph.region_count {
            let usage = self.state.region_usage[r];
            max_usage = max_usage.max(usage);
            max_utilization =
                max_utilization.max(usage as f64 / self.region_graph.region_capacity[r]);
        }

        let extra = json!({"routeCount":self.region_problem.route_count,"regionCount":self.region_graph.region_count,"edgeCount":self.region_graph.edge_count,"solvedRouteCount":self.state.solved_route_region_ids.iter().filter(|p|!p.is_empty()).count(),"currentRouteId":self.state.current_route_id,"currentGoalRegionId":if self.state.goal_region_id>=0{Some(self.state.goal_region_id)}else{None},"openCandidateCount":self.state.candidate_queue.length(),"maxRegionUsage":max_usage,"maxUtilization":max_utilization});

        for (k, v) in extra.as_object().unwrap() {
            self.stats[k] = v.clone();
        }
    }

    pub fn visualize(&self) -> GraphicsObject {
        visualize_region_graph(self)
    }

    pub fn get_output(&self) -> RegionPathSolverOutput {
        RegionPathSolverOutput {
            route_count: self.region_problem.route_count,
            solved_routes: self
                .state
                .solved_route_region_ids
                .iter()
                .enumerate()
                .map(|(route, path)| RegionPathSolvedRoute {
                    route_id: route as i32,
                    connection_id: self
                        .region_problem
                        .route_metadata
                        .as_ref()
                        .and_then(|m| m.get(route))
                        .and_then(|m| m["connectionId"].as_str())
                        .map(str::to_owned),
                    start_region_id: get_serialized_region_id(
                        &self.region_graph,
                        self.region_problem.route_start_region[route],
                    ),
                    end_region_id: get_serialized_region_id(
                        &self.region_graph,
                        self.region_problem.route_end_region[route],
                    ),
                    region_ids: path
                        .iter()
                        .map(|r| get_serialized_region_id(&self.region_graph, *r))
                        .collect(),
                    cost: self.state.solved_route_costs[route],
                })
                .collect(),
        }
    }
}
