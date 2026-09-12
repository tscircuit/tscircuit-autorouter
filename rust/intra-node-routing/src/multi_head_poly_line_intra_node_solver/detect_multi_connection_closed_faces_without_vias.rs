use indexmap::{IndexMap,IndexSet};
use crate::specialized_utils::math::{Point,SpecializedMath};
use crate::specialized_utils::get_bounds_from_node_with_port_points::Bounds;
use crate::js_number::js_number_to_string;
use super::types1::{MHPoint,PolyLine};

const EPS:f64=1e-9;
struct Segment { start:Point,end:Point,connection_name:Option<String>,layer:f64 }
struct DcelVertex { id:usize,x:f64,y:f64,is_via:bool,connection_names:IndexSet<String>,outgoing_edges:Vec<usize> }
struct DcelHalfEdge { id:usize,origin:usize,twin:Option<usize>,next:Option<usize>,face:Option<usize>,connection_name:Option<String>,layer:f64,visited:bool }
struct DcelFace { id:usize,outer_component:Option<usize>,inner_components:Vec<usize>,is_outer_face:bool }

fn almost_equal(a:f64,b:f64)->bool { (a-b).abs()<EPS }
fn point_key(p:Point,math:SpecializedMath)->String { format!("{}:{}",js_number_to_string((math.round)(p.x/EPS)),js_number_to_string((math.round)(p.y/EPS))) }
fn cross(ax:f64,ay:f64,bx:f64,by:f64)->f64 { ax*by-ay*bx }
fn segment_intersection(p1:Point,p2:Point,q1:Point,q2:Point)->Option<Point> {
    let r=Point{x:p2.x-p1.x,y:p2.y-p1.y}; let s=Point{x:q2.x-q1.x,y:q2.y-q1.y};
    let rxs=cross(r.x,r.y,s.x,s.y); let qp=Point{x:q1.x-p1.x,y:q1.y-p1.y};
    if almost_equal(rxs,0.0) {return None;}
    let t=cross(qp.x,qp.y,s.x,s.y)/rxs; let u=cross(qp.x,qp.y,r.x,r.y)/rxs;
    if t>=-EPS && t<=1.0+EPS && u>=-EPS && u<=1.0+EPS {Some(Point{x:p1.x+t*r.x,y:p1.y+t*r.y})} else {None}
}
fn is_on_segment(p:Point,a:Point,b:Point,math:SpecializedMath)->bool {
    let d_ap=(math.hypot)(p.x-a.x,p.y-a.y);
    let d_pb=(math.hypot)(p.x-b.x,p.y-b.y);
    let d_ab=(math.hypot)(a.x-b.x,a.y-b.y);
    almost_equal(d_ap+d_pb,d_ab)
}
fn get_or_create_vertex(p:Point,name:Option<&str>,map:&mut IndexMap<String,usize>,vertices:&mut Vec<DcelVertex>,vias:&IndexMap<String,(&MHPoint,&str)>,math:SpecializedMath)->usize {
    let key=point_key(p,math);
    let id=if let Some(&id)=map.get(&key) {id} else {
        let id=vertices.len(); let is_via=vias.contains_key(&key);
        let mut vertex=DcelVertex{id,x:p.x,y:p.y,is_via,connection_names:IndexSet::new(),outgoing_edges:Vec::new()};
        if let Some((_,name))=vias.get(&key) {vertex.connection_names.insert((*name).to_owned());}
        map.insert(key,id); vertices.push(vertex); id
    };
    if let Some(name)=name.filter(|name| !name.is_empty()) {vertices[id].connection_names.insert(name.to_owned());}
    id
}

