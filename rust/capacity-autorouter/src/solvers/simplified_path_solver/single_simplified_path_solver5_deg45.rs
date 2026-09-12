use std::ops::{Deref,DerefMut};
use std::rc::Rc;
use indexmap::{IndexMap,IndexSet};
use serde_json::Value;
use crate::bindings::trace_simplification::types::*;
use crate::bindings::trace_simplification::math_utils::*;
use crate::data_structures::segment_tree::SegmentTree;
use crate::utils::{calculate_45_degree_paths::calculate_45_degree_paths,minimum_distance_between_segments::minimum_distance_between_segments,polygon_containment::does_segment_cross_polygon_boundary};
use super::single_simplified_path_solver::{SingleSimplifiedPathSolver,SingleSimplifiedPathParams};

pub struct PathSegment { pub start:PointRef,pub end:PointRef,pub length:f64,pub start_distance:f64,pub end_distance:f64 }
pub struct FilteredVia { pub point:PointRef,pub diameter:f64 }
pub struct JumperPad { pub center:Point2,pub width:f64,pub height:f64,pub connection_name:String }
pub struct SingleSimplifiedPathSolver5 {
    pub inner:SingleSimplifiedPathSolver,
    pub path_segments:Vec<PathSegment>,pub total_path_length:f64,pub head_distance_along_path:f64,pub tail_distance_along_path:f64,
    pub min_step_size:f64,pub last_valid_path:Option<Vec<PointRef>>,pub last_valid_path_array_identity:u64,pub last_valid_path_head_distance:f64,
    pub step_size_reduction_factor:f64,pub max_step_size:f64,pub current_step_size:f64,pub last_head_move_distance:f64,
    pub cached_valid_path_segments:IndexSet<String>,pub filtered_obstacles:Vec<ObstacleRef>,pub filtered_obstacle_path_segments:Vec<[PointRef;2]>,
    pub trace_thickness_by_obstacle_segment_id:IndexMap<String,f64>,pub filtered_vias:Vec<FilteredVia>,pub filtered_jumper_pads:Vec<JumperPad>,
    pub jumper_pad_point_indices:IndexSet<usize>,pub segment_tree:SegmentTree,
    pub obstacle_margin:f64,pub trace_thickness:f64,pub use_trace_width_aware_clearance:bool,pub clearance_trace_thickness:f64,pub tail_jump_ratio:f64,
}
impl Deref for SingleSimplifiedPathSolver5 {type Target=SingleSimplifiedPathSolver;fn deref(&self)->&Self::Target{&self.inner}}
impl DerefMut for SingleSimplifiedPathSolver5 {fn deref_mut(&mut self)->&mut Self::Target{&mut self.inner}}
fn number(p:&PointRef,key:&str)->Option<f64>{p.borrow().metadata.get(key).and_then(Value::as_f64)}
fn segment_id(a:&PointRef,b:&PointRef)->String {
    use crate::utils::js_number::js_number_to_string as n;
    let a=a.borrow();let b=b.borrow();format!("{}-{}-{}-{}-{}-{}",n(a.x),n(a.y),n(a.z),n(b.x),n(b.y),n(b.z))
}
impl SingleSimplifiedPathSolver5 {
    pub fn new(params:SingleSimplifiedPathParams)->Self {
        let aware=params.use_trace_width_aware_clearance;
        let clearance=if aware {params.input_route.borrow().trace_thickness}else{0.15};
        let mut solver=Self {inner:SingleSimplifiedPathSolver::new(params),path_segments:Vec::new(),total_path_length:0.0,head_distance_along_path:0.0,tail_distance_along_path:0.0,min_step_size:0.25,last_valid_path:None,last_valid_path_array_identity:next_identity(),last_valid_path_head_distance:0.0,
            step_size_reduction_factor:0.25,max_step_size:4.0,current_step_size:4.0,last_head_move_distance:0.0,cached_valid_path_segments:IndexSet::new(),filtered_obstacles:Vec::new(),filtered_obstacle_path_segments:Vec::new(),trace_thickness_by_obstacle_segment_id:IndexMap::new(),filtered_vias:Vec::new(),filtered_jumper_pads:Vec::new(),jumper_pad_point_indices:IndexSet::new(),segment_tree:SegmentTree::new(Vec::new(),0.4),obstacle_margin:0.1,trace_thickness:0.15,use_trace_width_aware_clearance:aware,clearance_trace_thickness:clearance,tail_jump_ratio:0.8};
        let input=solver.params.input_route.clone();
        if input.borrow().route.len()<=1 {solver.new_route=input.borrow().route.clone();solver.base.solved=true;return solver;}
        let mut bounds=Bounds{min_x:f64::INFINITY,max_x:f64::NEG_INFINITY,min_y:f64::INFINITY,max_y:f64::NEG_INFINITY};
        for p in &input.borrow().route {let p=p.borrow();bounds.min_x=min(bounds.min_x,p.x);bounds.max_x=max(bounds.max_x,p.x);bounds.min_y=min(bounds.min_y,p.y);bounds.max_y=max(bounds.max_y,p.y);}
        let mut maximum_other=if aware{0.0}else{solver.trace_thickness};
        if aware {for route in solver.params.other_hd_routes.iter(){let route=route.borrow();maximum_other=max(maximum_other,route.trace_thickness);for p in &route.route{maximum_other=max(maximum_other,number(p,"traceThickness").unwrap_or(route.trace_thickness));}}}
        let margin=if aware {solver.obstacle_margin+clearance/2.0+maximum_other/2.0}else{solver.obstacle_margin+solver.trace_thickness};
        let center=Point2{x:(bounds.min_x+bounds.max_x)/2.0,y:(bounds.min_y+bounds.max_y)/2.0};
        let obstacles=solver.params.obstacles.clone();
        let shared_connectivity=solver.params.connectivity.clone();
        let mut connectivity=shared_connectivity.borrow_mut();
        connectivity.refresh(&solver.params.conn_map);
        let connection=connectivity.resolve(&input.borrow().connection_name);
        for obstacle_ref in obstacles.iter(){
            let ids=connectivity.resolve_obstacle(obstacle_ref);
            let obstacle=obstacle_ref.borrow();
            if ids.iter().any(|id|connection.is_connected_to(*id)){continue;}
            if compute_gap_between_boxes(center,bounds.max_x-bounds.min_x,bounds.max_y-bounds.min_y,obstacle.center,obstacle.width,obstacle.height,solver.params.math)<solver.obstacle_margin+clearance/2.0 {solver.filtered_obstacles.push(obstacle_ref.clone());}
        }
        drop(connectivity);
        let others=solver.params.other_hd_routes.clone();
        for route in others.iter(){
            if solver.is_same_net_route(route){continue;}
            let route=route.borrow();
            for pair in route.route.windows(2){let start=&pair[0];let end=&pair[1];
                if segment_to_bounds_min_distance(point2(start),point2(end),&bounds)<=margin {
                    solver.filtered_obstacle_path_segments.push([start.clone(),end.clone()]);
                    if aware {let id=segment_id(start,end);let thickness=max(number(start,"traceThickness").unwrap_or(route.trace_thickness),number(end,"traceThickness").unwrap_or(route.trace_thickness));let previous=solver.trace_thickness_by_obstacle_segment_id.get(&id).copied().unwrap_or(0.0);solver.trace_thickness_by_obstacle_segment_id.insert(id,max(previous,thickness));}
                }
            }
            for via in &route.vias {let p=via.borrow();let margin=solver.obstacle_margin+clearance/2.0+route.via_diameter/2.0;
                if p.x-margin<=bounds.max_x&&p.x+margin>=bounds.min_x&&p.y-margin<=bounds.max_y&&p.y+margin>=bounds.min_y {solver.filtered_vias.push(FilteredVia{point:spread_point(via),diameter:route.via_diameter});}
            }
        }
        solver.segment_tree=SegmentTree::new(solver.filtered_obstacle_path_segments.clone(),if aware{margin}else{0.4});
        for route in others.iter(){if !solver.is_same_net_route(route){solver.extract_jumper_pads(route,&bounds);}}
        let has_jumpers=input.borrow().has_jumpers();
        if has_jumpers {
            solver.extract_jumper_pads(&input,&bounds);
            let route=input.borrow();
            for jumper in route.jumpers.as_ref().unwrap().borrow().as_array().unwrap(){for(i,p)in route.route.iter().enumerate(){let p=p.borrow();let matches=|side:&str| (p.x-jumper[side]["x"].as_f64().unwrap()).abs()<0.01&&(p.y-jumper[side]["y"].as_f64().unwrap()).abs()<0.01;if matches("start")||matches("end"){solver.jumper_pad_point_indices.insert(i);}}}
        }
        solver.compute_path_segments();solver
    }
    pub fn is_same_net_route(&self,other:&RouteRef)->bool {
        let input=self.params.input_route.borrow();let other=other.borrow();
        [Some(input.connection_name.as_str()),input.root_connection_name.as_deref()].into_iter().flatten().any(|a|[Some(other.connection_name.as_str()),other.root_connection_name.as_deref()].into_iter().flatten().any(|b|a==b||self.params.conn_map.are_ids_connected(a,b)))
    }
    fn extract_jumper_pads(&mut self,route:&RouteRef,bounds:&Bounds){
        let route=route.borrow();let Some(jumpers)=&route.jumpers else{return;};let jumpers=jumpers.borrow();let Some(jumpers)=jumpers.as_array()else{return;};
        for jumper in jumpers{
            let (length,width)=match jumper["footprint"].as_str(){Some("1206")=>(0.6,1.6),Some("1206x4_pair")=>(0.8,0.5),_=>(0.8,0.95)};
            let start=Point2{x:jumper["start"]["x"].as_f64().unwrap(),y:jumper["start"]["y"].as_f64().unwrap()};let end=Point2{x:jumper["end"]["x"].as_f64().unwrap(),y:jumper["end"]["y"].as_f64().unwrap()};
            let horizontal=(end.x-start.x).abs()>(end.y-start.y).abs();let(w,h)=if horizontal{(length,width)}else{(width,length)};
            let margin=self.obstacle_margin+self.clearance_trace_thickness/2.0;
            for center in [start,end]{if center.x-w/2.0-margin<=bounds.max_x&&center.x+w/2.0+margin>=bounds.min_x&&center.y-h/2.0-margin<=bounds.max_y&&center.y+h/2.0+margin>=bounds.min_y{self.filtered_jumper_pads.push(JumperPad{center,width:w,height:h,connection_name:route.connection_name.clone()});}}
        }
    }
    pub fn compute_path_segments(&mut self){
        let mut cumulative=0.0;
        let input=self.params.input_route.clone();
        for(i,pair)in input.borrow().route.windows(2).enumerate(){let a=point3(&pair[0]);let b=point3(&pair[1]);let dx=b.x-a.x;let dy=b.y-a.y;let length=(dx*dx+dy*dy).sqrt()+i as f64/10000.0;self.path_segments.push(PathSegment{start:pair[0].clone(),end:pair[1].clone(),length,start_distance:cumulative,end_distance:cumulative+length});cumulative+=length;}
        self.total_path_length=cumulative;
    }
    pub fn are_points_equal(&self,a:&PointRef,b:&PointRef)->bool{let a=a.borrow();let b=b.borrow();a.x==b.x&&a.y==b.y&&a.z==b.z}
    pub fn get_point_at_distance(&self,distance:f64)->PointRef{
        let distance=max(0.0,min(distance,self.total_path_length));
        let Some(segment)=self.path_segments.iter().find(|s|distance>=s.start_distance&&distance<=s.end_distance)else{return self.params.input_route.borrow().route.last().expect("Route endpoint required").clone();};
        let factor=(distance-segment.start_distance)/segment.length;let start=segment.start.borrow();let end=segment.end.borrow();
        fresh_point(start.x+factor*(end.x-start.x),start.y+factor*(end.y-start.y),if factor<0.5{start.z}else{end.z})
    }
    pub fn get_nearest_index_for_distance(&self,distance:f64)->usize{
        if distance<=0.0{return 0;}if distance>=self.total_path_length{return self.params.input_route.borrow().route.len()-1;}
        let Some(i)=self.path_segments.iter().position(|s|distance>=s.start_distance&&distance<=s.end_distance)else{return 0;};let s=&self.path_segments[i];if distance>(s.start_distance+s.end_distance)/2.0{i+1}else{i}
    }
    pub fn is_valid_path_segment(&self,start:&PointRef,end:&PointRef)->Result<bool,String>{
        let a=point3(start);let b=point3(end);let a2=point2(start);let b2=point2(end);
        for obstacle in &self.filtered_obstacles{let obstacle=obstacle.borrow();if !obstacle.z_layers.contains(&a.z){continue;}if segment_to_box_min_distance(a2,b2,obstacle.center,obstacle.width,obstacle.height)<self.obstacle_margin+self.clearance_trace_thickness/2.0{return Ok(false);}}
        for (other_a,other_b,id) in self.segment_tree.get_segments_that_could_intersect(&a,&b){
            if other_a.borrow().z==a.z&&other_b.borrow().z==a.z{
                let distance=minimum_distance_between_segments(a2,b2,point2(&other_a),point2(&other_b));
                if !self.use_trace_width_aware_clearance{if distance<self.obstacle_margin+self.trace_thickness{return Ok(false);}continue;}
                let thickness=self.trace_thickness_by_obstacle_segment_id.get(&id).ok_or_else(||format!("Missing trace thickness for segment \"{id}\""))?;
                if distance<self.obstacle_margin+self.clearance_trace_thickness/2.0+thickness/2.0{return Ok(false);}
            }
        }
        for via in &self.filtered_vias{if point_to_segment_distance(point2(&via.point),a2,b2)<self.obstacle_margin+via.diameter/2.0+self.clearance_trace_thickness/2.0{return Ok(false);}}
        for pad in &self.filtered_jumper_pads{if segment_to_box_min_distance(a2,b2,pad.center,pad.width,pad.height)<self.obstacle_margin+self.clearance_trace_thickness/2.0{return Ok(false);}}
        if let Some(outline)=&self.params.outline{if outline.len()>=3&&does_segment_cross_polygon_boundary(a2,b2,outline,self.params.min_board_edge_clearance+self.params.input_route.borrow().trace_thickness/2.0){return Ok(false);}}
        Ok(true)
    }
    pub fn is_valid_path(&self,points:&[PointRef])->Result<bool,String>{
        if points.len()<2{return Ok(true);}
        for pair in points.windows(2){if pair[0].borrow().z!=pair[1].borrow().z{return Ok(false);}}
        for pair in points.windows(2){if !self.is_valid_path_segment(&pair[0],&pair[1])?{return Ok(false);}}
        Ok(true)
    }
    pub fn find_45_degree_path(&self,start:&PointRef,end:&PointRef)->Result<Option<Vec<PointRef>>,String>{
        if self.are_points_equal(start,end){return Ok(Some(vec![start.clone()]));}
        let z=start.borrow().z;if z!=end.borrow().z{return Ok(None);}
        for path in calculate_45_degree_paths(point2(start),point2(end)){
            let full:Vec<_>=path.into_iter().map(|p|fresh_point(p.x,p.y,z)).collect();
            if self.is_valid_path(&full)?{return Ok(Some(full));}
        }
        Ok(None)
    }
    pub fn add_path_to_result(&mut self,path:&[PointRef]){
        if path.is_empty(){return;}
        for(i,p)in path.iter().enumerate(){if i==0&&self.new_route.last().is_some_and(|last|self.are_points_equal(last,p)){continue;}self.new_route.push(p.clone());}
        self.current_step_size=self.max_step_size;
    }
    pub fn append_original_route_slice(&mut self,distance:f64,end:usize)->Result<(),String>{
        let index=self.path_segments.iter().position(|s|distance>=s.start_distance&&distance<=s.end_distance).ok_or_else(||format!("Could not find path segment containing distance {}",crate::utils::js_number::js_number_to_string(distance)))?;
        let input=self.params.input_route.clone();let input=input.borrow();
        for i in index+1..=end{if i>=input.route.len(){break;}let point=&input.route[i];if self.new_route.last().is_some_and(|last|self.are_points_equal(last,point)){continue;}self.new_route.push(spread_point(point));}
        Ok(())
    }
    pub fn move_head(&mut self,distance:f64){self.last_head_move_distance=distance;self.head_distance_along_path=min(self.head_distance_along_path+distance,self.total_path_length);}
    pub fn step_back_and_reduce_step_size(&mut self){self.head_distance_along_path=max(self.tail_distance_along_path,self.head_distance_along_path-self.last_head_move_distance);self.current_step_size=max(self.min_step_size,self.current_step_size*self.step_size_reduction_factor);}
    pub fn _step(&mut self)->Result<(),String>{
        let tail_end=self.tail_distance_along_path>=self.total_path_length;let head_end=self.head_distance_along_path>=self.total_path_length;
        let input=self.params.input_route.clone();
        if tail_end{let last=input.borrow().route.last().expect("Route endpoint").clone();if self.new_route.last().is_none_or(|p|!self.are_points_equal(p,&last)){self.new_route.push(last);}self.base.solved=true;return Ok(());}
        if head_end{
            let tail=self.get_point_at_distance(self.tail_distance_along_path);let end=input.borrow().route.last().unwrap().clone();
            if let Some(path)=self.find_45_degree_path(&tail,&end)?{self.add_path_to_result(&path);self.base.solved=true;return Ok(());}
            let connector=if self.last_valid_path.is_some(){self.last_valid_path_head_distance}else{self.tail_distance_along_path};
            if let Some(path)=self.last_valid_path.take(){self.add_path_to_result(&path);}
            let _start_index=self.get_nearest_index_for_distance(connector);
            self.append_original_route_slice(connector,input.borrow().route.len()-1)?;
            self.tail_distance_along_path=self.total_path_length;self.head_distance_along_path=self.total_path_length;self.base.solved=true;return Ok(());
        }
        self.move_head(self.current_step_size);
        let tail=self.get_point_at_distance(self.tail_distance_along_path);let head=self.get_point_at_distance(self.head_distance_along_path);
        let tail_index=self.get_nearest_index_for_distance(self.tail_distance_along_path);let head_index=self.get_nearest_index_for_distance(self.head_distance_along_path);
        let mut layer_change=false;let mut layer_distance=-1.0;
        for i in tail_index..head_index{let route=input.borrow();if i+1<route.route.len()&&route.route[i].borrow().z!=route.route[i+1].borrow().z{layer_change=true;layer_distance=self.path_segments[i].start_distance;break;}}
        if layer_change&&self.last_head_move_distance>self.min_step_size{self.step_back_and_reduce_step_size();return Ok(());}
        let mut jumper=false;let mut jumper_index=None;let mut jumper_distance=-1.0;
        for i in tail_index+1..=head_index{if self.jumper_pad_point_indices.contains(&i){jumper=true;jumper_index=Some(i);jumper_distance=if i>0&&i-1<self.path_segments.len(){self.path_segments[i-1].end_distance}else{self.path_segments.first().map(|s|s.start_distance).unwrap_or(0.0)};break;}}
        if jumper&&self.last_head_move_distance>self.min_step_size{self.step_back_and_reduce_step_size();return Ok(());}
        if let Some(index)=jumper_index{
            let point=point3(&input.borrow().route[index]);if let Some(path)=self.last_valid_path.take(){self.add_path_to_result(&path);}
            if self.new_route.last().is_none_or(|p|{let p=p.borrow();p.x!=point.x||p.y!=point.y}){self.new_route.push(fresh_point(point.x,point.y,point.z));}
            self.current_step_size=self.max_step_size;self.tail_distance_along_path=jumper_distance;self.head_distance_along_path=self.tail_distance_along_path;self.last_valid_path=None;self.last_valid_path_head_distance=self.tail_distance_along_path;return Ok(());
        }
        if layer_change&&layer_distance>0.0{
            let connector=if self.last_valid_path.is_some(){self.last_valid_path_head_distance}else{self.tail_distance_along_path};
            let after=self.get_nearest_index_for_distance(layer_distance)+1;let point=input.borrow().route[after].clone();let p=point3(&point);let via=fresh_via(p.x,p.y);
            if let Some(path)=self.last_valid_path.take(){self.add_path_to_result(&path);}
            let last=self.new_route.last().expect("Route leaving-layer point").clone();let leaving=fresh_point(p.x,p.y,last.borrow().z);
            if !self.are_points_equal(&last,&leaving){if let Some(path)=self.find_45_degree_path(&last,&leaving)?{self.add_path_to_result(&path);}else{self.append_original_route_slice(connector,after-1)?;}}
            self.new_vias.push(via);self.new_route.push(fresh_point(p.x,p.y,p.z));self.current_step_size=self.max_step_size;
            if let Some(index)=self.path_segments.iter().position(|s|Rc::ptr_eq(&s.start,&point)){
                self.tail_distance_along_path=self.path_segments[index].start_distance;self.head_distance_along_path=self.tail_distance_along_path;self.last_valid_path=None;self.last_valid_path_head_distance=self.tail_distance_along_path;
            }else if after<input.borrow().route.len(){
                if after==input.borrow().route.len()-1{self.base.solved=true;return Ok(());}
                if let Some(segment)=self.path_segments.iter().find(|s|Rc::ptr_eq(&s.start,&input.borrow().route[after])){self.tail_distance_along_path=segment.start_distance;self.head_distance_along_path=self.tail_distance_along_path;self.last_valid_path=None;self.last_valid_path_head_distance=self.tail_distance_along_path;}else{self.base.solved=true;}
            }else{self.base.solved=true;}
            return Ok(());
        }
        let path=self.find_45_degree_path(&tail,&head)?;
        if path.is_none()&&self.last_head_move_distance>self.min_step_size{self.step_back_and_reduce_step_size();return Ok(());}
        if path.is_none()&&self.last_valid_path.is_none(){
            let old=self.get_point_at_distance(self.tail_distance_along_path);self.tail_distance_along_path+=self.min_step_size;self.move_head(self.min_step_size);
            let index=self.get_nearest_index_for_distance(self.tail_distance_along_path);let new=input.borrow().route[index].clone();let last=input.borrow().route.last().unwrap().clone();
            if !self.are_points_equal(&old,&new)&&!self.are_points_equal(&new,&last){self.new_route.push(new);}return Ok(());
        }
        if let Some(path)=path{self.last_valid_path=Some(path);self.last_valid_path_array_identity=next_identity();self.last_valid_path_head_distance=self.head_distance_along_path;return Ok(());}
        if let Some(path)=self.last_valid_path.take(){self.add_path_to_result(&path);self.tail_distance_along_path=self.last_valid_path_head_distance;self.move_head(self.min_step_size);}
        Ok(())
    }
}
