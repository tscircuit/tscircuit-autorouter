use std::rc::Rc;
use indexmap::{IndexMap, IndexSet};
use serde_json::{Value,json};
use crate::types::*;
use crate::math_utils::*;
use crate::data_structures::high_density_route_spatial_index::{HighDensityRouteSpatialIndex, RouteConflict, RouteClearanceIndex};
use crate::data_structures::obstacle_tree::ObstacleSpatialHashIndex;
use crate::useless_via_removal_solver::{route_section::RouteSection,break_route_into_sections::break_route_into_sections,can_section_move_to_layer::can_section_move_to_layer};
use crate::utils::polygon_containment::does_segment_cross_polygon_boundary;
use intra_node_routing::{flatbush::Flatbush,js_number::js_number_to_string,specialized_base_solver::{BaseSolverState,SpecializedSolver}};

const EPSILON:f64=1e-6;
const MAX_MULTI_CROSSING_SELECTIONS:usize=4;

pub struct CrossingViaReductionSolverInput {
    pub input_hd_routes:Vec<RouteRef>, pub other_hd_routes:Vec<RouteRef>, pub obstacles:Vec<ObstacleRef>,
    pub conn_map:Rc<ConnectivityMap>,pub layer_count:f64,pub outline:Option<Vec<Point2>>,
    pub trace_margin:f64,pub obstacle_margin:f64,pub math:Math,
}
#[derive(Clone,Copy,PartialEq,Eq,PartialOrd,Ord,Hash)]
pub enum TransitionSide { Start,End }
#[derive(Clone)]
pub struct SectionSplit {pub prefix:Vec<PointRef>,pub suffix:Vec<PointRef>,pub point:PointRef}
#[derive(Clone)]
pub struct TransitionUpdate {pub route_index:usize,pub route:RouteRef,pub relocated_vias:Vec<Point2>}
#[derive(Clone)]
pub struct CrossingReductionCandidate {pub detour_route_index:usize,pub detour_route:RouteRef,pub transition_updates:Vec<TransitionUpdate>}
#[derive(Clone)]
pub struct IndexedTransitionSegment {pub route_index:usize,pub section_index:usize,pub side:TransitionSide,pub adjacent_z:f64,pub start:PointRef,pub end:PointRef,pub distance_from_section_start:f64}
#[derive(Clone)]
pub struct IndexedCrossingGroup {pub transition_route_index:usize,pub transition_section_index:usize,pub side:TransitionSide,pub crossing_distances:Vec<f64>}
struct TransitionSegmentIndex {index:Flatbush,segments:Vec<IndexedTransitionSegment>}
pub struct BaseClearanceIndexes {pub mutable_routes:HighDensityRouteSpatialIndex,pub immutable_routes:Option<HighDensityRouteSpatialIndex>}
struct CandidateClearanceIndex<'a> {base:&'a BaseClearanceIndexes,pair:HighDensityRouteSpatialIndex,ignored:&'a IndexSet<String>,original:&'a IndexSet<String>}
struct StaticGeometryOnlyClearanceIndex;

pub fn get_segment_key(start: &Point, end: &Point) -> String {
    let start_key = format!("{}:{}:{}", js_number_to_string(start.x), js_number_to_string(start.y), js_number_to_string(start.z));
    let end_key = format!("{}:{}:{}", js_number_to_string(end.x), js_number_to_string(end.y), js_number_to_string(end.z));
    if start_key < end_key {
        format!("{start_key}|{end_key}")
    } else {
        format!("{end_key}|{start_key}")
    }
}

pub fn get_route_segment_keys(route: &RouteRef) -> IndexSet<String> {
    let route = route.borrow();
    let mut keys = IndexSet::new();
    for pair in route.route.windows(2) {
        let start = point3(&pair[0]);
        let end = point3(&pair[1]);
        if start.z == end.z { keys.insert(get_segment_key(&start, &end)); }
    }
    keys
}

pub fn remove_consecutive_duplicate_points(points: Vec<PointRef>) -> Vec<PointRef> {
    points.iter().enumerate().filter(|(index, point)| {
        if *index == 0 { return true; }
        let point = point.borrow();
        let previous = points[*index - 1].borrow();
        point.x != previous.x || point.y != previous.y || point.z != previous.z
    }).map(|(_, point)| point.clone()).collect()
}

pub fn recompute_vias(points: &[PointRef]) -> Result<Vec<PointRef>, String> {
    let mut vias = Vec::new();
    let mut seen_locations = IndexSet::new();
    for (index, pair) in points.windows(2).enumerate() {
        let previous = pair[0].borrow();
        let point = pair[1].borrow();
        if previous.z == point.z { continue; }
        if previous.metadata["toNextSegmentType"] == "through_obstacle" { continue; }
        if previous.x != point.x || previous.y != point.y {
            return Err(format!("CrossingViaReductionSolver found a layer transition without a via at route point {}", index + 1));
        }
        let key = format!("{}:{}", js_number_to_string(point.x), js_number_to_string(point.y));
        if seen_locations.insert(key) { vias.push(fresh_via(point.x, point.y)); }
    }
    Ok(vias)
}

