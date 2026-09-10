use high_density::high_density_solver_a01::HighDensitySolverA01;
use high_density::high_density_solver_a03::HighDensitySolverA03;
use serde::Serialize;
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

enum Engine {
    A01(HighDensitySolverA01),
    A03(HighDensitySolverA03),
}

fn to_js(value: &Value) -> Result<JsValue, JsValue> {
    value.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen]
pub struct HighDensitySolver {
    engine: Engine,
}

#[wasm_bindgen]
impl HighDensitySolver {
    #[wasm_bindgen(constructor)]
    pub fn new(variant: &str, props: JsValue, initial_penalty_fn: Option<js_sys::Function>) -> Result<Self, JsValue> {
        let props: Value = serde_wasm_bindgen::from_value(props)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let penalty = initial_penalty_fn.map(|callback| {
            Box::new(move |input: &Value| -> f64 {
                let input = to_js(input).unwrap_or_else(|error| wasm_bindgen::throw_val(error));
                let result = callback.call1(&JsValue::UNDEFINED, &input)
                    .unwrap_or_else(|error| wasm_bindgen::throw_val(error));
                result.as_f64().unwrap_or_else(|| wasm_bindgen::throw_str("initialPenaltyFn must return a number"))
            }) as Box<dyn Fn(&Value) -> f64>
        });
        let engine = match variant {
            "a01" => {
                let mut engine = HighDensitySolverA01::new(props);
                engine.initial_penalty_fn = penalty;
                Engine::A01(engine)
            }
            "a03" => {
                let mut engine = HighDensitySolverA03::new(props);
                engine.hypot = Some(js_sys::Math::hypot);
                engine.initial_penalty_fn = penalty;
                Engine::A03(engine)
            }
            _ => return Err(JsValue::from_str("Expected high-density engine a01 or a03")),
        };
        Ok(Self { engine })
    }

    pub fn setup(&mut self, max_iterations: usize) -> Result<JsValue, JsValue> {
        match &mut self.engine {
            Engine::A01(engine) => {
                engine.max_iterations = max_iterations;
                engine.setup();
                to_js(&json!({ "maxIterations": engine.max_iterations, "solved": engine.solved, "failed": engine.failed, "error": engine.error }))
            }
            Engine::A03(engine) => {
                engine.max_iterations = max_iterations;
                engine.setup();
                to_js(&json!({ "maxIterations": engine.max_iterations, "solved": engine.solved, "failed": engine.failed, "error": engine.error }))
            }
        }
    }

    // The TS BaseSolver owns the outer iteration lifecycle. Return the segment
    // count and two status bits together to avoid serializing state each step.
    pub fn step(&mut self, iterations: usize, max_iterations: usize) -> f64 {
        match &mut self.engine {
            Engine::A01(engine) => {
                engine.iterations = iterations;
                engine.max_iterations = max_iterations;
                engine.step();
                (engine.solved_segment_count() as f64) * 4.0 + u8::from(engine.solved) as f64 + 2.0 * u8::from(engine.failed) as f64
            }
            Engine::A03(engine) => {
                engine.iterations = iterations;
                engine.max_iterations = max_iterations;
                engine.step();
                (engine.solved_segment_count() as f64) * 4.0 + u8::from(engine.solved) as f64 + 2.0 * u8::from(engine.failed) as f64
            }
        }
    }

    pub fn error(&self) -> Option<String> {
        match &self.engine {
            Engine::A01(engine) => engine.error.clone(),
            Engine::A03(engine) => engine.error.clone(),
        }
    }

    #[wasm_bindgen(js_name = getOutput)]
    pub fn get_output(&self) -> Result<JsValue, JsValue> {
        match &self.engine {
            Engine::A01(engine) => to_js(&engine.get_output()),
            Engine::A03(engine) => to_js(&engine.get_output()),
        }
    }

    pub fn visualize(&self) -> Result<JsValue, JsValue> {
        match &self.engine {
            Engine::A01(engine) => to_js(&engine.visualize()),
            Engine::A03(engine) => to_js(&engine.visualize()),
        }
    }
}
