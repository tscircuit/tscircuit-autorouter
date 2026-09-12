use std::io::{self, Read};

use intra_node_routing::intra_node_solver::IntraNodeRouteSolver;
use serde_json::{Value, json};
use intra_node_routing::js_number::js_number_to_string;

fn js_stringify(value: &Value) -> String {
    match value {
        Value::Number(number) => js_number_to_string(number.as_f64().expect("number must be representable")),
        Value::Array(values) => format!("[{}]", values.iter().map(js_stringify).collect::<Vec<_>>().join(",")),
        Value::Object(object) => {
            let fields = object.iter().map(|(key, value)| {
                format!("{}:{}", serde_json::to_string(key).expect("could not encode key"), js_stringify(value))
            }).collect::<Vec<_>>();
            format!("{{{}}}", fields.join(","))
        }
        _ => serde_json::to_string(value).expect("could not encode JSON value"),
    }
}

fn snapshot(solver: &IntraNodeRouteSolver) -> Value {
    let active = solver.active_sub_solver.as_ref().map(|child| json!({
        "solved": child.solved,
        "failed": child.failed,
        "error": child.error,
        "iterations": child.iterations,
        "maxIterations": child.max_iterations,
        "progress": child.progress,
        "solvedPath": child.solved_path,
        "solvedPathJson": js_stringify(&serde_json::to_value(&child.solved_path).expect("could not encode solved path")),
    }));
    json!({
        "solved": solver.solved,
        "failed": solver.failed,
        "error": solver.error,
        "iterations": solver.iterations,
        "maxIterations": solver.max_iterations,
        "progress": solver.progress,
        "solvedRoutes": solver.solved_routes,
        "solvedRoutesJson": js_stringify(&serde_json::to_value(&solver.solved_routes).expect("could not encode solved routes")),
        "unsolvedConnections": solver.unsolved_connections,
        "failedSubSolvers": solver.failed_sub_solvers.len(),
        "active": active,
    })
}

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).expect("could not read parity input");
    let fixtures: Vec<Value> = serde_json::from_str(&input).expect("invalid parity fixtures");
    let mut results = Vec::new();
    for fixture in fixtures {
        let mut solver = IntraNodeRouteSolver::new(fixture["props"].clone());
        if let Some(limit) = fixture["maxIterations"].as_f64() {
            solver.max_iterations = limit;
        }
        let mut trace = vec![snapshot(&solver)];
        while !solver.solved && !solver.failed {
            assert!(solver.iterations < 100_000, "parity fixture exceeded safety budget");
            solver.step();
            trace.push(snapshot(&solver));
        }
        results.push(json!({"name": fixture["name"], "trace": trace}));
    }
    println!("{}", serde_json::to_string(&results).expect("could not encode parity results"));
}
