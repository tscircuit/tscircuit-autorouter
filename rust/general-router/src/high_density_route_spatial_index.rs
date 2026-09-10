use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use indexmap::IndexMap;
use crate::geometry::do_segments_intersect;
use crate::types::{Bounds, Point, Point2, Route};

fn get_segment_bounds(segment: &[Point; 2]) -> Bounds {
    Bounds {
        min_x: segment[0].x.min(segment[1].x),
        max_x: segment[0].x.max(segment[1].x),
        min_y: segment[0].y.min(segment[1].y),
        max_y: segment[0].y.max(segment[1].y),
    }
}

fn compute_dist_sq(p1: Point2, p2: Point2) -> f64 {
    let dx = p1.x - p2.x;
    let dy = p1.y - p2.y;
    dx * dx + dy * dy
}

fn point_to_segment_distance_sq(p: Point2, a: Point2, b: Point2) -> f64 {
    let l2 = compute_dist_sq(a, b);
    if l2 == 0.0 {
        return compute_dist_sq(p, a);
    }
    let mut t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = t.min(1.0).max(0.0);
    let projection = Point2 {
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
    };
    compute_dist_sq(p, projection)
}

fn segment_to_segment_distance_sq(a: &Point, b: &Point, c: &Point, d: &Point) -> f64 {
    if do_segments_intersect(a, b, c, d) {
        return 0.0;
    }
    let pa = Point2 { x: a.x, y: a.y };
    let pb = Point2 { x: b.x, y: b.y };
    let pc = Point2 { x: c.x, y: c.y };
    let pd = Point2 { x: d.x, y: d.y };
    point_to_segment_distance_sq(pa, pc, pd)
        .min(point_to_segment_distance_sq(pb, pc, pd))
        .min(point_to_segment_distance_sq(pc, pa, pb))
        .min(point_to_segment_distance_sq(pd, pa, pb))
}

#[derive(Clone, Debug)]
struct StoredSegment {
    segment_id: String,
    segment: [Point; 2],
    parent_route: Rc<Route>,
}

#[derive(Clone, Debug)]
struct StoredVia {
    via_id: String,
    x: f64,
    y: f64,
    parent_route: Rc<Route>,
}

#[derive(Clone, Debug)]
pub struct RouteConflict {
    pub conflicting_route: Rc<Route>,
    pub distance: f64,
}

#[derive(Clone, Debug)]
pub struct HighDensityRouteSpatialIndex {
    segment_buckets: HashMap<(i64, i64), Vec<Rc<StoredSegment>>>,
    via_buckets: HashMap<(i64, i64), Vec<Rc<StoredVia>>>,
    cell_size: f64,
    maximum_copper_radius: f64,
}

impl HighDensityRouteSpatialIndex {
    pub fn new(routes: Vec<Route>, cell_size: f64) -> Self {
        let mut index = Self {
            segment_buckets: HashMap::new(),
            via_buckets: HashMap::new(),
            cell_size,
            maximum_copper_radius: 0.0,
        };
        for route in routes {
            index.add_route(route);
        }
        index
    }

