use crate::shared_maps::NetByConnectionName;
use std::{cell::RefCell, rc::Rc};
use indexmap::{IndexMap, IndexSet};
use serde_json::{Value, json};
use intra_node_routing::specialized_base_solver::{BaseSolverState, SpecializedSolver};
use crate::{types::*, graph_codec::GraphCodec};
use crate::useless_via_removal_solver::{useless_via_removal_solver::{UselessViaRemovalSolver,UselessViaRemovalSolverInput},can_endpoint_connect_on_layer::TerminalLayers};
use crate::same_net_via_merger_solver::{SameNetViaMergerSolver,SameNetViaMergerSolverInput};
use crate::simplified_path_solver::multi_simplified_path_solver::{MultiSimplifiedPathSolver,MultiSimplifiedPathParams};
use crate::crossing_via_reduction_solver::{CrossingViaReductionSolver,CrossingViaReductionSolverInput};

const VIA_INSIDE_OBSTACLE_TOLERANCE:f64=1e-6;

pub struct TraceSimplificationParams {
    pub hd_routes:Vec<RouteRef>, pub other_hd_routes:Vec<RouteRef>,pub obstacles:Vec<ObstacleRef>,
    pub conn_map:Rc<ConnectivityMap>,pub color_map:ColorMapRef,pub outline:Option<Vec<Point2>>,
    pub layer_count:f64,pub default_via_diameter:f64,pub options:Value,pub math:Math,
    pub terminal_layers:Option<Rc<TerminalLayers>>,pub net_by_connection_name:Option<Rc<NetByConnectionName>>,
}

pub enum TraceChildKind {
    Via(Rc<RefCell<UselessViaRemovalSolver>>),
    Crossing(Rc<RefCell<CrossingViaReductionSolver>>),
    Merger(Rc<RefCell<SameNetViaMergerSolver>>),
    Path(Rc<RefCell<MultiSimplifiedPathSolver>>),
}

pub struct TraceChild { pub identity:u64,pub kind:TraceChildKind }
impl TraceChild {
    pub fn base(&self)->BaseSolverState {match &self.kind {
        TraceChildKind::Via(s)=>s.borrow().base.clone(),TraceChildKind::Crossing(s)=>s.borrow().base.clone(),
        TraceChildKind::Merger(s)=>s.borrow().base.clone(),TraceChildKind::Path(s)=>s.borrow().base.clone(),
    }}
    pub fn step(&self)->Result<(),String> {match &self.kind {
        TraceChildKind::Via(s)=>s.borrow_mut().step(),TraceChildKind::Crossing(s)=>s.borrow_mut().step(),
        TraceChildKind::Merger(s)=>s.borrow_mut().step(),TraceChildKind::Path(s)=>s.borrow_mut().step(),
    }}
    pub fn routes(&self)->Vec<RouteRef> {match &self.kind {
        TraceChildKind::Via(s)=>s.borrow().get_optimized_hd_routes().to_vec(),TraceChildKind::Crossing(s)=>s.borrow().get_reduced_hd_routes().to_vec(),
        TraceChildKind::Merger(s)=>s.borrow().merged_via_hd_routes.clone(),TraceChildKind::Path(s)=>s.borrow().simplified_hd_routes.clone(),
    }}
    pub fn snapshot(&self,codec:&mut GraphCodec)->Value {match &self.kind {
        TraceChildKind::Via(s)=>s.borrow().snapshot(codec),TraceChildKind::Crossing(s)=>s.borrow().snapshot(codec),
        TraceChildKind::Merger(s)=>s.borrow().snapshot(codec),TraceChildKind::Path(s)=>s.borrow().snapshot(codec),
    }}
    pub fn restore(&self,fields:&Value,codec:&mut GraphCodec)->Result<(),String> {match &self.kind {
        TraceChildKind::Via(s)=>s.borrow_mut().restore(fields,codec),TraceChildKind::Crossing(s)=>s.borrow_mut().restore(fields,codec),
        TraceChildKind::Merger(s)=>s.borrow_mut().restore(fields,codec),TraceChildKind::Path(s)=>{let child=if fields.get("activeSubSolver").is_some_and(Value::is_null){None}else{s.borrow().active_sub_solver.clone()};s.borrow_mut().restore(fields,codec,child)},
    }}
}

