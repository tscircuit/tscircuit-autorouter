use crate::bindings::trace_simplification::math_utils::{do_segments_intersect, max, min};
use crate::bindings::trace_simplification::types::{Point, Point2, PointRef, RouteRef, point3};
use indexmap::{IndexMap, IndexSet};
use std::rc::Rc;

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
    t = max(0.0, min(1.0, t));
    let projection = Point2 {
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
    };
    compute_dist_sq(p, projection)
}

fn segment_to_segment_distance_sq(a: &Point, b: &Point, c: &Point, d: &Point) -> f64 {
    let pa = Point2 { x: a.x, y: a.y };
    let pb = Point2 { x: b.x, y: b.y };
    let pc = Point2 { x: c.x, y: c.y };
    let pd = Point2 { x: d.x, y: d.y };
    if do_segments_intersect(pa, pb, pc, pd) {
        return 0.0;
    }
    min(
        min(
            min(
                point_to_segment_distance_sq(pa, pc, pd),
                point_to_segment_distance_sq(pb, pc, pd),
            ),
            point_to_segment_distance_sq(pc, pa, pb),
        ),
        point_to_segment_distance_sq(pd, pa, pb),
    )
}

#[derive(Clone, Debug)]
pub struct StoredSegment {
    pub segment_id: String,
    pub segment: [PointRef; 2],
    pub parent_route: RouteRef,
}

#[derive(Clone, Debug)]
pub struct StoredVia {
    pub via_id: String,
    pub x: f64,
    pub y: f64,
    pub parent_route: RouteRef,
}

#[derive(Clone, Debug)]
pub struct RouteConflict {
    pub conflicting_route: RouteRef,
    pub distance: f64,
}

#[derive(Clone, Debug)]
pub struct HighDensityRouteSpatialIndex {
    pub identity: u64,
    pub segment_buckets: IndexMap<(i64, i64), Vec<Rc<StoredSegment>>>,
    pub via_buckets: IndexMap<(i64, i64), Vec<Rc<StoredVia>>>,
    pub cell_size: f64,
    pub maximum_copper_radius: f64,
    #[cfg(test)]
    pub(crate) segment_clearance_queries: std::cell::Cell<usize>,
}

impl HighDensityRouteSpatialIndex {
    pub fn new(routes: Vec<RouteRef>, cell_size: f64) -> Self {
        let mut index = Self {
            identity: crate::bindings::trace_simplification::types::next_identity(),
            segment_buckets: IndexMap::new(),
            via_buckets: IndexMap::new(),
            cell_size,
            maximum_copper_radius: 0.0,
            #[cfg(test)]
            segment_clearance_queries: std::cell::Cell::new(0),
        };
        for route in routes {
            index.add_route(route);
        }
        index
    }

    pub fn add_route(&mut self, route_ref: RouteRef) {
        let route = route_ref.borrow();
        if route.connection_name.is_empty() {
            return;
        }
        self.maximum_copper_radius = max(
            max(self.maximum_copper_radius, route.trace_thickness / 2.0),
            route.via_diameter / 2.0,
        );
        let epsilon = 1e-9;
        for i in 0..route.route.len().saturating_sub(1) {
            let p1 = route.route[i].borrow();
            let p2 = route.route[i + 1].borrow();
            if p1.x == p2.x && p1.y == p2.y {
                continue;
            }
            if p1.metadata["insideJumperPad"].as_bool().unwrap_or(false)
                && p2.metadata["insideJumperPad"].as_bool().unwrap_or(false)
            {
                continue;
            }
            let segment_info = Rc::new(StoredSegment {
                segment_id: format!("{}-seg-{}", route.connection_name, i),
                segment: [route.route[i].clone(), route.route[i + 1].clone()],
                parent_route: route_ref.clone(),
            });
            let min_index_x = (min(p1.x, p2.x) / self.cell_size).floor() as i64;
            let max_index_x = ((max(p1.x, p2.x) + epsilon) / self.cell_size).floor() as i64;
            let min_index_y = (min(p1.y, p2.y) / self.cell_size).floor() as i64;
            let max_index_y = ((max(p1.y, p2.y) + epsilon) / self.cell_size).floor() as i64;
            for ix in min_index_x..=max_index_x {
                for iy in min_index_y..=max_index_y {
                    self.segment_buckets
                        .entry((ix, iy))
                        .or_default()
                        .push(segment_info.clone());
                }
            }
        }
        for (i, via) in route.vias.iter().enumerate() {
            let via = via.borrow();
            let stored_via = Rc::new(StoredVia {
                via_id: format!("{}-via-{}", route.connection_name, i),
                x: via.x,
                y: via.y,
                parent_route: route_ref.clone(),
            });
            let ix = (via.x / self.cell_size).floor() as i64;
            let iy = (via.y / self.cell_size).floor() as i64;
            self.via_buckets
                .entry((ix, iy))
                .or_default()
                .push(stored_via);
        }
    }

