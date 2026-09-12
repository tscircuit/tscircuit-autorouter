use indexmap::{IndexMap, IndexSet};
use std::rc::Rc;
use serde::{Serialize,Deserialize};
use serde_json::{Value,json};
use crate::bindings::high_density::specialized_base_solver::{BaseSolverState,SpecializedSolver};
use crate::bindings::high_density::specialized_utils::{math::*,get_bounds_from_node_with_port_points::Bounds,
    generate_color_map_from_node_with_port_points::generate_color_map_from_node_with_port_points,
    get_intra_node_crossings::get_intra_node_crossings};
use super::{types1::*,within_bounds::within_bounds,compute_via_count_variants::{PortPairsEntries,compute_via_count_variants},
    get_possible_initial_via_positions::get_possible_initial_via_positions,
    get_every_possible_ordering::get_every_possible_ordering,
    construct_middle_points_with_via_positions::construct_middle_points_with_via_positions,
    detect_multi_connection_closed_faces_without_vias::detect_multi_connection_closed_faces_without_vias};
use crate::utils::js_number::{js_number_to_string,js_to_fixed};

pub fn xy(p:&MHPoint)->Point { Point{x:p.x,y:p.y} }

#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct MultiHeadPolyLineIntraNodeSolver {
    #[serde(flatten)] pub base:BaseSolverState,
    pub node_with_port_points:Value,
    pub color_map:Value,
    pub hyper_parameters:Value,
    #[serde(skip_serializing_if="Option::is_none")] pub conn_map:Option<Rc<Value>>,
    pub candidates:Vec<Candidate>,
    pub bounds:Bounds,
    pub solved_routes:Vec<Value>,
    pub unsolved_connections:Vec<Value>,
    #[serde(rename="SEGMENTS_PER_POLYLINE")] pub segments_per_polyline:usize,
    pub cell_size:f64,
    #[serde(rename="MAX_CANDIDATES")] pub max_candidates:usize,
    pub via_diameter:f64,
    pub obstacle_margin:f64,
    pub trace_width:f64,
    pub available_z:Vec<f64>,
    pub unique_connections:usize,
    #[serde(rename="BOUNDARY_PADDING")] pub boundary_padding:f64,
    pub last_candidate:Option<Candidate>,
    pub max_via_count:usize,
    pub min_via_count:usize,
    pub phase:String,
    pub stats:Value,
    #[serde(skip)] pub math:SpecializedMath,
    #[serde(skip)] pub variant:u8,
    #[serde(skip)] pub has_candidate_aliases:bool,
}

impl MultiHeadPolyLineIntraNodeSolver {
    pub fn new(params:Value)->Result<Self,String> { Self::new_with_math(params,SpecializedMath::default()) }

    pub fn new_with_math(mut params:Value,math:SpecializedMath)->Result<Self,String> {
        let node=params["nodeWithPortPoints"].clone();
        let width=node["width"].as_f64().ok_or("Node width required")?;
        let height=node["height"].as_f64().ok_or("Node height required")?;
        let x=node["center"]["x"].as_f64().ok_or("Node center.x required")?;
        let y=node["center"]["y"].as_f64().ok_or("Node center.y required")?;
        let via_diameter=params["viaDiameter"].as_f64().unwrap_or(0.3);
        let obstacle_margin=0.1;
        let trace_width=0.15;
        let segments_per_polyline=params["hyperParameters"]["SEGMENTS_PER_POLYLINE"].as_u64().unwrap_or(3) as usize;
        let unique_connections=node["portPoints"].as_array().ok_or("Port points required")?.iter().map(|p|p["connectionName"].as_str().expect("Connection name")).collect::<IndexSet<_>>().len();
        let crossings=get_intra_node_crossings(&node);
        let min_via_count=crossings.num_same_layer_crossings*2+crossings.num_entry_exit_layer_changes;
        let area_per_via=(math.pow)(via_diameter+obstacle_margin*2.0+trace_width/2.0,2.0);
        let max_via_count=min((width*height/area_per_via).floor(),(unique_connections as f64*1.5).ceil()) as usize;
        let mut result=Self {
            base:BaseSolverState{max_iterations:10_000.0,..Default::default()},
            color_map:params.get("colorMap").filter(|v|!v.is_null()).cloned().unwrap_or_else(||generate_color_map_from_node_with_port_points(&node)),
            hyper_parameters:params.get("hyperParameters").filter(|v|!v.is_null()).cloned().unwrap_or(json!({})),
            conn_map:params.get_mut("connMap").filter(|v|!v.is_null()).map(|value|Rc::new(value.take())),candidates:vec![],
            bounds:Bounds{min_x:x-width/2.0,max_x:x+width/2.0,min_y:y-height/2.0,max_y:y+height/2.0},
            solved_routes:vec![],unsolved_connections:vec![],segments_per_polyline,cell_size:width/1024.0,
            max_candidates:50_000,via_diameter,obstacle_margin,trace_width,
            available_z:node["availableZ"].as_array().map(|a|a.iter().map(|v|v.as_f64().expect("Layer number")).collect()).unwrap_or(vec![0.0,1.0]),
            unique_connections,boundary_padding:params["hyperParameters"]["BOUNDARY_PADDING"].as_f64().unwrap_or(0.05),
            last_candidate:None,max_via_count,min_via_count,phase:"setup".into(),stats:json!({}),math,variant:1,has_candidate_aliases:false,node_with_port_points:node,
        };
        if min_via_count as f64 > segments_per_polyline as f64*(unique_connections as f64/2.0) {
            result.base.failed=true;
            result.base.error=Some(format!("Not possible to solve problem with given SEGMENTS_PER_POLYLINE ({segments_per_polyline}), atleast {min_via_count} vias are required"));
            return Ok(result);
        }
        if result.max_via_count>segments_per_polyline {result.max_via_count=segments_per_polyline;}
        if result.max_via_count<min_via_count {result.max_via_count=min_via_count;}
        Ok(result)
    }

