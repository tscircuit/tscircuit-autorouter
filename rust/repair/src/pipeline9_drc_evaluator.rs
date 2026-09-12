use std::borrow::Cow;
use indexmap::{IndexMap,IndexSet};
use serde_json::{Value,json};
use autorouting_drc::autorouting_drc_engine::{AutoroutingDrcEngine,DrcMath};
use crate::internal_types::MutableRoute;
use autorouting_drc::simplified_trace::SimplifiedTrace;
use crate::repair_cache_key::{write_mutable_routes_key, write_route_values_key};
use crate::net_utils::RepairConnectivityMap;
use crate::types::{DrcEvaluator,DrcSnapshot,Routes};
use crate::convert_pipeline7_hd_routes_to_simplified_pcb_traces::Pipeline7Converter;
use crate::convert_hd_route_to_simplified_route::{ConvertOptions,convert_hd_route_to_simplified_route,convert_mutable_hd_route_to_simplified_route};
use crate::assign_unique_pcb_trace_ids_to_new_traces::assign_unique_pcb_trace_ids_to_owned_traces;
use crate::combine_preloaded_and_routed_traces::combine_preloaded_and_routed_trace_view;
use crate::filter_pipeline9_drc_errors_against_baseline::{filter_pipeline9_drc_errors_against_baseline};
use crate::normalize_pipeline9_drc_errors_for_repair::normalize_pipeline9_drc_errors_for_repair;
use crate::pipeline9_drc_trace_ids::{get_autorouting_via_elements,get_autorouting_via_elements_from_traces,get_autorouting_via_elements_from_typed_traces,add_autorouting_via_trace_ids,remap_drc_trace_ids};

pub struct PreparedCandidateDrcInput {
    pub evaluated_traces: Vec<Value>,
    pub movable_trace_ids: IndexSet<String>,
    pub original_trace_id_by_evaluation_trace_id: IndexMap<String,String>,
    pub routed_traces: Vec<Value>,
    pub solver_trace_id_by_evaluation_trace_id: IndexMap<String,String>,
}

struct PreparedCandidateDrcTraceView<'a> {
    movable_trace_ids: IndexSet<String>,
    original_trace_id_by_evaluation_trace_id: IndexMap<String,String>,
    routed_traces: Vec<Cow<'a, Value>>,
    solver_trace_id_by_evaluation_trace_id: IndexMap<String,String>,
}

pub struct Pipeline9DrcEvaluator {
    descriptor: Value,
    engine: AutoroutingDrcEngine,
    converter: Pipeline7Converter,
    conn_map: Option<RepairConnectivityMap>,
    synthetic_names: IndexSet<String>,
    original_typed_traces: Vec<SimplifiedTrace>,
    non_movable_typed_traces: Vec<SimplifiedTrace>,
    non_movable_replaced_ids: IndexSet<String>,
    baseline_errors: Vec<Value>,
    baseline_centered: Vec<Value>,
    cache: IndexMap<Vec<u8>,Value,rustc_hash::FxBuildHasher>,
    cache_key_scratch: Vec<u8>,
    reference_callback: Option<Box<dyn FnMut(&[Value]) -> Result<Value, String>>>,
    clock: Option<fn() -> f64>,
    pub indexed_drc_evaluation_count: usize,
    pub indexed_drc_cache_hit_count: usize,
    pub indexed_drc_evaluation_time_ms: f64,
}

impl Pipeline9DrcEvaluator {
    pub fn new(descriptor: Value, math: DrcMath) -> Result<Self,String> {
        Self::new_with_prepared(descriptor, math, None)
    }