pub fn get_route_ids(route: &RouteRef) -> Vec<String> {
    let route = route.borrow();
    let mut ids = vec![route.connection_name.clone()];
    if let Some(root) = route.root_connection_name.as_ref().filter(|root| !root.is_empty()) {
        ids.push(root.clone());
    }
    ids
}

pub fn routes_are_same_net(first: &RouteRef, second: &RouteRef, conn: &ConnectivityMap) -> bool {
    let first = first.borrow();
    let second = second.borrow();
    let first_ids = [Some(first.connection_name.as_str()), first.root_connection_name.as_deref().filter(|root| !root.is_empty())];
    let second_ids = [Some(second.connection_name.as_str()), second.root_connection_name.as_deref().filter(|root| !root.is_empty())];
    first_ids.into_iter().flatten().any(|first| second_ids.into_iter().flatten().any(|second| {
        first == second || conn.are_ids_connected(first, second)
    }))
}

pub fn obstacle_is_same_net(obstacle: &ObstacleRef, route: &RouteRef, conn: &ConnectivityMap) -> bool {
    let route = route.borrow();
    let ids = [Some(route.connection_name.as_str()), route.root_connection_name.as_deref().filter(|root| !root.is_empty())];
    obstacle.borrow().connected_to.iter().any(|connected| ids.into_iter().flatten().any(|route| {
        connected == route || conn.are_ids_connected(connected, route)
    }))
}

pub fn get_section_length(points: &[PointRef], math: Math) -> f64 {
    let mut length = 0.0;
    for pair in points.windows(2) {
        let start = pair[0].borrow();
        let end = pair[1].borrow();
        length += (math.hypot)(end.x - start.x, end.y - start.y);
    }
    length
}

pub fn split_section_at_distance(points: &[PointRef], distance: f64, math: Math) -> Option<SectionSplit> {
    let length = get_section_length(points, math);
    if distance <= EPSILON || distance >= length - EPSILON { return None; }
    let mut traversed = 0.0;
    for index in 1..points.len() {
        let start = points[index - 1].borrow();
        let end = points[index].borrow();
        let segment_length = (math.hypot)(end.x - start.x, end.y - start.y);
        if traversed + segment_length < distance - EPSILON {
            traversed += segment_length;
            continue;
        }
        let distance_on_segment = distance - traversed;
        if distance_on_segment <= EPSILON {
            return Some(SectionSplit {
                prefix: points[..index].iter().map(spread_point).collect(),
                suffix: points[index - 1..].iter().map(spread_point).collect(),
                point: spread_point(&points[index - 1]),
            });
        }
        if segment_length - distance_on_segment <= EPSILON {
            return Some(SectionSplit {
                prefix: points[..index + 1].iter().map(spread_point).collect(),
                suffix: points[index..].iter().map(spread_point).collect(),
                point: spread_point(&points[index]),
            });
        }
        let ratio = distance_on_segment / segment_length;
        let point = fresh_point(start.x + (end.x - start.x) * ratio, start.y + (end.y - start.y) * ratio, start.z);
        return Some(SectionSplit {
            prefix: points[..index].iter().chain(std::iter::once(&point)).map(spread_point).collect(),
            suffix: std::iter::once(&point).chain(points[index..].iter()).map(spread_point).collect(),
            point,
        });
    }
    None
}

pub fn get_interior_intersection_distance(a: &PointRef, b: &PointRef, c: &PointRef, d: &PointRef, math: Math) -> Option<f64> {
    let a = point2(a);
    let b = point2(b);
    let c = point2(c);
    let d = point2(d);
    let intersection = get_segment_intersection(a, b, c, d)?;
    let from_transition_start = (math.hypot)(intersection.x - a.x, intersection.y - a.y);
    let from_transition_end = (math.hypot)(intersection.x - b.x, intersection.y - b.y);
    let from_detour_start = (math.hypot)(intersection.x - c.x, intersection.y - c.y);
    let from_detour_end = (math.hypot)(intersection.x - d.x, intersection.y - d.y);
    if min(min(min(from_transition_start, from_transition_end), from_detour_start), from_detour_end) <= EPSILON {
        None
    } else {
        Some(from_transition_start)
    }
}

pub fn section_has_protected_geometry(section: &RouteSection) -> bool {
    section.points.iter().any(|point| {
        let point = point.borrow();
        point.metadata["insideJumperPad"].as_bool() == Some(true)
            || point.metadata["toNextSegmentType"].as_str().is_some_and(|kind| !kind.is_empty())
    })
}

pub fn get_transition_adjacent_z(sections: &[RouteSection], index: usize, side: TransitionSide) -> Option<f64> {
    let section = &sections[index];
    let adjacent = if side == TransitionSide::Start {
        index.checked_sub(1).and_then(|index| sections.get(index))
    } else { sections.get(index + 1) }?;
    let (point, adjacent_point) = if side == TransitionSide::Start {
        (section.points.first().expect("Transition section has no start point"), adjacent.points.last().expect("Adjacent section has no end point"))
    } else { (section.points.last().expect("Transition section has no end point"), adjacent.points.first().expect("Adjacent section has no start point")) };
    let point = point.borrow();
    let adjacent_point = adjacent_point.borrow();
    if point.x != adjacent_point.x || point.y != adjacent_point.y { None } else { Some(adjacent.z) }
}

