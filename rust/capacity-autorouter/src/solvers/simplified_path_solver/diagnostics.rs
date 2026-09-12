use serde_json::{Value,json};
use std::rc::Rc;
use crate::bindings::trace_simplification::graph_codec::GraphCodec;
use crate::bindings::trace_simplification::types::*;
use crate::data_structures::segment_tree::SegmentTree;
use super::{multi_simplified_path_solver::{PathChild,PathChildKind},single_simplified_path_solver5_deg45::{PathSegment,FilteredVia,JumperPad}};

impl PathChild {
    pub fn snapshot(&self,codec:&mut GraphCodec)->Value {
        let solver=self.base_solver();let params=&solver.params;
        let mut fields=serde_json::to_value(&solver.base).unwrap();
        fields["inputRoute"]=codec.route(&params.input_route);
        fields["otherHdRoutes"]=codec.routes(&params.other_hd_routes);
        fields["newRoute"]=codec.point_array(solver.new_route_array_identity,&solver.new_route);
        fields["newVias"]=codec.point_array(solver.new_vias_array_identity,&solver.new_vias);
        fields["headIndex"]=json!(solver.head_index);fields["tailIndex"]=json!(solver.tail_index);
        fields["obstacles"]=codec.obstacles(&params.obstacles);
        fields["connMap"]=codec.connectivity(&params.conn_map);fields["colorMap"]=codec.color_map(&params.color_map);
        if let Some(outline)=&params.outline{fields["outline"]=json!(outline);}
        fields["minBoardEdgeClearance"]=json!(params.min_board_edge_clearance);
        if let Some(s)=self.sampled(){
            macro_rules! scalar{($key:literal,$field:ident)=>{fields[$key]=json!(s.$field);};}
            scalar!("totalPathLength",total_path_length);scalar!("headDistanceAlongPath",head_distance_along_path);scalar!("tailDistanceAlongPath",tail_distance_along_path);scalar!("minStepSize",min_step_size);scalar!("lastValidPathHeadDistance",last_valid_path_head_distance);scalar!("STEP_SIZE_REDUCTION_FACTOR",step_size_reduction_factor);scalar!("maxStepSize",max_step_size);scalar!("currentStepSize",current_step_size);scalar!("lastHeadMoveDistance",last_head_move_distance);scalar!("OBSTACLE_MARGIN",obstacle_margin);scalar!("TRACE_THICKNESS",trace_thickness);scalar!("useTraceWidthAwareClearance",use_trace_width_aware_clearance);scalar!("clearanceTraceThickness",clearance_trace_thickness);scalar!("TAIL_JUMP_RATIO",tail_jump_ratio);
            fields["lastValidPath"]=s.last_valid_path.as_ref().map(|p|codec.point_array(s.last_valid_path_array_identity,p)).unwrap_or(Value::Null);
            fields["pathSegments"]=Value::Array(s.path_segments.iter().map(|segment|json!({"start":codec.point(&segment.start),"end":codec.point(&segment.end),"length":segment.length,"startDistance":segment.start_distance,"endDistance":segment.end_distance})).collect());
            fields["cachedValidPathSegments"]=json!(s.cached_valid_path_segments);fields["jumperPadPointIndices"]=json!(s.jumper_pad_point_indices);
            fields["filteredObstacles"]=codec.obstacles(&s.filtered_obstacles);
            fields["filteredObstaclePathSegments"]=Value::Array(s.filtered_obstacle_path_segments.iter().map(|pair|codec.points(pair)).collect());
            fields["traceThicknessByObstacleSegmentId"]=json!(s.trace_thickness_by_obstacle_segment_id);
            fields["filteredVias"]=Value::Array(s.filtered_vias.iter().map(|via|{let mut value=point_to_value(&via.point);value["diameter"]=json!(via.diameter);codec.raw(value)}).collect());
            fields["filteredJumperPads"]=Value::Array(s.filtered_jumper_pads.iter().map(|pad|json!({"center":pad.center,"width":pad.width,"height":pad.height,"connectionName":pad.connection_name})).collect());
            let buckets:Vec<Value>=s.segment_tree.buckets.iter().map(|(&(x,y),segments)|json!([format!("{x}x{y}"),segments.iter().map(|(a,b,id)|json!([codec.point(a),codec.point(b),id])).collect::<Vec<_>>()])).collect();
            fields["segmentTree"]=json!({"CELL_SIZE":s.segment_tree.cell_size,"SEGMENT_MARGIN":s.segment_tree.segment_margin,"segments":s.segment_tree.segments.iter().map(|p|codec.points(p)).collect::<Vec<_>>(),"buckets":buckets});
        }
        if let PathChildKind::Vertex(s)=&self.kind{fields["vertexIndex"]=json!(s.vertex_index);}
        fields
    }
    pub fn invoke(&mut self,method:&str,args:&Value,codec:&mut GraphCodec)->Result<Value,String>{
        if method=="getSolverName"{return Ok(json!(if matches!(&self.kind,PathChildKind::Vertex(_)){"VertexShortcutPathSolver"}else{"SingleSimplifiedPathSolver"}));}
        if method=="simplifiedRoute"{return Ok(codec.route(&self.simplified_route()));}
        if method=="getConstructorParams"{let mut value=self.snapshot(codec);let object=value.as_object_mut().unwrap();object.retain(|key,_|["inputRoute","otherHdRoutes","obstacles","connMap","colorMap","outline","minBoardEdgeClearance"].contains(&key.as_str()));value["connMap"]=codec.raw(serde_json::to_value(&self.base_solver().params.conn_map.net_map).unwrap());return Ok(value);}
        let Some(s)=self.sampled_mut()else{return Err("Not implemented".into());};
        match method{
            "isValidPath"=>Ok(json!(s.is_valid_path(&codec.read_points(&args[0])?)?)),
            "isValidPathSegment"=>Ok(json!(s.is_valid_path_segment(&codec.read_point(&args[0])?,&codec.read_point(&args[1])?)?)),
            "arePointsEqual"=>Ok(json!(s.are_points_equal(&codec.read_point(&args[0])?,&codec.read_point(&args[1])?))),
            "getPointAtDistance"=>Ok(codec.point(&s.get_point_at_distance(args[0].as_f64().ok_or("Distance required")?))),
            "getNearestIndexForDistance"=>Ok(json!(s.get_nearest_index_for_distance(args[0].as_f64().ok_or("Distance required")?))),
            "find45DegreePath"=>Ok(s.find_45_degree_path(&codec.read_point(&args[0])?,&codec.read_point(&args[1])?)?.map(|p|codec.points(&p)).unwrap_or(Value::Null)),
            "addPathToResult"=>{s.add_path_to_result(&codec.read_points(&args[0])?);Ok(Value::Null)},
            "appendOriginalRouteSlice"=>{s.append_original_route_slice(args[0].as_f64().ok_or("Distance required")?,args[1].as_u64().ok_or("Route index required")? as usize)?;Ok(Value::Null)},
            "moveHead"=>{s.move_head(args[0].as_f64().ok_or("Distance required")?);Ok(Value::Null)},
            "stepBackAndReduceStepSize"=>{s.step_back_and_reduce_step_size();Ok(Value::Null)},
            "computePathSegments"=>{s.compute_path_segments();Ok(Value::Null)},
            "isSameNetRoute"=>Ok(json!(s.is_same_net_route(&codec.read_route(&args[0])?))),
            _=>Err(format!("Unknown simplified path method {method}")),
        }
    }
}

