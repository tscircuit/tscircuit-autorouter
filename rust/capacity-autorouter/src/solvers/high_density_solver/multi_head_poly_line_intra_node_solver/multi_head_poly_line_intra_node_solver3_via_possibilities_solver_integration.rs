use serde::{Serialize,Deserialize};
use serde_json::{Value,json,Map};
use std::ops::{Deref,DerefMut};
use indexmap::IndexSet;
use crate::bindings::high_density::specialized_base_solver::{BaseSolverState,SpecializedSolver};
use crate::bindings::high_density::specialized_utils::math::{SpecializedMath,distance};
use crate::solvers::via_possibilities_solver::via_possibilities_solver2::ViaPossibilitiesSolver2;
use super::{multi_head_poly_line_intra_node_solver::{MultiHeadPolyLineIntraNodeSolver,xy},multi_head_poly_line_intra_node_solver2_optimized::MultiHeadPolyLineIntraNodeSolver2,types1::*};
use crate::utils::js_number::js_number_to_string;

#[derive(Serialize,Deserialize)]
pub struct MultiHeadPolyLineIntraNodeSolver3 {
    #[serde(flatten)] pub inner:MultiHeadPolyLineIntraNodeSolver2,
}
impl Deref for MultiHeadPolyLineIntraNodeSolver3 {type Target=MultiHeadPolyLineIntraNodeSolver2;fn deref(&self)->&Self::Target {&self.inner}}
impl DerefMut for MultiHeadPolyLineIntraNodeSolver3 {fn deref_mut(&mut self)->&mut Self::Target {&mut self.inner}}
impl MultiHeadPolyLineIntraNodeSolver3 {
    pub fn new(params:Value)->Result<Self,String> {Self::new_with_math(params,SpecializedMath::default())}
    pub fn new_with_math(params:Value,math:SpecializedMath)->Result<Self,String> {
        let mut inner=MultiHeadPolyLineIntraNodeSolver2::new_with_math(params,math)?;
        inner.variant=3;
        inner.base.max_iterations=1000.0;
        Ok(Self{inner})
    }
}
impl SpecializedSolver for MultiHeadPolyLineIntraNodeSolver3 {
    fn base(&self)->&BaseSolverState {&self.inner.base}
    fn base_mut(&mut self)->&mut BaseSolverState {&mut self.inner.base}
    fn get_solver_name(&self)->&'static str {"MultiHeadPolyLineIntraNodeSolver3"}
    fn _step(&mut self)->Result<(),String> {self.inner._step()}
    fn try_final_acceptance(&mut self)->Result<(),String> {self.inner.try_final_acceptance()}
}

pub fn hash_poly_lines(lines:&[PolyLine])->String {
    let mut hashes:Vec<_>=lines.iter().map(|line| {
        let positions:Vec<_>=line.m_points.iter().map(|p| {
            let mut x=ryu_js::Buffer::new();
            let mut y=ryu_js::Buffer::new();
            format!("{},{},{},{}",x.format_to_fixed(p.x,2),y.format_to_fixed(p.y,2),js_number_to_string(p.z1),js_number_to_string(p.z2))
        }).collect();
        format!("{}-{}",line.connection_name,positions.join(","))
    }).collect();
    hashes.sort_by(|a,b|a.encode_utf16().cmp(b.encode_utf16()));
    hashes.join("|")
}

pub fn factorial(n:usize)->f64 {
    let mut result=1.0;
    for i in 2..=n {result*=i as f64;}
    result
}

