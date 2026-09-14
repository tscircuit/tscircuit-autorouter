use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateState {
    pub iterations: usize,
    pub max_iterations: f64,
    pub solved: bool,
    pub failed: bool,
    pub progress: f64,
    pub error: Option<String>,
    pub solved_segment_count: Option<usize>,
    pub routing_iterations: Option<usize>,
    pub negotiated_progress: Option<f64>,
}

pub trait Candidate {
    fn state(&self) -> &CandidateState;
    fn step(&mut self) -> Result<(), String>;
    fn step_many(&mut self, count: usize) -> Result<(), String> {
        for _ in 0..count {
            self.step()?;
        }
        Ok(())
    }
    fn setup(&mut self) -> Result<(), String> {
        Ok(())
    }
    fn is_specialized(&self) -> bool {
        false
    }
    fn set_state(&mut self, _state: CandidateState) -> Result<(), String> {
        Err("Candidate does not expose mutable native state".into())
    }
}

pub trait CandidateFactory {
    fn generate(&mut self, hyper_parameters: &Value) -> Result<Box<dyn Candidate>, String>;
}

pub struct SupervisedSolver {
    pub id: usize,
    pub hyper_parameters: Value,
    pub solver: Box<dyn Candidate>,
    pub h: f64,
    pub g: f64,
    pub f: f64,
}

pub struct HyperParameterDef {
    pub name: &'static str,
    pub possible_values: Vec<Value>,
}

pub fn get_hyper_parameter_combinations(defs: &[&HyperParameterDef]) -> Vec<Value> {
    let Some((current, remaining)) = defs.split_first() else {
        return vec![json!({})];
    };
    let sub_combinations = get_hyper_parameter_combinations(remaining);
    let mut combinations = Vec::new();
    for value in &current.possible_values {
        for sub in &sub_combinations {
            let mut combination = sub.clone();
            for (key, value) in value
                .as_object()
                .expect("Hyperparameter value must be an object")
            {
                combination[key] = value.clone();
            }
            combinations.push(combination);
        }
    }
    combinations
}

pub struct HyperParameterSupervisorSolver {
    pub greedy_multiplier: f64,
    pub min_substeps: usize,
    pub supervised_solvers: Option<Vec<SupervisedSolver>>,
    pub winning_solver: Option<usize>,
    pub active_sub_solver: Option<usize>,
    pub solved: bool,
    pub failed: bool,
    pub error: Option<String>,
    next_id: usize,
}

impl HyperParameterSupervisorSolver {
    pub fn new() -> Self {
        Self {
            greedy_multiplier: 1.2,
            min_substeps: 1,
            supervised_solvers: None,
            winning_solver: None,
            active_sub_solver: None,
            solved: false,
            failed: false,
            error: None,
            next_id: 0,
        }
    }

    pub fn add_candidate(
        &mut self,
        hyper_parameters: Value,
        solver: Box<dyn Candidate>,
        g: f64,
    ) -> usize {
        let id = self.next_id;
        self.next_id += 1;
        self.supervised_solvers
            .as_mut()
            .expect("Initialize candidate list before adding candidates")
            .push(SupervisedSolver {
                id,
                hyper_parameters,
                solver,
                h: 0.0,
                g,
                f: g,
            });
        id
    }

    pub fn initialize_solvers(
        &mut self,
        defs: &[HyperParameterDef],
        combinations: Option<&[Vec<&str>]>,
        factory: &mut dyn CandidateFactory,
        compute_g: impl Fn(&dyn Candidate, &Value) -> f64,
    ) -> Result<(), String> {
        let default = vec![defs.iter().map(|def| def.name).collect()];
        self.supervised_solvers = Some(Vec::new());
        for combination in combinations.unwrap_or(&default) {
            let selected: Vec<_> = defs
                .iter()
                .filter(|def| combination.contains(&def.name))
                .collect();
            for hyper_parameters in get_hyper_parameter_combinations(&selected) {
                let solver = factory.generate(&hyper_parameters)?;
                let g = compute_g(solver.as_ref(), &hyper_parameters);
                self.add_candidate(hyper_parameters, solver, g);
            }
        }
        Ok(())
    }

    pub fn compute_g(solver: &dyn Candidate) -> f64 {
        let state = solver.state();
        state.iterations as f64 / state.max_iterations
    }

    pub fn compute_h(solver: &dyn Candidate) -> f64 {
        let progress = solver.state().progress;
        1.0 - if progress == 0.0 || progress.is_nan() {
            0.0
        } else {
            progress
        }
    }

    pub fn get_supervised_solver_with_best_fitness(&self) -> Option<usize> {
        let mut best_fitness = f64::INFINITY;
        let mut best = None;
        for (index, record) in self
            .supervised_solvers
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .enumerate()
        {
            let state = record.solver.state();
            if state.solved {
                return Some(index);
            }
            if state.failed {
                continue;
            }
            if record.f < best_fitness {
                best_fitness = record.f;
                best = Some(index);
            }
        }
        best
    }

    pub fn get_failure_message(&mut self) -> String {
        let Some(records) = &mut self.supervised_solvers else {
            return "All solvers failed in hyper solver. Example failures: undefined".to_owned();
        };
        records.sort_by(|left, right| {
            (right.f - left.f)
                .partial_cmp(&0.0)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let errors: Vec<_> = records
            .iter()
            .take(5)
            .map(|record| record.solver.state().error.clone().unwrap_or_default())
            .collect();
        format!(
            "All solvers failed in hyper solver. Example failures: {}",
            errors.join(", ")
        )
    }

    pub fn step_initialized(
        &mut self,
        compute_g: impl Fn(&dyn Candidate, &Value) -> f64,
        compute_h: impl Fn(&dyn Candidate) -> f64,
    ) -> Result<(), String> {
        let Some(index) = self.get_supervised_solver_with_best_fitness() else {
            self.failed = true;
            self.error = Some(self.get_failure_message());
            return Ok(());
        };
        let record = &mut self.supervised_solvers.as_mut().unwrap()[index];
        record.solver.step_many(self.min_substeps)?;
        self.active_sub_solver = Some(record.id);
        record.g = compute_g(record.solver.as_ref(), &record.hyper_parameters);
        record.h = compute_h(record.solver.as_ref());
        record.f = record.g + record.h * self.greedy_multiplier;
        if record.solver.state().solved {
            self.solved = true;
            self.winning_solver = Some(record.id);
        }
        Ok(())
    }
}

impl Default for HyperParameterSupervisorSolver {
    fn default() -> Self {
        Self::new()
    }
}
