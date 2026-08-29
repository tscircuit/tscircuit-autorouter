use serde_json::Value;
use tscircuit_hybrid_routing_core::execute_protocol;

#[test]
fn search_routes_around_a_rotated_obstacle() {
    let output = execute_protocol(include_str!("fixtures/obstacle-request.json"))
        .expect("obstacle request should be valid");
    let output: Value = serde_json::from_str(&output).expect("response should be JSON");
    assert_eq!(output["status"], "solved");
    assert_eq!(output["cost"]["viaCount"], 0);
    assert!(output["cost"]["totalLengthMm"].as_f64().unwrap_or(0.0) > 5.0);
    assert!(output["work"]["geometryPredicateCalls"]
        .as_u64()
        .unwrap_or(0)
        > 0);
}
