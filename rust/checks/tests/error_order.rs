use serde_json::json;
use checks::check;
use checks::Math;

#[test]
fn via_errors_precede_source_deduplication_and_missing_port_errors() {
    let input = vec![
        json!({"type":"source_trace","source_trace_id":"s","connected_source_port_ids":["sp"]}),
        json!({"type":"pcb_port","pcb_port_id":"p","source_port_id":"sp","x":20,"y":0}),
        json!({"type":"pcb_smtpad","pcb_port_id":"p","shape":"circle","x":20,"y":0,"radius":1}),
        json!({"type":"pcb_trace","pcb_trace_id":"t1","source_trace_id":"s","route":[{"route_type":"wire","x":0,"y":0,"width":0.1},{"route_type":"via","x":2,"y":0},{"route_type":"wire","x":4,"y":0,"width":0.1}]}),
        json!({"type":"pcb_trace","pcb_trace_id":"t2","source_trace_id":"s","route":[{"route_type":"wire","x":6,"y":0,"width":0.1},{"route_type":"via","x":8,"y":0},{"route_type":"wire","x":10,"y":0,"width":0.1}]}),
    ];
    let errors = check(&input, Math::default()).unwrap();
    assert_eq!(errors.iter().map(|e| (e.kind,e.trace_index)).collect::<Vec<_>>(), vec![("misalignedVia",3),("missingConnection",3),("misalignedVia",4)]);
    assert_eq!(errors[1].center_point_index, Some(2));
    assert_eq!(errors[1].pad_index, Some(2));
}
