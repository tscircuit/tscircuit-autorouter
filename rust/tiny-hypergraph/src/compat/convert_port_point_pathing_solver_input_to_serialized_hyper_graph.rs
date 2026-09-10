use serde_json::{Value, json};
pub type SerializedHyperGraphPortPointPathingSolverParams = Value;
pub type SerializedHyperGraphPortPointPathingSolverInput = Value;

pub fn get_single_port_point_pathing_solver_params(input: &Value) -> &Value {
    if let Some(items) = input.as_array() {
        items
            .first()
            .expect("Port point pathing solver input array must contain at least one item")
    } else {
        input
    }
}

pub fn convert_port_point_pathing_solver_input_to_serialized_hyper_graph(input: &Value) -> Value {
    let params = get_single_port_point_pathing_solver_params(input);
    assert!(
        params["format"] == "serialized-hg-port-point-pathing-solver-params"
            && params["graph"]["regions"].is_array()
            && params["graph"]["ports"].is_array()
            && params["connections"].is_array(),
        "Expected serialized-hg-port-point-pathing-solver-params input"
    );
    json!({"regions":params["graph"]["regions"],"ports":params["graph"]["ports"],"connections":params["connections"]})
}
