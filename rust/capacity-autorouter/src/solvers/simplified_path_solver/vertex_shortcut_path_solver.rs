use std::ops::{Deref,DerefMut};
use std::rc::Rc;
use serde_json::{Value,json};
use crate::bindings::trace_simplification::types::*;
use crate::utils::calculate_45_degree_paths::calculate_45_degree_paths;
use super::{single_simplified_path_solver::SingleSimplifiedPathParams,single_simplified_path_solver5_deg45::SingleSimplifiedPathSolver5};

pub struct VertexShortcutPathSolver {pub inner:SingleSimplifiedPathSolver5,pub vertex_index:usize}
impl Deref for VertexShortcutPathSolver{type Target=SingleSimplifiedPathSolver5;fn deref(&self)->&Self::Target{&self.inner}}
impl DerefMut for VertexShortcutPathSolver{fn deref_mut(&mut self)->&mut Self::Target{&mut self.inner}}
fn truthy(value:&Value)->bool{match value{Value::Null=>false,Value::Bool(v)=>*v,Value::Number(v)=>v.as_f64().is_some_and(|n|n!=0.0&&!n.is_nan()),Value::String(v)=>!v.is_empty(),_=>true}}
impl VertexShortcutPathSolver {
    pub fn new(params:SingleSimplifiedPathParams)->Self{
        let mut inner=SingleSimplifiedPathSolver5::new(params);let input=inner.params.input_route.clone();
        inner.new_route=input.borrow().route.iter().take(1).map(spread_point).collect();inner.new_vias=input.borrow().vias.iter().map(spread_point).collect();
        Self{inner,vertex_index:0}
    }
    pub fn get_solver_name(&self)->&'static str{"VertexShortcutPathSolver"}
    pub fn _step(&mut self)->Result<(),String>{
        let input=self.params.input_route.clone();let points=input.borrow().route.clone();
        if self.vertex_index>=points.len().saturating_sub(1){self.base.solved=true;return Ok(());}
        let start=points[self.vertex_index].clone();let mut end_index=self.vertex_index+1;let mut lengths=vec![0.0];
        for index in self.vertex_index..points.len()-1{
            let a=points[index].borrow();let b=points[index+1].borrow();
            let at=a.metadata.get("traceThickness");let bt=b.metadata.get("traceThickness");
            if a.z!=b.z||truthy(&a.metadata["toNextSegmentType"])||at!=bt||(at.is_some()&&at.and_then(Value::as_f64)!=Some(input.borrow().trace_thickness))||truthy(&a.metadata["insideJumperPad"])||truthy(&b.metadata["insideJumperPad"]){break;}
            lengths.push(lengths.last().copied().unwrap()+(self.params.math.hypot)(b.x-a.x,b.y-a.y));end_index=index+1;
            if truthy(&b.metadata["pcb_port_id"])||self.jumper_pad_point_indices.contains(&end_index){break;}
        }
        for index in (self.vertex_index+2..=end_index).rev(){
            let end=&points[index];let original=lengths[index-self.vertex_index];
            for path in calculate_45_degree_paths(point2(&start),point2(end)){
                let mut candidate=Vec::new();
                for(i,p)in path.iter().enumerate(){
                    if i>0&&p.x==path[i-1].x&&p.y==path[i-1].y{continue;}
                    let point=if i==0{spread_point(&start)}else if i==path.len()-1{spread_point(end)}else{fresh_via(p.x,p.y)};
                    {let mut point=point.borrow_mut();point.z=start.borrow().z;let metadata=Rc::make_mut(&mut point.metadata);metadata["z"]=json!(start.borrow().z);if let Some(width)=start.borrow().metadata.get("traceThickness"){metadata["traceThickness"]=width.clone();}else if let Some(object)=metadata.as_object_mut(){object.remove("traceThickness");}}
                    candidate.push(point);
                }
                let mut length=0.0;for pair in candidate.windows(2){let a=pair[0].borrow();let b=pair[1].borrow();length+=(self.params.math.hypot)(b.x-a.x,b.y-a.y);}
                if candidate.len()<2||length>original+1e-9||(length>=original-1e-9&&candidate.len()>=index-self.vertex_index+1)||!self.is_valid_path(&candidate)?{continue;}
                *candidate.last_mut().unwrap()=spread_point(end);self.new_route.extend(candidate.into_iter().skip(1));self.vertex_index=index;return Ok(());
            }
        }
        self.vertex_index+=1;let point=spread_point(&points[self.vertex_index]);self.new_route.push(point);Ok(())
    }
}