    pub fn new_with_prepared(descriptor: Value, math: DrcMath, prepared: Option<(AutoroutingDrcEngine, Value)>) -> Result<Self,String> {
        let conn_value = descriptor.get("connMap").filter(|v|!v.is_null()).cloned();
        let conn_map = conn_value.as_ref().map(|v|serde_json::from_value(v.clone()).map_err(|e|e.to_string())).transpose()?;
        let (mut engine, prepared_baseline) = if let Some((engine, baseline)) = prepared { (engine, Some(baseline)) }
            else { (AutoroutingDrcEngine::new_with_math(descriptor["engineSrj"].clone(),conn_value,descriptor["engineOptions"].clone(),math)?, None) };
        let originals = descriptor["originalTraces"].as_array().expect("Descriptor originalTraces");
        let (baseline_errors, baseline_centered) = if let Some(baseline) = prepared_baseline {
            let errors = baseline["errors"].as_array().ok_or("Prepared baseline errors required")?.clone();
            let centered = baseline["errorsWithCenters"].as_array().ok_or("Prepared baseline centered errors required")?.clone();
            (errors, centered)
        } else {
            let baseline = engine.evaluate_slice(originals);
            let via_circuit = get_autorouting_via_elements(originals);
            let ids:IndexSet<_>=originals.iter().map(|t|t["pcb_trace_id"].as_str().expect("Trace id").to_owned()).collect();
            (add_autorouting_via_trace_ids(baseline["errors"].as_array().expect("DRC errors"),&via_circuit,&ids),
                add_autorouting_via_trace_ids(baseline["errorsWithCenters"].as_array().expect("Centered DRC errors"),&via_circuit,&ids))
        };
        let converter=Pipeline7Converter::new(descriptor["newConnections"].as_array().expect("Descriptor newConnections"),descriptor["originalConnections"].as_array().expect("Descriptor originalConnections"),descriptor["obstacles"].as_array().expect("Descriptor obstacles"),descriptor["layerCount"].as_u64().expect("Layer count") as usize,descriptor["defaultViaHoleDiameter"].as_f64().expect("Default via hole diameter"));
        let synthetic_names=descriptor["movablePreloadedSections"].as_array().expect("Movable sections").iter().map(|s|s["syntheticConnectionName"].as_str().expect("Synthetic name").to_owned()).collect();
        let original_typed_traces = originals.iter().map(SimplifiedTrace::from_value).collect();
        let non_movable = descriptor["nonMovableMutatedPreloadedTraces"].as_array().expect("Nonmovable preloaded traces");
        let non_movable_typed_traces = non_movable.iter().map(SimplifiedTrace::from_value).collect();
        let non_movable_replaced_ids = non_movable.iter().filter_map(|trace| {
            trace["__replaces_pcb_trace_id"].as_str().filter(|id| !id.is_empty()).map(str::to_owned)
        }).collect();
        Ok(Self { descriptor,engine,converter,conn_map,synthetic_names,original_typed_traces,non_movable_typed_traces,non_movable_replaced_ids,baseline_errors,baseline_centered,cache:IndexMap::with_hasher(rustc_hash::FxBuildHasher),cache_key_scratch:Vec::new(),reference_callback:None,clock:None,indexed_drc_evaluation_count:0,indexed_drc_cache_hit_count:0,indexed_drc_evaluation_time_ms:0.0 })
    }

    pub fn set_reference_callback(&mut self, callback: Box<dyn FnMut(&[Value]) -> Result<Value, String>>) {
        self.reference_callback = Some(callback);
    }

    pub fn set_clock(&mut self, clock: fn() -> f64) { self.clock = Some(clock); }

    pub fn cache_len(&self) -> usize { self.cache.len() }

    pub fn prepare_candidate_drc_input(&mut self, routes: &[Value]) -> PreparedCandidateDrcInput {
        let input=Self::prepare_candidate_drc_trace_view(&self.descriptor,&mut self.converter,self.conn_map.as_ref(),&self.synthetic_names,routes);
        let routed_view: Vec<_>=input.routed_traces.iter().map(|trace|trace.as_ref()).collect();
        let evaluated_traces=combine_preloaded_and_routed_trace_view(self.descriptor["originalTraces"].as_array().unwrap(),&routed_view).into_iter().cloned().collect();
        PreparedCandidateDrcInput {
            evaluated_traces,
            movable_trace_ids:input.movable_trace_ids,
            original_trace_id_by_evaluation_trace_id:input.original_trace_id_by_evaluation_trace_id,
            routed_traces:input.routed_traces.into_iter().map(Cow::into_owned).collect(),
            solver_trace_id_by_evaluation_trace_id:input.solver_trace_id_by_evaluation_trace_id,
        }
    }