pub struct TraceSimplificationSolver {
    pub base:BaseSolverState,pub stats:Value,pub params:TraceSimplificationParams,
    pub connectivity:Rc<RefCell<crate::connectivity_context::ConnectivityContext>>,
    pub hd_routes:Vec<RouteRef>,pub hd_routes_array_identity:u64,
    pub preserved_route_endpoints:Option<IndexMap<String,(PointRef,PointRef)>>,
    pub simplification_pipeline_loops:f64,pub max_simplification_pipeline_loops:f64,
    pub phase_order:Vec<String>,pub current_phase:String,
    pub active_sub_solver:Option<Rc<TraceChild>>,pub active_assigned:bool,pub extract_mode:String,pub awaiting_extract:bool,
}

fn point_inside_obstacle(point:Point2,obstacle:&Obstacle)->bool {
    (point.x-obstacle.center.x).abs()<=obstacle.width/2.0+VIA_INSIDE_OBSTACLE_TOLERANCE &&
    (point.y-obstacle.center.y).abs()<=obstacle.height/2.0+VIA_INSIDE_OBSTACLE_TOLERANCE
}
fn is_multilayer_obstacle(obstacle:&Obstacle)->bool {
    if obstacle.metadata.get("__zLayers").is_some_and(|value|!value.is_null()) {obstacle.z_layers.len()>1} else {obstacle.layers.len()>1}
}

impl TraceSimplificationSolver {
    pub fn new(mut params:TraceSimplificationParams)->Result<Self,String> {
        params.obstacles=crate::utils::create_objects_with_z_layers::normalize_obstacles(params.obstacles,params.layer_count);
        let connectivity=Rc::new(RefCell::new(crate::connectivity_context::ConnectivityContext::new(params.conn_map.clone())));
        let mut solver=Self {connectivity,base:BaseSolverState{max_iterations:100e6,..Default::default()},stats:json!({}),params,
            hd_routes:Vec::new(),hd_routes_array_identity:next_identity(),preserved_route_endpoints:None,
            simplification_pipeline_loops:0.0,max_simplification_pipeline_loops:2.0,
            phase_order:["via_removal","crossing_via_reduction","via_merging","path_simplification"].map(str::to_owned).to_vec(),
            current_phase:"via_removal".into(),active_sub_solver:None,active_assigned:false,extract_mode:"null".into(),awaiting_extract:false};
        solver.hd_routes=solver.mark_through_obstacle_segments(&solver.params.hd_routes);
        if solver.params.options["preserveRouteEndpoints"].as_bool()==Some(true) {
            let mut endpoints=IndexMap::new();
            for route in &solver.params.hd_routes {
                let route=route.borrow();
                let (Some(start),Some(end))=(route.route.first(),route.route.last()) else {
                    return Err(format!("TraceSimplificationSolver cannot preserve endpoints for empty route \"{}\"",route.connection_name));
                };
                if endpoints.contains_key(&route.connection_name) {return Err(format!("TraceSimplificationSolver cannot preserve endpoints for duplicate route \"{}\"",route.connection_name));}
                endpoints.insert(route.connection_name.clone(),(spread_point(start),spread_point(end)));
            }
            solver.preserved_route_endpoints=Some(endpoints);
        }
        Ok(solver)
    }

    pub fn validate_preserved_route_endpoints(&self,routes:&[RouteRef])->Result<(),String> {
        let Some(expected)=&self.preserved_route_endpoints else{return Ok(());};
        if routes.len()!=expected.len(){return Err(format!("TraceSimplificationSolver changed the preserved route set (expected {}, got {})",expected.len(),routes.len()));}
        let mut output_names=IndexSet::new();
        let points_match=|a:&PointRef,b:&PointRef|{let a=a.borrow();let b=b.borrow();(a.x-b.x).abs()<=VIA_INSIDE_OBSTACLE_TOLERANCE&&(a.y-b.y).abs()<=VIA_INSIDE_OBSTACLE_TOLERANCE&&a.z==b.z};
        for route in routes {
            let route=route.borrow();
            if !output_names.insert(route.connection_name.clone()){return Err(format!("TraceSimplificationSolver produced duplicate preserved route \"{}\"",route.connection_name));}
            let valid=expected.get(&route.connection_name).is_some_and(|(a,b)|route.route.first().is_some_and(|start|points_match(start,a))&&route.route.last().is_some_and(|end|points_match(end,b)));
            if !valid{return Err(format!("TraceSimplificationSolver changed a preserved endpoint for route \"{}\"",route.connection_name));}
        }
        Ok(())
    }

