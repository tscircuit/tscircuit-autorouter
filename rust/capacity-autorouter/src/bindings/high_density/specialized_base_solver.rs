use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseSolverState {
    #[serde(rename = "MAX_ITERATIONS")]
    pub max_iterations: f64,
    pub solved: bool,
    pub failed: bool,
    pub iterations: usize,
    pub progress: f64,
    pub error: Option<String>,
}

impl Default for BaseSolverState {
    fn default() -> Self {
        Self {
            max_iterations: 1000.0,
            solved: false,
            failed: false,
            iterations: 0,
            progress: 0.0,
            error: None,
        }
    }
}

pub trait SpecializedSolver {
    fn base(&self) -> &BaseSolverState;
    fn base_mut(&mut self) -> &mut BaseSolverState;
    fn get_solver_name(&self) -> &'static str;
    fn _step(&mut self) -> Result<(), String>;

    fn try_final_acceptance(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn compute_progress(&self) -> Option<f64> {
        None
    }

    fn step(&mut self) -> Result<(), String> {
        if self.base().solved || self.base().failed {
            return Ok(());
        }
        self.base_mut().iterations += 1;
        if let Err(error) = self._step() {
            self.base_mut().error = Some(format!("{} error: {}", self.get_solver_name(), error));
            self.base_mut().failed = true;
            return Err(error);
        }
        if !self.base().solved && self.base().iterations as f64 > self.base().max_iterations {
            self.try_final_acceptance()?;
        }
        if !self.base().solved && self.base().iterations as f64 > self.base().max_iterations {
            self.base_mut().error = Some(format!(
                "{} ran out of iterations (MAX_ITERATIONS={})",
                self.get_solver_name(),
                crate::utils::js_number::js_number_to_string(self.base().max_iterations),
            ));
            self.base_mut().failed = true;
        }
        if let Some(progress) = self.compute_progress() {
            self.base_mut().progress = progress;
        }
        Ok(())
    }

    fn solve(&mut self) -> Result<(), String> {
        while !self.base().solved && !self.base().failed {
            self.step()?;
        }
        Ok(())
    }
}