impl PathChild {
    pub fn restore(&mut self,fields:&Value,codec:&mut GraphCodec)->Result<(),String>{
        {
            let solver=self.base_solver_mut();
            let mut base=serde_json::to_value(&solver.base).unwrap();
            for key in ["MAX_ITERATIONS","iterations","solved","failed","error","progress"]{if let Some(value)=fields.get(key){base[key]=value.clone();}}
            solver.base=serde_json::from_value(base).map_err(|e|e.to_string())?;
            if let Some(value)=fields.get("inputRoute"){solver.params.input_route=codec.read_route(value)?;}
            if let Some(value)=fields.get("otherHdRoutes"){solver.params.other_hd_routes=Rc::new(codec.read_routes(value)?);}
            if let Some(value)=fields.get("newRoute"){solver.new_route=codec.read_points(value)?;if let Some(id)=value["$array"].as_u64(){solver.new_route_array_identity=id;}}
            if let Some(value)=fields.get("newVias"){solver.new_vias=codec.read_points(value)?;if let Some(id)=value["$array"].as_u64(){solver.new_vias_array_identity=id;}}
            if let Some(value)=fields.get("headIndex"){solver.head_index=value.as_u64().ok_or("headIndex required")? as usize;}
            if let Some(value)=fields.get("tailIndex"){solver.tail_index=value.as_u64().ok_or("tailIndex required")? as usize;}
            if let Some(value)=fields.get("obstacles"){solver.params.obstacles=Rc::new(codec.read_obstacles(value)?);}
            if let Some(value)=fields.get("colorMap"){solver.params.color_map=codec.read_color_map(value)?;}
            if let Some(value)=fields.get("connMap"){solver.params.conn_map=codec.read_connectivity(value)?;}
            if let Some(value)=fields.get("outline"){solver.params.outline=if value.is_null(){None}else{Some(Rc::new(serde_json::from_value(value.clone()).map_err(|e|e.to_string())?))};}
            if let Some(value)=fields.get("minBoardEdgeClearance"){solver.params.min_board_edge_clearance=value.as_f64().ok_or("Clearance required")?;}
        }
        if let Some(s)=self.sampled_mut(){
            macro_rules! scalar{($key:literal,$field:ident)=>{if let Some(value)=fields.get($key){s.$field=value.as_f64().ok_or(concat!($key," required"))?;}};}
            scalar!("totalPathLength",total_path_length);scalar!("headDistanceAlongPath",head_distance_along_path);scalar!("tailDistanceAlongPath",tail_distance_along_path);scalar!("minStepSize",min_step_size);scalar!("lastValidPathHeadDistance",last_valid_path_head_distance);scalar!("STEP_SIZE_REDUCTION_FACTOR",step_size_reduction_factor);scalar!("maxStepSize",max_step_size);scalar!("currentStepSize",current_step_size);scalar!("lastHeadMoveDistance",last_head_move_distance);scalar!("OBSTACLE_MARGIN",obstacle_margin);scalar!("TRACE_THICKNESS",trace_thickness);scalar!("clearanceTraceThickness",clearance_trace_thickness);scalar!("TAIL_JUMP_RATIO",tail_jump_ratio);
            if let Some(value)=fields.get("useTraceWidthAwareClearance"){s.use_trace_width_aware_clearance=value.as_bool().ok_or("Width awareness flag required")?;}
            if let Some(value)=fields.get("lastValidPath"){s.last_valid_path=if value.is_null(){None}else{Some(codec.read_points(value)?)};if let Some(id)=value["$array"].as_u64(){s.last_valid_path_array_identity=id;}}
            if let Some(value)=fields.get("pathSegments"){
                s.path_segments=value.as_array().ok_or("pathSegments required")?.iter().map(|v|Ok(PathSegment{start:codec.read_point(&v["start"])?,end:codec.read_point(&v["end"])?,length:v["length"].as_f64().ok_or("Segment length required")?,start_distance:v["startDistance"].as_f64().ok_or("Start distance required")?,end_distance:v["endDistance"].as_f64().ok_or("End distance required")?})).collect::<Result<_,String>>()?;
            }
            if let Some(value)=fields.get("cachedValidPathSegments"){s.cached_valid_path_segments=serde_json::from_value(value.clone()).map_err(|e|e.to_string())?;}
            if let Some(value)=fields.get("jumperPadPointIndices"){s.jumper_pad_point_indices=serde_json::from_value(value.clone()).map_err(|e|e.to_string())?;}
            if let Some(value)=fields.get("filteredObstacles"){s.filtered_obstacles=codec.read_obstacles(value)?;}
            if let Some(value)=fields.get("filteredObstaclePathSegments"){s.filtered_obstacle_path_segments=value.as_array().ok_or("Filtered segments required")?.iter().map(|v|{let p=codec.read_points(v)?;p.try_into().map_err(|_|"Segment pair required".to_string())}).collect::<Result<_,_>>()?;}
            if let Some(value)=fields.get("traceThicknessByObstacleSegmentId"){s.trace_thickness_by_obstacle_segment_id=serde_json::from_value(value.clone()).map_err(|e|e.to_string())?;}
            if let Some(value)=fields.get("filteredVias"){s.filtered_vias=value.as_array().ok_or("Filtered vias required")?.iter().map(|v|{let v=codec.read_raw(v);Ok(FilteredVia{diameter:v["diameter"].as_f64().ok_or("Via diameter required")?,point:point_from_value(&v)})}).collect::<Result<_,String>>()?;}
            if let Some(value)=fields.get("filteredJumperPads"){s.filtered_jumper_pads=value.as_array().ok_or("Jumper pads required")?.iter().map(|v|Ok(JumperPad{center:serde_json::from_value(v["center"].clone()).map_err(|e|e.to_string())?,width:v["width"].as_f64().ok_or("Pad width required")?,height:v["height"].as_f64().ok_or("Pad height required")?,connection_name:v["connectionName"].as_str().ok_or("Pad connection required")?.into()})).collect::<Result<_,String>>()?;}
            if let Some(value)=fields.get("segmentTree"){
                let segments=value["segments"].as_array().ok_or("Tree segments required")?.iter().map(|v|{let p=codec.read_points(v)?;p.try_into().map_err(|_|"Segment pair required".to_string())}).collect::<Result<_,_>>()?;
                let mut tree=SegmentTree::new(segments,value["SEGMENT_MARGIN"].as_f64().ok_or("Segment margin required")?);tree.cell_size=value["CELL_SIZE"].as_f64().ok_or("Cell size required")?;
                if let Some(buckets)=value["buckets"].as_array(){tree.buckets.clear();for bucket in buckets{let key=bucket[0].as_str().ok_or("Bucket key required")?;let(x,y)=key.split_once('x').ok_or("Bucket key must contain x")?;let key=(x.parse().map_err(|_|"Invalid bucket x")?,y.parse().map_err(|_|"Invalid bucket y")?);let segments=bucket[1].as_array().ok_or("Bucket segments required")?.iter().map(|v|Ok((codec.read_point(&v[0])?,codec.read_point(&v[1])?,v[2].as_str().ok_or("Segment ID required")?.to_owned()))).collect::<Result<_,String>>()?;tree.buckets.insert(key,segments);}}
                s.segment_tree=tree;
            }
        }
        if let PathChildKind::Vertex(s)=&mut self.kind{if let Some(value)=fields.get("vertexIndex"){s.vertex_index=value.as_u64().ok_or("vertexIndex required")? as usize;}}
        Ok(())
    }
}

