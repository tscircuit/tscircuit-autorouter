use super::{
    break_route_into_sections::break_route_into_sections,
    can_endpoint_connect_on_layer::{TerminalLayers, can_endpoint_connect_on_layer},
    can_section_move_to_layer::can_section_move_to_layer,
    create_obstacle_detour_path_validator::create_obstacle_detour_path_validator,
    route_section::RouteSection,
};
use crate::bindings::high_density::specialized_base_solver::{BaseSolverState, SpecializedSolver};
use crate::bindings::trace_simplification::high_density_route_spatial_index::HighDensityRouteSpatialIndex;
use crate::bindings::trace_simplification::types::{
    ConnectivityMap, Math, Point2, PointRef, RouteRef, fresh_point, fresh_route, fresh_via, point2,
    spread_point,
};
use crate::data_structures::obstacle_tree::ObstacleSpatialHashIndex;
use crate::utils::js_number::js_number_to_string;
use crate::utils::{
    calculate_45_degree_paths::calculate_45_degree_paths,
    polygon_containment::does_segment_cross_polygon_boundary,
};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone)]
pub struct ViaPairShortcut {
    pub path: Vec<PointRef>,
    pub previous_point_index: usize,
    pub next_point_index: usize,
    pub saved_length: f64,
    pub validation_first_segment_index: Option<usize>,
}

pub struct ObstacleDetourPath {
    pub path: Vec<PointRef>,
    pub length: f64,
    pub longest_segment_index: usize,
}

#[derive(Clone, Copy)]
pub enum MergeWith {
    Previous,
    Next,
}

pub struct MultilayerSectionCollapse {
    pub target_z: f64,
    pub merge_with: MergeWith,
}

pub struct SingleRouteUselessViaRemovalSolverParams {
    pub obstacle_shi: Rc<RefCell<ObstacleSpatialHashIndex>>,
    pub hd_route_shi: Rc<RefCell<HighDensityRouteSpatialIndex>>,
    pub unsimplified_route: RouteRef,
    pub conn_map: Rc<ConnectivityMap>,
    pub outline: Option<Vec<Point2>>,
    pub terminal_layers: Option<Rc<TerminalLayers>>,
    pub options: Value,
    pub math: Math,
}

pub struct SingleRouteUselessViaRemovalSolver {
    pub identity: u64,
    pub route_sections_array_identity: u64,
    pub base: BaseSolverState,
    pub stats: Value,
    pub obstacle_shi: Rc<RefCell<ObstacleSpatialHashIndex>>,
    pub hd_route_shi: Rc<RefCell<HighDensityRouteSpatialIndex>>,
    pub unsimplified_route: RouteRef,
    pub conn_map: Rc<ConnectivityMap>,
    pub outline: Option<Vec<Point2>>,
    pub terminal_layers: Option<Rc<TerminalLayers>>,
    pub route_sections: Vec<RouteSection>,
    pub current_section_index: usize,
    pub trace_thickness: f64,
    pub obstacle_margin: f64,
    pub geometry_shortcut_trace_margin: f64,
    pub geometry_shortcut_obstacle_margin: f64,
    pub max_geometry_shortcut_added_length: f64,
    pub enable_geometry_shortcuts: bool,
    pub enable_obstacle_detour_shortcuts: bool,
    pub preserve_route_endpoints: bool,
    pub geometry_shortcuts_applied: usize,
    pub multilayer_sections_collapsed: usize,
    pub obstacle_detour_candidates_validated: usize,
    pub math: Math,
}

impl SingleRouteUselessViaRemovalSolver {
    pub fn new(params: SingleRouteUselessViaRemovalSolverParams) -> Self {
        let sections = break_route_into_sections(&params.unsimplified_route);
        Self {
            identity: crate::bindings::trace_simplification::types::next_identity(),
            route_sections_array_identity:
                crate::bindings::trace_simplification::types::next_identity(),
            base: BaseSolverState::default(),
            stats: json!({}),
            obstacle_shi: params.obstacle_shi,
            hd_route_shi: params.hd_route_shi,
            unsimplified_route: params.unsimplified_route,
            conn_map: params.conn_map,
            outline: params.outline,
            terminal_layers: params.terminal_layers,
            route_sections: sections,
            current_section_index: 0,
            trace_thickness: 0.15,
            obstacle_margin: 0.1,
            geometry_shortcut_trace_margin: params.options["geometryShortcutTraceMargin"]
                .as_f64()
                .unwrap_or(0.1),
            geometry_shortcut_obstacle_margin: params.options["geometryShortcutObstacleMargin"]
                .as_f64()
                .unwrap_or(0.15),
            max_geometry_shortcut_added_length: 4.0,
            enable_geometry_shortcuts: params.options["enableGeometryShortcuts"]
                .as_bool()
                .unwrap_or(true),
            enable_obstacle_detour_shortcuts: params.options["enableObstacleDetourShortcuts"]
                .as_bool()
                .unwrap_or(false),
            preserve_route_endpoints: params.options["preserveRouteEndpoints"]
                .as_bool()
                .unwrap_or(false),
            geometry_shortcuts_applied: 0,
            multilayer_sections_collapsed: 0,
            obstacle_detour_candidates_validated: 0,
            math: params.math,
        }
    }