pub fn detect_multi_connection_closed_faces_without_vias(poly_lines:&[PolyLine],bounds:&Bounds,math:SpecializedMath)->bool {
    let mut all_segments=Vec::new(); let mut via_points=IndexMap::new();
    for poly_line in poly_lines {
        let path:Vec<_>=std::iter::once(&poly_line.start).chain(poly_line.m_points.iter()).chain(std::iter::once(&poly_line.end)).collect();
        for adjacent in path.windows(2) {
            let p1=adjacent[0]; let p2=adjacent[1];
            all_segments.push(Segment{start:Point{x:p1.x,y:p1.y},end:Point{x:p2.x,y:p2.y},connection_name:Some(poly_line.connection_name.clone()),layer:p1.z2});
            if p1.z1!=p1.z2 {
                let key=point_key(Point{x:p1.x,y:p1.y},math);
                via_points.entry(key).or_insert((p1,poly_line.connection_name.as_str()));
            }
        }
        let last=path.last().unwrap();
        if last.z1!=last.z2 {
            let key=point_key(Point{x:last.x,y:last.y},math);
            via_points.entry(key).or_insert((*last,poly_line.connection_name.as_str()));
        }
    }
    for (start,end) in [
        (Point{x:bounds.min_x,y:bounds.min_y},Point{x:bounds.max_x,y:bounds.min_y}),
        (Point{x:bounds.max_x,y:bounds.min_y},Point{x:bounds.max_x,y:bounds.max_y}),
        (Point{x:bounds.max_x,y:bounds.max_y},Point{x:bounds.min_x,y:bounds.max_y}),
        (Point{x:bounds.min_x,y:bounds.max_y},Point{x:bounds.min_x,y:bounds.min_y}),
    ] {all_segments.push(Segment{start,end,connection_name:None,layer:0.0});}
    let mut vertices_map=IndexMap::new(); let mut vertices=Vec::new();
    for segment in &all_segments {
        get_or_create_vertex(segment.start,segment.connection_name.as_deref(),&mut vertices_map,&mut vertices,&via_points,math);
        get_or_create_vertex(segment.end,segment.connection_name.as_deref(),&mut vertices_map,&mut vertices,&via_points,math);
    }
    let mut breakpoints:Vec<Vec<Point>>=all_segments.iter().map(|_|Vec::new()).collect();
    for i in 0..all_segments.len() {
        for j in i+1..all_segments.len() {
            if all_segments[i].layer!=all_segments[j].layer {continue;}
            let a=&all_segments[i];let b=&all_segments[j];
            if let Some(intersection)=segment_intersection(a.start,a.end,b.start,b.end) {
                get_or_create_vertex(intersection,None,&mut vertices_map,&mut vertices,&via_points,math);
                if is_on_segment(intersection,a.start,a.end,math) {breakpoints[i].push(intersection);}
                if is_on_segment(intersection,b.start,b.end,math) {breakpoints[j].push(intersection);}
            }
        }
    }
    let mut half_edges=Vec::new(); let mut edge_id_counter=0;
    for (index,segment) in all_segments.iter().enumerate() {
        let mut points:Vec<_>=std::iter::once(segment.start).chain(breakpoints[index].iter().copied()).chain(std::iter::once(segment.end)).collect();
        points.sort_by(|a,b| {
            let dx=segment.end.x-segment.start.x; let dy=segment.end.y-segment.start.y;
            let difference=if dx.abs()>dy.abs() {(a.x-segment.start.x)/dx-(b.x-segment.start.x)/dx}
                else if dy.abs()<EPS {0.0} else {(a.y-segment.start.y)/dy-(b.y-segment.start.y)/dy};
            difference.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
        });
        let mut unique=Vec::new();
        if let Some(&first)=points.first() {
            unique.push(first);
            for adjacent in points.windows(2) {
                if !almost_equal(adjacent[1].x,adjacent[0].x) || !almost_equal(adjacent[1].y,adjacent[0].y) {unique.push(adjacent[1]);}
            }
        }
        for pair in unique.windows(2) {
            let v1=get_or_create_vertex(pair[0],segment.connection_name.as_deref(),&mut vertices_map,&mut vertices,&via_points,math);
            let v2=get_or_create_vertex(pair[1],segment.connection_name.as_deref(),&mut vertices_map,&mut vertices,&via_points,math);
            if v1==v2 {continue;}
            let id1=edge_id_counter;edge_id_counter+=1;
            let id2=edge_id_counter;edge_id_counter+=1;
            half_edges.push(DcelHalfEdge{id:id1,origin:v1,twin:Some(id2),next:None,face:None,connection_name:segment.connection_name.clone(),layer:segment.layer,visited:false});
            half_edges.push(DcelHalfEdge{id:id2,origin:v2,twin:Some(id1),next:None,face:None,connection_name:segment.connection_name.clone(),layer:segment.layer,visited:false});
            vertices[v1].outgoing_edges.push(id1);vertices[v2].outgoing_edges.push(id2);
        }
    }
    for vid in 0..vertices.len() {
        let mut outgoing=std::mem::take(&mut vertices[vid].outgoing_edges);
        outgoing.sort_by(|&e1,&e2| {
            let vertex=&vertices[vid];
            let p1=&vertices[half_edges[half_edges[e1].twin.unwrap()].origin];
            let p2=&vertices[half_edges[half_edges[e2].twin.unwrap()].origin];
            let a1=(math.atan2)(p1.y-vertex.y,p1.x-vertex.x);let a2=(math.atan2)(p2.y-vertex.y,p2.x-vertex.x);
            (a1-a2).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
        });
        let count=outgoing.len();
        for i in 0..count {
            if let Some(twin)=half_edges[outgoing[i]].twin {half_edges[twin].next=Some(outgoing[(i+count-1)%count]);}
        }
        vertices[vid].outgoing_edges=outgoing;
    }
    let mut faces:Vec<DcelFace>=Vec::new();let mut face_id_counter=0;let mut outer_face:Option<usize>=None;let mut max_area=f64::NEG_INFINITY;
    for edge in 0..half_edges.len() {
        if half_edges[edge].visited {continue;}
        let face_id=face_id_counter;face_id_counter+=1;
        let face_index=faces.len();
        faces.push(DcelFace{id:face_id,outer_component:Some(edge),inner_components:Vec::new(),is_outer_face:false});
        let mut current=Some(edge);let mut face_edges=Vec::new();let mut face_vertices=Vec::new();let mut names=IndexSet::new();let mut area=0.0;
        loop {
            if current.is_none() || half_edges[current.unwrap()].visited {
                eprintln!("Face traversal encountered visited edge or null, breaking loop. {face_id}");
                face_edges.clear();break;
            }
            let current_id=current.unwrap();
            half_edges[current_id].visited=true;half_edges[current_id].face=Some(face_index);
            face_edges.push(current_id);face_vertices.push(half_edges[current_id].origin);
            if let Some(name)=&half_edges[current_id].connection_name {names.insert(name.clone());}
            let p1=&vertices[half_edges[current_id].origin];
            let p2=&vertices[half_edges[half_edges[current_id].twin.unwrap()].origin];
            area+=p1.x*p2.y-p2.x*p1.y;
            current=half_edges[current_id].next;
            if current==Some(edge) || current.is_none() {break;}
        }
        if current!=Some(edge) {
            eprintln!("Face {face_id} did not close properly.");
            faces.pop();face_id_counter-=1;continue;
        }
        area=0.5*area.abs();
        if area>max_area {
            max_area=area;
            if let Some(previous)=outer_face {faces[previous].is_outer_face=false;}
            outer_face=Some(face_index);faces[face_index].is_outer_face=true;
        }
        if !faces[face_index].is_outer_face && !face_edges.is_empty() && names.len()>1 {
            let mut via_found=false;
            for id in face_vertices {if vertices[id].is_via {via_found=true;break;}}
            if !via_found {return true;}
        }
    }
    false
}
