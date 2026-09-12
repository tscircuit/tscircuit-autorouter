use serde::{Serialize,Deserialize};
use serde_json::Value;
use std::ops::{Deref,DerefMut};
use crate::bindings::high_density::specialized_base_solver::{BaseSolverState,SpecializedSolver};
use crate::bindings::high_density::specialized_utils::math::{SpecializedMath,min,max,point_to_segment_closest_point,segment_to_segment_min_distance};
use super::{multi_head_poly_line_intra_node_solver::{MultiHeadPolyLineIntraNodeSolver,xy},types1::*};

#[derive(Serialize,Deserialize)]
pub struct MultiHeadPolyLineIntraNodeSolver2 {
    #[serde(flatten)] pub inner:MultiHeadPolyLineIntraNodeSolver,
}
impl Deref for MultiHeadPolyLineIntraNodeSolver2 {type Target=MultiHeadPolyLineIntraNodeSolver;fn deref(&self)->&Self::Target {&self.inner}}
impl DerefMut for MultiHeadPolyLineIntraNodeSolver2 {fn deref_mut(&mut self)->&mut Self::Target {&mut self.inner}}
impl MultiHeadPolyLineIntraNodeSolver2 {
    pub fn new(params:Value)->Result<Self,String> {Self::new_with_math(params,SpecializedMath::default())}
    pub fn new_with_math(params:Value,math:SpecializedMath)->Result<Self,String> {
        let mut inner=MultiHeadPolyLineIntraNodeSolver::new_with_math(params,math)?;
        inner.variant=2;
        Ok(Self{inner})
    }
}
impl SpecializedSolver for MultiHeadPolyLineIntraNodeSolver2 {
    fn base(&self)->&BaseSolverState {&self.inner.base}
    fn base_mut(&mut self)->&mut BaseSolverState {&mut self.inner.base}
    fn get_solver_name(&self)->&'static str {"MultiHeadPolyLineIntraNodeSolver2"}
    fn _step(&mut self)->Result<(),String> {self.inner._step()}
    fn try_final_acceptance(&mut self)->Result<(),String> {self.inner.try_final_acceptance()}
}

pub fn step_optimized(solver:&mut MultiHeadPolyLineIntraNodeSolver)->Result<(),String> {
    if solver.candidates.is_empty() {
        solver.try_final_acceptance()?;
        if !solver.base.solved {solver.base.failed=true;}
        return Ok(());
    }
    let mut candidate=solver.candidates.remove(0);
    if solver.check_if_solved(&candidate) {
        solver.last_candidate=Some(candidate);
        solver.base.solved=true;
        solver.set_solved_routes();
        return Ok(());
    }
    let mut last_step_moved=false;
    let mut magnitude=0.0;
    let steps=if candidate.mag_force_applied.is_none() {1} else {10};
    for _ in 0..steps {
        let result=solver.apply_forces_to_poly_lines(&mut candidate.poly_lines);
        magnitude+=result.mag_force_applied;
        last_step_moved=result.last_step_moved;
        if !last_step_moved {break;}
    }
    candidate.mag_force_applied=Some(magnitude);
    candidate.min_gaps=solver.compute_min_gap_btw_poly_lines(&candidate.poly_lines);
    candidate.min_gaps_id=next_diagnostic_id();
    if solver.check_if_solved(&candidate) {
        if solver.has_candidate_aliases { for queued in &mut solver.candidates { if queued.diagnostic_id == candidate.diagnostic_id { *queued = candidate.clone(); } } }
        solver.last_candidate=Some(candidate);
        solver.base.solved=true;
        solver.set_solved_routes();
        return Ok(());
    }
    candidate.g=solver.compute_g(&candidate.poly_lines,&candidate);
    candidate.h=solver.compute_h(&candidate);
    candidate.f=candidate.g+candidate.h;
    if solver.has_candidate_aliases { for queued in &mut solver.candidates { if queued.diagnostic_id == candidate.diagnostic_id { *queued = candidate.clone(); } } }
    if last_step_moved {solver.insert_candidate(candidate.clone());}
    solver.last_candidate=Some(candidate);
    Ok(())
}

#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ForceResult {pub last_step_moved:bool,pub mag_force_applied:f64}

fn add_net_force(forces:&mut [Vec<Force>],line:usize,index:usize,fx:f64,fy:f64) {
    if index>0 && index<forces[line].len()+1 {
        let force=&mut forces[line][index-1];
        force.fx+=fx;
        force.fy+=fy;
    }
}