impl super::multi_simplified_path_solver::MultiSimplifiedPathSolver {
    pub fn snapshot(&self,codec:&mut GraphCodec)->Value{
        let mut fields=serde_json::to_value(&self.base).unwrap();
        fields["simplifiedHdRoutes"]=codec.routes(&self.simplified_hd_routes);
        fields["unsimplifiedHdRoutes"]=codec.routes(&self.params.unsimplified_hd_routes);
        fields["otherHdRoutes"]=codec.routes(&self.params.other_hd_routes);
        fields["obstacles"]=codec.obstacles(&self.params.obstacles);
        fields["connMap"]=codec.connectivity(&self.params.conn_map);
        fields["colorMap"]=codec.color_map(&self.params.color_map);
        if let Some(outline)=&self.params.outline{fields["outline"]=json!(outline);}
        fields["currentUnsimplifiedHdRouteIndex"]=json!(self.current_unsimplified_hd_route_index);
        fields["minBoardEdgeClearance"]=json!(self.params.min_board_edge_clearance);
        fields["defaultViaDiameter"]=json!(self.params.default_via_diameter);
        fields["useTraceWidthAwareClearance"]=json!(self.params.use_trace_width_aware_clearance);
        fields["enableVertexShortcuts"]=json!(self.params.enable_vertex_shortcuts);
        fields["activeSubSolver"]=if let Some(child)=&self.active_sub_solver{let child=child.borrow();let snapshot=child.snapshot(codec);codec.object(child.identity,snapshot)}else{Value::Null};
        fields
    }
    pub fn restore(&mut self,fields:&Value,codec:&mut GraphCodec,child:Option<super::multi_simplified_path_solver::PathChildRef>)->Result<(),String>{
        let mut base=serde_json::to_value(&self.base).unwrap();for key in ["MAX_ITERATIONS","iterations","solved","failed","error","progress"]{if let Some(value)=fields.get(key){base[key]=value.clone();}}self.base=serde_json::from_value(base).map_err(|e|e.to_string())?;
        if let Some(value)=fields.get("simplifiedHdRoutes"){self.simplified_hd_routes=codec.read_routes(value)?;}
        if let Some(value)=fields.get("unsimplifiedHdRoutes"){self.params.unsimplified_hd_routes=codec.read_routes(value)?;}
        if let Some(value)=fields.get("otherHdRoutes"){self.params.other_hd_routes=Rc::new(codec.read_routes(value)?);}
        if let Some(value)=fields.get("obstacles"){self.params.obstacles=Rc::new(codec.read_obstacles(value)?);}
        if let Some(value)=fields.get("colorMap"){self.params.color_map=codec.read_color_map(value)?;}
        if let Some(value)=fields.get("connMap"){self.params.conn_map=codec.read_connectivity(value)?;}
        if let Some(value)=fields.get("outline"){self.params.outline=if value.is_null(){None}else{Some(Rc::new(serde_json::from_value(value.clone()).map_err(|e|e.to_string())?))};}
        if let Some(value)=fields.get("currentUnsimplifiedHdRouteIndex"){self.current_unsimplified_hd_route_index=value.as_u64().ok_or("Route index required")? as usize;}
        if let Some(value)=fields.get("minBoardEdgeClearance"){self.params.min_board_edge_clearance=value.as_f64().ok_or("Clearance required")?;}
        if let Some(value)=fields.get("defaultViaDiameter"){self.params.default_via_diameter=value.as_f64().ok_or("Via diameter required")?;}
        if let Some(value)=fields.get("useTraceWidthAwareClearance"){self.params.use_trace_width_aware_clearance=value.as_bool().ok_or("Width flag required")?;}
        if let Some(value)=fields.get("enableVertexShortcuts"){self.params.enable_vertex_shortcuts=value.as_bool().ok_or("Vertex flag required")?;}
        if fields.get("activeSubSolver").is_some(){self.active_sub_solver=child;}
        Ok(())
    }
    pub fn invoke(&mut self,method:&str,_args:&Value,_codec:&mut GraphCodec)->Result<Value,String>{
        match method{"getSolverName"=>Ok(json!("MultiSimplifiedPathSolver")),_=>Err(format!("Unknown multi simplified path method {method}"))}
    }
}