    pub fn remove_route(&mut self, connection_name: &str) {
        self.segment_buckets.retain(|_, segments| {
            segments
                .retain(|segment| segment.parent_route.borrow().connection_name != connection_name);
            !segments.is_empty()
        });
        self.via_buckets.retain(|_, vias| {
            vias.retain(|via| via.parent_route.borrow().connection_name != connection_name);
            !vias.is_empty()
        });
    }

    pub fn get_conflicting_routes_for_segment(
        &self,
        segment_start: &Point,
        segment_end: &Point,
        margin: f64,
    ) -> Vec<RouteConflict> {
        #[cfg(test)]
        self.segment_clearance_queries
            .set(self.segment_clearance_queries.get() + 1);
        let broad_phase_margin = margin + self.maximum_copper_radius;
        let search_min_x = min(segment_start.x, segment_end.x) - broad_phase_margin;
        let search_min_y = min(segment_start.y, segment_end.y) - broad_phase_margin;
        let search_max_x = max(segment_start.x, segment_end.x) + broad_phase_margin;
        let search_max_y = max(segment_start.y, segment_end.y) + broad_phase_margin;
        let epsilon = 1e-9;
        let min_index_x = (search_min_x / self.cell_size).floor() as i64;
        let max_index_x = ((search_max_x + epsilon) / self.cell_size).floor() as i64;
        let min_index_y = (search_min_y / self.cell_size).floor() as i64;
        let max_index_y = ((search_max_y + epsilon) / self.cell_size).floor() as i64;
        let mut conflicting_route_data: IndexMap<String, (RouteRef, f64)> = IndexMap::new();
        let mut checked_segments = IndexSet::new();
        let mut checked_vias = IndexSet::new();
        let query_p1 = Point2 {
            x: segment_start.x,
            y: segment_start.y,
        };
        let query_p2 = Point2 {
            x: segment_end.x,
            y: segment_end.y,
        };
        for ix in min_index_x..=max_index_x {
            for iy in min_index_y..=max_index_y {
                if let Some(segment_bucket_list) = self.segment_buckets.get(&(ix, iy)) {
                    for segment_info in segment_bucket_list {
                        if !checked_segments.insert(&segment_info.segment_id) {
                            continue;
                        }
                        let route = segment_info.parent_route.borrow();
                        let p1 = point3(&segment_info.segment[0]);
                        let p2 = point3(&segment_info.segment[1]);
                        if segment_start.z != segment_end.z
                            || p1.z != p2.z
                            || p1.z != segment_start.z
                        {
                            continue;
                        }
                        let required_separation = margin + route.trace_thickness / 2.0;
                        let required_separation_sq = required_separation * required_separation;
                        let dist_sq =
                            segment_to_segment_distance_sq(segment_start, segment_end, &p1, &p2);
                        if dist_sq < required_separation_sq {
                            let existing = conflicting_route_data.get(&route.connection_name);
                            if existing.is_none() || dist_sq < existing.unwrap().1 {
                                conflicting_route_data.insert(
                                    route.connection_name.clone(),
                                    (segment_info.parent_route.clone(), dist_sq),
                                );
                            }
                        }
                    }
                }
                if let Some(via_bucket_list) = self.via_buckets.get(&(ix, iy)) {
                    for via_info in via_bucket_list {
                        if !checked_vias.insert(&via_info.via_id) {
                            continue;
                        }
                        let route = via_info.parent_route.borrow();
                        let via_point = Point2 {
                            x: via_info.x,
                            y: via_info.y,
                        };
                        let required_separation = margin + route.via_diameter / 2.0;
                        let required_separation_sq = required_separation * required_separation;
                        let dist_sq = point_to_segment_distance_sq(via_point, query_p1, query_p2);
                        if dist_sq < required_separation_sq {
                            let existing = conflicting_route_data.get(&route.connection_name);
                            if existing.is_none() || dist_sq < existing.unwrap().1 {
                                conflicting_route_data.insert(
                                    route.connection_name.clone(),
                                    (via_info.parent_route.clone(), dist_sq),
                                );
                            }
                        }
                    }
                }
            }
        }
        conflicting_route_data
            .into_values()
            .map(|(route, min_dist_sq)| RouteConflict {
                conflicting_route: route,
                distance: min_dist_sq.sqrt(),
            })
            .collect()
    }