    pub fn is_same_net_obstacle(&self, route: &RouteRef, obstacle: &ObstacleRef) -> bool {
        let mut context = self.connectivity.borrow_mut();
        context.refresh(&self.params.conn_map);
        let route = context.resolve_route(route);
        let obstacle = context.resolve_obstacle(obstacle);
        route.is_connected_to_any(&obstacle)
    }

    pub fn get_same_net_obstacle_for_segment(&self, route: &RouteRef, start: Point2, end: Point2) -> Option<ObstacleRef> {
        let mut context = self.connectivity.borrow_mut();
        context.refresh(&self.params.conn_map);
        let route = context.resolve_route(route);
        self.params.obstacles.iter().find(|obstacle| {
            let value = obstacle.borrow();
            is_multilayer_obstacle(&value)
                && route.is_connected_to_any(&context.resolve_obstacle(obstacle))
                && point_inside_obstacle(start, &value)
                && point_inside_obstacle(end, &value)
        }).cloned()
    }

    pub fn is_via_inside_same_net_obstacle(&self, route: &RouteRef, via: Point2) -> bool {
        let mut context = self.connectivity.borrow_mut();
        context.refresh(&self.params.conn_map);
        let route = context.resolve_route(route);
        self.params.obstacles.iter().any(|obstacle| {
            let value = obstacle.borrow();
            is_multilayer_obstacle(&value)
                && route.is_connected_to_any(&context.resolve_obstacle(obstacle))
                && point_inside_obstacle(via, &value)
        })
    }

    pub fn mark_through_obstacle_segments(&self,routes:&[RouteRef])->Vec<RouteRef> {
        // This pass has no callbacks or connectivity mutations. Resolve IDs once
        // while retaining the source obstacle order and per-point geometry checks.
        let mut context = self.connectivity.borrow_mut();
        context.refresh(&self.params.conn_map);
        let route_ids = routes.iter().map(|route|context.resolve_route(route)).collect::<Vec<_>>();
        let obstacles = self.params.obstacles.iter().map(|obstacle| {
            let ids = context.resolve_obstacle(obstacle);
            (obstacle, obstacle.borrow(), ids)
        }).collect::<Vec<_>>();
        drop(context);
        routes.iter().zip(route_ids).map(|(route, route_ids)|{
            let output=spread_route(route);
            let input=route.borrow();
            let points=input.route.iter().enumerate().map(|(index,point)|{
                let obstacle=input.route.get(index+1).filter(|next|point.borrow().z!=next.borrow().z)
                    .and_then(|next| {
                        let start = point2(point);
                        let end = point2(next);
                        obstacles.iter().find(|(_, obstacle, ids)| {
                            is_multilayer_obstacle(obstacle)
                                && route_ids.is_connected_to_any(ids)
                                && point_inside_obstacle(start, obstacle)
                                && point_inside_obstacle(end, obstacle)
                        }).map(|(obstacle, _, _)|(*obstacle).clone())
                    });
                let output=spread_point(point);
                let mut result=output.borrow_mut();
                if let Some(obstacle)=obstacle {
                    let mut metadata=(*result.metadata).clone();
                    metadata["toNextSegmentType"]=json!("through_obstacle");
                    result.removed_segment_properties&=!1;
                    let value=obstacle.borrow().metadata.get("circuitJsonMetadata").cloned();
                    if value.as_ref().is_some_and(|value| !value.is_null() && value!=&Value::Bool(false)) {
                        metadata["toNextSegmentCircuitJsonMetadata"]=value.unwrap();
                        result.segment_metadata_obstacle=Some(obstacle);
                        result.removed_segment_properties&=!2;
                    }
                    result.metadata=Rc::new(metadata);
                } else {
                    if result.metadata.get("toNextSegmentType").is_some() || result.metadata.get("toNextSegmentCircuitJsonMetadata").is_some() {
                        let mut metadata=(*result.metadata).clone();
                        metadata.as_object_mut().unwrap().remove("toNextSegmentType");
                        metadata.as_object_mut().unwrap().remove("toNextSegmentCircuitJsonMetadata");
                        result.metadata=Rc::new(metadata);
                    }
                    result.segment_metadata_obstacle=None;
                    result.removed_segment_properties=3;
                }
                drop(result);output
            }).collect();
            let vias=input.vias.iter().filter(|via| {
                let point = point2(via);
                !obstacles.iter().any(|(_, obstacle, ids)| {
                    is_multilayer_obstacle(obstacle)
                        && route_ids.is_connected_to_any(ids)
                        && point_inside_obstacle(point, obstacle)
                })
            }).cloned().collect();
            {let mut result=output.borrow_mut();result.route=points;result.vias=vias;result.route_array_identity=next_identity();result.vias_array_identity=next_identity();}
            output
        }).collect()
    }