    pub fn get_path_length(&self, points: &[PointRef]) -> f64 {
        let mut length = 0.0;
        for pair in points.windows(2) {
            let a = pair[0].borrow();
            let b = pair[1].borrow();
            length += (self.math.hypot)(b.x - a.x, b.y - a.y);
        }
        length
    }

    pub fn normalize_shortcut_path(
        &self,
        path: &[Point2],
        start: &PointRef,
        end: &PointRef,
    ) -> Vec<PointRef> {
        let unique: Vec<_> = path
            .iter()
            .enumerate()
            .filter(|(i, point)| *i == 0 || point.x != path[*i - 1].x || point.y != path[*i - 1].y)
            .collect();
        unique
            .iter()
            .enumerate()
            .map(|(index, (_, point))| {
                if index == 0 {
                    spread_point(start)
                } else if index == unique.len() - 1 {
                    spread_point(end)
                } else {
                    fresh_point(point.x, point.y, start.borrow().z)
                }
            })
            .collect()
    }

    pub fn shortcut_crosses_outline(&self, path: &[PointRef]) -> bool {
        let Some(outline) = self.outline.as_ref().filter(|outline| outline.len() >= 3) else {
            return false;
        };
        for pair in path.windows(2) {
            if does_segment_cross_polygon_boundary(point2(&pair[0]), point2(&pair[1]), outline, 0.2)
            {
                return true;
            }
        }
        false
    }

    pub fn get_obstacle_detour_paths(
        &self,
        start: &PointRef,
        end: &PointRef,
        target_z: f64,
        max_length: f64,
    ) -> Result<Vec<ObstacleDetourPath>, String> {
        let route = self.unsimplified_route.borrow();
        let thickness = if route
            .metadata
            .get("traceThickness")
            .is_none_or(Value::is_null)
        {
            self.trace_thickness
        } else {
            route.trace_thickness
        };
        let margin = thickness / 2.0 + self.geometry_shortcut_obstacle_margin + 1e-6;
        let expansion = self.max_geometry_shortcut_added_length / 2.0 + margin;
        let a = point2(start);
        let b = point2(end);
        let obstacles: Vec<_> = self
            .obstacle_shi
            .borrow()
            .search(&crate::bindings::trace_simplification::types::Bounds {
                min_x: crate::bindings::trace_simplification::math_utils::min(a.x, b.x) - expansion,
                max_x: crate::bindings::trace_simplification::math_utils::max(a.x, b.x) + expansion,
                min_y: crate::bindings::trace_simplification::math_utils::min(a.y, b.y) - expansion,
                max_y: crate::bindings::trace_simplification::math_utils::max(a.y, b.y) + expansion,
            })?
            .into_iter()
            .filter(|o| o.borrow().z_layers.contains(&target_z))
            .collect();
        if obstacles.is_empty() {
            return Ok(Vec::new());
        }
        let mut xs = Vec::new();
        let mut ys = Vec::new();
        for obstacle in obstacles {
            let obstacle = obstacle.borrow();
            for x in [
                obstacle.center.x - obstacle.width / 2.0 - margin,
                obstacle.center.x + obstacle.width / 2.0 + margin,
            ] {
                if !xs.contains(&x) {
                    xs.push(x);
                }
            }
            for y in [
                obstacle.center.y - obstacle.height / 2.0 - margin,
                obstacle.center.y + obstacle.height / 2.0 + margin,
            ] {
                if !ys.contains(&y) {
                    ys.push(y);
                }
            }
        }
        let mut paths = Vec::new();
        let mut keys = HashSet::new();
        let mut add_path = |points: Vec<Point2>| {
            let mut length = 0.0;
            for pair in points.windows(2) {
                length += (self.math.hypot)(pair[1].x - pair[0].x, pair[1].y - pair[0].y);
            }
            if length > max_length {
                return;
            }
            let path = self.normalize_shortcut_path(&points, start, end);
            let mut longest = 0;
            let mut longest_length = -1.0;
            for (index, pair) in path.windows(2).enumerate() {
                let a = pair[0].borrow();
                let b = pair[1].borrow();
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let length_squared = dx * dx + dy * dy;
                if length_squared > longest_length {
                    longest = index;
                    longest_length = length_squared;
                }
            }
            let key = path
                .iter()
                .map(|point| {
                    let p = point.borrow();
                    format!("{}:{}", js_number_to_string(p.x), js_number_to_string(p.y))
                })
                .collect::<Vec<_>>()
                .join("|");
            if !keys.insert(key) {
                return;
            }
            paths.push(ObstacleDetourPath {
                path,
                length,
                longest_segment_index: longest,
            });
        };
        for y in ys {
            add_path(vec![a, Point2 { x: a.x, y }, Point2 { x: b.x, y }, b]);
        }
        for x in xs {
            add_path(vec![a, Point2 { x, y: a.y }, Point2 { x, y: b.y }, b]);
        }
        Ok(paths)
    }