    fn prepare_candidate_drc_trace_view<'a>(descriptor: &'a Value, converter: &mut Pipeline7Converter, conn_map: Option<&RepairConnectivityMap>, synthetic_names: &IndexSet<String>, routes: &[Value]) -> PreparedCandidateDrcTraceView<'a> {
        let new_routes=routes.iter().filter(|r|!synthetic_names.contains(r["connectionName"].as_str().expect("Route name")));
        let new_traces=converter.convert(new_routes,conn_map);
        let originals=descriptor["originalTraces"].as_array().unwrap();
        let new_trace_ids: Vec<_> = new_traces.iter().map(|trace|trace["pcb_trace_id"].as_str().expect("Trace id").to_owned()).collect();
        let unique=assign_unique_pcb_trace_ids_to_owned_traces(new_traces,originals);
        let mut replaced=IndexSet::new(); let mut original_mapping=IndexMap::new(); let mut movable=Vec::new();
        let sections=descriptor["movablePreloadedSections"].as_array().unwrap();
        for section in sections {
            let name=section["syntheticConnectionName"].as_str().unwrap();
            let route=routes.iter().find(|r|r["connectionName"]==name).unwrap_or_else(||panic!("Pipeline9 joint DRC repair lost preloaded section {name}"));
            let original_id=section["originalTrace"]["pcb_trace_id"].as_str().expect("Original trace id");
            let evaluation_id=section["evaluationTraceId"].as_str().expect("Evaluation trace id"); original_mapping.insert(evaluation_id.to_owned(),original_id.to_owned());
            let mut trace=section["originalTrace"].clone(); trace["pcb_trace_id"]=json!(evaluation_id);
            if replaced.insert(original_id.to_owned()) { trace["__replaces_pcb_trace_id"]=json!(original_id); } else { trace.as_object_mut().unwrap().shift_remove("__replaces_pcb_trace_id"); }
            trace["route"]=json!(convert_hd_route_to_simplified_route(route,converter.layer_count,&ConvertOptions { connection_points:&[],terminal_via_attach_tolerance:0.25,default_via_hole_diameter:Some(converter.default_via_hole_diameter),obstacles:descriptor["obstacles"].as_array().unwrap(),connected_multilayer_obstacles:None,conn_map:conn_map })); movable.push(trace);
        }
        let mut solver_mapping=IndexMap::new();
        for (unique,original_id) in unique.iter().zip(new_trace_ids) { solver_mapping.insert(unique["pcb_trace_id"].as_str().unwrap().to_owned(),original_id); }
        for section in sections { solver_mapping.insert(section["evaluationTraceId"].as_str().unwrap().to_owned(),format!("{}_0",section["syntheticConnectionName"].as_str().unwrap())); }
        let movable_ids=solver_mapping.values().cloned().collect();
        let routed:Vec<_>=descriptor["nonMovableMutatedPreloadedTraces"].as_array().expect("Nonmovable preloaded traces").iter().map(Cow::Borrowed).chain(movable.into_iter().map(Cow::Owned)).chain(unique.into_iter().map(Cow::Owned)).collect();
        PreparedCandidateDrcTraceView { movable_trace_ids:movable_ids,original_trace_id_by_evaluation_trace_id:original_mapping,routed_traces:routed,solver_trace_id_by_evaluation_trace_id:solver_mapping }
    }

    fn cache_result(&mut self, result: &Value) {
        let key = std::mem::take(&mut self.cache_key_scratch);
        if self.cache.len() >= 64 {
            let (mut evicted_key, _) = self.cache.shift_remove_index(0).expect("Full DRC cache has an oldest entry");
            evicted_key.clear();
            self.cache_key_scratch = evicted_key;
        }
        self.cache.insert(key, result.clone());
    }

    pub fn evaluate_values(&mut self, routes: &[Value]) -> Result<Value, String> {
        write_route_values_key(routes, &mut self.cache_key_scratch);
        if let Some(result)=self.cache.get(&self.cache_key_scratch) {
            self.indexed_drc_cache_hit_count+=1;
            self.cache_key_scratch.clear();
            return Ok(result.clone());
        }
        let started = self.clock.map(|clock| clock());
        self.indexed_drc_evaluation_count+=1;
        let input=Self::prepare_candidate_drc_trace_view(&self.descriptor,&mut self.converter,self.conn_map.as_ref(),&self.synthetic_names,routes);
        let routed_view: Vec<_>=input.routed_traces.iter().map(|trace|trace.as_ref()).collect();
        let evaluated_traces=combine_preloaded_and_routed_trace_view(self.descriptor["originalTraces"].as_array().unwrap(),&routed_view);
        let evaluated=self.engine.evaluate_trace_errors(&evaluated_traces);
        let circuit=get_autorouting_via_elements_from_traces(evaluated_traces.iter().copied());
        let ids=evaluated_traces.iter().map(|t|t["pcb_trace_id"].as_str().unwrap().to_owned()).collect();
        self.finish_evaluation(evaluated, circuit, ids, input.original_trace_id_by_evaluation_trace_id,
            input.solver_trace_id_by_evaluation_trace_id, input.movable_trace_ids, started, || Cow::Borrowed(routes))
    }

    fn finish_evaluation<'a>(&mut self, evaluated: Vec<Value>, circuit: Vec<Value>, ids: IndexSet<String>,
        original_mapping: IndexMap<String, String>, solver_mapping: IndexMap<String, String>,
        movable_ids: IndexSet<String>, started: Option<f64>, reference_routes: impl FnOnce() -> Cow<'a, [Value]>) -> Result<Value, String> {
        let mut results=Vec::new();
        let centered: Cow<'_, [Value]> = if evaluated.iter().all(|error| !error["center"].is_null()) {
            Cow::Borrowed(&evaluated)
        } else {
            Cow::Owned(evaluated.iter().filter(|error| !error["center"].is_null()).cloned().collect())
        };
        let mut remapped_circuit = None;
        for field in ["errors", "errorsWithCenters"] {
            let baseline = if field == "errors" { &self.baseline_errors } else { &self.baseline_centered };
            let enriched=add_autorouting_via_trace_ids(if field == "errors" { &evaluated } else { centered.as_ref() },&circuit,&ids);
            let filtered=filter_pipeline9_drc_errors_against_baseline(&enriched,baseline,&original_mapping);
            if field == "errors" && filtered.is_empty() {
                let result = self.reference_callback.as_mut().ok_or_else(|| "Pipeline9 zero-error candidate requires reference validation".to_owned())?(reference_routes().as_ref())?;
                if let (Some(start), Some(clock)) = (started, self.clock) { self.indexed_drc_evaluation_time_ms += clock() - start; }
                self.cache_result(&result);
                return Ok(result);
            }
            let remapped=remap_drc_trace_ids(&filtered,&solver_mapping);
            let remapped_circuit = remapped_circuit.get_or_insert_with(|| circuit.iter().map(|v| { let mut e=v.clone(); if let Some(id)=e["pcb_trace_id"].as_str().and_then(|id|solver_mapping.get(id)).filter(|id|!id.is_empty()) { e["pcb_trace_id"]=json!(id); } e }).collect::<Vec<_>>());
            results.push(normalize_pipeline9_drc_errors_for_repair(&remapped,remapped_circuit,&movable_ids));
        }
        let result=json!({"errors":results[0],"errorsWithCenters":results[1]});
        if let (Some(start), Some(clock)) = (started, self.clock) { self.indexed_drc_evaluation_time_ms += clock() - start; }
        self.cache_result(&result); Ok(result)
    }

    pub fn evaluate(&mut self, routes: &[MutableRoute]) -> Result<Value, String> {
        write_mutable_routes_key(routes, &mut self.cache_key_scratch);
        if let Some(result) = self.cache.get(&self.cache_key_scratch) {
            self.indexed_drc_cache_hit_count += 1;
            self.cache_key_scratch.clear();
            return Ok(result.clone());
        }
        let started = self.clock.map(|clock| clock());
        self.indexed_drc_evaluation_count += 1;
        let new_routes = routes.iter().filter(|route| !self.synthetic_names.contains(&route.connection_name));
        let mut new_traces: Vec<_> = self.converter.convert_typed(new_routes, self.conn_map.as_ref())
            .into_iter().map(|converted| converted.trace).collect();
        let new_trace_ids: Vec<_> = new_traces.iter().map(|trace| trace.pcb_trace_id.clone()).collect();
        let mut used: IndexSet<String> = self.original_typed_traces.iter().map(|trace| trace.pcb_trace_id.clone()).collect();
        for trace in &mut new_traces {
            if used.insert(trace.pcb_trace_id.clone()) { continue; }
            let base = format!("{}_routed", trace.pcb_trace_id);
            let mut candidate = base.clone();
            let mut suffix = 2;
            while used.contains(&candidate) {
                candidate = format!("{base}_{suffix}");
                suffix += 1;
            }
            used.insert(candidate.clone());
            trace.pcb_trace_id = candidate;
        }

        let mut replaced = self.non_movable_replaced_ids.clone();
        let mut original_mapping = IndexMap::new();
        let mut movable = Vec::new();
        let sections = self.descriptor["movablePreloadedSections"].as_array().expect("Movable sections");
        for section in sections {
            let name = section["syntheticConnectionName"].as_str().expect("Synthetic name");
            let route = routes.iter().find(|route| route.connection_name == name)
                .unwrap_or_else(|| panic!("Pipeline9 joint DRC repair lost preloaded section {name}"));
            let original_id = section["originalTrace"]["pcb_trace_id"].as_str().expect("Original trace id");
            let evaluation_id = section["evaluationTraceId"].as_str().expect("Evaluation trace id");
            original_mapping.insert(evaluation_id.to_owned(), original_id.to_owned());
            if !original_id.is_empty() { replaced.insert(original_id.to_owned()); }
            movable.push(SimplifiedTrace {
                pcb_trace_id: evaluation_id.to_owned(),
                connection_name: section["originalTrace"]["connection_name"].as_str().expect("Original connection name").to_owned(),
                route: convert_mutable_hd_route_to_simplified_route(route, self.converter.layer_count, &ConvertOptions {
                    connection_points: &[], terminal_via_attach_tolerance: 0.25,
                    default_via_hole_diameter: Some(self.converter.default_via_hole_diameter),
                    obstacles: self.descriptor["obstacles"].as_array().expect("Obstacles"),
                    connected_multilayer_obstacles: None, conn_map: self.conn_map.as_ref(),
                }),
            });
        }
        let mut solver_mapping = IndexMap::new();
        for (trace, original_id) in new_traces.iter().zip(new_trace_ids) {
            solver_mapping.insert(trace.pcb_trace_id.clone(), original_id);
        }
        for section in sections {
            solver_mapping.insert(section["evaluationTraceId"].as_str().unwrap().to_owned(),
                format!("{}_0", section["syntheticConnectionName"].as_str().unwrap()));
        }
        let movable_ids = solver_mapping.values().cloned().collect();
        let evaluated_traces: Vec<_> = self.original_typed_traces.iter()
            .filter(|trace| !replaced.contains(&trace.pcb_trace_id))
            .chain(self.non_movable_typed_traces.iter())
            .chain(movable.iter()).chain(new_traces.iter()).collect();
        let evaluated = self.engine.evaluate_typed_trace_errors(&evaluated_traces);
        let circuit = get_autorouting_via_elements_from_typed_traces(evaluated_traces.iter().copied());
        let ids = evaluated_traces.iter().map(|trace| trace.pcb_trace_id.clone()).collect();
        self.finish_evaluation(evaluated, circuit, ids, original_mapping, solver_mapping, movable_ids,
            started, || Cow::Owned(routes.iter().map(MutableRoute::to_value).collect()))
    }

}