    fn finish_phase(&mut self)->Result<(),String> {
        self.active_sub_solver=None;self.extract_mode="null".into();self.awaiting_extract=false;
        self.current_phase=match self.current_phase.as_str(){
            "via_removal"=>if self.params.options["enableCrossingViaReduction"].as_bool()==Some(true){"crossing_via_reduction".into()}else{"via_merging".into()},
            "crossing_via_reduction"=>"via_merging".into(),"via_merging"=>"path_simplification".into(),
            _=>{self.simplification_pipeline_loops+=1.0;"via_removal".into()}
        };
        if self.simplification_pipeline_loops>=self.max_simplification_pipeline_loops {self.base.solved=true;return Ok(());}
        self.start_next_phase()
    }

    pub fn resolve_extract(&mut self,routes:Vec<RouteRef>)->Result<(),String> {
        if !self.awaiting_extract{return Err("TraceSimplificationSolver has no pending extraction".into());}
        crate::connectivity_read_barrier::check(&self.params.conn_map)?;
        self.validate_preserved_route_endpoints(&routes)?;
        self.hd_routes=self.mark_through_obstacle_segments(&routes);self.hd_routes_array_identity=next_identity();
        self.finish_phase()
    }

    fn start_next_phase(&mut self)->Result<(),String> {
        if self.active_sub_solver.is_some()||self.base.solved{return Ok(());}
        crate::connectivity_read_barrier::check(&self.params.conn_map)?;
        let options=&self.params.options;
        let child=match self.current_phase.as_str(){
            "via_removal"=>{
                let mut child_options=json!({"geometryShortcutTraceMargin":0.1,"geometryShortcutObstacleMargin":options["minTraceToPadEdgeClearance"].as_f64().unwrap_or(0.15),
                    "enableGeometryShortcuts":self.simplification_pipeline_loops>0.0,"enableObstacleDetourShortcuts":options["enableCrossingViaReduction"].as_bool()==Some(true)&&self.simplification_pipeline_loops>0.0});
                if let Some(value)=options.get("preserveRouteEndpoints"){child_options["preserveRouteEndpoints"]=value.clone();}
                let terminal_layers=self.params.terminal_layers.clone();
                let mut child=UselessViaRemovalSolver::new(UselessViaRemovalSolverInput{unsimplified_hd_routes:self.hd_routes.clone(),other_hd_routes:self.params.other_hd_routes.clone(),obstacles:self.params.obstacles.clone(),
                    layer_count:self.params.layer_count,conn_map:self.params.conn_map.clone(),outline:self.params.outline.clone(),terminal_layers,options:child_options,math:self.params.math});
                child.unsimplified_routes_array_identity=self.hd_routes_array_identity;
                TraceChild{identity:child.identity,kind:TraceChildKind::Via(Rc::new(RefCell::new(child)))}
            }
            "crossing_via_reduction"=>{
                let child=CrossingViaReductionSolver::new(CrossingViaReductionSolverInput{input_hd_routes:self.hd_routes.clone(),other_hd_routes:self.params.other_hd_routes.clone(),obstacles:self.params.obstacles.clone(),conn_map:self.params.conn_map.clone(),layer_count:self.params.layer_count,outline:self.params.outline.clone(),trace_margin:0.1,obstacle_margin:options["minTraceToPadEdgeClearance"].as_f64().unwrap_or(0.15),math:self.params.math})?;
                TraceChild{identity:child.identity,kind:TraceChildKind::Crossing(Rc::new(RefCell::new(child)))}
            }
            "via_merging"=>{
                let explicit=self.params.net_by_connection_name.clone();
                let mut child=SameNetViaMergerSolver::new(SameNetViaMergerSolverInput{input_hd_routes:self.hd_routes.clone(),other_hd_routes:self.params.other_hd_routes.clone(),net_by_connection_name:explicit,obstacles:self.params.obstacles.clone(),color_map:self.params.color_map.clone(),layer_count:self.params.layer_count,conn_map:self.params.conn_map.clone(),outline:self.params.outline.clone(),preserve_route_endpoints:options["preserveRouteEndpoints"].as_bool().unwrap_or(false)})?;
                child.input_routes_array_identity=self.hd_routes_array_identity;
                TraceChild{identity:child.identity,kind:TraceChildKind::Merger(Rc::new(RefCell::new(child)))}
            }
            "path_simplification"=>TraceChild{identity:next_identity(),kind:TraceChildKind::Path(Rc::new(RefCell::new(MultiSimplifiedPathSolver::new(MultiSimplifiedPathParams{
                unsimplified_hd_routes:self.hd_routes.clone(),other_hd_routes:Rc::new(self.params.other_hd_routes.clone()),obstacles:Rc::new(self.params.obstacles.clone()),conn_map:self.params.conn_map.clone(),color_map:self.params.color_map.clone(),outline:self.params.outline.clone().map(Rc::new),
                min_board_edge_clearance:options["minBoardEdgeClearance"].as_f64().unwrap_or(0.2),default_via_diameter:self.params.default_via_diameter,use_trace_width_aware_clearance:options["useTraceWidthAwareClearance"].as_bool().unwrap_or(false),enable_vertex_shortcuts:options["enableVertexShortcuts"].as_bool().unwrap_or(false),math:self.params.math}))))},
            _=>{self.base.failed=true;self.base.error=Some(format!("Unknown phase: {}",self.current_phase));return Ok(());}
        };
        self.active_sub_solver=Some(Rc::new(child));self.active_assigned=true;self.extract_mode="default".into();Ok(())
    }
}