    pub fn get_direct_geometry_shortcut(
        &self,
        previous: &RouteSection,
        current: &RouteSection,
        next: &RouteSection,
    ) -> Result<Option<ViaPairShortcut>, String> {
        let mut best: Option<ViaPairShortcut> = None;
        for previous_index in 0..previous.points.len() {
            let start = &previous.points[previous_index];
            for next_index in 0..next.points.len() {
                let end = &next.points[next_index];
                let replaced: Vec<_> = previous.points[previous_index..]
                    .iter()
                    .chain(current.points.iter())
                    .chain(next.points[..=next_index].iter())
                    .cloned()
                    .collect();
                if replaced.iter().any(point_has_jumper) {
                    continue;
                }
                for possible in calculate_45_degree_paths(point2(start), point2(end)) {
                    let path = self.normalize_shortcut_path(&possible, start, end);
                    let saved = self.get_path_length(&replaced) - self.get_path_length(&path);
                    if saved < -1e-6 || self.shortcut_crosses_outline(&path) {
                        continue;
                    }
                    let section = RouteSection {
                        identity: crate::bindings::trace_simplification::types::next_identity(),
                        points_array_identity:
                            crate::bindings::trace_simplification::types::next_identity(),
                        start_index: previous.start_index + previous_index,
                        end_index: (next.start_index + next_index) as isize,
                        z: previous.z,
                        points: path.clone(),
                    };
                    if !self.can_move(
                        &section,
                        previous.z,
                        self.geometry_shortcut_obstacle_margin,
                        Some(self.geometry_shortcut_trace_margin),
                    )? {
                        continue;
                    }
                    if best.as_ref().is_none_or(|best| saved > best.saved_length) {
                        best = Some(ViaPairShortcut {
                            path,
                            previous_point_index: previous_index,
                            next_point_index: next_index,
                            saved_length: saved,
                            validation_first_segment_index: None,
                        });
                    }
                }
            }
        }
        Ok(best)
    }

    pub fn get_obstacle_detour_shortcut(
        &mut self,
        previous: &RouteSection,
        current: &RouteSection,
        next: &RouteSection,
    ) -> Result<Option<ViaPairShortcut>, String> {
        let transition = previous.points.len() - 1;
        let mut anchors: Vec<_> = (0..=transition).map(|i| (i, 0)).collect();
        anchors.extend((1..next.points.len()).map(|i| (transition, i)));
        let mut candidates = Vec::new();
        for (previous_index, next_index) in anchors {
            let start = &previous.points[previous_index];
            let end = &next.points[next_index];
            let replaced: Vec<_> = previous.points[previous_index..]
                .iter()
                .chain(current.points.iter())
                .chain(next.points[..=next_index].iter())
                .cloned()
                .collect();
            if replaced.iter().any(point_has_jumper) {
                continue;
            }
            let replaced_length = self.get_path_length(&replaced);
            for detour in self.get_obstacle_detour_paths(
                start,
                end,
                previous.z,
                replaced_length + self.max_geometry_shortcut_added_length + 1e-6,
            )? {
                let saved = replaced_length - detour.length;
                if saved < -self.max_geometry_shortcut_added_length - 1e-6 {
                    continue;
                }
                candidates.push(ViaPairShortcut {
                    path: detour.path,
                    previous_point_index: previous_index,
                    next_point_index: next_index,
                    saved_length: saved,
                    validation_first_segment_index: Some(detour.longest_segment_index),
                });
            }
        }
        self.find_valid_obstacle_detour_shortcut(candidates, previous.z)
    }