pub fn has_transition_on_side(sections: &[RouteSection], index: usize, z: f64, side: TransitionSide) -> bool {
    get_transition_adjacent_z(sections, index, side) == Some(z)
}

impl RouteClearanceIndex for StaticGeometryOnlyClearanceIndex{
    fn get_conflicting_routes_for_segment(&self,_:&Point,_:&Point,_:f64)->Vec<RouteConflict>{Vec::new()}
    fn get_conflicting_routes_near_point(&self,_:&Point,_:f64)->Vec<RouteConflict>{Vec::new()}
}
impl RouteClearanceIndex for CandidateClearanceIndex<'_>{
    fn get_conflicting_routes_for_segment(&self,a:&Point,b:&Point,margin:f64)->Vec<RouteConflict>{
        let unchanged=self.original.contains(&get_segment_key(a,b));let mut result=Vec::new();if !unchanged{result.extend(self.base.mutable_routes.get_conflicting_routes_for_segment(a,b,margin).into_iter().filter(|c|!self.ignored.contains(&c.conflicting_route.borrow().connection_name)));if let Some(index)=&self.base.immutable_routes{result.extend(index.get_conflicting_routes_for_segment(a,b,margin));}}result.extend(self.pair.get_conflicting_routes_for_segment(a,b,margin));result
    }
    fn get_conflicting_routes_near_point(&self,p:&Point,margin:f64)->Vec<RouteConflict>{let mut result:Vec<_>=self.base.mutable_routes.get_conflicting_routes_near_point(p,margin).into_iter().filter(|c|!self.ignored.contains(&c.conflicting_route.borrow().connection_name)).collect();if let Some(index)=&self.base.immutable_routes{result.extend(index.get_conflicting_routes_near_point(p,margin));}result.extend(self.pair.get_conflicting_routes_near_point(p,margin));result}
}

pub struct CrossingViaReductionSolver {pub identity:u64,pub reduced_routes_array_identity:u64,pub base:BaseSolverState,pub stats:Value,pub input:CrossingViaReductionSolverInput,pub obstacle_shi:ObstacleSpatialHashIndex,pub trace_margin:f64,pub obstacle_margin:f64,pub reduced_hd_routes:Vec<RouteRef>}
impl CrossingViaReductionSolver {
    pub fn new(mut input:CrossingViaReductionSolverInput)->Result<Self,String>{
        input.obstacles=crate::utils::create_objects_with_z_layers::normalize_obstacles(input.obstacles,input.layer_count);let routes=structured_clone_routes(&input.input_hd_routes);let obstacles=ObstacleSpatialHashIndex::new_flatbush(input.obstacles.clone());
        Ok(Self{identity:next_identity(),reduced_routes_array_identity:next_identity(),base:BaseSolverState{max_iterations:1e6,..Default::default()},stats:json!({}),trace_margin:input.trace_margin,obstacle_margin:input.obstacle_margin,reduced_hd_routes:routes,obstacle_shi:obstacles,input})
    }
    pub fn collapse_detour_section(&self,route:&RouteRef,section:&RouteSection,target:f64)->Result<RouteRef,String>{
        let source=route.borrow();let mut points:Vec<_>=source.route[..section.start_index].iter().map(spread_point).collect();points.extend(section.points.iter().map(|p|{let p=spread_point(p);p.borrow_mut().z=target;p}));points.extend(source.route[(section.end_index+1)as usize..].iter().map(spread_point));let points=remove_consecutive_duplicate_points(points);let vias=recompute_vias(&points)?;drop(source);let result=spread_route(route);{let mut r=result.borrow_mut();r.route=points;r.vias=vias;r.route_array_identity=next_identity();r.vias_array_identity=next_identity();}Ok(result)
    }
    pub fn relocate_transition_via(&self,route:&RouteRef,section:&RouteSection,target:f64,side:TransitionSide,distance:f64)->Result<Option<(RouteRef,Point2)>,String>{
        let Some(split)=split_section_at_distance(&section.points,distance,self.input.math)else{return Ok(None);};let(prefix_z,suffix_z)=if side==TransitionSide::Start{(target,section.z)}else{(section.z,target)};
        let source=route.borrow();let mut points:Vec<_>=source.route[..section.start_index].iter().map(spread_point).collect();for (list,z) in [(&split.prefix,prefix_z),(&split.suffix,suffix_z)]{points.extend(list.iter().map(|p|{let p=spread_point(p);p.borrow_mut().z=z;p}));}points.extend(source.route[(section.end_index+1)as usize..].iter().map(spread_point));let points=remove_consecutive_duplicate_points(points);let vias=recompute_vias(&points)?;drop(source);let result=spread_route(route);{let mut r=result.borrow_mut();r.route=points;r.vias=vias;r.route_array_identity=next_identity();r.vias_array_identity=next_identity();}Ok(Some((result,point2(&split.point))))
    }
    pub fn relocate_transition_vias(&self,route:&RouteRef,sections:&[RouteSection],groups:&[IndexedCrossingGroup],detour_z:f64,detour_thickness:f64)->Result<Option<(RouteRef,Vec<Point2>)>,String>{
        let mut by_section:IndexMap<usize,Vec<&IndexedCrossingGroup>>=IndexMap::new();for group in groups{by_section.entry(group.transition_section_index).or_default().push(group);}
        let mut replacements=Vec::new();let mut relocated=Vec::new();let clearance=route.borrow().via_diameter/2.0+detour_thickness/2.0+self.trace_margin+EPSILON;
        for (index,groups) in by_section{if groups.len()!=1{return Ok(None);}let section=&sections[index];let group=groups[0];if !has_transition_on_side(sections,index,detour_z,group.side){return Ok(None);}
            let distance=if group.side==TransitionSide::Start{group.crossing_distances.iter().copied().fold(f64::NEG_INFINITY,max)+clearance}else{group.crossing_distances.iter().copied().fold(f64::INFINITY,min)-clearance};
            let Some(split)=split_section_at_distance(&section.points,distance,self.input.math)else{return Ok(None);};let(prefix_z,suffix_z)=if group.side==TransitionSide::Start{(detour_z,section.z)}else{(section.z,detour_z)};
            let mut points=Vec::new();for(list,z)in[(&split.prefix,prefix_z),(&split.suffix,suffix_z)]{points.extend(list.iter().map(|p|{let p=spread_point(p);p.borrow_mut().z=z;p}));}replacements.push((section,points));relocated.push(point2(&split.point));
        }
        let mut points:Vec<_>=route.borrow().route.iter().map(spread_point).collect();replacements.sort_by(|a,b|b.0.start_index.cmp(&a.0.start_index));for(section,replacement)in replacements{points.splice(section.start_index..(section.end_index+1)as usize,replacement);}
        let points=remove_consecutive_duplicate_points(points);let vias=recompute_vias(&points)?;let result=spread_route(route);{let mut r=result.borrow_mut();r.route=points;r.vias=vias;r.route_array_identity=next_identity();r.vias_array_identity=next_identity();}Ok(Some((result,relocated)))
    }

