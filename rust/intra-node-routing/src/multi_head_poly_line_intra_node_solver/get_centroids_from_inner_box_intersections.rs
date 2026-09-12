use indexmap::{IndexMap, IndexSet};
use serde::{Serialize, Deserialize};
use crate::specialized_utils::math::{Point, SpecializedMath};
use crate::specialized_utils::get_bounds_from_node_with_port_points::Bounds;
use crate::js_number::js_number_to_string;

const EPS: f64 = 1e-9;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment { pub start: Point, pub end: Point, #[serde(skip_serializing_if = "Option::is_none")] pub connection_name: Option<String> }

pub fn almost_equal(a:f64,b:f64,eps:f64)->bool { (a-b).abs() < eps }
pub fn point_key(p:Point,eps:f64,math:SpecializedMath)->String {
    format!("{}:{}",js_number_to_string((math.round)(p.x/eps)),js_number_to_string((math.round)(p.y/eps)))
}
pub fn cross(ax:f64,ay:f64,bx:f64,by:f64)->f64 { ax*by-ay*bx }

pub fn segment_intersection(p:Point,p2:Point,q:Point,q2:Point)->Option<Point> {
    let r=Point{x:p2.x-p.x,y:p2.y-p.y}; let s=Point{x:q2.x-q.x,y:q2.y-q.y};
    let denominator=cross(r.x,r.y,s.x,s.y);
    if almost_equal(denominator,0.0,EPS) { return None; }
    let qp=Point{x:q.x-p.x,y:q.y-p.y};
    let t=cross(qp.x,qp.y,s.x,s.y)/denominator;
    let u=cross(qp.x,qp.y,r.x,r.y)/denominator;
    if t < -EPS || t > 1.0+EPS || u < -EPS || u > 1.0+EPS { return None; }
    Some(Point{x:p.x+t*r.x,y:p.y+t*r.y})
}

pub fn polygon_area(points:&[Point])->f64 {
    let mut area=0.0;
    for i in 0..points.len() {
        let j=(i+1)%points.len();
        area+=points[i].x*points[j].y-points[j].x*points[i].y;
    }
    0.5*area
}

pub fn polygon_centroid(points:&[Point])->Option<Point> {
    let mut area=0.0; let mut cx=0.0; let mut cy=0.0;
    for i in 0..points.len() {
        let j=(i+1)%points.len();
        let product=points[i].x*points[j].y-points[j].x*points[i].y;
        area+=product;
        cx+=(points[i].x+points[j].x)*product;
        cy+=(points[i].y+points[j].y)*product;
    }
    area*=0.5;
    if almost_equal(area,0.0,EPS) { return None; }
    cx/=6.0*area; cy/=6.0*area;
    Some(Point{x:cx,y:cy})
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vertex { pub x:f64,pub y:f64,pub out:Vec<usize>,pub connection_names:IndexSet<String> }
impl Vertex {
    pub fn new(x:f64,y:f64)->Self { Self{x,y,out:Vec::new(),connection_names:IndexSet::new()} }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HalfEdge { pub orig:usize,pub dest:usize,pub twin:Option<usize>,pub next:Option<usize>,pub visited:bool }
impl HalfEdge {
    pub fn new(orig:usize,dest:usize)->Self { Self{orig,dest,twin:None,next:None,visited:false} }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceVertex { pub x:f64,pub y:f64,#[serde(skip_serializing_if = "Option::is_none")] pub connection_names:Option<IndexSet<String>> }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Face { pub vertices:Vec<FaceVertex>,pub centroid:Point }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CentroidResult { pub centroids:Vec<Point>,pub faces:Vec<Face>,pub all_vertices:Vec<Vertex> }

fn get_vertex_id(p:Point,ids:&mut IndexMap<String,usize>,vertices:&mut Vec<Vertex>,math:SpecializedMath)->usize {
    let key=point_key(p,EPS,math);
    if let Some(&id)=ids.get(&key) { return id; }
    let id=vertices.len();
    ids.insert(key,id);
    vertices.push(Vertex::new(p.x,p.y));
    id
}

pub fn get_centroids_from_inner_box_intersections(rectangle:&Bounds,user_segments:&[Segment],math:SpecializedMath)->CentroidResult {
    let mut segments=user_segments.to_vec();
    for (start,end) in [
        (Point{x:rectangle.min_x,y:rectangle.min_y},Point{x:rectangle.max_x,y:rectangle.min_y}),
        (Point{x:rectangle.max_x,y:rectangle.min_y},Point{x:rectangle.max_x,y:rectangle.max_y}),
        (Point{x:rectangle.max_x,y:rectangle.max_y},Point{x:rectangle.min_x,y:rectangle.max_y}),
        (Point{x:rectangle.min_x,y:rectangle.max_y},Point{x:rectangle.min_x,y:rectangle.min_y}),
    ] { segments.push(Segment{start,end,connection_name:None}); }
    let mut break_map:Vec<Vec<Point>>=segments.iter().map(|_|Vec::new()).collect();
    for (i,segment) in segments.iter().enumerate() { break_map[i].extend([segment.start,segment.end]); }
    for i in 0..segments.len() {
        for j in i+1..segments.len() {
            if let Some(p)=segment_intersection(segments[i].start,segments[i].end,segments[j].start,segments[j].end) {
                break_map[i].push(p); break_map[j].push(p);
            }
        }
    }
    let mut vertex_ids=IndexMap::new(); let mut vertices=Vec::new(); let mut undirected=Vec::new();
    for (i,segment) in segments.iter().enumerate() {
        let mut list=break_map[i].clone();
        list.sort_by(|p1,p2| {
            let dx=segment.end.x-segment.start.x; let dy=segment.end.y-segment.start.y;
            let t1=if almost_equal(dx.abs(),0.0,EPS) {(p1.y-segment.start.y)/dy} else {(p1.x-segment.start.x)/dx};
            let t2=if almost_equal(dx.abs(),0.0,EPS) {(p2.y-segment.start.y)/dy} else {(p2.x-segment.start.x)/dx};
            (t1-t2).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
        });
        for pair in list.windows(2) {
            let v1=get_vertex_id(pair[0],&mut vertex_ids,&mut vertices,math);
            let v2=get_vertex_id(pair[1],&mut vertex_ids,&mut vertices,math);
            if v1!=v2 {
                undirected.push((v1,v2));
                if let Some(name)=segment.connection_name.as_ref().filter(|name| !name.is_empty()) {
                    vertices[v1].connection_names.insert(name.clone()); vertices[v2].connection_names.insert(name.clone());
                }
            }
        }
    }
    let mut half_edges=Vec::new();
    for (v1,v2) in undirected {
        let mut he1=HalfEdge::new(v1,v2); let mut he2=HalfEdge::new(v2,v1);
        he1.twin=Some(half_edges.len()+1); he2.twin=Some(half_edges.len());
        let id=half_edges.len(); half_edges.extend([he1,he2]);
        vertices[v1].out.push(id); vertices[v2].out.push(id+1);
    }
    for vid in 0..vertices.len() {
        let mut outgoing=std::mem::take(&mut vertices[vid].out);
        outgoing.sort_by(|&e1,&e2| {
            let v=&vertices[vid]; let d1=&vertices[half_edges[e1].dest]; let d2=&vertices[half_edges[e2].dest];
            let a1=(math.atan2)(d1.y-v.y,d1.x-v.x); let a2=(math.atan2)(d2.y-v.y,d2.x-v.x);
            (a1-a2).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
        });
        let m=outgoing.len();
        for i in 0..m {
            if let Some(twin)=half_edges[outgoing[i]].twin { half_edges[twin].next=Some(outgoing[(i+m-1)%m]); }
        }
        vertices[vid].out=outgoing;
    }
    let mut centroids=Vec::new(); let mut faces=Vec::new();
    for h in 0..half_edges.len() {
        if half_edges[h].visited {continue;}
        let mut walk=Some(h); let mut polygon=Vec::new(); let mut face_edges=Vec::new();
        loop {
            let Some(edge)=walk else {break;};
            half_edges[edge].visited=true;
            polygon.push(half_edges[edge].orig); face_edges.push(edge); walk=half_edges[edge].next;
            if walk.is_none() || walk==Some(h) || half_edges[walk.unwrap()].visited {break;}
        }
        if polygon.len()<3 {continue;}
        let points:Vec<_>=polygon.iter().map(|&id|Point{x:vertices[id].x,y:vertices[id].y}).collect();
        if polygon_area(&points)>EPS {
            if let Some(centroid)=polygon_centroid(&points) {
                centroids.push(centroid);
                faces.push(Face{vertices:polygon.iter().map(|&id| {
                    let v=&vertices[id];
                    FaceVertex{x:v.x,y:v.y,connection_names:if v.connection_names.is_empty(){None}else{Some(v.connection_names.clone())}}
                }).collect(),centroid});
            }
        }
    }
    CentroidResult{centroids,faces,all_vertices:vertices}
}