    pub fn get_conflicting_routes_for_segment(&self, segment_start: &Point, segment_end: &Point, margin: f64) -> Vec<RouteConflict> {
        let bounds = get_segment_bounds(&[*segment_start, *segment_end]);
        let broad_phase_margin = margin + self.maximum_copper_radius;
        let search_min_x = bounds.min_x - broad_phase_margin;
        let search_min_y = bounds.min_y - broad_phase_margin;
        let search_max_x = bounds.max_x + broad_phase_margin;
        let search_max_y = bounds.max_y + broad_phase_margin;
        let epsilon = 1e-9;
        let min_index_x = (search_min_x / self.cell_size).floor() as i64;
        let max_index_x = ((search_max_x + epsilon) / self.cell_size).floor() as i64;
        let min_index_y = (search_min_y / self.cell_size).floor() as i64;
        let max_index_y = ((search_max_y + epsilon) / self.cell_size).floor() as i64;
        let mut conflicting_route_data: IndexMap<String, (Rc<Route>, f64)> = IndexMap::new();
        let mut checked_segments: HashSet<String> = HashSet::new();
        let mut checked_vias: HashSet<String> = HashSet::new();
        let query_p1 = Point2 { x: segment_start.x, y: segment_start.y };
        let query_p2 = Point2 { x: segment_end.x, y: segment_end.y };
        for ix in min_index_x..=max_index_x {
            for iy in min_index_y..=max_index_y {
                let bucket_key = (ix, iy);
                if let Some(segment_bucket_list) = self.segment_buckets.get(&bucket_key) {
                    for segment_info in segment_bucket_list {
                        if !checked_segments.insert(segment_info.segment_id.clone()) {
                            continue;
                        }
                        let route = &segment_info.parent_route;
                        let [p1, p2] = &segment_info.segment;
                        if segment_start.z != segment_end.z || p1.z != p2.z || p1.z != segment_start.z {
                            continue;
                        }
                        let required_separation = margin + route.trace_thickness / 2.0;
                        let required_separation_sq = required_separation * required_separation;
                        let dist_sq = segment_to_segment_distance_sq(segment_start, segment_end, p1, p2);
                        if dist_sq < required_separation_sq {
                            let existing = conflicting_route_data.get(&route.connection_name);
                            if existing.is_none() || dist_sq < existing.unwrap().1 {
                                conflicting_route_data.insert(route.connection_name.clone(), (route.clone(), dist_sq));
                            }
                        }
                    }
                }
                if let Some(via_bucket_list) = self.via_buckets.get(&bucket_key) {
                    for via_info in via_bucket_list {
                        if !checked_vias.insert(via_info.via_id.clone()) {
                            continue;
                        }
                        let route = &via_info.parent_route;
                        let via_point = Point2 { x: via_info.x, y: via_info.y };
                        let required_separation = margin + route.via_diameter / 2.0;
                        let required_separation_sq = required_separation * required_separation;
                        let dist_sq = point_to_segment_distance_sq(via_point, query_p1, query_p2);
                        if dist_sq < required_separation_sq {
                            let existing = conflicting_route_data.get(&route.connection_name);
                            if existing.is_none() || dist_sq < existing.unwrap().1 {
                                conflicting_route_data.insert(route.connection_name.clone(), (route.clone(), dist_sq));
                            }
                        }
                    }
                }
            }
        }
        let mut results = Vec::new();
        for (route, min_dist_sq) in conflicting_route_data.into_values() {
            results.push(RouteConflict { conflicting_route: route, distance: min_dist_sq.sqrt() });
        }
        results
    }

    pub fn remove_route(&mut self, connection_name: &str) {
        self.segment_buckets.retain(|_, segments| {
            segments.retain(|segment| segment.parent_route.connection_name != connection_name);
            !segments.is_empty()
        });
        self.via_buckets.retain(|_, vias| {
            vias.retain(|via| via.parent_route.connection_name != connection_name);
            !vias.is_empty()
        });
    }

    pub fn add_route(&mut self, route: Route) {
        if route.connection_name.is_empty() {
            eprintln!("Skipping route with missing data: {:?}", route);
            return;
        }
        self.maximum_copper_radius = self.maximum_copper_radius
            .max(route.trace_thickness / 2.0)
            .max(route.via_diameter / 2.0);
        let epsilon = 1e-9;
        let route = Rc::new(route);
        if route.route.len() >= 2 {
            for i in 0..route.route.len() - 1 {
                let p1 = &route.route[i];
                let p2 = &route.route[i + 1];
                if p1.x == p2.x && p1.y == p2.y {
                    continue;
                }
                if p1.inside_jumper_pad.unwrap_or(false) && p2.inside_jumper_pad.unwrap_or(false) {
                    continue;
                }
                let segment = [p1.point(), p2.point()];
                let bounds = get_segment_bounds(&segment);
                let segment_info = Rc::new(StoredSegment {
                    segment_id: format!("{}-seg-{}", route.connection_name, i),
                    segment,
                    parent_route: route.clone(),
                });
                let min_index_x = (bounds.min_x / self.cell_size).floor() as i64;
                let max_index_x = ((bounds.max_x + epsilon) / self.cell_size).floor() as i64;
                let min_index_y = (bounds.min_y / self.cell_size).floor() as i64;
                let max_index_y = ((bounds.max_y + epsilon) / self.cell_size).floor() as i64;
                for ix in min_index_x..=max_index_x {
                    for iy in min_index_y..=max_index_y {
                        self.segment_buckets.entry((ix, iy)).or_default().push(segment_info.clone());
                    }
                }
            }
        }
        for (i, via) in route.vias.iter().enumerate() {
            let stored_via = Rc::new(StoredVia {
                via_id: format!("{}-via-{}", route.connection_name, i),
                x: via.x,
                y: via.y,
                parent_route: route.clone(),
            });
            let ix = (via.x / self.cell_size).floor() as i64;
            let iy = (via.y / self.cell_size).floor() as i64;
            self.via_buckets.entry((ix, iy)).or_default().push(stored_via);
        }
    }