    pub fn route_is_clear(&self,route:&RouteRef,index:&dyn RouteClearanceIndex,original:&IndexSet<String>)->Result<bool,String>{
        for section in break_route_into_sections(route){for pair in section.points.windows(2){if !original.contains(&get_segment_key(&point3(&pair[0]),&point3(&pair[1]))){if let Some(outline)=&self.input.outline{if does_segment_cross_polygon_boundary(point2(&pair[0]),point2(&pair[1]),outline,route.borrow().trace_thickness/2.0){return Ok(false);}}}}
            if !can_section_move_to_layer(&section,section.z,route,index,&self.obstacle_shi,&self.input.conn_map,route.borrow().trace_thickness,self.obstacle_margin,Some(self.trace_margin),Some(&|a,b|!original.contains(&get_segment_key(a,b))))?{return Ok(false);}
        }Ok(true)
    }

    pub fn relocated_via_is_clear(&self,route:&RouteRef,via:Point2,index:&dyn RouteClearanceIndex)->Result<bool,String>{
        let radius=route.borrow().via_diameter/2.0;let mut z=0.0;while z<self.input.layer_count{if index.get_conflicting_routes_near_point(&Point{x:via.x,y:via.y,z},radius+self.trace_margin).iter().any(|c|!routes_are_same_net(route,&c.conflicting_route,&self.input.conn_map)){return Ok(false);}z+=1.0;}
        let margin=radius+self.obstacle_margin;for obstacle in self.obstacle_shi.search_area(via.x,via.y,margin*2.0,margin*2.0)?{if obstacle_is_same_net(&obstacle,route,&self.input.conn_map){continue;}let obstacle=obstacle.borrow();if segment_to_box_min_distance(via,via,obstacle.center,obstacle.width,obstacle.height)<margin{return Ok(false);}}
        if let Some(outline)=&self.input.outline{for i in 0..outline.len(){if point_to_segment_distance(via,outline[i],outline[(i+1)%outline.len()])<radius+self.trace_margin{return Ok(false);}}}Ok(true)
    }

    pub fn changed_sections_are_statically_clear(&self,route:&RouteRef,original:&IndexSet<String>)->Result<bool,String>{
        for section in break_route_into_sections(route){let changed=section.points.windows(2).any(|pair|!original.contains(&get_segment_key(&point3(&pair[0]),&point3(&pair[1]))));if !changed{continue;}
            if let Some(outline)=&self.input.outline{for pair in section.points.windows(2){if does_segment_cross_polygon_boundary(point2(&pair[0]),point2(&pair[1]),outline,route.borrow().trace_thickness/2.0){return Ok(false);}}}
            if !can_section_move_to_layer(&section,section.z,route,&StaticGeometryOnlyClearanceIndex,&self.obstacle_shi,&self.input.conn_map,route.borrow().trace_thickness,min(self.obstacle_margin,0.1),Some(self.trace_margin),None)?{return Ok(false);}
        }Ok(true)
    }

