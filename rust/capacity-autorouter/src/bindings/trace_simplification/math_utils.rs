use crate::bindings::trace_simplification::types::{Point2, Bounds, Math};
use crate::bindings::high_density::specialized_utils::math as source;
pub use source::{min, max};
fn point(p: Point2) -> source::Point { source::Point { x:p.x,y:p.y } }
pub fn do_segments_intersect(a:Point2,b:Point2,c:Point2,d:Point2)->bool { source::do_segments_intersect(point(a),point(b),point(c),point(d)) }
pub fn get_segment_intersection(a:Point2,b:Point2,c:Point2,d:Point2)->Option<Point2> { source::get_segment_intersection(point(a),point(b),point(c),point(d)).map(|p|Point2{x:p.x,y:p.y}) }
pub fn point_to_segment_distance(p:Point2,a:Point2,b:Point2)->f64 { source::point_to_segment_distance(point(p),point(a),point(b)) }
pub fn segment_to_bounds_min_distance(a:Point2,b:Point2,bounds:&Bounds)->f64 {
    use math_utils as drc;
    drc::segment_to_bounds_min_distance(&drc::Point{x:a.x,y:a.y},&drc::Point{x:b.x,y:b.y},&drc::Bounds{min_x:bounds.min_x,min_y:bounds.min_y,max_x:bounds.max_x,max_y:bounds.max_y})
}
pub fn segment_to_box_min_distance(a:Point2,b:Point2,center:Point2,width:f64,height:f64)->f64 {
    let half_width=width/2.0; let half_height=height/2.0;
    segment_to_bounds_min_distance(a,b,&Bounds{min_x:center.x-half_width,max_x:center.x+half_width,min_y:center.y-half_height,max_y:center.y+half_height})
}
pub fn compute_gap_between_boxes(a:Point2,aw:f64,ah:f64,b:Point2,bw:f64,bh:f64,math:Math)->f64 {
    let a_min_x=a.x-aw/2.0; let a_max_x=a.x+aw/2.0; let a_min_y=a.y-ah/2.0; let a_max_y=a.y+ah/2.0;
    let b_min_x=b.x-bw/2.0; let b_max_x=b.x+bw/2.0; let b_min_y=b.y-bh/2.0; let b_max_y=b.y+bh/2.0;
    let dx=max(max(a_min_x-b_max_x,b_min_x-a_max_x),0.0);
    let dy=max(max(a_min_y-b_max_y,b_min_y-a_max_y),0.0);
    (math.hypot)(dx,dy)
}
