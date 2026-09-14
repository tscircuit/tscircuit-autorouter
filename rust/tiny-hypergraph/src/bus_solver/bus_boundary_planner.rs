use super::bus_solver_types::{
    BUS_CANDIDATE_EPSILON, BoundaryStep, BusCenterCandidate, get_region_pair_key,
};
use super::derive_bus_trace_order::BusTraceOrder;
use super::geometry::{get_port_distance, get_port_projection};
use crate::core::{TinyHyperGraphProblem, TinyHyperGraphTopology};
use crate::types::{PortId, RegionId};
use std::collections::HashMap;
use std::rc::Rc;

pub struct BusBoundaryPlannerOptions {
    pub topology: Rc<TinyHyperGraphTopology>,
    pub problem: TinyHyperGraphProblem,
    pub bus_trace_order: BusTraceOrder,
    pub center_trace_index: usize,
    pub center_port_options_per_edge: usize,
    pub is_usable_centerline_boundary_port: Box<dyn Fn(PortId) -> bool>,
}

#[derive(Clone, Copy, Debug)]
pub struct BoundaryNormal {
    pub x: f64,
    pub y: f64,
}

pub struct BusBoundaryPlanner {
    pub centerline_neighbor_region_ids_by_region: Vec<Vec<RegionId>>,
    shared_z0_ports_by_region_pair: HashMap<String, Vec<PortId>>,
    usable_centerline_shared_z0_ports_by_region_pair: HashMap<String, Vec<PortId>>,
    options: BusBoundaryPlannerOptions,
}

impl BusBoundaryPlanner {
    pub fn new(options: BusBoundaryPlannerOptions) -> Self {
        let mut value = Self {
            options,
            centerline_neighbor_region_ids_by_region: vec![],
            shared_z0_ports_by_region_pair: HashMap::new(),
            usable_centerline_shared_z0_ports_by_region_pair: HashMap::new(),
        };
        value.build_shared_z0_ports_by_region_pair();
        value.build_usable_centerline_shared_z0_ports_by_region_pair();
        value.centerline_neighbor_region_ids_by_region =
            value.build_centerline_neighbor_region_ids_by_region();
        value
    }

    pub fn create_boundary_step(
        &self,
        from_region_id: RegionId,
        to_region_id: RegionId,
        center_port_id: PortId,
        reference_port_id: PortId,
        previous_normal: Option<BoundaryNormal>,
    ) -> BoundaryStep {
        let normal = self.compute_boundary_normal(
            reference_port_id,
            center_port_id,
            from_region_id,
            to_region_id,
            previous_normal,
        );
        BoundaryStep {
            from_region_id,
            to_region_id,
            center_port_id,
            normal_x: normal.x,
            normal_y: normal.y,
        }
    }

    pub fn get_ordered_shared_ports_for_boundary_step(
        &self,
        step: &BoundaryStep,
    ) -> Option<Vec<PortId>> {
        let key = get_region_pair_key(step.from_region_id, step.to_region_id);
        let mut ports = self.shared_z0_ports_by_region_pair.get(&key)?.clone();
        ports.sort_by(|l, r| {
            get_port_projection(&self.options.topology, *l, step.normal_x, step.normal_y)
                .total_cmp(&get_port_projection(
                    &self.options.topology,
                    *r,
                    step.normal_x,
                    step.normal_y,
                ))
                .then_with(|| l.cmp(r))
        });
        Some(ports)
    }

    pub fn get_preferred_center_port_options_for_boundary_step(
        &self,
        step: &BoundaryStep,
    ) -> Vec<PortId> {
        let Some(ports) = self.get_ordered_shared_ports_for_boundary_step(step) else {
            return vec![];
        };
        if ports.is_empty() {
            return vec![];
        }

        let midpoint = (ports.len() - 1) as f64 / 2.0;
        let mut indexed: Vec<_> = ports.into_iter().enumerate().collect();
        indexed.sort_by(|(li, lp), (ri, rp)| {
            (*li as f64 - midpoint)
                .abs()
                .total_cmp(&(*ri as f64 - midpoint).abs())
                .then_with(|| lp.cmp(rp))
        });
        indexed
            .into_iter()
            .take(self.options.center_port_options_per_edge)
            .map(|(_, p)| p)
            .collect()
    }

    pub fn assign_boundary_ports_for_path(
        &self,
        steps: &[BoundaryStep],
    ) -> Vec<Option<Vec<PortId>>> {
        let mut result = vec![];
        let mut previous: Vec<_> = self
            .options
            .bus_trace_order
            .traces
            .iter()
            .map(|t| self.options.problem.route_start_port[t.route_id as usize])
            .collect();

        for step in steps {
            let assignments = self.assign_boundary_ports_for_step(step, Some(&previous));
            result.push(assignments.clone());
            if let Some(ports) = assignments {
                previous = ports;
            } else {
                result.resize(steps.len(), None);
                break;
            }
        }

        result
    }