    pub fn candidate_is_clear(&mut self,candidate:&CrossingReductionCandidate,base:&BaseClearanceIndexes)->Result<bool,String>{
        let mut routes=vec![(candidate.detour_route_index,candidate.detour_route.clone())];routes.extend(candidate.transition_updates.iter().map(|t|(t.route_index,t.route.clone())));let ignored:IndexSet<_>=routes.iter().map(|(i,_)|self.reduced_hd_routes[*i].borrow().connection_name.clone()).collect();let original=get_route_segment_keys(&self.reduced_hd_routes[candidate.detour_route_index]);
        let index=CandidateClearanceIndex{base,pair:HighDensityRouteSpatialIndex::new(candidate.transition_updates.iter().map(|t|t.route.clone()).collect(),1.0),ignored:&ignored,original:&original};self.stats["candidateClearanceChecks"]=json!(self.stats["candidateClearanceChecks"].as_u64().unwrap_or(0)+1);
        if !self.route_is_clear(&candidate.detour_route,&index,&original)?{return Ok(false);}
        for update in &candidate.transition_updates{let original=get_route_segment_keys(&self.reduced_hd_routes[update.route_index]);let index=CandidateClearanceIndex{base,pair:HighDensityRouteSpatialIndex::new(routes.iter().filter(|(i,_)|*i!=update.route_index).map(|(_,r)|r.clone()).collect(),1.0),ignored:&ignored,original:&original};if !self.route_is_clear(&update.route,&index,&original)?{return Ok(false);}for via in &update.relocated_vias{if !self.relocated_via_is_clear(&update.route,*via,&index)?{return Ok(false);}}}
        self.changed_sections_are_statically_clear(&candidate.detour_route,&original)
    }

    pub fn candidate_routes_have_no_external_copper_conflicts(&self,candidate:&CrossingReductionCandidate,base:&BaseClearanceIndexes)->bool{
        let routes:Vec<_>=std::iter::once(&candidate.detour_route).chain(candidate.transition_updates.iter().map(|t|&t.route)).collect();let names:IndexSet<_>=routes.iter().map(|r|r.borrow().connection_name.clone()).collect();let indexes:Vec<_>=std::iter::once(&base.mutable_routes).chain(base.immutable_routes.as_ref()).collect();
        for route in routes{for section in break_route_into_sections(route){for pair in section.points.windows(2){for index in &indexes{if index.get_conflicting_routes_for_segment(&point3(&pair[0]),&point3(&pair[1]),route.borrow().trace_thickness/2.0+self.trace_margin).iter().any(|c|!names.contains(&c.conflicting_route.borrow().connection_name)&&!routes_are_same_net(route,&c.conflicting_route,&self.input.conn_map)){return false;}}}}}true
    }

    fn build_transition_segment_index(&mut self,sections_by_route:&[Vec<RouteSection>],relevant:&IndexSet<String>)->Option<TransitionSegmentIndex>{
        let mut segments=Vec::new();for route_index in 0..self.reduced_hd_routes.len(){if self.reduced_hd_routes[route_index].borrow().has_jumpers(){continue;}let sections=&sections_by_route[route_index];for(section_index,section)in sections.iter().enumerate(){if section_has_protected_geometry(section){continue;}for side in [TransitionSide::Start,TransitionSide::End]{let Some(adjacent_z)=get_transition_adjacent_z(sections,section_index,side)else{continue;};if adjacent_z==section.z||!relevant.contains(&format!("{}:{}",js_number_to_string(section.z),js_number_to_string(adjacent_z))){continue;}let mut traversed=0.0;for pair in section.points.windows(2){let a=point2(&pair[0]);let b=point2(&pair[1]);let length=(self.input.math.hypot)(b.x-a.x,b.y-a.y);if length>EPSILON{segments.push(IndexedTransitionSegment{route_index,section_index,side,adjacent_z,start:pair[0].clone(),end:pair[1].clone(),distance_from_section_start:traversed});}traversed+=length;}}}}
        self.stats["transitionSegmentsIndexed"]=json!(self.stats["transitionSegmentsIndexed"].as_u64().unwrap_or(0)+segments.len()as u64);if segments.is_empty(){return None;}let mut index=Flatbush::new(segments.len());for segment in &segments{let a=point2(&segment.start);let b=point2(&segment.end);index.add(min(a.x,b.x),min(a.y,b.y),max(a.x,b.x),max(a.y,b.y));}index.finish();Some(TransitionSegmentIndex{index,segments})
    }