impl DrcEvaluator for Pipeline9DrcEvaluator {
    fn snapshot(&mut self, routes: &Routes, topology: bool, legacy: bool) -> Result<DrcSnapshot, String> {
        let result=self.evaluate(routes)?;
        Ok(crate::drc_snapshot::snapshot_from_result(&self.descriptor["solverSrj"],routes,result,topology,legacy))
    }
}

#[cfg(test)]
mod cache_scratch_tests {
    use super::*;

    #[test]
    fn cache_scratch_reuses_hits_evictions_and_survives_reference_errors() {
        let descriptor = json!({
            "engineSrj":{"layerCount":2,"minTraceWidth":0.1,"bounds":{"minX":0,"minY":0,"maxX":1,"maxY":1},"obstacles":[],"connections":[]},
            "engineOptions":{},"connMap":null,"originalTraces":[],"newConnections":[],
            "originalConnections":[],"layerCount":2,"defaultViaHoleDiameter":0.15,
            "obstacles":[],"movablePreloadedSections":[],"nonMovableMutatedPreloadedTraces":[]
        });
        let mut evaluator = Pipeline9DrcEvaluator::new(descriptor, DrcMath::default()).unwrap();
        evaluator.set_reference_callback(Box::new(|_| Err("reference sentinel".to_owned())));
        assert_eq!(evaluator.evaluate_values(&[]).unwrap_err(), "reference sentinel");
        assert_eq!(evaluator.cache_len(), 0);
        assert_eq!(evaluator.indexed_drc_evaluation_count, 1);
        let allocation = evaluator.cache_key_scratch.as_ptr();
        evaluator.set_reference_callback(Box::new(|_| Ok(json!({"errors":[],"errorsWithCenters":[]}))));
        let expected = evaluator.evaluate(&[]).unwrap();
        assert_eq!(evaluator.cache.first().unwrap().0.as_ptr(), allocation);
        evaluator.cache_key_scratch.reserve(1024);
        let allocation = evaluator.cache_key_scratch.as_ptr();
        assert_eq!(evaluator.evaluate_values(&[]).unwrap(), expected);
        assert_eq!(evaluator.evaluate(&[]).unwrap(), expected);
        assert_eq!(evaluator.cache_key_scratch.as_ptr(), allocation);
        assert!(evaluator.cache_key_scratch.is_empty());
        assert_eq!(evaluator.indexed_drc_evaluation_count, 2);
        assert_eq!(evaluator.indexed_drc_cache_hit_count, 2);
        let mut oracle = IndexMap::new();
        oracle.insert(Vec::<Value>::new(), expected);
        for index in 0..80 {
            let values = vec![json!(index)];
            write_route_values_key(&values, &mut evaluator.cache_key_scratch);
            let evicted_allocation = if evaluator.cache_len() >= 64 {
                Some(evaluator.cache.first().unwrap().0.as_ptr())
            } else { None };
            if oracle.len() >= 64 { oracle.shift_remove_index(0); }
            oracle.insert(values, json!(index));
            evaluator.cache_result(&json!(index));
            if let Some(allocation) = evicted_allocation {
                assert_eq!(evaluator.cache_key_scratch.as_ptr(), allocation);
                assert!(evaluator.cache_key_scratch.is_empty());
            }
            assert_eq!(evaluator.cache.values().collect::<Vec<_>>(), oracle.values().collect::<Vec<_>>());
        }
        evaluator.set_reference_callback(Box::new(|_| Err("second sentinel".to_owned())));
        let cache_before = evaluator.cache.clone();
        assert_eq!(evaluator.evaluate(&[]).unwrap_err(), "second sentinel");
        assert_eq!(evaluator.cache, cache_before);
        assert_eq!(evaluator.indexed_drc_evaluation_count, 3);
        assert_eq!(evaluator.indexed_drc_cache_hit_count, 2);
    }
}