    pub fn get_conflicting_routes_near_point(
        &self,
        point: &Point,
        margin: f64,
    ) -> Vec<RouteConflict> {
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
        let mut conflicting_route_data: IndexMap<String, (RouteRef, f64)> = IndexMap::new();
        let mut checked_segments = IndexSet::new();
        let mut checked_vias = IndexSet::new();
        let query_point = Point2 {
            x: point.x,
            y: point.y,
        };
        for ix in min_index_x..=max_index_x {
            for iy in min_index_y..=max_index_y {
                if let Some(segment_bucket_list) = self.segment_buckets.get(&(ix, iy)) {
                    for segment_info in segment_bucket_list {
                        if !checked_segments.insert(&segment_info.segment_id) {
                            continue;
                        }
                        let p1 = point3(&segment_info.segment[0]);
                        let p2 = point3(&segment_info.segment[1]);
                        if p1.z != p2.z || p1.z != point.z {
                            continue;
                        }
                        let route = segment_info.parent_route.borrow();
                        let required_separation = margin + route.trace_thickness / 2.0;
                        let required_separation_sq = required_separation * required_separation;
                        let dist_sq = point_to_segment_distance_sq(
                            query_point,
                            Point2 { x: p1.x, y: p1.y },
                            Point2 { x: p2.x, y: p2.y },
                        );
                        if dist_sq < required_separation_sq {
                            let existing = conflicting_route_data.get(&route.connection_name);
                            if existing.is_none() || dist_sq < existing.unwrap().1 {
                                conflicting_route_data.insert(
                                    route.connection_name.clone(),
                                    (segment_info.parent_route.clone(), dist_sq),
                                );
                            }
                        }
                    }
                }
                if let Some(via_bucket_list) = self.via_buckets.get(&(ix, iy)) {
                    for via_info in via_bucket_list {
                        if !checked_vias.insert(&via_info.via_id) {
                            continue;
                        }
                        let route = via_info.parent_route.borrow();
                        let via_point = Point2 {
                            x: via_info.x,
                            y: via_info.y,
                        };
                        let required_separation = margin + route.via_diameter / 2.0;
                        let required_separation_sq = required_separation * required_separation;
                        let dist_sq = compute_dist_sq(query_point, via_point);
                        if dist_sq < required_separation_sq {
                            let existing = conflicting_route_data.get(&route.connection_name);
                            if existing.is_none() || dist_sq < existing.unwrap().1 {
                                conflicting_route_data.insert(
                                    route.connection_name.clone(),
                                    (via_info.parent_route.clone(), dist_sq),
                                );
                            }
                        }
                    }
                }
            }
        }
        conflicting_route_data
            .into_values()
            .map(|(route, min_dist_sq)| RouteConflict {
                conflicting_route: route,
                distance: min_dist_sq.sqrt(),
            })
            .collect()
    }
}

pub trait RouteClearanceIndex {
    fn get_conflicting_routes_for_segment(
        &self,
        start: &Point,
        end: &Point,
        margin: f64,
    ) -> Vec<RouteConflict>;
    fn get_conflicting_routes_near_point(&self, point: &Point, margin: f64) -> Vec<RouteConflict>;
}
impl RouteClearanceIndex for HighDensityRouteSpatialIndex {
    fn get_conflicting_routes_for_segment(
        &self,
        start: &Point,
        end: &Point,
        margin: f64,
    ) -> Vec<RouteConflict> {
        HighDensityRouteSpatialIndex::get_conflicting_routes_for_segment(self, start, end, margin)
    }
    fn get_conflicting_routes_near_point(&self, point: &Point, margin: f64) -> Vec<RouteConflict> {
        HighDensityRouteSpatialIndex::get_conflicting_routes_near_point(self, point, margin)
    }
}
