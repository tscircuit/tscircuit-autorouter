use crate::core::*;
use crate::indexed_candidate_heap::{CompactCandidateHopIndex, IndexedCandidateHeap};
use std::ops::{Deref, DerefMut};

/// Adds geometric distance for every segment, including the final goal segment.
pub struct DistanceAwareTinyHyperGraphSolver {
    pub core: TinyHyperGraphSolver,
}

impl Deref for DistanceAwareTinyHyperGraphSolver {
    type Target = TinyHyperGraphSolver;

    fn deref(&self) -> &Self::Target {
        &self.core
    }
}

impl DerefMut for DistanceAwareTinyHyperGraphSolver {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.core
    }
}

impl DistanceAwareTinyHyperGraphSolver {
    pub fn new(
        topology: TinyHyperGraphTopology,
        problem: TinyHyperGraphProblem,
        options: Option<TinyHyperGraphSolverOptions>,
    ) -> Self {
        let mut core = TinyHyperGraphSolver::new(topology, problem, options);
        core.add_segment_distance_to_g = true;
        core.distance_aware_goal = true;
        Self { core }
    }

    pub fn setup(&mut self) -> () {
        self.core.setup();
        self.core.state.candidate_queue = Box::new(IndexedCandidateHeap::new(
            self.core.topology.region_count,
            Some(CompactCandidateHopIndex {
                hop_capacity: self.core.candidate_hop_capacity,
                hop_slot_stride: self.core.candidate_hop_slot_stride,
                first_region_by_port_id: self.core.candidate_first_region_by_port_id.clone(),
                second_region_by_port_id: self.core.candidate_second_region_by_port_id.clone(),
                incident_port_region: self.core.topology.incident_port_region.clone(),
            }),
        ));
    }

    pub fn on_path_found(&mut self, candidate: Candidate) -> () {
        self.core.on_path_found(candidate);
    }

    pub fn solve(&mut self) -> () {
        if !self.core.is_setup {
            self.setup();
        }

        self.core.solve();
    }
}
