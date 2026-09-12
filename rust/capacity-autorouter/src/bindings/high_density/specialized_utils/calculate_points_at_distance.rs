use super::math::Point;

pub fn calculate_perpendicular_points_at_distance(external:Point,center:Point,k:f64)->(Point,Point) {
    let dx=center.x-external.x;let dy=center.y-external.y;
    let magnitude=(dx*dx+dy*dy).sqrt();
    let px=-(center.y-external.y)/magnitude;let py=(center.x-external.x)/magnitude;
    let half_k=k/2.0;
    (Point{x:center.x+px*half_k,y:center.y+py*half_k},Point{x:center.x-px*half_k,y:center.y-py*half_k})
}