    pub fn assign_boundary_ports_for_step(
        &self,
        step: &BoundaryStep,
        previous: Option<&[PortId]>,
    ) -> Option<Vec<PortId>> {
        let ports = self.get_ordered_shared_ports_for_boundary_step(step)?;
        let reversed: Vec<_> = ports.iter().copied().rev().collect();
        let mut candidates = vec![];

        for ordered in [&ports, &reversed] {
            if let Some(assignments) = self
                .build_boundary_port_assignments_from_ordered_ports(ordered, step.center_port_id)
                && !candidates.contains(&assignments)
            {
                candidates.push(assignments);
            }
        }

        if let Some(previous) = previous {
            candidates.sort_by(|l, r| {
                self.count_local_boundary_assignment_intersections(previous, l)
                    .cmp(&self.count_local_boundary_assignment_intersections(previous, r))
                    .then_with(|| {
                        self.get_boundary_assignment_length(previous, l)
                            .total_cmp(&self.get_boundary_assignment_length(previous, r))
                    })
            });
        }

        candidates.into_iter().next()
    }

    pub fn get_boundary_steps(&self, path: &[BusCenterCandidate]) -> Vec<BoundaryStep> {
        let mut result = vec![];
        let Some(first) = path.first() else {
            return result;
        };
        let mut current = first.next_region_id;
        let mut normal = None;

        for i in 1..path.len() {
            let next = &path[i];
            if next.at_goal {
                break;
            }

            let previous_port = path.get(i - 1).map(|p| p.port_id).unwrap_or(next.port_id);
            let next_port = path.get(i + 1).map(|p| p.port_id).unwrap_or(next.port_id);
            let boundary = self.compute_boundary_normal(
                previous_port,
                next_port,
                current,
                next.next_region_id,
                normal,
            );
            result.push(BoundaryStep {
                from_region_id: current,
                to_region_id: next.next_region_id,
                center_port_id: next.port_id,
                normal_x: boundary.x,
                normal_y: boundary.y,
            });
            normal = Some(boundary);
            current = next.next_region_id;
        }

        result
    }

    pub fn get_ordered_usable_centerline_ports_for_boundary_step(
        &self,
        step: &BoundaryStep,
    ) -> Option<Vec<PortId>> {
        Some(
            self.get_ordered_shared_ports_for_boundary_step(step)?
                .into_iter()
                .filter(|p| (self.options.is_usable_centerline_boundary_port)(*p))
                .collect(),
        )
    }

    pub fn get_usable_centerline_port_ids_between_regions(
        &self,
        from: RegionId,
        to: RegionId,
    ) -> Option<&Vec<PortId>> {
        self.usable_centerline_shared_z0_ports_by_region_pair
            .get(&get_region_pair_key(from, to))
    }

    pub fn get_boundary_center_midpoint_penalty(&self, step: &BoundaryStep) -> f64 {
        let Some(ports) = self.get_ordered_usable_centerline_ports_for_boundary_step(step) else {
            return f64::INFINITY;
        };
        let Some(index) = ports.iter().position(|p| *p == step.center_port_id) else {
            return f64::INFINITY;
        };
        (index as f64 - (ports.len() - 1) as f64 / 2.0).abs()
    }

    pub fn get_boundary_support_penalty(&self, step: &BoundaryStep) -> f64 {
        let unsupported = self.options.problem.route_count as f64 * 20.0;
        let Some(ports) = self.get_ordered_shared_ports_for_boundary_step(step) else {
            return unsupported;
        };
        let Some(index) = ports.iter().position(|p| *p == step.center_port_id) else {
            return unsupported;
        };
        let before = index.min(self.options.center_trace_index);
        let after = (ports.len() - index - 1)
            .min(self.options.problem.route_count - self.options.center_trace_index - 1);
        (self.options.problem.route_count - 1 - before - after) as f64 * 20.0
    }

    fn build_shared_z0_ports_by_region_pair(&mut self) {
        self.shared_z0_ports_by_region_pair.clear();

        for port in 0..self.options.topology.port_count {
            if self.options.topology.port_z[port] != 0 {
                continue;
            }

            let Some(regions) = self.options.topology.incident_port_region.get(port) else {
                continue;
            };
            if regions.len() < 2 {
                continue;
            }

            self.shared_z0_ports_by_region_pair
                .entry(get_region_pair_key(regions[0], regions[1]))
                .or_default()
                .push(port as PortId);
        }

        for ports in self.shared_z0_ports_by_region_pair.values_mut() {
            ports.sort_by(|l, r| {
                get_port_projection(
                    &self.options.topology,
                    *l,
                    self.options.bus_trace_order.normal_x,
                    self.options.bus_trace_order.normal_y,
                )
                .total_cmp(&get_port_projection(
                    &self.options.topology,
                    *r,
                    self.options.bus_trace_order.normal_x,
                    self.options.bus_trace_order.normal_y,
                ))
                .then_with(|| l.cmp(r))
            });
        }
    }

