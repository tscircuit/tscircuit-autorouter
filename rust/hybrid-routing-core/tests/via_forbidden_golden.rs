use serde_json::Value;
use tscircuit_hybrid_routing_core::execute_protocol;

#[test]
fn connected_pads_block_vias_without_blocking_wire_escape() {
    let request = include_str!("fixtures/via-forbidden-request.json");
    let output = execute_protocol(request).expect("via-forbidden request should be valid");
    let parsed: Value = serde_json::from_str(&output).expect("response should be JSON");

    assert_eq!(parsed["status"], "solved");
    let vias = parsed["vias"].as_array().expect("solved response should contain vias");
    assert_eq!(vias.len(), 2);
    assert!(vias.iter().all(|via| {
        let x = via["x"].as_f64().expect("via x should be numeric");
        let y = via["y"].as_f64().expect("via y should be numeric");
        let outside_start_pad = (x - 0.5).abs() > 0.6 || (y - 3.0).abs() > 0.6;
        let outside_goal_pad = (x - 5.5).abs() > 0.6 || (y - 3.0).abs() > 0.6;
        outside_start_pad && outside_goal_pad
    }));
}
