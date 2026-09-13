use super::calculate_side_traversal::calculate_traversal_percentages;
use super::compute_turn_direction::compute_turn_direction;
use crate::bindings::high_density::specialized_base_solver::{BaseSolverState, SpecializedSolver};
use crate::bindings::high_density::specialized_utils::classify_point_in_bounds::classify_point_in_bounds;
use crate::bindings::high_density::specialized_utils::find_closest_point_to_abc_within_bounds::find_closest_point_to_abc_within_bounds;
use crate::bindings::high_density::specialized_utils::find_point_to_get_around_circle::{
    Circle, find_point_to_get_around_circle,
};
use crate::bindings::high_density::specialized_utils::math::{
    Bounds, Point, SpecializedMath, clamp, do_segments_intersect,
};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    #[serde(rename = "A")]
    pub a: Value,
    #[serde(rename = "B")]
    pub b: Value,
    pub connection_name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleTransitionCrossingRouteSolver {
    #[serde(flatten)]
    pub base: BaseSolverState,
    pub node_with_port_points: Value,
    pub routes: Vec<Route>,
    pub via_diameter: f64,
    pub trace_thickness: f64,
    pub obstacle_margin: f64,
    pub layer_count: f64,
    pub debug_via_positions: Vec<Value>,
    pub solved_routes: Vec<Value>,
    pub bounds: Bounds,
    #[serde(skip)]
    pub math: SpecializedMath,
}