    pub fn get_conflicting_routes_near_point(&self, point: &Point, margin: f64) -> Vec<RouteConflict> {
        let broad_phase_margin = margin + self.maximum_copper_radius;
        let search_min_x = point.x - broad_phase_margin;
        let search_min_y = point.y - broad_phase_margin;
        let search_max_x = point.x + broad_phase_margin;
        let search_max_y = point.y + broad_phase_margin;
        let epsilon = 1e-9;
        let min_index_x = (search_min_x / self.cell_size).floor() as i64;
        let max_index_x = ((search_max_x + epsilon) / self.cell_size).floor() as i64;
        let min_index_y = (search_min_y / self.cell_size).floor() as i64;
        let max_index_y = ((search_max_y + epsilon) / self.cell_size).floor() as i64;
        let mut conflicting_route_data: IndexMap<String, (Rc<Route>, f64)> = IndexMap::new();
        let mut checked_segments: HashSet<String> = HashSet::new();
        let mut checked_vias: HashSet<String> = HashSet::new();
        let query_point = Point2 { x: point.x, y: point.y };
        for ix in min_index_x..=max_index_x {
            for iy in min_index_y..=max_index_y {
                let bucket_key = (ix, iy);
                if let Some(segment_bucket_list) = self.segment_buckets.get(&bucket_key) {
                    for segment_info in segment_bucket_list {
                        if !checked_segments.insert(segment_info.segment_id.clone()) {
                            continue;
                        }
                        let [p1_seg, p2_seg] = &segment_info.segment;
                        if p1_seg.z != p2_seg.z || p1_seg.z != point.z {
                            continue;
                        }
                        let route = &segment_info.parent_route;
                        let p1 = Point2 { x: p1_seg.x, y: p1_seg.y };
                        let p2 = Point2 { x: p2_seg.x, y: p2_seg.y };
                        let required_separation = margin + route.trace_thickness / 2.0;
                        let required_separation_sq = required_separation * required_separation;
                        let dist_sq = point_to_segment_distance_sq(query_point, p1, p2);
                        if dist_sq < required_separation_sq {
                            let existing = conflicting_route_data.get(&route.connection_name);
                            if existing.is_none() || dist_sq < existing.unwrap().1 {
                                conflicting_route_data.insert(route.connection_name.clone(), (route.clone(), dist_sq));
                            }
                        }
                    }
                }
                if let Some(via_bucket_list) = self.via_buckets.get(&bucket_key) {
                    for via_info in via_bucket_list {
                        if !checked_vias.insert(via_info.via_id.clone()) {
                            continue;
                        }
                        let route = &via_info.parent_route;
                        let via_point = Point2 { x: via_info.x, y: via_info.y };
                        let required_separation = margin + route.via_diameter / 2.0;
                        let required_separation_sq = required_separation * required_separation;
                        let dist_sq = compute_dist_sq(query_point, via_point);
                        if dist_sq < required_separation_sq {
                            let existing = conflicting_route_data.get(&route.connection_name);
                            if existing.is_none() || dist_sq < existing.unwrap().1 {
                                conflicting_route_data.insert(route.connection_name.clone(), (route.clone(), dist_sq));
                            }
                        }
                    }
                }
            }
        }
        let mut results = Vec::new();
        for (route, min_dist_sq) in conflicting_route_data.into_values() {
            results.push(RouteConflict { conflicting_route: route, distance: min_dist_sq.sqrt() });
        }
        results
    }
}
