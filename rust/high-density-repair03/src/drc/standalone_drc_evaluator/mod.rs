
use crate::drc::autorouting_drc_engine::AutoroutingDrcEngine;
use crate::drc::autorouting_drc_engine::DrcMath;
use crate::drc::simplified_trace::SimplifiedTrace;
use indexmap::IndexMap;
use serde_json::{Value, json};
use crate::solvers::global_drc_force_improve_solver::types::DrcEvaluator;
use crate::solvers::global_drc_force_improve_solver::types::DrcSnapshot;
use crate::solvers::global_drc_force_improve_solver::types::Routes;
use crate::solvers::global_drc_force_improve_solver::drc_snapshot::get_drc_error_severity;
use crate::solvers::global_drc_force_improve_solver::drc_snapshot::get_topology_repair_drc_error_severity;
use crate::solvers::global_drc_force_improve_solver::drc_snapshot::is_via_pad_drc_error;
use crate::utils::convert_hd_route_to_simplified_route::convert_hd_route_to_simplified_route;

pub struct StandaloneDrcEvaluator {
    pub srj: Value,
    pub engine: AutoroutingDrcEngine,
}

impl StandaloneDrcEvaluator {
    pub fn new(srj: Value, conn_map: Option<Value>, owner_metadata: bool, math: DrcMath) -> Result<Self, String> {
        let clearance = srj["minTraceToPadEdgeClearance"].as_f64().unwrap_or(0.1);
        let engine = AutoroutingDrcEngine::new_with_math(srj.clone(), conn_map, json!({
            "traceClearance":clearance, "viaClearance":clearance, "includeTraceViaOwnerMetadata":owner_metadata,
        }), math)?;
        Ok(Self { srj, engine })
    }

    pub fn traces(&self, routes: &Routes) -> (Vec<SimplifiedTrace>, IndexMap<String, usize>) {
        let mut grouped: IndexMap<&str, Vec<(usize, &crate::solvers::global_drc_force_improve_solver::internal_types::MutableRoute)>> = IndexMap::new();
        for (index, route) in routes.iter().enumerate() { grouped.entry(&route.connection_name).or_default().push((index, route)); }
        let mut traces = Vec::new();
        let mut ids = IndexMap::new();
        let layer_count = self.srj["layerCount"].as_u64().expect("Layer count") as usize;
        for connection in self.srj["connections"].as_array().expect("Connections") {
            let name = connection["name"].as_str().expect("Connection name");
            let Some(group) = grouped.get(name) else { continue; };
            for (index, (route_index, route)) in group.iter().enumerate() {
                let id = format!("{name}_{index}");
                let width = route.trace_thickness.or_else(||connection["nominalTraceWidth"].as_f64())
                    .or_else(||self.srj["nominalTraceWidth"].as_f64()).or_else(||self.srj["minTraceWidth"].as_f64()).unwrap_or(0.1);
                let diameter = route.via_diameter.or_else(||self.srj["minViaDiameter"].as_f64());
                traces.push(SimplifiedTrace {
                    pcb_trace_id: id.clone(), connection_name: connection["netConnectionName"].as_str().or_else(||connection["rootConnectionName"].as_str()).unwrap_or(name).to_owned(),
                    route: convert_hd_route_to_simplified_route(route, layer_count, width, diameter, connection["pointsToConnect"].as_array().expect("Connection points")),
                });
                ids.insert(id, *route_index);
            }
        }
        (traces, ids)
    }
}

impl DrcEvaluator for StandaloneDrcEvaluator {
    fn snapshot(&mut self, routes: &Routes, topology: bool, legacy: bool) -> Result<DrcSnapshot, String> {
        let (traces, trace_route_index_by_id) = self.traces(routes);
        let errors = self.engine.evaluate_typed_trace_errors(&traces.iter().collect::<Vec<_>>());
        let count = errors.iter().filter(|error| !legacy || !is_via_pad_drc_error(error)).count();
        let has_centered = errors.iter().any(|error| !error["center"].is_null());
        let errors: Vec<_> = errors.into_iter().filter(|error| (!legacy || !is_via_pad_drc_error(error)) && (!has_centered || !error["center"].is_null())).map(|mut error| {
            if !topology {
                if error["first_contact_center"].is_object() || error.get("first_contact_center").is_some_and(Value::is_null) { error["center"] = error["first_contact_center"].clone(); }
                if error["first_contact_message"].is_string() { error["message"] = error["first_contact_message"].clone(); }
                if error["first_actual_clearance"].is_number() { error["actual_clearance"] = error["first_actual_clearance"].clone(); }
            }
            error
        }).collect();
        let severity = if topology { get_topology_repair_drc_error_severity } else { get_drc_error_severity };
        let issue_score = errors.iter().fold(0.0, |score,error| score + severity(error));
        let legacy_issue_score = errors.iter().filter(|error| !is_via_pad_drc_error(error)).fold(0.0, |score,error| score + severity(error));
        Ok(DrcSnapshot { errors, count, issue_score, legacy_issue_score, trace_route_index_by_id })
    }
}