fn endpoint_force(forces:&mut [Vec<Force>],ep:&MHPoint,ep_idx:usize,other:&[&MHPoint],other_index:usize,target:usize,opposite:usize,math:SpecializedMath) {
    let closest=point_to_segment_closest_point(xy(ep),xy(other[0]),xy(other[1]));
    let dx=ep.x-closest.x;
    let dy=ep.y-closest.y;
    let sq=dx*dx+dy*dy;
    if sq<=1e-6 {return;}
    let distance=sq.sqrt();
    let magnitude=1.0*0.02*(math.exp)(-6.0*distance);
    let fx=(dx/distance)*magnitude;
    let fy=(dy/distance)*magnitude;
    add_net_force(forces,target,ep_idx,fx,fy);
    add_net_force(forces,opposite,other_index,-fx/2.0,-fy/2.0);
    add_net_force(forces,opposite,other_index+1,-fx/2.0,-fy/2.0);
}

impl MultiHeadPolyLineIntraNodeSolver {
    pub fn apply_forces_to_poly_lines(&self,lines:&mut [PolyLine])->ForceResult {
        let mut mag_force_applied=0.0;
        let mut forces:Vec<Vec<Force>>=lines.iter().map(|line|vec![Force{fx:0.0,fy:0.0};line.m_points.len()]).collect();
        let paths:Vec<Vec<&MHPoint>>=lines.iter().map(|line|std::iter::once(&line.start).chain(line.m_points.iter()).chain(std::iter::once(&line.end)).collect()).collect();
        for i in 0..lines.len() {for j in i+1..lines.len() {
            let points1=&paths[i];let points2=&paths[j];
            let vias1:Vec<_>=points1.iter().enumerate().filter(|(_,p)|p.z1!=p.z2).collect();
            let vias2:Vec<_>=points2.iter().enumerate().filter(|(_,p)|p.z1!=p.z2).collect();
            for (k,a) in points1.windows(2).enumerate() {for (l,b) in points2.windows(2).enumerate() {
                if a[0].z2==b[0].z2 {
                    let _min_distance=segment_to_segment_min_distance(xy(a[0]),xy(a[1]),xy(b[0]),xy(b[1]));
                    endpoint_force(&mut forces,a[0],k,b,l,i,j,self.math);
                    endpoint_force(&mut forces,a[1],k+1,b,l,i,j,self.math);
                    endpoint_force(&mut forces,b[0],l,a,k,j,i,self.math);
                    endpoint_force(&mut forces,b[1],l+1,a,k,j,i,self.math);
                }
            }}
            for &(index,via) in &vias1 {for (k,segment) in points2.windows(2).enumerate() {
                if via.z1==segment[0].z2 || via.z2==segment[0].z2 {
                    let closest=point_to_segment_closest_point(xy(via),xy(segment[0]),xy(segment[1]));
                    let dx=via.x-closest.x;let dy=via.y-closest.y;let sq=dx*dx+dy*dy;
                    if sq>1e-6 {
                        let distance=sq.sqrt();let mut multiplier=2.0;
                        let effective=if distance<self.via_diameter/2.0 {multiplier*=4.0;max(1e-6,distance)} else {max(1e-6,distance-self.via_diameter/2.0)};
                        let magnitude=multiplier*0.02*(self.math.exp)(-6.0*effective);
                        let fx=(dx/distance)*magnitude;let fy=(dy/distance)*magnitude;
                        add_net_force(&mut forces,i,index,fx,fy);
                        add_net_force(&mut forces,j,k,-fx/2.0,-fy/2.0);
                        add_net_force(&mut forces,j,k+1,-fx/2.0,-fy/2.0);
                    }
                }
            }}
            for &(index,via) in &vias2 {for (k,segment) in points1.windows(2).enumerate() {
                if via.z1==segment[0].z2 || via.z2==segment[0].z2 {
                    let closest=point_to_segment_closest_point(xy(via),xy(segment[0]),xy(segment[1]));
                    let dx=via.x-closest.x;let dy=via.y-closest.y;let sq=dx*dx+dy*dy;
                    if sq>1e-6 {
                        let distance=sq.sqrt();let mut multiplier=2.0;
                        let effective=if distance<self.via_diameter/2.0 {multiplier*=4.0;max(1e-6,distance)} else {max(1e-6,distance-self.via_diameter/2.0)};
                        let magnitude=multiplier*0.02*(self.math.exp)(-6.0*effective);
                        let fx=(dx/distance)*magnitude;let fy=(dy/distance)*magnitude;
                        add_net_force(&mut forces,j,index,fx,fy);
                        add_net_force(&mut forces,i,k,-fx/2.0,-fy/2.0);
                        add_net_force(&mut forces,i,k+1,-fx/2.0,-fy/2.0);
                    }
                }
            }}
            for &(a_index,a) in &vias1 {for &(b_index,b) in &vias2 {
                if [a.z1,a.z2].iter().any(|&z|z==b.z1||z==b.z2) {
                    let dx=a.x-b.x;let dy=a.y-b.y;let sq=dx*dx+dy*dy;
                    if sq>1e-6 {
                        let distance=sq.sqrt();let mut multiplier=2.0;
                        let effective=if distance<self.via_diameter {multiplier*=4.0;max(1e-6,distance)} else {max(1e-6,distance-self.via_diameter)};
                        let magnitude=multiplier*0.02*(self.math.exp)(-6.0*effective);
                        let fx=(dx/distance)*magnitude;let fy=(dy/distance)*magnitude;
                        add_net_force(&mut forces,i,a_index,fx,fy);
                        add_net_force(&mut forces,j,b_index,-fx,-fy);
                    }
                }
            }}
        }}
        for i in 0..lines.len() {
            let vias:Vec<_>=paths[i].iter().enumerate().filter(|(_,p)|p.z1!=p.z2).collect();
            if vias.len()<2 {continue;}
            for a_index in 0..vias.len() {for b_index in a_index+1..vias.len() {
                let (ai,a)=vias[a_index];let (bi,b)=vias[b_index];
                let dx=a.x-b.x;let dy=a.y-b.y;let sq=dx*dx+dy*dy;
                if sq>1e-6 {
                    let distance=sq.sqrt();let mut multiplier=2.0;
                    let effective=if distance<self.via_diameter {multiplier*=4.0;max(1e-6,distance)} else {max(1e-6,distance-self.via_diameter)};
                    let magnitude=multiplier*0.02*(self.math.exp)(-6.0*effective);
                    let fx=(dx/distance)*magnitude;let fy=(dy/distance)*magnitude;
                    add_net_force(&mut forces,i,ai,fx,fy);
                    add_net_force(&mut forces,i,bi,-fx,-fy);
                }
            }}
        }
        let mut points_moved=false;
        for (i,line) in lines.iter_mut().enumerate() {for (k,p) in line.m_points.iter_mut().enumerate() {
            let net=&forces[i][k];
            let mut fx=net.fx;let mut fy=net.fy;
            let mut x=p.x+fx;let mut y=p.y+fy;
            if p.z1!=p.z2 {
                let radius=self.via_diameter/2.0;
                let margin=self.via_diameter/2.0+self.boundary_padding;
                let min_x=self.bounds.min_x+margin;let max_x=self.bounds.max_x-margin;
                let min_y=self.bounds.min_y+margin;let max_y=self.bounds.max_y-margin;
                let d_min_x=min_x+radius-p.x;let d_max_x=p.x-(max_x-radius);
                let d_min_y=min_y+radius-p.y;let d_max_y=p.y-(max_y-radius);
                let mut bx=0.0;let mut by=0.0;
                if d_min_x>0.0 {bx=0.008*((self.math.exp)(d_min_x/(self.obstacle_margin*2.0))-1.0);}
                else if d_max_x>0.0 {bx=-0.008*((self.math.exp)(d_max_x/(self.obstacle_margin*2.0))-1.0);}
                if d_min_y>0.0 {by=0.008*((self.math.exp)(d_min_y/(self.obstacle_margin*2.0))-1.0);}
                else if d_max_y>0.0 {by=-0.008*((self.math.exp)(d_max_y/(self.obstacle_margin*2.0))-1.0);}
                fx+=bx;fy+=by;x=p.x+fx;y=p.y+fy;
            } else {
                let padding=self.trace_width/2.0+self.boundary_padding;
                x=max(self.bounds.min_x+padding,min(self.bounds.max_x-padding,x));
                y=max(self.bounds.min_y+padding,min(self.bounds.max_y-padding,y));
            }
            if fx.abs()<1e-6 && fy.abs()<1e-6 {continue;}
            mag_force_applied+=(fx*fx+fy*fy).sqrt();
            if (p.x-x).abs()>1e-6 || (p.y-y).abs()>1e-6 {p.x=x;p.y=y;points_moved=true;}
        }}
        ForceResult{last_step_moved:points_moved,mag_force_applied}
    }
}