impl SpecializedSolver for TraceSimplificationSolver {
    fn base(&self)->&BaseSolverState{&self.base}
    fn base_mut(&mut self)->&mut BaseSolverState{&mut self.base}
    fn get_solver_name(&self)->&'static str{"TraceSimplificationSolver"}
    fn _step(&mut self)->Result<(),String>{
        if self.simplification_pipeline_loops>=self.max_simplification_pipeline_loops{self.base.solved=true;return Ok(());}
        if let Some(child)=self.active_sub_solver.clone(){
            child.step()?;
            let state=child.base();
            if !state.failed&&!state.solved{return Ok(());}
            if state.solved {
                if self.extract_mode=="custom" {self.awaiting_extract=true;return Ok(());}
                if self.extract_mode!="null" {crate::connectivity_read_barrier::check(&self.params.conn_map)?;let routes=child.routes();self.validate_preserved_route_endpoints(&routes)?;self.hd_routes=self.mark_through_obstacle_segments(&routes);self.hd_routes_array_identity=next_identity();}
                return self.finish_phase();
            } else if state.failed {self.base.failed=true;self.base.error=Some(state.error.unwrap_or_else(||"Sub-solver failed without error message".into()));return Ok(());}
        }
        self.start_next_phase()
    }
}

impl TraceSimplificationSolver {
    pub fn snapshot(&self,codec:&mut GraphCodec)->Value {
        let mut fields=serde_json::to_value(&self.base).unwrap();
        fields["stats"]=codec.raw(self.stats.clone());
        fields["hdRoutes"]=codec.route_array(self.hd_routes_array_identity,&self.hd_routes);
        fields["simplificationPipelineLoops"]=json!(self.simplification_pipeline_loops);
        fields["MAX_SIMPLIFICATION_PIPELINE_LOOPS"]=json!(self.max_simplification_pipeline_loops);
        fields["PHASE_ORDER"]=json!(self.phase_order);fields["currentPhase"]=json!(self.current_phase);
        fields["extractMode"]=json!(self.extract_mode);fields["awaitingExtract"]=json!(self.awaiting_extract);
        if self.active_assigned {fields["activeSubSolver"]=self.active_sub_solver.as_ref().map(|child|{let fields=child.snapshot(codec);codec.object(child.identity,fields)}).unwrap_or(Value::Null);}
        if let Some(endpoints)=&self.preserved_route_endpoints {
            let mut values=serde_json::Map::new();
            for (name,(start,end)) in endpoints {values.insert(name.clone(),json!({"start":codec.point(start),"end":codec.point(end)}));}
            fields["preservedRouteEndpoints"]=Value::Object(values);
        }
        let mut config=self.params.options.clone();
        config["hdRoutes"]=Value::Array(self.params.hd_routes.iter().map(|route|json!({"$ref":["route",route.borrow().identity]})).collect());config["otherHdRoutes"]=codec.routes(&self.params.other_hd_routes);
        config["obstacles"]=codec.obstacles(&self.params.obstacles);config["connMap"]=codec.connectivity(&self.params.conn_map);
        config["colorMap"]=codec.color_map(&self.params.color_map);config["layerCount"]=json!(self.params.layer_count);config["defaultViaDiameter"]=json!(self.params.default_via_diameter);
        if let Some(outline)=&self.params.outline{config["outline"]=json!(outline);}
        config["terminalLayerIndicesByPcbPortId"]=self.params.terminal_layers.as_ref().map(|map|codec.terminal_layers(map)).unwrap_or(Value::Null);
        config["netByConnectionName"]=self.params.net_by_connection_name.as_ref().map(|map|codec.net_names(map)).unwrap_or(Value::Null);
        fields["simplificationConfig"]=config;
        fields
    }