    fn build_usable_centerline_shared_z0_ports_by_region_pair(&mut self) {
        self.usable_centerline_shared_z0_ports_by_region_pair
            .clear();

        for (key, ports) in &self.shared_z0_ports_by_region_pair {
            let usable: Vec<_> = ports
                .iter()
                .copied()
                .filter(|p| (self.options.is_usable_centerline_boundary_port)(*p))
                .collect();
            if !usable.is_empty() {
                self.usable_centerline_shared_z0_ports_by_region_pair
                    .insert(key.clone(), usable);
            }
        }
    }

    fn build_centerline_neighbor_region_ids_by_region(&self) -> Vec<Vec<RegionId>> {
        let mut neighbors = vec![vec![]; self.options.topology.region_count];

        for key in self.usable_centerline_shared_z0_ports_by_region_pair.keys() {
            let (a, b) = key
                .split_once(':')
                .expect("Region-pair key must contain separator");
            let a: RegionId = a.parse().expect("Invalid first region id");
            let b: RegionId = b.parse().expect("Invalid second region id");
            neighbors[a as usize].push(b);
            neighbors[b as usize].push(a);
        }

        for ids in &mut neighbors {
            ids.sort();
        }

        neighbors
    }

    fn compute_boundary_normal(
        &self,
        from_port: PortId,
        to_port: PortId,
        from_region: RegionId,
        to_region: RegionId,
        previous: Option<BoundaryNormal>,
    ) -> BoundaryNormal {
        let t = &self.options.topology;
        let (mut x, mut y) = (
            t.port_x[to_port as usize] - t.port_x[from_port as usize],
            t.port_y[to_port as usize] - t.port_y[from_port as usize],
        );
        let mut length = x.hypot(y);
        if length <= BUS_CANDIDATE_EPSILON {
            x = t.region_center_x[to_region as usize] - t.region_center_x[from_region as usize];
            y = t.region_center_y[to_region as usize] - t.region_center_y[from_region as usize];
            length = x.hypot(y);
        }

        let reference = previous.unwrap_or(BoundaryNormal {
            x: self.options.bus_trace_order.normal_x,
            y: self.options.bus_trace_order.normal_y,
        });
        if length <= BUS_CANDIDATE_EPSILON {
            return reference;
        }

        x /= length;
        y /= length;
        let (mut nx, mut ny) = (-y, x);
        if nx * reference.x + ny * reference.y < -BUS_CANDIDATE_EPSILON {
            nx *= -1.0;
            ny *= -1.0;
        }

        BoundaryNormal { x: nx, y: ny }
    }

    fn build_boundary_port_assignments_from_ordered_ports(
        &self,
        ports: &[PortId],
        center_port: PortId,
    ) -> Option<Vec<PortId>> {
        let center = ports.iter().position(|p| *p == center_port)?;
        let before = self.options.center_trace_index;
        let after = self.options.problem.route_count - before - 1;
        if center < before || ports.len() - center - 1 < after {
            return None;
        }

        let mut assignments = vec![0; self.options.problem.route_count];

        for (trace, assignment) in assignments.iter_mut().enumerate() {
            *assignment = *ports.get(center + trace - before)?;
        }

        Some(assignments)
    }

    fn count_local_boundary_assignment_intersections(
        &self,
        previous: &[PortId],
        next: &[PortId],
    ) -> usize {
        let mut count = 0;

        for left in 0..previous.len() {
            for right in left + 1..previous.len() {
                if self.do_port_segments_intersect(
                    previous[left],
                    next[left],
                    previous[right],
                    next[right],
                ) {
                    count += 1;
                }
            }
        }

        count
    }

    fn do_port_segments_intersect(
        &self,
        a_from: PortId,
        a_to: PortId,
        b_from: PortId,
        b_to: PortId,
    ) -> bool {
        if a_from == b_from || a_from == b_to || a_to == b_from || a_to == b_to {
            return false;
        }

        let t = &self.options.topology;
        let (ax, ay) = (t.port_x[a_from as usize], t.port_y[a_from as usize]);
        let (bx, by) = (t.port_x[a_to as usize], t.port_y[a_to as usize]);
        let (cx, cy) = (t.port_x[b_from as usize], t.port_y[b_from as usize]);
        let (dx, dy) = (t.port_x[b_to as usize], t.port_y[b_to as usize]);
        let orientation = |px: f64, py: f64, qx: f64, qy: f64, rx: f64, ry: f64| -> f64 {
            (qx - px) * (ry - py) - (qy - py) * (rx - px)
        };
        let ac = orientation(ax, ay, bx, by, cx, cy);
        let ad = orientation(ax, ay, bx, by, dx, dy);
        let ba = orientation(cx, cy, dx, dy, ax, ay);
        let bb = orientation(cx, cy, dx, dy, bx, by);
        if [ac, ad, ba, bb]
            .iter()
            .any(|v| v.abs() <= BUS_CANDIDATE_EPSILON)
        {
            return false;
        }

        (ac > 0.0) != (ad > 0.0) && (ba > 0.0) != (bb > 0.0)
    }

    fn get_boundary_assignment_length(&self, previous: &[PortId], next: &[PortId]) -> f64 {
        previous
            .iter()
            .enumerate()
            .map(|(i, p)| get_port_distance(&self.options.topology, *p, next[i]))
            .sum()
    }
}