    pub fn compute_min_gap_btw_poly_lines(&self,lines:&[PolyLine])->Vec<f64> {
        let paths:Vec<Vec<&MHPoint>>=lines.iter().map(|line|std::iter::once(&line.start).chain(line.m_points.iter()).chain(std::iter::once(&line.end)).collect()).collect();
        let mut result=vec![];
        for i in 0..lines.len() { for j in i+1..lines.len() {
            if let Some(map)=&self.conn_map {
                let name1=&lines[i].connection_name;
                let name2=&lines[j].connection_name;
                if name1==name2 {continue;}
                let first=map["idToNetMap"][name1].as_str().filter(|name|!name.is_empty());
                let second=map["idToNetMap"][name2].as_str().filter(|name|!name.is_empty());
                if let (Some(first),Some(second))=(first,second) {
                    if first==second || second==name1 {continue;}
                }
            }
            let mut min_gap:f64=1.0;
            let vias1:Vec<_>=paths[i].iter().filter(|p|p.z1!=p.z2).copied().collect();
            let vias2:Vec<_>=paths[j].iter().filter(|p|p.z1!=p.z2).copied().collect();
            for &z in &self.available_z {
                let segments1:Vec<_>=paths[i].windows(2).filter(|p|p[0].z2==z).collect();
                let segments2:Vec<_>=paths[j].windows(2).filter(|p|p[0].z2==z).collect();
                for a in &segments1 {for b in &segments2 {min_gap=min(min_gap,segment_to_segment_min_distance(xy(a[0]),xy(a[1]),xy(b[0]),xy(b[1]))-self.trace_width);}}
                for via in &vias1 {for s in &segments2 {min_gap=min(min_gap,point_to_segment_distance(xy(via),xy(s[0]),xy(s[1]))-self.trace_width/2.0-self.via_diameter/2.0);}}
                for via in &vias2 {for s in &segments1 {min_gap=min(min_gap,point_to_segment_distance(xy(via),xy(s[0]),xy(s[1]))-self.trace_width/2.0-self.via_diameter/2.0);}}
                for a in &vias1 {for b in &vias2 {min_gap=min(min_gap,distance(xy(a),xy(b))-self.via_diameter);}}
            }
            result.push(min_gap);
        }}
        result
    }

    pub fn insert_candidate(&mut self,candidate:Candidate) {
        let mut low=0isize;
        let mut high=self.candidates.len() as isize-1;
        while low<=high {
            let mid=(low+high)/2;
            if self.candidates[mid as usize].f<candidate.f {low=mid+1;} else {high=mid-1;}
        }
        self.candidates.insert(low as usize,candidate);
    }