    fn restore_config(&mut self,fields:&Value,codec:&mut GraphCodec,full:bool)->Result<(),String> {
        if let Some(value)=fields.get("hdRoutes").filter(|_|full){self.params.hd_routes=codec.read_routes(value)?;}
        if let Some(value)=fields.get("otherHdRoutes"){self.params.other_hd_routes=codec.read_routes(value)?;}
        if let Some(value)=fields.get("obstacles"){self.params.obstacles=codec.read_obstacles(value)?;}
        if let Some(value)=fields.get("connMap"){self.params.conn_map=codec.read_connectivity(value)?;}
        if let Some(value)=fields.get("colorMap"){self.params.color_map=codec.read_color_map(value)?;}
        if let Some(value)=fields.get("outline"){self.params.outline=if value.is_null(){None}else{Some(serde_json::from_value(codec.read_raw(value)).map_err(|e|e.to_string())?)};}
        if full {
            if let Some(value)=fields.get("layerCount"){self.params.layer_count=value.as_f64().ok_or("Layer count required")?;}
            if let Some(value)=fields.get("defaultViaDiameter"){self.params.default_via_diameter=value.as_f64().ok_or("Via diameter required")?;}
        }
        if let Some(value)=fields.get("terminalLayerIndicesByPcbPortId"){self.params.terminal_layers=if value.is_null(){None}else{Some(codec.read_terminal_layers(value)?)};}
        if let Some(value)=fields.get("netByConnectionName"){self.params.net_by_connection_name=if value.is_null(){None}else{Some(codec.read_net_names(value)?)};}
        for key in ["minTraceToPadEdgeClearance","minBoardEdgeClearance","enableCrossingViaReduction","preserveRouteEndpoints","useTraceWidthAwareClearance","enableVertexShortcuts","netByConnectionName","terminalLayerIndicesByPcbPortId"]{
            if let Some(value)=fields.get(key){self.params.options[key]=codec.read_raw(value);}
        }
        Ok(())
    }

