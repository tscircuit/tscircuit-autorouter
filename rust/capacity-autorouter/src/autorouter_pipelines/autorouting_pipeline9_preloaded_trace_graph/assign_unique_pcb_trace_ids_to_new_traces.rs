use indexmap::IndexSet;
use serde_json::Value;

pub fn assign_unique_pcb_trace_ids_to_new_traces(traces: &[Value], preloaded: &[Value]) -> Vec<Value> {
    assign_unique_pcb_trace_ids_to_owned_traces(traces.to_vec(), preloaded)
}

pub fn assign_unique_pcb_trace_ids_to_owned_traces(traces: Vec<Value>, preloaded: &[Value]) -> Vec<Value> {
    let mut used: IndexSet<String> = preloaded.iter().map(|t|t["pcb_trace_id"].as_str().expect("Trace id").to_owned()).collect();
    traces.into_iter().map(|mut trace| {
        let id=trace["pcb_trace_id"].as_str().expect("Trace id");
        if used.insert(id.to_owned()) { return trace; }
        let base=format!("{id}_routed"); let mut candidate=base.clone(); let mut suffix=2;
        while used.contains(&candidate) { candidate=format!("{base}_{suffix}"); suffix+=1; }
        used.insert(candidate.clone()); trace["pcb_trace_id"]=Value::from(candidate); trace
    }).collect()
}