    pub fn setup_initial_poly_lines(&mut self)->Result<(),String> {
        if self.variant==3 {return super::multi_head_poly_line_intra_node_solver3_via_possibilities_solver_integration::setup_initial_poly_lines(self);}
        let mut pairs:IndexMap<String,(MHPoint,Option<MHPoint>)>=IndexMap::new();
        for point in self.node_with_port_points["portPoints"].as_array().unwrap() {
            let name=point["connectionName"].as_str().unwrap();
            let z=point["z"].as_f64().unwrap_or(0.0);
            let metadata=point.as_object().unwrap().clone();
            let point=MHPoint{diagnostic_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(),x:point["x"].as_f64().unwrap(),y:point["y"].as_f64().unwrap(),z1:z,z2:z,metadata};
            if let Some(pair)=pairs.get_mut(name) {pair.1=Some(point);} else {pairs.insert(name.into(),(point,None));}
        }
        let pairs:PortPairsEntries=pairs.into_iter().filter_map(|(name,(start,end))|end.map(|end|(name,(start,end)))).collect();
        if pairs.is_empty() {self.base.failed=true;self.base.error=Some("No port pairs found, can't solve".into());return Ok(());}
        let counts=compute_via_count_variants(&pairs,self.segments_per_polyline,self.max_via_count,self.min_via_count);
        let possible=get_possible_initial_via_positions(&pairs,&self.bounds,&counts,self.math)?;
        let mut reordered=Vec::new();
        for variant in possible {for positions in get_every_possible_ordering(&variant.via_positions) {reordered.push((variant.via_count_variant.clone(),positions));}}
        for (counts,positions) in reordered {
            let mut lines=vec![];
            let mut used=0;
            for (index,(name,(start,end))) in pairs.iter().enumerate() {
                let count=counts[index];
                let m_points=construct_middle_points_with_via_positions(start,end,self.segments_per_polyline,count,&self.available_z,&positions[used..used+count]);
                used+=count;
                lines.push(PolyLine{diagnostic_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(), m_points_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(),connection_name:name.clone(),start:start.clone(),end:end.clone(),m_points});
            }
            if detect_multi_connection_closed_faces_without_vias(&lines,&self.bounds,self.math) {continue;}
            let min_gaps=self.compute_min_gap_btw_poly_lines(&lines);
            let mut candidate=Candidate{diagnostic_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(), poly_lines_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(), min_gaps_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(),poly_lines:lines,g:0.0,h:0.0,f:0.0,min_gaps,forces:None,via_count:counts.iter().sum(),mag_force_applied:None,has_closed_same_layer_face:None};
            candidate.h=self.compute_h(&candidate);candidate.f=candidate.h;
            if self.check_if_solved(&candidate) {self.candidates=vec![candidate];return Ok(());}
            self.candidates.push(candidate);
            if self.candidates.len()>self.max_candidates {return Ok(());}
        }
        self.candidates.sort_by(|a,b|(a.f-b.f).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
        Ok(())
    }

    pub fn compute_g(&self,_lines:&[PolyLine],candidate:&Candidate)->f64 {
        candidate.g+0.000005+candidate.via_count as f64*0.000005*100.0
    }

    pub fn compute_h(&self,candidate:&Candidate)->f64 {
        if self.variant>=2 {
            let mut score=0.0;
            for &gap in &candidate.min_gaps {if gap<0.0 {score+=self.obstacle_margin;} if gap<self.obstacle_margin {score+=self.obstacle_margin-gap;}}
            return score*0.011;
        }
        let mut total=0.0;
        if let Some(forces)=&candidate.forces {for force in forces {for map in force {for force in map.values() {total+=force.fx*force.fx+force.fy*force.fy;}}}}
        total
    }

    pub fn check_if_solved(&self,candidate:&Candidate)->bool {
        candidate.min_gaps.iter().all(|&gap|gap>=self.obstacle_margin) && candidate.poly_lines.iter().all(|line|line.m_points.iter().all(|p| {
            let padding=if p.z1!=p.z2 {self.via_diameter/2.0} else {self.trace_width/2.0};
            within_bounds(p,&self.bounds,padding+self.boundary_padding)
        }))
    }

    pub fn set_solved_routes(&mut self)->Vec<Value> {
        if !self.base.solved || self.last_candidate.is_none() {return vec![];}
        let mut routes=vec![];
        for line in &self.last_candidate.as_ref().unwrap().poly_lines {
            let mut route=vec![];let mut vias=vec![];
            for p in std::iter::once(&line.start).chain(line.m_points.iter()).chain(std::iter::once(&line.end)) {
                route.push(json!({"x":p.x,"y":p.y,"z":p.z1}));
                if p.z1!=p.z2 {vias.push(json!({"x":p.x,"y":p.y}));route.push(json!({"x":p.x,"y":p.y,"z":p.z2}));}
            }
            let mut output=json!({"connectionName":line.connection_name});
            if let Some(id)=self.node_with_port_points.get("capacityMeshNodeId") {output["regionId"]=id.clone();}
            output["traceThickness"]=json!(self.trace_width);output["viaDiameter"]=json!(self.via_diameter);output["route"]=json!(route);output["vias"]=json!(vias);
            routes.push(output);
        }
        self.solved_routes=routes;
        self.solved_routes.clone()
    }
}

impl SpecializedSolver for MultiHeadPolyLineIntraNodeSolver {
    fn base(&self)->&BaseSolverState {&self.base}
    fn base_mut(&mut self)->&mut BaseSolverState {&mut self.base}
    fn get_solver_name(&self)->&'static str {match self.variant {2=>"MultiHeadPolyLineIntraNodeSolver2",3=>"MultiHeadPolyLineIntraNodeSolver3",_=>"MultiHeadPolyLineIntraNodeSolver"}}