    pub fn restore(&mut self,fields:&Value,codec:&mut GraphCodec)->Result<(),String> {
        let mut base=serde_json::to_value(&self.base).unwrap();
        for key in ["MAX_ITERATIONS","iterations","solved","failed","error","progress"]{if let Some(value)=fields.get(key){base[key]=value.clone();}}
        self.base=serde_json::from_value(base).map_err(|e|e.to_string())?;
        if let Some(value)=fields.get("stats"){self.stats=codec.read_raw(value);}
        if let Some(value)=fields.get("hdRoutes"){self.hd_routes=codec.read_routes(value)?;if let Some(id)=value["$array"].as_u64(){self.hd_routes_array_identity=id;}}
        if let Some(value)=fields.get("simplificationPipelineLoops"){self.simplification_pipeline_loops=value.as_f64().ok_or("Pipeline loops required")?;}
        if let Some(value)=fields.get("MAX_SIMPLIFICATION_PIPELINE_LOOPS"){self.max_simplification_pipeline_loops=value.as_f64().ok_or("Max loops required")?;}
        if let Some(value)=fields.get("PHASE_ORDER"){self.phase_order=serde_json::from_value(value.clone()).map_err(|e|e.to_string())?;}
        if let Some(value)=fields.get("currentPhase"){self.current_phase=value.as_str().ok_or("Phase required")?.into();}
        if let Some(value)=fields.get("extractMode"){self.extract_mode=value.as_str().ok_or("Extract mode required")?.into();}
        if let Some(value)=fields.get("activeSubSolver"){
            self.active_assigned=true;
            if value.is_null(){self.active_sub_solver=None;}
            else if let Some(child)=&self.active_sub_solver{if let Some(fields)=value.get("fields"){child.restore(fields,codec)?;}}
        }
        if let Some(value)=fields.get("preservedRouteEndpoints"){
            if value.is_null(){self.preserved_route_endpoints=None;}else{
                let mut endpoints=IndexMap::new();
                for (name,value) in value.as_object().ok_or("Preserved endpoints map required")?{endpoints.insert(name.clone(),(codec.read_point(&value["start"])? ,codec.read_point(&value["end"])?));}
                self.preserved_route_endpoints=Some(endpoints);
            }
        }
        self.restore_config(fields,codec,false)?;
        if let Some(config)=fields.get("simplificationConfig"){self.restore_config(config,codec,true)?;}
        Ok(())
    }

    pub fn invoke(&mut self,method:&str,args:&Value,codec:&mut GraphCodec)->Result<Value,String>{
        match method {
            "markThroughObstacleSegments"=>{let routes=codec.read_routes(&args[0])?;let routes=self.mark_through_obstacle_segments(&routes);Ok(codec.routes(&routes))}
            "validatePreservedRouteEndpoints"=>{let routes=codec.read_routes(&args[0])?;self.validate_preserved_route_endpoints(&routes)?;Ok(Value::Null)}
            "isSameNetObstacle"=>{let route=codec.read_route(&args[0])?;let obstacle=codec.read_obstacle(&args[1])?;Ok(json!(self.is_same_net_obstacle(&route,&obstacle)))}
            "getSameNetObstacleForSegment"=>{let route=codec.read_route(&args[0])?;let start=point2(&codec.read_point(&args[1])?);let end=point2(&codec.read_point(&args[2])?);Ok(self.get_same_net_obstacle_for_segment(&route,start,end).map(|obstacle|codec.obstacle(&obstacle)).unwrap_or(Value::Null))}
            "isViaInsideSameNetObstacle"=>{let route=codec.read_route(&args[0])?;let via=point2(&codec.read_point(&args[1])?);Ok(json!(self.is_via_inside_same_net_obstacle(&route,via)))}
            "getOutput"|"simplifiedHdRoutes"=>Ok(codec.route_array(self.hd_routes_array_identity,&self.hd_routes)),
            _=>Err(format!("Unknown trace simplification method: {method}")),
        }
    }
}