    fn get_indexed_crossing_groups(&mut self,detour_route_index:usize,section:&RouteSection,target:f64,index:&TransitionSegmentIndex)->Vec<IndexedCrossingGroup>{
        let mut groups:IndexMap<(usize,usize,TransitionSide),IndexedCrossingGroup>=IndexMap::new();for pair in section.points.windows(2){let a=point2(&pair[0]);let b=point2(&pair[1]);if (self.input.math.hypot)(b.x-a.x,b.y-a.y)<=EPSILON{continue;}self.stats["indexedDetourSegmentQueries"]=json!(self.stats["indexedDetourSegmentQueries"].as_u64().unwrap_or(0)+1);
            for id in index.index.search(min(a.x,b.x)-EPSILON,min(a.y,b.y)-EPSILON,max(a.x,b.x)+EPSILON,max(a.y,b.y)+EPSILON){let segment=&index.segments[id];if segment.route_index==detour_route_index||segment.start.borrow().z!=target||segment.adjacent_z!=section.z{continue;}self.stats["exactSegmentIntersectionChecks"]=json!(self.stats["exactSegmentIntersectionChecks"].as_u64().unwrap_or(0)+1);let Some(distance)=get_interior_intersection_distance(&segment.start,&segment.end,&pair[0],&pair[1],self.input.math)else{continue;};let group=groups.entry((segment.route_index,segment.section_index,segment.side)).or_insert_with(||IndexedCrossingGroup{transition_route_index:segment.route_index,transition_section_index:segment.section_index,side:segment.side,crossing_distances:Vec::new()});group.crossing_distances.push(segment.distance_from_section_start+distance);}
        }let mut groups:Vec<_>=groups.into_values().collect();groups.sort_by_key(|g|(g.transition_route_index,g.transition_section_index,g.side));groups
    }
    pub fn try_create_candidate(&mut self,detour_index:usize,detour_section:&RouteSection,target:f64,group:&IndexedCrossingGroup,sections:&[RouteSection],base:&BaseClearanceIndexes)->Result<Option<CrossingReductionCandidate>,String>{
        if !has_transition_on_side(sections,group.transition_section_index,detour_section.z,group.side){return Ok(None);}let detour=self.reduced_hd_routes[detour_index].clone();let transition=self.reduced_hd_routes[group.transition_route_index].clone();if group.crossing_distances.is_empty(){return Ok(None);}
        let clearance=transition.borrow().via_diameter/2.0+detour.borrow().trace_thickness/2.0+self.trace_margin+EPSILON;let distance=if group.side==TransitionSide::Start{group.crossing_distances.iter().copied().fold(f64::NEG_INFINITY,max)+clearance}else{group.crossing_distances.iter().copied().fold(f64::INFINITY,min)-clearance};let Some((relocated,via))=self.relocate_transition_via(&transition,&sections[group.transition_section_index],detour_section.z,group.side,distance)?else{return Ok(None);};let collapsed=self.collapse_detour_section(&detour,detour_section,target)?;
        let removed=detour.borrow().vias.len()as isize+transition.borrow().vias.len()as isize-collapsed.borrow().vias.len()as isize-relocated.borrow().vias.len()as isize;if removed!=2{return Ok(None);}let candidate=CrossingReductionCandidate{detour_route_index:detour_index,detour_route:collapsed,transition_updates:vec![TransitionUpdate{route_index:group.transition_route_index,route:relocated,relocated_vias:vec![via]}]};if self.candidate_is_clear(&candidate,base)?{Ok(Some(candidate))}else{Ok(None)}
    }

    pub fn try_create_multi_crossing_candidate(&mut self,detour_index:usize,section:&RouteSection,target:f64,groups:&[IndexedCrossingGroup],sections:&[Vec<RouteSection>],base:&BaseClearanceIndexes)->Result<Option<CrossingReductionCandidate>,String>{
        if groups.len()<2{return Ok(None);}let detour=self.reduced_hd_routes[detour_index].clone();let mut updates=Vec::new();let mut by_route:IndexMap<usize,Vec<IndexedCrossingGroup>>=IndexMap::new();for group in groups{by_route.entry(group.transition_route_index).or_default().push(group.clone());}
        for(index,groups)in &by_route{let transition=&self.reduced_hd_routes[*index];let Some((route,vias))=self.relocate_transition_vias(transition,&sections[*index],groups,section.z,detour.borrow().trace_thickness)?else{return Ok(None);};updates.push(TransitionUpdate{route_index:*index,route,relocated_vias:vias});}
        let collapsed=self.collapse_detour_section(&detour,section,target)?;let original=detour.borrow().vias.len()+by_route.keys().map(|i|self.reduced_hd_routes[*i].borrow().vias.len()).sum::<usize>();let count=collapsed.borrow().vias.len()+updates.iter().map(|u|u.route.borrow().vias.len()).sum::<usize>();if original as isize-count as isize!=2{return Ok(None);}
        self.stats["multiCrossingCandidates"]=json!(self.stats["multiCrossingCandidates"].as_u64().unwrap_or(0)+1);let candidate=CrossingReductionCandidate{detour_route_index:detour_index,detour_route:collapsed,transition_updates:updates};if !self.candidate_is_clear(&candidate,base)?{return Ok(None);}if !self.candidate_routes_have_no_external_copper_conflicts(&candidate,base){self.stats["multiCrossingPreexistingConflictRejections"]=json!(self.stats["multiCrossingPreexistingConflictRejections"].as_u64().unwrap_or(0)+1);return Ok(None);}
        self.stats["multiCrossingReductions"]=json!(self.stats["multiCrossingReductions"].as_u64().unwrap_or(0)+1);self.stats["transitionRoutesMovedByMultiCrossingReductions"]=json!(self.stats["transitionRoutesMovedByMultiCrossingReductions"].as_u64().unwrap_or(0)+candidate.transition_updates.len()as u64);Ok(Some(candidate))
    }