impl MultiHeadPolyLineIntraNodeSolver {
    pub fn create_initial_candidate_from_seed(&mut self,seed:f64)->Result<Option<Candidate>,String> {
        let mut via_solver=ViaPossibilitiesSolver2::new_from_borrowed_inputs(
            &self.node_with_port_points, Some(&self.color_map),
            &json!({"SHUFFLE_SEED":seed}), &json!(self.via_diameter), self.math,
        )?;
        via_solver.solve()?;
        if via_solver.base.failed || !via_solver.base.solved {
            self.base.failed=true;
            self.base.error=Some(format!("ViaPossibilitiesSolver2 failed with: {}",via_solver.base.error.as_deref().unwrap_or("null")));
            return Ok(None);
        }
        let mut poly_lines=vec![];
        let mut total_vias=0;
        for (name,path) in &via_solver.completed_paths {
            if path.len()<2 {continue;}
            let start_value=&path[0];let end_value=path.last().unwrap();
            let middle=&path[1..path.len()-1];
            let start_z=start_value.coordinates().2.expect("Start z required");
            let end_z=end_value.coordinates().2.expect("End z required");
            let start_metadata=start_value.as_object().unwrap().clone();
            let end_metadata=end_value.as_object().unwrap().clone();
            let start=MHPoint{diagnostic_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(),x:start_value.coordinates().0.unwrap(),y:start_value.coordinates().1.unwrap(),z1:start_z,z2:start_z,metadata:start_metadata};
            let end=MHPoint{diagnostic_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(),x:end_value.coordinates().0.unwrap(),y:end_value.coordinates().1.unwrap(),z1:end_z,z2:end_z,metadata:end_metadata};
            let mut points=vec![];let mut count=0;let mut last_z=start_z;let mut index=0;
            while index<middle.len() {
                let p=&middle[index];
                let next=middle.get(index+1).unwrap_or(end_value);
                let z=p.coordinates().2.unwrap();
                let is_via=index+1<middle.len() && p.coordinates().0 == next.coordinates().0 && p.coordinates().1 == next.coordinates().1 && p.coordinates().2 != next.coordinates().2;
                let z2=if is_via {next.coordinates().2.unwrap()} else {z};
                points.push(MHPoint{diagnostic_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(),x:p.coordinates().0.unwrap(),y:p.coordinates().1.unwrap(),z1:last_z,z2,metadata:Map::new()});
                if last_z!=z2 {count+=1;index+=1;last_z=z2;} else {last_z=z;}
                index+=1;
            }
            total_vias+=count;
            let mut segments=points.len()+1;
            while segments<self.segments_per_polyline {
                let full:Vec<_>=std::iter::once(&start).chain(points.iter()).chain(std::iter::once(&end)).collect();
                let mut longest=-1.0;let mut longest_index=None;
                for k in 0..full.len()-1 {
                    let a=full[k];let b=full[k+1];
                    if a.x==b.x && a.y==b.y {continue;}
                    let length=distance(xy(a),xy(b));
                    if length>longest {longest=length;longest_index=Some(k);}
                }
                let Some(k)=longest_index else {break;};
                let a=full[k];let b=full[k+1];
                let midpoint=MHPoint{diagnostic_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(),x:(a.x+b.x)/2.0,y:(a.y+b.y)/2.0,z1:a.z2,z2:a.z2,metadata:Map::new()};
                points.insert(k,midpoint);segments+=1;
            }
            poly_lines.push(PolyLine{diagnostic_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(), m_points_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(),connection_name:name.clone(),start,end,m_points:points});
        }
        if poly_lines.is_empty() {
            self.base.failed=true;self.base.error=Some("No valid polylines generated from ViaPossibilitiesSolver2.".into());return Ok(None);
        }
        let min_gaps=self.compute_min_gap_btw_poly_lines(&poly_lines);
        let mut candidate=Candidate{diagnostic_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(), poly_lines_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(), min_gaps_id: crate::solvers::high_density_solver::multi_head_poly_line_intra_node_solver::types1::next_diagnostic_id(),poly_lines,g:0.0,h:0.0,f:0.0,via_count:total_vias,min_gaps,forces:None,mag_force_applied:None,has_closed_same_layer_face:None};
        candidate.h=self.compute_h(&candidate);candidate.f=0.0+candidate.h;
        candidate.g=self.compute_g(&candidate.poly_lines,&candidate);candidate.f=candidate.g+candidate.h;
        Ok(Some(candidate))
    }
}

pub fn setup_initial_poly_lines(solver:&mut MultiHeadPolyLineIntraNodeSolver)->Result<(),String> {
    solver.candidates.clear();
    let count=factorial(solver.unique_connections).min(2000.0) as usize;
    let mut hashes=IndexSet::new();
    for seed in 0..count {
        let Some(candidate)=solver.create_initial_candidate_from_seed(seed as f64)? else {continue;};
        if !hashes.insert(hash_poly_lines(&candidate.poly_lines)) {continue;}
        solver.candidates.push(candidate);
    }
    solver.candidates.sort_by(|a,b|(a.f-b.f).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    Ok(())
}
