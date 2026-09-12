use crate::specialized_utils::math::{Point,min,max};

pub fn find_circle_line_intersections(circle:Point,r:f64,p1:Point,p2:Point)->Vec<Point> {
    let cx=circle.x;let cy=circle.y;let x1=p1.x;let y1=p1.y;let x2=p2.x;let y2=p2.y;
    if (x2-x1).abs()<0.001 {
        let x=x1;let aa=r*r-(x-cx)*(x-cx);
        if aa<0.0{return vec![];}
        if aa.abs()<0.001 {let y=cy;return if y>=min(y1,y2)&&y<=max(y1,y2){vec![Point{x,y}]}else{vec![]};}
        let y_1=cy+aa.sqrt();let y_2=cy-aa.sqrt();let mut points=vec![];
        if y_1>=min(y1,y2)&&y_1<=max(y1,y2){points.push(Point{x,y:y_1});}
        if y_2>=min(y1,y2)&&y_2<=max(y1,y2){points.push(Point{x,y:y_2});}
        return points;
    }
    let m=(y2-y1)/(x2-x1);let b=y1-m*x1;let aa=1.0+m*m;let bb=2.0*(m*b-m*cy-cx);let cc=cx*cx+(b-cy)*(b-cy)-r*r;
    let discriminant=bb*bb-4.0*aa*cc;
    if discriminant<0.0{return vec![];}
    let within=|x:f64,y:f64|x>=min(x1,x2)&&x<=max(x1,x2)&&y>=min(y1,y2)&&y<=max(y1,y2);
    if discriminant.abs()<0.001{let x=-bb/(2.0*aa);let y=m*x+b;return if within(x,y){vec![Point{x,y}]}else{vec![]};}
    let xx1=(-bb+discriminant.sqrt())/(2.0*aa);let xx2=(-bb-discriminant.sqrt())/(2.0*aa);let yy1=m*xx1+b;let yy2=m*xx2+b;
    let mut points=vec![];if within(xx1,yy1){points.push(Point{x:xx1,y:yy1});}if within(xx2,yy2){points.push(Point{x:xx2,y:yy2});}points
}