    pub fn find_crossing_reduction(&mut self) -> Result<Option<CrossingReductionCandidate>, String> {
        let sections_by_route: Vec<_> = self.reduced_hd_routes.iter().map(break_route_into_sections).collect();
        let mut detour_candidates = Vec::new();
        let mut relevant_layer_transitions = IndexSet::new();
        for (route_index, route) in self.reduced_hd_routes.iter().enumerate() {
            if route.borrow().has_jumpers() { continue; }
            let sections = &sections_by_route[route_index];
            for section_index in 1..sections.len().saturating_sub(1) {
                let previous = &sections[section_index - 1];
                let section = &sections[section_index];
                let next = &sections[section_index + 1];
                if previous.z != next.z || previous.z == section.z || section_has_protected_geometry(section) { continue; }
                detour_candidates.push((route_index, section.clone(), previous.z));
                relevant_layer_transitions.insert(format!("{}:{}", js_number_to_string(previous.z), js_number_to_string(section.z)));
            }
        }
        if detour_candidates.is_empty() { return Ok(None); }
        let Some(transition_index) = self.build_transition_segment_index(&sections_by_route, &relevant_layer_transitions) else { return Ok(None); };
        let mut base_indexes: Option<BaseClearanceIndexes> = None;

        for (detour_index, detour_section, target_z) in detour_candidates {
            let detour_route = self.reduced_hd_routes[detour_index].clone();
            let crossing_groups = self.get_indexed_crossing_groups(detour_index, &detour_section, target_z, &transition_index);
            let mut group_options: IndexMap<(usize, usize), Vec<IndexedCrossingGroup>> = IndexMap::new();
            for group in crossing_groups {
                let transition_route = &self.reduced_hd_routes[group.transition_route_index];
                if transition_route.borrow().has_jumpers() || routes_are_same_net(&detour_route, transition_route, &self.input.conn_map) { continue; }
                group_options.entry((group.transition_route_index, group.transition_section_index)).or_default().push(group);
            }
            if group_options.len() > 1 {
                let base = base_indexes.get_or_insert_with(|| BaseClearanceIndexes {
                    mutable_routes: HighDensityRouteSpatialIndex::new(self.reduced_hd_routes.clone(), 1.0),
                    immutable_routes: if self.input.other_hd_routes.is_empty() { None } else {
                        Some(HighDensityRouteSpatialIndex::new(self.input.other_hd_routes.clone(), 1.0))
                    },
                });
                let mut selections: Vec<(Vec<IndexedCrossingGroup>, f64)> = vec![(Vec::new(), 0.0)];
                for options in group_options.values() {
                    let mut sorted_options: Vec<_> = options.iter().map(|group| {
                        let route = self.reduced_hd_routes[group.transition_route_index].borrow();
                        let section = &sections_by_route[group.transition_route_index][group.transition_section_index];
                        let via_clearance = route.via_diameter / 2.0 + detour_route.borrow().trace_thickness / 2.0 + self.trace_margin + EPSILON;
                        let new_via_distance = if group.side == TransitionSide::Start {
                            group.crossing_distances.iter().copied().fold(f64::NEG_INFINITY, max) + via_clearance
                        } else {
                            group.crossing_distances.iter().copied().fold(f64::INFINITY, min) - via_clearance
                        };
                        let movement = if group.side == TransitionSide::Start { new_via_distance } else {
                            get_section_length(&section.points, self.input.math) - new_via_distance
                        };
                        (group.clone(), movement)
                    }).collect();
                    sorted_options.sort_by(|first, second| (first.1 - second.1).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
                    let mut next_selections = Vec::new();
                    for (groups, movement) in &selections {
                        for (group, option_movement) in &sorted_options {
                            let mut next_groups = groups.clone();
                            next_groups.push(group.clone());
                            next_selections.push((next_groups, movement + option_movement));
                        }
                    }
                    next_selections.sort_by(|first, second| (first.1 - second.1).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
                    next_selections.truncate(MAX_MULTI_CROSSING_SELECTIONS);
                    selections = next_selections;
                }
                for (groups, _) in selections {
                    if let Some(candidate) = self.try_create_multi_crossing_candidate(detour_index, &detour_section, target_z, &groups, &sections_by_route, base)? {
                        return Ok(Some(candidate));
                    }
                }
                continue;
            }

            if let Some(options) = group_options.values().next() {
                for group in options {
                    let base = base_indexes.get_or_insert_with(|| BaseClearanceIndexes {
                        mutable_routes: HighDensityRouteSpatialIndex::new(self.reduced_hd_routes.clone(), 1.0),
                        immutable_routes: if self.input.other_hd_routes.is_empty() { None } else {
                            Some(HighDensityRouteSpatialIndex::new(self.input.other_hd_routes.clone(), 1.0))
                        },
                    });
                    if let Some(candidate) = self.try_create_candidate(detour_index, &detour_section, target_z, group, &sections_by_route[group.transition_route_index], base)? {
                        return Ok(Some(candidate));
                    }
                }
            }
        }
        Ok(None)
    }

    pub fn get_reduced_hd_routes(&self)->&[RouteRef]{&self.reduced_hd_routes}
    pub fn snapshot(&self,codec:&mut crate::graph_codec::GraphCodec)->Value{
        let mut fields=serde_json::to_value(&self.base).unwrap();fields["identity"]=json!(self.identity);fields["stats"]=codec.raw(self.stats.clone());fields["reducedHdRoutes"]=codec.route_array(self.reduced_routes_array_identity,&self.reduced_hd_routes);fields["traceMargin"]=json!(self.trace_margin);fields["obstacleMargin"]=json!(self.obstacle_margin);fields
    }
    pub fn restore(&mut self,fields:&Value,codec:&mut crate::graph_codec::GraphCodec)->Result<(),String>{
        let mut base=serde_json::to_value(&self.base).unwrap();for key in ["iterations","MAX_ITERATIONS","solved","failed","error","progress"]{if let Some(value)=fields.get(key){base[key]=value.clone();}}self.base=serde_json::from_value(base).map_err(|e|e.to_string())?;if let Some(value)=fields.get("stats"){self.stats=codec.read_raw(value);}if let Some(value)=fields.get("reducedHdRoutes"){self.reduced_hd_routes=codec.read_routes(value)?;if let Some(id)=value["$array"].as_u64(){self.reduced_routes_array_identity=id;}}if let Some(value)=fields["traceMargin"].as_f64(){self.trace_margin=value;}if let Some(value)=fields["obstacleMargin"].as_f64(){self.obstacle_margin=value;}Ok(())
    }
    pub fn invoke(&mut self,method:&str,args:&Value,codec:&mut crate::graph_codec::GraphCodec)->Result<Value,String>{
        match method{
            "collapseDetourSection" => {
                let arg = &args[0];
                let route = codec.read_route(&arg["route"])?;
                let section = RouteSection::restore(&arg["section"], codec)?;
                let target = arg["targetZ"].as_f64().ok_or("Missing targetZ")?;
                Ok(codec.route(&self.collapse_detour_section(&route, &section, target)?))
            }
            "relocateTransitionVia" => {
                let arg = &args[0];
                let route = codec.read_route(&arg["route"])?;
                let section = RouteSection::restore(&arg["section"], codec)?;
                let target = arg["targetZ"].as_f64().ok_or("Missing targetZ")?;
                let side = match arg["side"].as_str() { Some("start") => TransitionSide::Start, Some("end") => TransitionSide::End, _ => return Err("Invalid transition side".into()) };
                let distance = arg["newViaDistance"].as_f64().ok_or("Missing newViaDistance")?;
                Ok(match self.relocate_transition_via(&route, &section, target, side, distance)? {
                    Some((route, point)) => json!({"route":codec.route(&route),"relocatedVia":point}),
                    None => Value::Null,
                })
            }
            "relocateTransitionVias" => {
                let arg = &args[0];
                let route = codec.read_route(&arg["route"])?;
                let sections = arg["sections"].as_array().ok_or("Missing sections")?.iter().map(|section|RouteSection::restore(section,codec)).collect::<Result<Vec<_>,_>>()?;
                let groups = arg["crossingGroups"].as_array().ok_or("Missing crossingGroups")?.iter().map(|group| {
                    Ok(IndexedCrossingGroup {
                        transition_route_index:group["transitionRouteIndex"].as_u64().ok_or("Missing transitionRouteIndex")? as usize,
                        transition_section_index:group["transitionSectionIndex"].as_u64().ok_or("Missing transitionSectionIndex")? as usize,
                        side:match group["side"].as_str(){Some("start")=>TransitionSide::Start,Some("end")=>TransitionSide::End,_=>return Err("Invalid side".to_string())},
                        crossing_distances:serde_json::from_value(group["crossingDistances"].clone()).map_err(|e|e.to_string())?,
                    })
                }).collect::<Result<Vec<_>,String>>()?;
                let z=arg["detourZ"].as_f64().ok_or("Missing detourZ")?;
                let thickness=arg["detourTraceThickness"].as_f64().ok_or("Missing detourTraceThickness")?;
                Ok(match self.relocate_transition_vias(&route,&sections,&groups,z,thickness)? {
                    Some((route,vias))=>json!({"route":codec.route(&route),"relocatedVias":vias}),
                    None=>Value::Null,
                })
            }
            "getReducedHdRoutes"=>Ok(codec.route_array(self.reduced_routes_array_identity,&self.reduced_hd_routes)),
            "findCrossingReduction"=>{let candidate=self.find_crossing_reduction()?;Ok(candidate.map(|c|json!({"detourRouteIndex":c.detour_route_index,"detourRoute":codec.route(&c.detour_route),"transitionUpdates":c.transition_updates.iter().map(|u|json!({"routeIndex":u.route_index,"route":codec.route(&u.route),"relocatedVias":u.relocated_vias})).collect::<Vec<_>>()})).unwrap_or(Value::Null))},
            _=>Err(format!("Unknown CrossingViaReductionSolver method: {method}")),
        }
    }
}
impl SpecializedSolver for CrossingViaReductionSolver{
    fn base(&self)->&BaseSolverState{&self.base}
    fn base_mut(&mut self)->&mut BaseSolverState{&mut self.base}
    fn get_solver_name(&self)->&'static str{"CrossingViaReductionSolver"}
    fn _step(&mut self)->Result<(),String>{
        crate::connectivity_read_barrier::check(&self.input.conn_map)?;
        let Some(candidate)=self.find_crossing_reduction()?else{self.base.solved=true;return Ok(());};self.reduced_hd_routes[candidate.detour_route_index]=candidate.detour_route;for update in candidate.transition_updates{self.reduced_hd_routes[update.route_index]=update.route;}self.stats["crossingViaReductions"]=json!(self.stats["crossingViaReductions"].as_u64().unwrap_or(0)+1);self.stats["viasRemovedByCrossingReductions"]=json!(self.stats["viasRemovedByCrossingReductions"].as_u64().unwrap_or(0)+2);Ok(())
    }
}