    fn try_final_acceptance(&mut self)->Result<(),String> {
        let Some(target)=self.hyper_parameters["MINIMUM_FINAL_ACCEPTANCE_GAP"].as_f64() else {return Ok(());};
        let Some(candidate)=&self.last_candidate else {return Ok(());};
        if candidate.min_gaps.is_empty() {return Ok(());}
        let min=candidate.min_gaps.iter().copied().fold(f64::INFINITY,min);
        if min>=target {self.base.solved=true;self.set_solved_routes();}
        Ok(())
    }

    fn _step(&mut self)->Result<(),String> {
        if self.phase=="setup" {self.setup_initial_poly_lines()?;self.phase="solving".into();return Ok(());}
        if self.variant>=2 {return super::multi_head_poly_line_intra_node_solver2_optimized::step_optimized(self);}
        if self.candidates.is_empty() {self.try_final_acceptance()?;if !self.base.solved {self.base.failed=true;self.base.error=Some("No candidates left".into());}return Ok(());}
        let candidate=self.candidates.remove(0);
        self.last_candidate=Some(candidate.clone());
        if self.check_if_solved(&candidate) {self.base.solved=true;self.set_solved_routes();return Ok(());}
        for neighbor in self.get_neighbors(&candidate) {self.insert_candidate(neighbor);}
        Ok(())
    }
}


const FORCE_MAGNITUDE:f64=0.02;
const VIA_FORCE_MULTIPLIER:f64=2.0;
const INSIDE_VIA_FORCE_MULTIPLIER:f64=4.0;
const SEGMENT_FORCE_MULTIPLIER:f64=1.0;
const FORCE_DECAY_RATE:f64=6.0;
const BOUNDARY_FORCE_STRENGTH:f64=0.008;
const EPSILON:f64=1e-6;
type Forces=Vec<Vec<IndexMap<String,Force>>>;
struct Segment {p1:Point,p2:Point,layer:f64,p1_idx:usize,p2_idx:usize}
struct Via {point:Point,layers:[f64;2],index:usize}

fn add_force_contribution(forces:&mut Forces,lines:&[PolyLine],line:usize,index:usize,source:&str,fx:f64,fy:f64) {
    if index>0 && index<lines[line].m_points.len()+1 {
        let map=&mut forces[line][index-1];
        let previous=map.get(source).cloned().unwrap_or(Force{fx:0.0,fy:0.0});
        map.insert(source.to_owned(),Force{fx:previous.fx+fx,fy:previous.fy+fy});
    }
}

fn endpoint_force(forces:&mut Forces,lines:&[PolyLine],ep:Point,index:usize,other:&Segment,target:usize,opposite:usize,source_opposite:&str,source_this:&str,math:SpecializedMath) {
    let cp=point_to_segment_closest_point(ep,other.p1,other.p2);
    let dx=ep.x-cp.x;let dy=ep.y-cp.y;let d_sq=dx*dx+dy*dy;
    if d_sq<=EPSILON {return;}
    let dist=d_sq.sqrt();
    let magnitude=SEGMENT_FORCE_MULTIPLIER*FORCE_MAGNITUDE*(math.exp)(-FORCE_DECAY_RATE*dist);
    let fx=(dx/dist)*magnitude;let fy=(dy/dist)*magnitude;
    add_force_contribution(forces,lines,target,index,source_opposite,fx,fy);
    add_force_contribution(forces,lines,opposite,other.p1_idx,source_this,-fx/2.0,-fy/2.0);
    add_force_contribution(forces,lines,opposite,other.p2_idx,source_this,-fx/2.0,-fy/2.0);
}

impl MultiHeadPolyLineIntraNodeSolver {
    pub fn get_neighbors(&self,candidate:&Candidate)->Vec<Candidate> {
        let lines=&candidate.poly_lines;
        let num_lines=lines.len();
        let mut forces:Forces=lines.iter().map(|line|line.m_points.iter().map(|_|IndexMap::new()).collect()).collect();
        for i in 0..num_lines {
            for j in i+1..num_lines {
                let line1=&lines[i];let line2=&lines[j];
                let points1:Vec<&MHPoint>=std::iter::once(&line1.start).chain(line1.m_points.iter()).chain(std::iter::once(&line1.end)).collect();
                let points2:Vec<&MHPoint>=std::iter::once(&line2.start).chain(line2.m_points.iter()).chain(std::iter::once(&line2.end)).collect();
                let mut segments1=Vec::new();let mut vias1=Vec::new();
                for k in 0..points1.len()-1 {segments1.push(Segment{p1:xy(points1[k]),p2:xy(points1[k+1]),layer:points1[k].z2,p1_idx:k,p2_idx:k+1});}
                for (k,p) in points1.iter().enumerate() {if p.z1!=p.z2 {vias1.push(Via{point:xy(p),layers:[p.z1,p.z2],index:k});}}
                let mut segments2=Vec::new();let mut vias2=Vec::new();
                for k in 0..points2.len()-1 {segments2.push(Segment{p1:xy(points2[k]),p2:xy(points2[k+1]),layer:points2[k].z2,p1_idx:k,p2_idx:k+1});}
                for (k,p) in points2.iter().enumerate() {if p.z1!=p.z2 {vias2.push(Via{point:xy(p),layers:[p.z1,p.z2],index:k});}}
                for seg1 in &segments1 {for seg2 in &segments2 {
                    if seg1.layer==seg2.layer {
                        let min_dist=segment_to_segment_min_distance(seg1.p1,seg1.p2,seg2.p1,seg2.p2);
                        if min_dist<EPSILON {continue;}
                        let center1=Point{x:(seg1.p1.x+seg1.p2.x)/2.0,y:(seg1.p1.y+seg1.p2.y)/2.0};
                        let center2=Point{x:(seg2.p1.x+seg2.p2.x)/2.0,y:(seg2.p1.y+seg2.p2.y)/2.0};
                        let dx=center1.x-center2.x;let dy=center1.y-center2.y;let d_sq=dx*dx+dy*dy;
                        if d_sq>EPSILON {
                            let dist=d_sq.sqrt();
                            let magnitude=SEGMENT_FORCE_MULTIPLIER*FORCE_MAGNITUDE*(self.math.exp)(-FORCE_DECAY_RATE*dist);
                            let _fx=(dx/dist)*magnitude;let _fy=(dy/dist)*magnitude;
                            let source2=format!("seg:{j}:{}:{}",seg2.p1_idx,seg2.p2_idx);
                            let source1=format!("seg:{i}:{}:{}",seg1.p1_idx,seg1.p2_idx);
                            endpoint_force(&mut forces,lines,seg1.p1,seg1.p1_idx,seg2,i,j,&source2,&source1,self.math);
                            endpoint_force(&mut forces,lines,seg1.p2,seg1.p2_idx,seg2,i,j,&source2,&source1,self.math);
                            endpoint_force(&mut forces,lines,seg2.p1,seg2.p1_idx,seg1,j,i,&source1,&source2,self.math);
                            endpoint_force(&mut forces,lines,seg2.p2,seg2.p2_idx,seg1,j,i,&source1,&source2,self.math);
                        }
                    }
                }}
                for via in &vias1 {for segment in &segments2 {
                    if via.layers.contains(&segment.layer) {
                        let closest=point_to_segment_closest_point(via.point,segment.p1,segment.p2);
                        let dx=via.point.x-closest.x;let dy=via.point.y-closest.y;let d_sq=dx*dx+dy*dy;
                        if d_sq>EPSILON {
                            let dist=d_sq.sqrt();let mut multiplier=VIA_FORCE_MULTIPLIER;
                            let effective_distance=if dist<self.via_diameter/2.0 {
                                multiplier*=INSIDE_VIA_FORCE_MULTIPLIER;max(EPSILON,dist)
                            } else {max(EPSILON,dist-self.via_diameter/2.0)};
                            let magnitude=multiplier*FORCE_MAGNITUDE*(self.math.exp)(-FORCE_DECAY_RATE*effective_distance);
                            let fx=(dx/dist)*magnitude;let fy=(dy/dist)*magnitude;
                            let source_segment=format!("seg:{j}:{}:{}",segment.p1_idx,segment.p2_idx);
                            add_force_contribution(&mut forces,lines,i,via.index,&source_segment,fx,fy);
                            let source_via=format!("via:{i}:{}",via.index);
                            add_force_contribution(&mut forces,lines,j,segment.p1_idx,&source_via,-fx/2.0,-fy/2.0);
                            add_force_contribution(&mut forces,lines,j,segment.p2_idx,&source_via,-fx/2.0,-fy/2.0);
                        }
                    }
                }}
                for via in &vias2 {for segment in &segments1 {
                    if via.layers.contains(&segment.layer) {
                        let closest=point_to_segment_closest_point(via.point,segment.p1,segment.p2);
                        let dx=via.point.x-closest.x;let dy=via.point.y-closest.y;let d_sq=dx*dx+dy*dy;
                        if d_sq>EPSILON {
                            let dist=d_sq.sqrt();let mut multiplier=VIA_FORCE_MULTIPLIER;
                            let effective_distance=if dist<self.via_diameter/2.0 {
                                multiplier*=INSIDE_VIA_FORCE_MULTIPLIER;max(EPSILON,dist)
                            } else {max(EPSILON,dist-self.via_diameter/2.0)};
                            let magnitude=multiplier*FORCE_MAGNITUDE*(self.math.exp)(-FORCE_DECAY_RATE*effective_distance);
                            let fx=(dx/dist)*magnitude;let fy=(dy/dist)*magnitude;
                            let source_segment=format!("seg:{i}:{}:{}",segment.p1_idx,segment.p2_idx);
                            add_force_contribution(&mut forces,lines,j,via.index,&source_segment,fx,fy);
                            let source_via=format!("via:{j}:{}",via.index);
                            add_force_contribution(&mut forces,lines,i,segment.p1_idx,&source_via,-fx/2.0,-fy/2.0);
                            add_force_contribution(&mut forces,lines,i,segment.p2_idx,&source_via,-fx/2.0,-fy/2.0);
                        }
                    }
                }}
                for via1 in &vias1 {for via2 in &vias2 {
                    let common:Vec<_>=via1.layers.iter().filter(|z|via2.layers.contains(z)).collect();
                    if !common.is_empty() {
                        let dx=via1.point.x-via2.point.x;let dy=via1.point.y-via2.point.y;let d_sq=dx*dx+dy*dy;
                        if d_sq>EPSILON {
                            let dist=d_sq.sqrt();let mut multiplier=VIA_FORCE_MULTIPLIER;
                            let effective_distance=if dist<self.via_diameter {multiplier*=INSIDE_VIA_FORCE_MULTIPLIER;max(EPSILON,dist)} else {max(EPSILON,dist-self.via_diameter)};
                            let magnitude=multiplier*FORCE_MAGNITUDE*(self.math.exp)(-FORCE_DECAY_RATE*effective_distance);
                            let fx=(dx/dist)*magnitude;let fy=(dy/dist)*magnitude;
                            let source2=format!("via:{j}:{}",via2.index);let source1=format!("via:{i}:{}",via1.index);
                            add_force_contribution(&mut forces,lines,i,via1.index,&source2,fx,fy);
                            add_force_contribution(&mut forces,lines,j,via2.index,&source1,-fx,-fy);
                        }
                    }
                }}
            }
        }
        for i in 0..num_lines {
            let line=&lines[i];
            let points:Vec<_>=std::iter::once(&line.start).chain(line.m_points.iter()).chain(std::iter::once(&line.end)).collect();
            let mut vias=Vec::new();
            for (k,p) in points.iter().enumerate() {if p.z1!=p.z2 {vias.push(Via{point:xy(p),layers:[p.z1,p.z2],index:k});}}
            if vias.len()<2 {continue;}
            for v1 in 0..vias.len() {for v2 in v1+1..vias.len() {
                let via1=&vias[v1];let via2=&vias[v2];
                let dx=via1.point.x-via2.point.x;let dy=via1.point.y-via2.point.y;let d_sq=dx*dx+dy*dy;
                if d_sq>EPSILON {
                    let dist=d_sq.sqrt();let mut multiplier=VIA_FORCE_MULTIPLIER;
                    let effective_distance=if dist<self.via_diameter {multiplier*=INSIDE_VIA_FORCE_MULTIPLIER;max(EPSILON,dist)} else {max(EPSILON,dist-self.via_diameter)};
                    let magnitude=multiplier*FORCE_MAGNITUDE*(self.math.exp)(-FORCE_DECAY_RATE*effective_distance);
                    let fx=(dx/dist)*magnitude;let fy=(dy/dist)*magnitude;
                    let source2=format!("via:{i}:{}",via2.index);let source1=format!("via:{i}:{}",via1.index);
                    add_force_contribution(&mut forces,lines,i,via1.index,&source2,fx,fy);
                    add_force_contribution(&mut forces,lines,i,via2.index,&source1,-fx,-fy);
                }
            }}
        }
        let mut new_lines=lines.clone();
        for line in &mut new_lines {
            line.diagnostic_id=next_diagnostic_id();
            line.m_points_id=next_diagnostic_id();
            for point in &mut line.m_points { point.diagnostic_id=next_diagnostic_id(); }
        }
        let mut points_moved=false;
        for i in 0..num_lines {for k in 0..new_lines[i].m_points.len() {
            let p=&mut new_lines[i].m_points[k];
            let mut net=Force{fx:0.0,fy:0.0};
            for force in forces[i][k].values() {net.fx+=force.fx;net.fy+=force.fy;}
            let is_via=p.z1!=p.z2;
            let mut new_x=p.x+net.fx;let mut new_y=p.y+net.fy;
            if is_via {
                let radius=self.via_diameter/2.0;let mut boundary_x=0.0;let mut boundary_y=0.0;
                let base_margin=self.via_diameter/2.0;let margin=base_margin+self.boundary_padding;
                let min_x=self.bounds.min_x+margin;let max_x=self.bounds.max_x-margin;
                let min_y=self.bounds.min_y+margin;let max_y=self.bounds.max_y-margin;
                let outside_min_x=min_x+radius-p.x;let outside_max_x=p.x-(max_x-radius);
                let outside_min_y=min_y+radius-p.y;let outside_max_y=p.y-(max_y-radius);
                if outside_min_x>0.0 {boundary_x=BOUNDARY_FORCE_STRENGTH*((self.math.exp)(outside_min_x/(self.obstacle_margin*2.0))-1.0);}
                else if outside_max_x>0.0 {boundary_x=-BOUNDARY_FORCE_STRENGTH*((self.math.exp)(outside_max_x/(self.obstacle_margin*2.0))-1.0);}
                if outside_min_y>0.0 {boundary_y=BOUNDARY_FORCE_STRENGTH*((self.math.exp)(outside_min_y/(self.obstacle_margin*2.0))-1.0);}
                else if outside_max_y>0.0 {boundary_y=-BOUNDARY_FORCE_STRENGTH*((self.math.exp)(outside_max_y/(self.obstacle_margin*2.0))-1.0);}
                net.fx+=boundary_x;net.fy+=boundary_y;
                new_x=p.x+net.fx;new_y=p.y+net.fy;
            } else {
                let base_padding=self.trace_width/2.0;let padding=base_padding+self.boundary_padding;
                new_x=max(self.bounds.min_x+padding,min(self.bounds.max_x-padding,new_x));
                new_y=max(self.bounds.min_y+padding,min(self.bounds.max_y-padding,new_y));
            }
            if net.fx.abs()<EPSILON && net.fy.abs()<EPSILON {continue;}
            if (p.x-new_x).abs()>EPSILON || (p.y-new_y).abs()>EPSILON {p.x=new_x;p.y=new_y;points_moved=true;}
        }}
        if !points_moved {return vec![];}
        let gaps=self.compute_min_gap_btw_poly_lines(&new_lines);
        let g=self.compute_g(&new_lines,candidate);
        let mut neighbor=Candidate{diagnostic_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(), poly_lines_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(), min_gaps_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(),poly_lines:new_lines,g,h:0.0,f:0.0,min_gaps:gaps,forces:Some(forces),via_count:candidate.via_count,mag_force_applied:None,has_closed_same_layer_face:None};
        neighbor.h=self.compute_h(&neighbor);neighbor.f=(self.math.round)(g*5.0)/5.0+neighbor.h;
        vec![neighbor]
    }
}


impl MultiHeadPolyLineIntraNodeSolver {
    pub fn visualize(&self,transparentize:&dyn Fn(&str,f64)->String)->Value {
        let mut graphics=json!({"points":[],"lines":[],"rects":[],"circles":[],"coordinateSystem":"cartesian","title":"MultiHeadPolyLineIntraNodeSolver Visualization"});
        graphics["lines"].as_array_mut().unwrap().push(json!({"points":[
            {"x":self.bounds.min_x,"y":self.bounds.min_y},{"x":self.bounds.max_x,"y":self.bounds.min_y},
            {"x":self.bounds.max_x,"y":self.bounds.max_y},{"x":self.bounds.min_x,"y":self.bounds.max_y},
            {"x":self.bounds.min_x,"y":self.bounds.min_y}],"strokeColor":"gray"}));
        let candidate=self.last_candidate.as_ref().or_else(||self.candidates.first());
        if candidate.is_some_and(|c|c.has_closed_same_layer_face.unwrap_or(false)) {
            let width=(self.bounds.max_x-self.bounds.min_x)*0.1;let height=(self.bounds.max_y-self.bounds.min_y)*0.1;
            graphics["rects"].as_array_mut().unwrap().push(json!({"center":{"x":self.bounds.max_x+width*0.6,"y":self.bounds.max_y+height*0.6},
                "width":width,"height":height,"fill":"red","label":"HAS CLOSED FACE"}));
        }
        for point in self.node_with_port_points["portPoints"].as_array().expect("Port points") {
            let name=point["connectionName"].as_str().expect("Connection name");
            graphics["points"].as_array_mut().unwrap().push(json!({"x":point["x"],"y":point["y"],
                "label":format!("{name} (Port z={})",js_number_to_string(point["z"].as_f64().unwrap_or(0.0))),
                "color":self.color_map[name].as_str().unwrap_or("blue")}));
        }
        if let Some(candidate)=candidate {
            for (line_index,line) in candidate.poly_lines.iter().enumerate() {
                let color=self.color_map[&line.connection_name].as_str().unwrap_or("purple");
                let points:Vec<_>=std::iter::once(&line.start).chain(line.m_points.iter()).chain(std::iter::once(&line.end)).collect();
                for pair in points.windows(2) {
                    let segment_layer=pair[0].z2;let is_layer_zero=segment_layer==0.0;
                    let segment_color=if is_layer_zero {color.to_owned()} else {transparentize(color,0.5)};
                    let mut graphic=json!({"points":pair,"strokeColor":segment_color,"strokeWidth":self.trace_width});
                    if !is_layer_zero {graphic["strokeDash"]=json!([0.15,0.15]);}
                    graphic["label"]=json!(format!("{} segment (z={})",line.connection_name,js_number_to_string(segment_layer)));
                    graphics["lines"].as_array_mut().unwrap().push(graphic);
                }
                for (point_index,point) in points.iter().enumerate() {
                    let is_via=point.z1!=point.z2;let point_layer=point.z1;
                    let is_middle=point_index>0 && point_index<points.len()-1;
                    let mut force_label=String::new();
                    if is_middle {
                        let middle_index=point_index-1;
                        let force_map=candidate.forces.as_ref().and_then(|forces|forces.get(line_index)).and_then(|forces|forces.get(middle_index));
                        if let Some(force_map)=force_map.filter(|map|!map.is_empty()) {
                            let mut net_x=0.0;let mut net_y=0.0;
                            for (source,force) in force_map {
                                net_x+=force.fx;net_y+=force.fy;
                                if force.fx.abs()>1e-6 || force.fy.abs()>1e-6 {
                                    let parts:Vec<_>=source.split(':').collect();
                                    let source_type=parts[0];let applying_index:usize=parts[1].parse().expect("Force source line index");
                                    let applying=&candidate.poly_lines[applying_index];
                                    let applying_color=self.color_map[&applying.connection_name].as_str().unwrap_or("gray");
                                    let end=json!({"x":point.x+force.fx*20.0,"y":point.y+force.fy*20.0});
                                    let mut source_label=applying.connection_name.clone();
                                    if source_type=="via" {
                                        let point_index:usize=parts[2].parse().expect("Force source point index");
                                        source_label.push_str(&format!(" Via {point_index}"));
                                    } else if source_type=="seg" {
                                        let p1:usize=parts[2].parse().expect("Force segment start index");let p2:usize=parts[3].parse().expect("Force segment end index");
                                        source_label.push_str(&format!(" Seg {p1}-{p2}"));
                                    }
                                    graphics["lines"].as_array_mut().unwrap().push(json!({"points":[point,end],"strokeColor":applying_color,
                                        "strokeWidth":0.02,"strokeDash":"2,2","label":format!("Force by {source_label} on {} mPoint {middle_index}",line.connection_name)}));
                                }
                            }
                            if net_x.abs()>1e-6 || net_y.abs()>1e-6 {force_label=format!("\nNet Force: ({}, {})",js_to_fixed(net_x,3),js_to_fixed(net_y,3));}
                        }
                    }
                    if is_via {
                        let label=format!("Via ({} z={} -> z={}){force_label}",line.connection_name,js_number_to_string(point.z1),js_number_to_string(point.z2));
                        graphics["circles"].as_array_mut().unwrap().push(json!({"center":point,"radius":self.via_diameter/2.0,"fill":transparentize(color,0.5),"label":label}));
                    } else if is_middle {
                        let point_color=if point_layer==0.0 {color.to_owned()} else {transparentize(color,0.5)};
                        let label=format!("mPoint ({} z={}){force_label}",line.connection_name,js_number_to_string(point_layer));
                        graphics["circles"].as_array_mut().unwrap().push(json!({"center":point,"radius":self.cell_size/8.0,"fill":point_color,"label":label}));
                    }
                }
            }
        }
        graphics
    }
}
