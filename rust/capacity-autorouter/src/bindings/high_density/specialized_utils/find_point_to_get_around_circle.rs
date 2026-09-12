use serde::{Serialize,Deserialize};
use super::math::{Point,distance,min};

#[derive(Clone,Copy,Debug,Serialize,Deserialize)]
pub struct Circle {pub center:Point,pub radius:f64}
#[derive(Clone,Copy,Debug,Serialize,Deserialize)]
pub struct AroundCircle {#[serde(rename="B")] pub b:Point,#[serde(rename="D")] pub d:Point,#[serde(rename="E")] pub e:Point}

pub fn find_point_to_get_around_circle(a:Point,c:Point,q:Circle)->AroundCircle {
    let b=compute_tangent_point(c,a,q.center,q.radius);
    let d=compute_tangent_point(a,c,q.center,q.radius);
    let dist_bc=distance(b,c);let dist_ad=distance(a,d);
    let threshold=1e-6;let mut e;
    if !(dist_bc>threshold)||!(dist_ad>threshold) {
        let mid=Point{x:(a.x+c.x)/2.0,y:(a.y+c.y)/2.0};
        let dist=distance(mid,q.center);
        if dist<q.radius*1.1 {
            let dir=Point{x:(mid.x-q.center.x)/dist,y:(mid.y-q.center.y)/dist};
            e=Point{x:q.center.x+dir.x*q.radius*1.2,y:q.center.y+dir.y*q.radius*1.2};
        } else {e=mid;}
    } else {
        e=Point{x:(b.x+d.x)/2.0,y:(b.y+d.y)/2.0};
        let be=distance(b,e);let de=distance(d,e);
        if (be-de).abs()>min(be,de)*0.5 {
            let ab=distance(a,b);let cd=distance(c,d);let total=ab+cd;
            if total>threshold {let wb=cd/total;let wd=ab/total;e=Point{x:b.x*wb+d.x*wd,y:b.y*wb+d.y*wd};}
        }
        let dist=distance(e,q.center);
        if dist<q.radius*1.05 {
            let dir=Point{x:(e.x-q.center.x)/dist,y:(e.y-q.center.y)/dist};
            e=Point{x:q.center.x+dir.x*q.radius*1.2,y:q.center.y+dir.y*q.radius*1.2};
        }
    }
    AroundCircle{b,d,e}
}

fn compute_tangent_point(observation:Point,reference:Point,center:Point,radius:f64)->Point {
    let cq=[center.x-observation.x,center.y-observation.y];let length=(cq[0]*cq[0]+cq[1]*cq[1]).sqrt();
    if length<=radius {
        if length<1e-8 {
            let rv=[reference.x-observation.x,reference.y-observation.y];let rl=(rv[0]*rv[0]+rv[1]*rv[1]).sqrt();
            if rl<1e-8{return Point{x:center.x+radius,y:center.y};}
            return Point{x:center.x+(rv[0]/rl)*radius,y:center.y+(rv[1]/rl)*radius};
        }
        let unit=[cq[0]/length,cq[1]/length];
        return Point{x:center.x-unit[0]*radius,y:center.y-unit[1]*radius};
    }
    let cr=[reference.x-observation.x,reference.y-observation.y];let d=(length*length-radius*radius).sqrt();
    let unit=[cq[0]/length,cq[1]/length];let p1=[-unit[1],unit[0]];let p2=[unit[1],-unit[0]];
    let dot1=cr[0]*p1[0]+cr[1]*p1[1];let dot2=cr[0]*p2[0]+cr[1]*p2[1];let perp=if dot1>dot2{p1}else{p2};
    let sin=radius/length;let cos=d/length;let to=[unit[0]*cos+perp[0]*sin,unit[1]*cos+perp[1]*sin];
    Point{x:observation.x+d*to[0],y:observation.y+d*to[1]}
}
