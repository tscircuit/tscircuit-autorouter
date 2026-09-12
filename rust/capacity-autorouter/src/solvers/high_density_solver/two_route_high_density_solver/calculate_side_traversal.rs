use serde::{Serialize,Deserialize};
use crate::bindings::high_density::specialized_utils::math::{Point,Bounds,min,max};
use crate::bindings::high_density::specialized_utils::classify_point_in_bounds::BOUNDARY_COORDINATE_TOLERANCE_MM as TOL;
const EPSILON:f64=1e-9;

#[derive(Clone,Copy,Debug,Default,Serialize,Deserialize)]
pub struct SidePercentages{pub left:f64,pub top:f64,pub right:f64,pub bottom:f64}

pub fn point_to_angle(point:Point,b:Bounds)->Result<f64,String>{
    let width=b.max_x-b.min_x;let height=b.max_y-b.min_y;
    if width<EPSILON&&height<EPSILON{return Ok(0.0);}
    let perimeter=2.0*(width+height);if perimeter<EPSILON{return Ok(0.0);}
    let distance=if (point.y-b.max_y).abs()<=TOL&&point.x>=b.min_x-TOL&&point.x<=b.max_x+TOL {
        max(0.0,min(width,point.x-b.min_x))
    }else if (point.x-b.max_x).abs()<=TOL&&point.y>=b.min_y-TOL&&point.y<=b.max_y+TOL {
        width+max(0.0,min(height,b.max_y-point.y))
    }else if (point.y-b.min_y).abs()<=TOL&&point.x>=b.min_x-TOL&&point.x<=b.max_x+TOL {
        width+height+max(0.0,min(width,b.max_x-point.x))
    }else if (point.x-b.min_x).abs()<=TOL&&point.y>=b.min_y-TOL&&point.y<=b.max_y+TOL {
        width+height+width+max(0.0,min(height,point.y-b.min_y))
    }else{return Err(format!("Point ({}, {}) does not lie on the boundary defined by {}",crate::utils::js_number::js_number_to_string(point.x),crate::utils::js_number::js_number_to_string(point.y),serde_json::to_string(&b).expect("bounds")));};
    let distance=max(0.0,min(perimeter,distance));
    Ok(if perimeter>EPSILON{(distance/perimeter)*(2.0*std::f64::consts::PI)}else{0.0})
}

fn traversal_overlap(s_start:f64,s_end:f64,t_start:f64,t_end:f64,wraps:bool)->f64{
    let full=2.0*std::f64::consts::PI;let end=if s_end>full-EPSILON{full}else{s_end};
    if end<=s_start+EPSILON{return 0.0;}
    if !wraps{return max(0.0,min(end,t_end)-max(s_start,t_start));}
    let overlap1=max(0.0,min(end,full)-max(s_start,t_start));
    let overlap2=max(0.0,min(end,t_end)-max(s_start,0.0));overlap1+overlap2
}

fn side_percentages(start:f64,end:f64,b:Bounds,direction:&str)->SidePercentages{
    let w=b.max_x-b.min_x;let h=b.max_y-b.min_y;let p=2.0*(w+h);let full=2.0*std::f64::consts::PI;
    if w<EPSILON&&h<EPSILON||p<EPSILON{return SidePercentages::default();}
    let top=(w/p)*full;let right=((w+h)/p)*full;let bottom=((w+w+h)/p)*full;
    let sides=[(0.0,top,w),(top,right,h),(right,bottom,w),(bottom,full,h)];let mut values=[0.0;4];
    for (i,(s,e,len)) in sides.into_iter().enumerate(){let range=e-s;if range<EPSILON||len<EPSILON{continue;}
        let angle=if direction=="cw"{traversal_overlap(s,e,start,end,start>end+EPSILON)}else{traversal_overlap(s,e,end,start,end>start+EPSILON)};
        if angle>EPSILON{let percent=angle/range;values[i]+=max(0.0,if percent.is_finite(){percent}else{0.0});}
    }
    for value in &mut values{*value=max(0.0,min(1.0,*value));}
    SidePercentages{left:values[3],top:values[0],right:values[1],bottom:values[2]}
}
fn segment_traversal(a:Point,b:Point,bounds:Bounds,direction:&str)->Result<SidePercentages,String>{
    let start=point_to_angle(a,bounds)?;let end=point_to_angle(b,bounds)?;
    if (end-start).abs()<EPSILON{return Ok(SidePercentages::default());}
    Ok(side_percentages(start,end,bounds,direction))
}
pub fn calculate_traversal_percentages(a:Point,b:Point,c:Point,bounds:Bounds,direction:Option<&str>)->Result<SidePercentages,String>{
    let direction=direction.unwrap_or("cw");let ab=segment_traversal(a,b,bounds,direction)?;let bc=segment_traversal(b,c,bounds,direction)?;
    let clean=|a:f64,b:f64|{let v=min(1.0,a+b);if v.abs()<EPSILON{0.0}else{v}};
    Ok(SidePercentages{left:clean(ab.left,bc.left),top:clean(ab.top,bc.top),right:clean(ab.right,bc.right),bottom:clean(ab.bottom,bc.bottom)})
}
