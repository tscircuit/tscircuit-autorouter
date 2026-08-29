use serde_json::Value;
use tscircuit_hybrid_routing_core::execute_protocol;

#[test]
fn direct_search_protocol_is_deterministic() {
    let request = include_str!("fixtures/direct-request.json");
    let first = execute_protocol(request).expect("direct request should be valid");
    let second = execute_protocol(request).expect("repeated direct request should be valid");
    assert_eq!(first, second);

    let output: Value = serde_json::from_str(&first).expect("response should be JSON");
    assert_eq!(output["status"], "solved");
    assert_eq!(output["protocolVersion"], 1);
    assert_eq!(output["regionId"], "direct-region");
    assert_eq!(output["cost"]["viaCount"], 0);
    assert_eq!(output["cost"]["totalLengthMm"], 3.0);
    assert_eq!(output["route"].as_array().map(Vec::len), Some(2));
}
