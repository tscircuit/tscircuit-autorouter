use indexmap::IndexSet;
use serde_json::Value;

pub fn combine_preloaded_and_routed_traces(preloaded: &[Value], routed: &[Value]) -> Vec<Value> {
    let routed_view: Vec<_> = routed.iter().collect();
    combine_preloaded_and_routed_trace_view(preloaded, &routed_view)
        .into_iter()
        .cloned()
        .collect()
}

pub fn combine_preloaded_and_routed_trace_view<'a>(
    preloaded: &'a [Value],
    routed: &[&'a Value],
) -> Vec<&'a Value> {
    let replaced: IndexSet<&str> = routed
        .iter()
        .filter_map(|t| {
            t["__replaces_pcb_trace_id"]
                .as_str()
                .filter(|s| !s.is_empty())
        })
        .collect();
    preloaded
        .iter()
        .filter(|t| !replaced.contains(t["pcb_trace_id"].as_str().expect("Trace id")))
        .chain(routed.iter().copied())
        .collect()
}
