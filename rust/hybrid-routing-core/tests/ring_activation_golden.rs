use serde_json::Value;
use tscircuit_hybrid_routing_core::execute_protocol;

#[test]
fn activates_a_larger_ring_without_discarding_search_state() {
    let output = execute_protocol(include_str!("fixtures/ring-activation-request.json"))
        .expect("ring activation request should be valid");
    let output: Value = serde_json::from_str(&output).expect("response should be JSON");
    assert_eq!(output["status"], "solved");
    assert_eq!(output["work"]["activatedRings"], 1);
    assert!(output["cost"]["totalLengthMm"].as_f64().unwrap_or(0.0) > 5.0);
}