impl SingleTransitionCrossingRouteSolver {
    pub fn new(params: Value) -> Result<Self, String> {
        Self::new_with_math(params, SpecializedMath::default())
    }
    pub fn new_with_math(params: Value, math: SpecializedMath) -> Result<Self, String> {
        let node = params["nodeWithPortPoints"].clone();
        let mut solver = Self {
            base: BaseSolverState::default(),
            node_with_port_points: node,
            routes: vec![],
            via_diameter: params["viaDiameter"].as_f64().unwrap_or(0.3),
            trace_thickness: params["traceThickness"].as_f64().unwrap_or(0.15),
            obstacle_margin: params["obstacleMargin"].as_f64().unwrap_or(0.1),
            layer_count: params["layerCount"].as_f64().unwrap_or(2.0),
            debug_via_positions: vec![],
            solved_routes: vec![],
            bounds: Bounds::default(),
            math,
        };
        solver.routes = solver.extract_routes_from_node()?;
        solver.bounds = solver.calculate_bounds();
        if solver.routes.len() != 2 {
            solver.base.failed = true;
            solver.base.error = Some(format!(
                "Expected 2 routes, but got {}",
                solver.routes.len()
            ));
            return Ok(solver);
        }
        let positions: Vec<&str> = solver
            .routes
            .iter()
            .flat_map(|r| [&r.a, &r.b])
            .map(|p| solver.get_port_point_bounds_position(Point::from_value(p)))
            .collect();
        if positions.contains(&"outside") {
            solver.base.failed = true;
            solver.base.error=Some("Invalid route input: SingleTransitionCrossingRouteSolver received port point(s) outside node bounds".into());
            return Ok(solver);
        }
        if positions.contains(&"inside") {
            solver.base.failed = true;
            return Ok(solver);
        }
        solver.routes = solver
            .routes
            .iter()
            .map(|r| Route {
                a: solver.snap_port_point_to_bounds(&r.a),
                b: solver.snap_port_point_to_bounds(&r.b),
                connection_name: r.connection_name.clone(),
            })
            .collect();
        let a = solver.routes[0].a["z"] != solver.routes[0].b["z"];
        let b = solver.routes[1].a["z"] != solver.routes[1].b["z"];
        if a && b || !a && !b {
            solver.base.failed = true;
            solver.base.error = Some("Exactly one route must have a layer transition".into());
        }
        Ok(solver)
    }
    pub fn extract_routes_from_node(&self) -> Result<Vec<Route>, String> {
        let mut groups: IndexMap<String, Vec<&Value>> = IndexMap::new();
        for p in self.node_with_port_points["portPoints"]
            .as_array()
            .ok_or("portPoints is required")?
        {
            groups
                .entry(
                    p["connectionName"]
                        .as_str()
                        .ok_or("connectionName is required")?
                        .to_owned(),
                )
                .or_default()
                .push(p);
        }
        let mut routes = vec![];
        for (name, points) in groups {
            if points.len() == 2 {
                let mut a = points[0].clone();
                let mut b = points[1].clone();
                a["z"] = json!(a["z"].as_f64().unwrap_or(0.0));
                b["z"] = json!(b["z"].as_f64().unwrap_or(0.0));
                routes.push(Route {
                    a,
                    b,
                    connection_name: name,
                });
            }
        }
        Ok(routes)
    }
    pub fn calculate_bounds(&self) -> Bounds {
        let n = &self.node_with_port_points;
        let c = Point::from_value(&n["center"]);
        let w = n["width"].as_f64().unwrap_or(f64::NAN);
        let h = n["height"].as_f64().unwrap_or(f64::NAN);
        Bounds {
            min_x: c.x - w / 2.0,
            max_x: c.x + w / 2.0,
            min_y: c.y - h / 2.0,
            max_y: c.y + h / 2.0,
        }
    }
    pub fn get_port_point_bounds_position(&self, point: Point) -> &'static str {
        classify_point_in_bounds(point, self.bounds, None)
    }
    pub fn snap_port_point_to_bounds(&self, point: &Value) -> Value {
        let p = Point::from_value(point);
        let b = self.bounds;
        let x = clamp(p.x, b.min_x, b.max_x);
        let y = clamp(p.y, b.min_y, b.max_y);
        let candidates = [
            ((p.y - b.max_y).abs(), x, b.max_y),
            ((p.x - b.max_x).abs(), b.max_x, y),
            ((p.y - b.min_y).abs(), x, b.min_y),
            ((p.x - b.min_x).abs(), b.min_x, y),
        ];
        let mut closest = candidates[0];
        for candidate in &candidates[1..] {
            if candidate.0 < closest.0 {
                closest = *candidate;
            }
        }
        let mut result = point.clone();
        result["x"] = json!(closest.1);
        result["y"] = json!(closest.2);
        result
    }
    pub fn do_routes_cross(&self, a: &Route, b: &Route) -> bool {
        do_segments_intersect(
            Point::from_value(&a.a),
            Point::from_value(&a.b),
            Point::from_value(&b.a),
            Point::from_value(&b.b),
        )
    }
    pub fn calculate_via_position(
        &self,
        transition: &Route,
        flat: &Route,
    ) -> Result<Option<Point>, String> {
        let ntr = if transition.a["z"] != flat.a["z"] {
            &transition.a
        } else {
            &transition.b
        };
        let with = self.obstacle_margin * 2.0 + self.via_diameter / 2.0 + self.trace_thickness;
        let without = self.obstacle_margin + self.via_diameter / 2.0;
        let a = Point::from_value(&flat.a);
        let b = Point::from_value(ntr);
        let c = Point::from_value(&flat.b);
        let direction = compute_turn_direction(a, b, c, self.bounds, self.math)?;
        let side = calculate_traversal_percentages(a, b, c, self.bounds, Some(direction))?;
        let mut bounds = Bounds {
            min_x: self.bounds.min_x + if side.left > 0.5 { with } else { without },
            min_y: self.bounds.min_y + if side.bottom > 0.5 { with } else { without },
            max_x: self.bounds.max_x - if side.right > 0.5 { with } else { without },
            max_y: self.bounds.max_y - if side.top > 0.5 { with } else { without },
        };
        if bounds.max_y < bounds.min_y {
            bounds.min_y = (bounds.min_y + bounds.max_y) / 2.0;
            bounds.max_y = bounds.min_y;
        }
        if bounds.max_x < bounds.min_x {
            bounds.min_x = (bounds.min_x + bounds.max_x) / 2.0;
            bounds.max_x = bounds.min_x;
        }
        Ok(Some(find_closest_point_to_abc_within_bounds(
            a, b, c, with, bounds,
        )))
    }
    pub fn create_transition_route(
        &self,
        start: &Value,
        end: &Value,
        via: Point,
        name: &str,
    ) -> Value {
        let a = Point::from_value(start);
        let b = Point::from_value(end);
        let za = start["z"].as_f64().unwrap_or(0.0);
        let zb = end["z"].as_f64().unwrap_or(0.0);
        let route = vec![
            json!({"x":a.x,"y":a.y,"z":za}),
            json!({"x":via.x,"y":via.y,"z":za}),
            json!({"x":via.x,"y":via.y,"z":zb}),
            json!({"x":b.x,"y":b.y,"z":zb}),
        ];
        self.route_output(name, route, vec![via.to_value()])
    }
    fn route_output(&self, name: &str, route: Vec<Value>, vias: Vec<Value>) -> Value {
        let mut result = json!({"connectionName":name});
        if let Some(region) = self.node_with_port_points.get("capacityMeshNodeId") {
            result["regionId"] = region.clone();
        }
        result["route"] = json!(route);
        result["traceThickness"] = json!(self.trace_thickness);
        result["viaDiameter"] = json!(self.via_diameter);
        result["vias"] = json!(vias);
        result
    }
    pub fn create_flat_route(
        &self,
        start: &Value,
        end: &Value,
        via: Point,
        other_start: &Value,
        other_end: &Value,
        name: &str,
    ) -> Value {
        let a = Point::from_value(start);
        let b = Point::from_value(end);
        let other = Point::from_value(if other_start["z"] != start["z"] {
            other_start
        } else {
            other_end
        });
        let dx = other.x - via.x;
        let dy = other.y - via.y;
        let effective_a = Point {
            x: via.x + dx * self.via_diameter,
            y: via.y + dy * self.via_diameter,
        };
        let effective_b = Point {
            x: other.x - dx * self.trace_thickness,
            y: other.y - dy * self.trace_thickness,
        };
        let p2 = Point {
            x: (effective_a.x + effective_b.x) / 2.0,
            y: (effective_a.y + effective_b.y) / 2.0,
        };
        let circle = Circle {
            center: via,
            radius: self.via_diameter / 2.0 + self.trace_thickness / 2.0 + self.obstacle_margin,
        };
        let p1 = find_point_to_get_around_circle(a, p2, circle).e;
        let p3 = find_point_to_get_around_circle(p2, b, circle).e;
        let p05 = find_point_to_get_around_circle(a, p1, circle).e;
        let p15 = find_point_to_get_around_circle(p1, p2, circle).e;
        let p25 = find_point_to_get_around_circle(p2, p3, circle).e;
        let p35 = find_point_to_get_around_circle(p3, b, circle).e;
        let better = find_point_to_get_around_circle(p15, p25, circle).e;
        let za = start["z"].as_f64().unwrap_or(0.0);
        let zb = end["z"].as_f64().unwrap_or(0.0);
        let mut route: Vec<Value> = [a, p05, p1, p15, better, p25, p3, p35]
            .iter()
            .map(|p| json!({"x":p.x,"y":p.y,"z":za}))
            .collect();
        route.push(json!({"x":b.x,"y":b.y,"z":zb}));
        self.route_output(name, route, vec![])
    }
    pub fn try_solve(&mut self) -> Result<bool, String> {
        let a = &self.routes[0];
        let b = &self.routes[1];
        let transition_a = a.a["z"] != a.b["z"];
        let transition = if transition_a { a } else { b };
        let flat = if transition_a { b } else { a };
        let Some(via) = self.calculate_via_position(transition, flat)? else {
            return Ok(false);
        };
        self.debug_via_positions.push(json!({"via":via}));
        let transition_solution = self.create_transition_route(
            &transition.a,
            &transition.b,
            via,
            &transition.connection_name,
        );
        let flat_solution = self.create_flat_route(
            &flat.a,
            &flat.b,
            via,
            &transition.a,
            &transition.b,
            &flat.connection_name,
        );
        self.solved_routes.push(transition_solution);
        self.solved_routes.push(flat_solution);
        Ok(true)
    }
    pub fn get_solved_routes(&self) -> &[Value] {
        &self.solved_routes
    }
    pub fn visualize(&self) -> Value {
        let mut g = json!({"lines":[],"points":[],"rects":[],"circles":[]});
        let b = self.bounds;
        g["rects"].as_array_mut().unwrap().push(json!({"center":{"x":(b.min_x+b.max_x)/2.0,"y":(b.min_y+b.max_y)/2.0},"width":b.max_x-b.min_x,"height":b.max_y-b.min_y,"stroke":"rgba(0, 0, 0, 0.5)","fill":"rgba(240, 240, 240, 0.1)","label":"PCB Bounds"}));
        for route in &self.routes {
            for (point, label) in [(&route.a, "start"), (&route.b, "end")] {
                let z = point["z"].as_f64().unwrap_or(f64::NAN);
                g["points"].as_array_mut().unwrap().push(json!({"x":point["x"],"y":point["y"],"label":format!("{} {} (z={})",route.connection_name,label,crate::utils::js_number::js_number_to_string(z)),"color":"orange"}));
            }
            g["lines"].as_array_mut().unwrap().push(json!({"points":[route.a,route.b],"strokeColor":"rgba(255, 0, 0, 0.5)","label":format!("{} direct",route.connection_name)}));
        }
        for (i, debug) in self.debug_via_positions.iter().enumerate() {
            let via = &debug["via"];
            g["circles"].as_array_mut().unwrap().push(json!({"center":via,"radius":self.via_diameter/2.0,"fill":"rgba(255, 165, 0, 0.7)","stroke":"rgba(0, 0, 0, 0.5)","label":format!("Computed Via (attempt {})",i+1)}));
            g["circles"].as_array_mut().unwrap().push(json!({"center":via,"radius":self.via_diameter/2.0+self.obstacle_margin,"stroke":"rgba(255, 165, 0, 0.7)","fill":"rgba(0, 0, 0, 0)","label":"Safety Margin"}));
        }
        for (si, route) in self.solved_routes.iter().enumerate() {
            let color = if si % 2 == 0 {
                "rgba(0, 255, 0, 0.75)"
            } else {
                "rgba(255, 0, 255, 0.75)"
            };
            let points = route["route"].as_array().unwrap();
            for pair in points.windows(2) {
                let mut line = json!({"points":pair,"strokeColor":color});
                if pair[0]["z"] != points[0]["z"] {
                    line["strokeDash"] = json!([0.2, 0.2]);
                }
                line["strokeWidth"] = route["traceThickness"].clone();
                line["label"] = json!(format!(
                    "{} z={}",
                    route["connectionName"].as_str().unwrap(),
                    crate::utils::js_number::js_number_to_string(pair[0]["z"].as_f64().unwrap())
                ));
                g["lines"].as_array_mut().unwrap().push(line);
            }
            for via in route["vias"].as_array().unwrap() {
                g["circles"].as_array_mut().unwrap().push(json!({"center":via,"radius":self.via_diameter/2.0,"fill":"rgba(0, 0, 255, 0.8)","stroke":"black","label":"Solved Via"}));
                g["circles"].as_array_mut().unwrap().push(json!({"center":via,"radius":self.via_diameter/2.0+self.obstacle_margin,"fill":"rgba(0, 0, 255, 0.3)","stroke":"black","label":"Via Margin"}));
            }
        }
        g
    }
}
impl SpecializedSolver for SingleTransitionCrossingRouteSolver {
    fn base(&self) -> &BaseSolverState {
        &self.base
    }
    fn base_mut(&mut self) -> &mut BaseSolverState {
        &mut self.base
    }
    fn get_solver_name(&self) -> &'static str {
        "SingleTransitionCrossingRouteSolver"
    }
    fn _step(&mut self) -> Result<(), String> {
        if !self.do_routes_cross(&self.routes[0], &self.routes[1]) {
            self.base.failed = true;
            self.base.error =
                Some("Can only solve routes that have a single transition crossing".into());
            return Ok(());
        }
        if self.try_solve()? {
            self.base.solved = true;
            return Ok(());
        }
        self.base.failed = true;
        self.base.error = Some("Failed to find a valid via position and route path".into());
        Ok(())
    }
}