    fn find_valid_obstacle_detour_shortcut(
        &mut self,
        mut candidates: Vec<ViaPairShortcut>,
        target_z: f64,
    ) -> Result<Option<ViaPairShortcut>, String> {
        candidates.sort_by(|a, b| {
            (b.saved_length - a.saved_length)
                .partial_cmp(&0.0)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let mut validated = 0;
        let hd_routes = self.hd_route_shi.borrow();
        let obstacles = self.obstacle_shi.borrow();
        let mut validator = create_obstacle_detour_path_validator(
            target_z,
            &self.unsimplified_route,
            &hd_routes,
            &obstacles,
            &self.conn_map,
            self.trace_thickness,
            self.geometry_shortcut_obstacle_margin,
            self.geometry_shortcut_trace_margin,
            candidates.len() >= 256,
        );
        for shortcut in candidates {
            validated += 1;
            if !validator.validate(
                &shortcut.path,
                shortcut.validation_first_segment_index.unwrap_or(0),
            )? {
                continue;
            }
            if self.shortcut_crosses_outline(&shortcut.path) {
                continue;
            }
            self.obstacle_detour_candidates_validated += validated;
            self.stats["obstacleDetourCandidatesValidated"] =
                json!(self.obstacle_detour_candidates_validated);
            return Ok(Some(shortcut));
        }
        self.obstacle_detour_candidates_validated += validated;
        self.stats["obstacleDetourCandidatesValidated"] =
            json!(self.obstacle_detour_candidates_validated);
        Ok(None)
    }

    pub fn find_geometry_shortcut(
        &mut self,
        previous: &RouteSection,
        current: &RouteSection,
        next: &RouteSection,
    ) -> Result<Option<ViaPairShortcut>, String> {
        if self.unsimplified_route.borrow().has_jumpers() {
            return Ok(None);
        }
        if self.enable_geometry_shortcuts
            && let Some(shortcut) = self.get_direct_geometry_shortcut(previous, current, next)?
        {
            return Ok(Some(shortcut));
        }
        if !self.enable_obstacle_detour_shortcuts {
            return Ok(None);
        }
        self.get_obstacle_detour_shortcut(previous, current, next)
    }

    pub fn apply_geometry_shortcut(&mut self, shortcut: ViaPairShortcut) {
        let previous = &self.route_sections[self.current_section_index - 1];
        let next = &self.route_sections[self.current_section_index + 1];
        let combined = previous.points[..shortcut.previous_point_index]
            .iter()
            .chain(shortcut.path.iter())
            .chain(next.points[shortcut.next_point_index + 1..].iter())
            .cloned()
            .collect();
        let section = RouteSection {
            identity: crate::bindings::trace_simplification::types::next_identity(),
            points_array_identity: crate::bindings::trace_simplification::types::next_identity(),
            start_index: previous.start_index,
            end_index: next.end_index,
            z: previous.z,
            points: remove_consecutive_duplicates(combined),
        };
        self.route_sections.splice(
            self.current_section_index - 1..self.current_section_index + 2,
            [section],
        );
        self.geometry_shortcuts_applied += 1;
        self.stats["geometryShortcutsApplied"] = json!(self.geometry_shortcuts_applied);
        self.stats["viasRemovedByGeometryShortcuts"] = json!(self.geometry_shortcuts_applied * 2);
        self.current_section_index = self.current_section_index.saturating_sub(1);
    }

    pub fn find_multilayer_section_collapse(
        &self,
        previous: &RouteSection,
        current: &RouteSection,
        next: &RouteSection,
    ) -> Result<Option<MultilayerSectionCollapse>, String> {
        if previous.z == next.z || self.unsimplified_route.borrow().has_jumpers() {
            return Ok(None);
        }
        if previous.points.last().is_some_and(point_has_jumper)
            || current.points.iter().any(point_has_jumper)
        {
            return Ok(None);
        }
        for (target_z, merge_with) in [(previous.z, MergeWith::Previous), (next.z, MergeWith::Next)]
        {
            if target_z != current.z
                && self.can_move(
                    current,
                    target_z,
                    self.geometry_shortcut_obstacle_margin,
                    Some(self.geometry_shortcut_trace_margin),
                )?
            {
                return Ok(Some(MultilayerSectionCollapse {
                    target_z,
                    merge_with,
                }));
            }
        }
        Ok(None)
    }

    pub fn apply_multilayer_section_collapse(&mut self, collapse: MultilayerSectionCollapse) {
        let previous = &self.route_sections[self.current_section_index - 1];
        let current = &self.route_sections[self.current_section_index];
        let next = &self.route_sections[self.current_section_index + 1];
        let moved: Vec<_> = current
            .points
            .iter()
            .map(|point| {
                let copy = spread_point(point);
                copy.borrow_mut().z = collapse.target_z;
                copy
            })
            .collect();
        let (index, section) = match collapse.merge_with {
            MergeWith::Previous => (
                self.current_section_index - 1,
                RouteSection {
                    identity: crate::bindings::trace_simplification::types::next_identity(),
                    points_array_identity:
                        crate::bindings::trace_simplification::types::next_identity(),
                    start_index: previous.start_index,
                    end_index: current.end_index,
                    z: collapse.target_z,
                    points: remove_consecutive_duplicates(
                        previous
                            .points
                            .iter()
                            .chain(moved.iter())
                            .cloned()
                            .collect(),
                    ),
                },
            ),
            MergeWith::Next => (
                self.current_section_index,
                RouteSection {
                    identity: crate::bindings::trace_simplification::types::next_identity(),
                    points_array_identity:
                        crate::bindings::trace_simplification::types::next_identity(),
                    start_index: current.start_index,
                    end_index: next.end_index,
                    z: collapse.target_z,
                    points: remove_consecutive_duplicates(
                        moved.iter().chain(next.points.iter()).cloned().collect(),
                    ),
                },
            ),
        };
        self.route_sections.splice(index..index + 2, [section]);
        self.multilayer_sections_collapsed += 1;
        self.stats["multilayerSectionsCollapsed"] = json!(self.multilayer_sections_collapsed);
        self.stats["viasRemovedByMultilayerSectionCollapses"] =
            json!(self.multilayer_sections_collapsed);
        self.current_section_index = self.current_section_index.saturating_sub(1);
    }

    pub fn can_move(
        &self,
        section: &RouteSection,
        target_z: f64,
        obstacle_margin: f64,
        trace_margin: Option<f64>,
    ) -> Result<bool, String> {
        can_section_move_to_layer(
            section,
            target_z,
            &self.unsimplified_route,
            &*self.hd_route_shi.borrow(),
            &self.obstacle_shi.borrow(),
            &self.conn_map,
            self.trace_thickness,
            obstacle_margin,
            trace_margin,
            None,
        )
    }

    pub fn get_optimized_hd_route(&self) -> RouteRef {
        let points: Vec<_> = self
            .route_sections
            .iter()
            .flat_map(|section| section.points.iter().cloned())
            .collect();
        let mut vias = Vec::new();
        for pair in points.windows(2) {
            let a = pair[0].borrow();
            let b = pair[1].borrow();
            if a.z != b.z {
                vias.push(fresh_via(a.x, a.y));
            }
        }
        let route = self.unsimplified_route.borrow();
        let mut output = json!({"connectionName":route.connection_name});
        for key in ["rootConnectionName", "startPcbPortId", "endPcbPortId"] {
            if let Some(value) = route.metadata.get(key) {
                output[key] = value.clone();
            }
        }
        output["route"] = json!([]);
        if let Some(value) = route.metadata.get("traceThickness") {
            output["traceThickness"] = value.clone();
        }
        output["vias"] = json!([]);
        if let Some(value) = route.metadata.get("viaDiameter") {
            output["viaDiameter"] = value.clone();
        }
        if let Some(value) = route.jumpers_value() {
            output["jumpers"] = value;
        }
        let output = fresh_route(output, points, vias);
        output.borrow_mut().source_metadata_identity = Some(route.identity);
        output.borrow_mut().jumpers = route.jumpers.clone();
        output.borrow_mut().jumpers_identity = route.jumpers_identity;
        output
    }
}

impl SpecializedSolver for SingleRouteUselessViaRemovalSolver {
    fn base(&self) -> &BaseSolverState {
        &self.base
    }
    fn base_mut(&mut self) -> &mut BaseSolverState {
        &mut self.base
    }
    fn get_solver_name(&self) -> &'static str {
        "SingleRouteUselessViaRemovalSolver"
    }

    fn _step(&mut self) -> Result<(), String> {
        crate::bindings::trace_simplification::connectivity_read_barrier::check(&self.conn_map)?;
        if self.current_section_index >= self.route_sections.len() {
            self.base.solved = true;
            return Ok(());
        }
        if self.current_section_index == 0 && self.route_sections.len() > 1 {
            let first = self.route_sections[0].clone();
            let second = self.route_sections[1].clone();
            if !self.preserve_route_endpoints && first.z != second.z {
                let target = second.z;
                let point = first.points[0].borrow();
                let route = self.unsimplified_route.borrow();
                let supported = can_endpoint_connect_on_layer(
                    point.x,
                    point.y,
                    target,
                    route.metadata["startPcbPortId"].as_str(),
                    self.terminal_layers.as_deref(),
                    &self.obstacle_shi.borrow(),
                    &self.unsimplified_route,
                    &self.conn_map,
                )?;
                drop(route);
                drop(point);
                if supported && self.can_move(&first, target, self.obstacle_margin, None)? {
                    self.route_sections[0].z = target;
                    self.route_sections[0].points_array_identity =
                        crate::bindings::trace_simplification::types::next_identity();
                    self.route_sections[0].points = first
                        .points
                        .iter()
                        .map(|point| {
                            let copy = spread_point(point);
                            copy.borrow_mut().z = target;
                            copy
                        })
                        .collect();
                    self.current_section_index = 2;
                    return Ok(());
                }
            }
            self.current_section_index += 1;
            return Ok(());
        }
        if self.current_section_index == self.route_sections.len() - 1 {
            if !self.preserve_route_endpoints && self.route_sections.len() >= 2 {
                let index = self.route_sections.len() - 1;
                let last = self.route_sections[index].clone();
                let previous = self.route_sections[index - 1].clone();
                if last.z != previous.z {
                    let target = previous.z;
                    let point = last.points.last().unwrap().borrow();
                    let route = self.unsimplified_route.borrow();
                    let supported = can_endpoint_connect_on_layer(
                        point.x,
                        point.y,
                        target,
                        route.metadata["endPcbPortId"].as_str(),
                        self.terminal_layers.as_deref(),
                        &self.obstacle_shi.borrow(),
                        &self.unsimplified_route,
                        &self.conn_map,
                    )?;
                    drop(route);
                    drop(point);
                    if supported && self.can_move(&last, target, self.obstacle_margin, None)? {
                        self.route_sections[index].z = target;
                        self.route_sections[index].points_array_identity =
                            crate::bindings::trace_simplification::types::next_identity();
                        self.route_sections[index].points = last
                            .points
                            .iter()
                            .map(|point| {
                                let copy = spread_point(point);
                                copy.borrow_mut().z = target;
                                copy
                            })
                            .collect();
                    }
                }
            }
            self.base.solved = true;
            return Ok(());
        }
        let previous = self.route_sections[self.current_section_index - 1].clone();
        let current = self.route_sections[self.current_section_index].clone();
        let next = self.route_sections[self.current_section_index + 1].clone();
        if previous.z != next.z {
            if let Some(collapse) =
                self.find_multilayer_section_collapse(&previous, &current, &next)?
            {
                self.apply_multilayer_section_collapse(collapse);
                return Ok(());
            }
            self.current_section_index += 1;
            return Ok(());
        }
        let target = previous.z;
        if self.can_move(&current, target, self.obstacle_margin, None)? {
            self.route_sections[self.current_section_index].z = target;
            self.route_sections[self.current_section_index].points_array_identity =
                crate::bindings::trace_simplification::types::next_identity();
            self.route_sections[self.current_section_index].points = current
                .points
                .iter()
                .map(|point| {
                    let copy = spread_point(point);
                    copy.borrow_mut().z = target;
                    copy
                })
                .collect();
            self.current_section_index += 2;
            return Ok(());
        }
        if let Some(shortcut) = self.find_geometry_shortcut(&previous, &current, &next)? {
            self.apply_geometry_shortcut(shortcut);
            return Ok(());
        }
        self.current_section_index += 1;
        Ok(())
    }
}

fn point_has_jumper(point: &PointRef) -> bool {
    let point = point.borrow();
    let truthy = |value: &Value| match value {
        Value::Null => false,
        Value::Bool(v) => *v,
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    };
    truthy(&point.metadata["insideJumperPad"]) || truthy(&point.metadata["toNextSegmentType"])
}

fn remove_consecutive_duplicates(points: Vec<PointRef>) -> Vec<PointRef> {
    points
        .iter()
        .enumerate()
        .filter(|(index, point)| {
            if *index == 0 {
                return true;
            }
            let a = point.borrow();
            let b = points[*index - 1].borrow();
            a.x != b.x || a.y != b.y || a.z != b.z
        })
        .map(|(_, point)| point.clone())
        .collect()
}

impl SingleRouteUselessViaRemovalSolver {
    pub fn snapshot(
        &self,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Value {
        let mut fields = serde_json::to_value(&self.base).expect("Base state serializes");
        fields["identity"] = json!(self.identity);
        fields["stats"] = codec.raw(self.stats.clone());
        fields["unsimplifiedRoute"] = codec.route(&self.unsimplified_route);
        fields["routeSections"] = json!({"$array":self.route_sections_array_identity,
            "items":self.route_sections.iter().map(|section| section.snapshot(codec)).collect::<Vec<_>>()});
        fields["currentSectionIndex"] = json!(self.current_section_index);
        fields["TRACE_THICKNESS"] = json!(self.trace_thickness);
        fields["OBSTACLE_MARGIN"] = json!(self.obstacle_margin);
        fields["GEOMETRY_SHORTCUT_TRACE_MARGIN"] = json!(self.geometry_shortcut_trace_margin);
        fields["GEOMETRY_SHORTCUT_OBSTACLE_MARGIN"] = json!(self.geometry_shortcut_obstacle_margin);
        fields["MAX_GEOMETRY_SHORTCUT_ADDED_LENGTH"] =
            json!(self.max_geometry_shortcut_added_length);
        fields["ENABLE_GEOMETRY_SHORTCUTS"] = json!(self.enable_geometry_shortcuts);
        fields["ENABLE_OBSTACLE_DETOUR_SHORTCUTS"] = json!(self.enable_obstacle_detour_shortcuts);
        fields["PRESERVE_ROUTE_ENDPOINTS"] = json!(self.preserve_route_endpoints);
        fields["geometryShortcutsApplied"] = json!(self.geometry_shortcuts_applied);
        fields["multilayerSectionsCollapsed"] = json!(self.multilayer_sections_collapsed);
        fields["obstacleDetourCandidatesValidated"] =
            json!(self.obstacle_detour_candidates_validated);
        fields["outline"] = codec.raw(serde_json::to_value(&self.outline).unwrap());
        fields["connMap"] = codec.connectivity(&self.conn_map);
        fields["terminalLayerIndicesByPcbPortId"] = self
            .terminal_layers
            .as_ref()
            .map(|map| codec.terminal_layers(map))
            .unwrap_or(Value::Null);
        fields
    }

    pub fn restore(
        &mut self,
        fields: &Value,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Result<(), String> {
        let mut base = serde_json::to_value(&self.base).unwrap();
        for key in [
            "MAX_ITERATIONS",
            "solved",
            "failed",
            "iterations",
            "progress",
            "error",
        ] {
            if let Some(value) = fields.get(key) {
                base[key] = value.clone();
            }
        }
        self.base = serde_json::from_value(base).map_err(|error| error.to_string())?;
        if let Some(value) = fields.get("stats") {
            self.stats = codec.read_raw(value);
        }
        if let Some(value) = fields.get("unsimplifiedRoute") {
            self.unsimplified_route = codec.read_route(value)?;
        }
        if let Some(value) = fields.get("routeSections") {
            let items = value
                .get("items")
                .unwrap_or(value)
                .as_array()
                .ok_or("Route sections array required")?;
            self.route_sections = items
                .iter()
                .map(|value| RouteSection::restore(value, codec))
                .collect::<Result<_, _>>()?;
            if let Some(id) = value["$array"].as_u64() {
                self.route_sections_array_identity = id;
            }
        }
        macro_rules! number {
            ($key:literal, $field:ident) => {
                if let Some(value) = fields.get($key) {
                    self.$field = value.as_f64().ok_or(concat!($key, " must be numeric"))?;
                }
            };
        }
        macro_rules! integer {
            ($key:literal, $field:ident) => {
                if let Some(value) = fields.get($key) {
                    self.$field =
                        value.as_u64().ok_or(concat!($key, " must be an integer"))? as usize;
                }
            };
        }
        macro_rules! boolean {
            ($key:literal, $field:ident) => {
                if let Some(value) = fields.get($key) {
                    self.$field = value.as_bool().ok_or(concat!($key, " must be boolean"))?;
                }
            };
        }
        number!("TRACE_THICKNESS", trace_thickness);
        number!("OBSTACLE_MARGIN", obstacle_margin);
        number!(
            "GEOMETRY_SHORTCUT_TRACE_MARGIN",
            geometry_shortcut_trace_margin
        );
        number!(
            "GEOMETRY_SHORTCUT_OBSTACLE_MARGIN",
            geometry_shortcut_obstacle_margin
        );
        number!(
            "MAX_GEOMETRY_SHORTCUT_ADDED_LENGTH",
            max_geometry_shortcut_added_length
        );
        integer!("currentSectionIndex", current_section_index);
        integer!("geometryShortcutsApplied", geometry_shortcuts_applied);
        integer!("multilayerSectionsCollapsed", multilayer_sections_collapsed);
        integer!(
            "obstacleDetourCandidatesValidated",
            obstacle_detour_candidates_validated
        );
        boolean!("ENABLE_GEOMETRY_SHORTCUTS", enable_geometry_shortcuts);
        boolean!(
            "ENABLE_OBSTACLE_DETOUR_SHORTCUTS",
            enable_obstacle_detour_shortcuts
        );
        boolean!("PRESERVE_ROUTE_ENDPOINTS", preserve_route_endpoints);
        if let Some(value) = fields.get("outline") {
            self.outline =
                serde_json::from_value(codec.read_raw(value)).map_err(|error| error.to_string())?;
        }
        if let Some(value) = fields.get("connMap") {
            self.conn_map = codec.read_connectivity(value)?;
        }
        if let Some(value) = fields.get("terminalLayerIndicesByPcbPortId") {
            self.terminal_layers = if value.is_null() {
                None
            } else {
                Some(codec.read_terminal_layers(value)?)
            };
        }
        Ok(())
    }

    pub fn get_optimized_hd_route_graph(
        &mut self,
        _args: &Value,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Result<Value, String> {
        Ok(codec.route(&self.get_optimized_hd_route()))
    }

    pub fn get_path_length_graph(
        &mut self,
        args: &Value,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Result<Value, String> {
        Ok(json!(self.get_path_length(&codec.read_points(&args[0])?)))
    }

    pub fn normalize_shortcut_path_graph(
        &mut self,
        args: &Value,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Result<Value, String> {
        let path: Vec<Point2> =
            serde_json::from_value(codec.read_raw(&args[0])).map_err(|error| error.to_string())?;
        let start = codec.read_point(&args[1])?;
        let end = codec.read_point(&args[2])?;
        Ok(codec.points(&self.normalize_shortcut_path(&path, &start, &end)))
    }

    pub fn shortcut_crosses_outline_graph(
        &mut self,
        args: &Value,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Result<Value, String> {
        Ok(json!(
            self.shortcut_crosses_outline(&codec.read_points(&args[0])?)
        ))
    }

    pub fn get_obstacle_detour_paths_graph(
        &mut self,
        args: &Value,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Result<Value, String> {
        let start = codec.read_point(&args[0])?;
        let end = codec.read_point(&args[1])?;
        let paths = self.get_obstacle_detour_paths(
            &start,
            &end,
            args[2].as_f64().ok_or("targetZ required")?,
            args[3].as_f64().ok_or("maxPathLength required")?,
        )?;
        Ok(Value::Array(paths.into_iter().map(|path| json!({"path":codec.points(&path.path),"length":path.length,"longestSegmentIndex":path.longest_segment_index})).collect()))
    }

    pub fn get_direct_geometry_shortcut_graph(
        &mut self,
        args: &Value,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Result<Value, String> {
        let previous = RouteSection::restore(&args[0], codec)?;
        let current = RouteSection::restore(&args[1], codec)?;
        let next = RouteSection::restore(&args[2], codec)?;
        let shortcut = self.get_direct_geometry_shortcut(&previous, &current, &next)?;
        Ok(shortcut.map(|shortcut| {
                    let mut value = json!({"path":codec.points(&shortcut.path),"previousPointIndex":shortcut.previous_point_index,"nextPointIndex":shortcut.next_point_index,"savedLength":shortcut.saved_length});
                    if let Some(index) = shortcut.validation_first_segment_index { value["validationFirstSegmentIndex"] = json!(index); }
                    value
                }).unwrap_or(Value::Null))
    }

    pub fn get_obstacle_detour_shortcut_graph(
        &mut self,
        args: &Value,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Result<Value, String> {
        let previous = RouteSection::restore(&args[0], codec)?;
        let current = RouteSection::restore(&args[1], codec)?;
        let next = RouteSection::restore(&args[2], codec)?;
        let shortcut = self.get_obstacle_detour_shortcut(&previous, &current, &next)?;
        Ok(shortcut.map(|shortcut| {
                    let mut value = json!({"path":codec.points(&shortcut.path),"previousPointIndex":shortcut.previous_point_index,"nextPointIndex":shortcut.next_point_index,"savedLength":shortcut.saved_length});
                    if let Some(index) = shortcut.validation_first_segment_index { value["validationFirstSegmentIndex"] = json!(index); }
                    value
                }).unwrap_or(Value::Null))
    }

    pub fn find_geometry_shortcut_graph(
        &mut self,
        args: &Value,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Result<Value, String> {
        let previous = RouteSection::restore(&args[0], codec)?;
        let current = RouteSection::restore(&args[1], codec)?;
        let next = RouteSection::restore(&args[2], codec)?;
        let shortcut = self.find_geometry_shortcut(&previous, &current, &next)?;
        Ok(shortcut.map(|shortcut| {
                    let mut value = json!({"path":codec.points(&shortcut.path),"previousPointIndex":shortcut.previous_point_index,"nextPointIndex":shortcut.next_point_index,"savedLength":shortcut.saved_length});
                    if let Some(index) = shortcut.validation_first_segment_index { value["validationFirstSegmentIndex"] = json!(index); }
                    value
                }).unwrap_or(Value::Null))
    }

    pub fn find_multilayer_section_collapse_graph(
        &mut self,
        args: &Value,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Result<Value, String> {
        let previous = RouteSection::restore(&args[0], codec)?;
        let current = RouteSection::restore(&args[1], codec)?;
        let next = RouteSection::restore(&args[2], codec)?;
        Ok(self.find_multilayer_section_collapse(&previous, &current, &next)?.map(|collapse| json!({"targetZ":collapse.target_z,"mergeWith":match collapse.merge_with { MergeWith::Previous=>"previous",MergeWith::Next=>"next" }})).unwrap_or(Value::Null))
    }

    pub fn apply_geometry_shortcut_graph(
        &mut self,
        args: &Value,
        codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Result<Value, String> {
        let value = &args[0];
        self.apply_geometry_shortcut(ViaPairShortcut {
            path: codec.read_points(&value["path"])?,
            previous_point_index: value["previousPointIndex"]
                .as_u64()
                .ok_or("previousPointIndex required")? as usize,
            next_point_index: value["nextPointIndex"]
                .as_u64()
                .ok_or("nextPointIndex required")? as usize,
            saved_length: value["savedLength"]
                .as_f64()
                .ok_or("savedLength required")?,
            validation_first_segment_index: value["validationFirstSegmentIndex"]
                .as_u64()
                .map(|v| v as usize),
        });
        Ok(Value::Null)
    }

    pub fn apply_multilayer_section_collapse_graph(
        &mut self,
        args: &Value,
        _codec: &mut crate::bindings::trace_simplification::graph_codec::GraphCodec,
    ) -> Result<Value, String> {
        let merge_with = match args[0]["mergeWith"].as_str() {
            Some("previous") => MergeWith::Previous,
            Some("next") => MergeWith::Next,
            _ => return Err("Unknown mergeWith".into()),
        };
        self.apply_multilayer_section_collapse(MultilayerSectionCollapse {
            target_z: args[0]["targetZ"].as_f64().ok_or("targetZ required")?,
            merge_with,
        });
        Ok(Value::Null)
    }
}

#[cfg(test)]
#[path = "obstacle_detour_cache_test.rs"]
mod obstacle_detour_cache_test;
