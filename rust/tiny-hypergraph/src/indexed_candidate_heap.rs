use crate::core::{Candidate, TinyHyperGraphCandidateQueue};
use crate::types::RegionId;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug)]
pub struct CompactCandidateHopIndex {
    pub hop_capacity: usize,
    pub hop_slot_stride: usize,
    pub first_region_by_port_id: Vec<i32>,
    pub second_region_by_port_id: Vec<i32>,
    pub incident_port_region: Vec<Vec<RegionId>>,
}

pub struct IndexedCandidateHeap {
    items: Vec<Candidate>,
    index_by_hop_id: HashMap<i64, usize>,
    closed_hop_ids: HashSet<i64>,
    hop_state_generation: Option<Vec<u32>>,
    hop_index_or_closed: Option<Vec<i32>>,
    current_hop_state_generation: u32,
    region_count: usize,
    compact_hop_index: Option<CompactCandidateHopIndex>,
}

impl IndexedCandidateHeap {
    pub fn new(region_count: usize, compact_hop_index: Option<CompactCandidateHopIndex>) -> Self {
        let capacity = compact_hop_index.as_ref().map(|index| index.hop_capacity);
        Self {
            items: Vec::new(),
            index_by_hop_id: HashMap::new(),
            closed_hop_ids: HashSet::new(),
            hop_state_generation: capacity.map(|len| vec![0; len]),
            hop_index_or_closed: capacity.map(|len| vec![0; len]),
            current_hop_state_generation: 1,
            region_count,
            compact_hop_index,
        }
    }

    pub fn length(&self) -> usize {
        self.items.len()
    }

    pub fn to_array(&self) -> Vec<Candidate> {
        self.items.clone()
    }

    pub fn clear(&mut self) -> () {
        self.items.clear();
        self.index_by_hop_id.clear();
        self.closed_hop_ids.clear();
        let Some(generation) = self.hop_state_generation.as_mut() else {
            return;
        };
        if self.current_hop_state_generation == u32::MAX {
            generation.fill(0);
            self.current_hop_state_generation = 1;
        } else {
            self.current_hop_state_generation += 1;
        }
    }

    pub fn is_closed_hop(&self, port_id: i32, next_region_id: i32) -> bool {
        self.is_hop_closed(self.get_hop_id_from_values(port_id, next_region_id))
    }

    pub fn queue(&mut self, candidate: Candidate) -> () {
        let hop_id = self.get_hop_id(&candidate);
        if self.is_hop_closed(hop_id) {
            return;
        }

        if let Some(existing_index) = self.get_queued_hop_index(hop_id) {
            let existing = &self.items[existing_index];
            if candidate.g >= existing.g {
                return;
            }

            let sift_up = candidate.f <= existing.f;
            self.items[existing_index] = candidate;
            if sift_up {
                self.sift_up(existing_index);
            } else {
                self.sift_down(existing_index);
            }

            return;
        }

        let index = self.items.len();
        self.items.push(candidate);
        self.sift_up(index);
    }

    pub fn dequeue(&mut self) -> Option<Candidate> {
        let best = self.items.first()?.clone();
        self.close_hop(self.get_hop_id(&best));
        let last = self.items.pop().unwrap();
        if !self.items.is_empty() {
            self.items[0] = last;
            self.sift_down(0);
        }

        Some(best)
    }

    fn get_hop_id(&self, candidate: &Candidate) -> i64 {
        self.get_hop_id_from_values(candidate.port_id, candidate.next_region_id)
    }

    fn get_hop_id_from_values(&self, port_id: i32, next_region_id: i32) -> i64 {
        let regular = port_id as i64 * self.region_count as i64 + next_region_id as i64;
        let Some(compact) = &self.compact_hop_index else {
            return regular;
        };
        let base = port_id as i64 * compact.hop_slot_stride as i64;
        if compact.first_region_by_port_id[port_id as usize] == next_region_id {
            return base;
        }

        if compact.second_region_by_port_id[port_id as usize] == next_region_id {
            return base + 1;
        }

        if let Some(regions) = compact.incident_port_region.get(port_id as usize) {
            for slot in 2..regions.len() {
                if regions[slot] == next_region_id {
                    return base + slot as i64;
                }
            }
        }

        -regular - 1
    }

    fn get_queued_hop_index(&self, hop_id: i64) -> Option<usize> {
        if hop_id >= 0
            && self
                .hop_state_generation
                .as_ref()
                .and_then(|g| g.get(hop_id as usize))
                .copied()
                == Some(self.current_hop_state_generation)
        {
            let index = self.hop_index_or_closed.as_ref().unwrap()[hop_id as usize];
            return if index >= 0 {
                Some(index as usize)
            } else {
                None
            };
        }

        self.index_by_hop_id.get(&hop_id).copied()
    }

    fn is_hop_closed(&self, hop_id: i64) -> bool {
        if hop_id >= 0
            && self
                .hop_state_generation
                .as_ref()
                .and_then(|g| g.get(hop_id as usize))
                .copied()
                == Some(self.current_hop_state_generation)
        {
            return self.hop_index_or_closed.as_ref().unwrap()[hop_id as usize] == -1;
        }

        self.closed_hop_ids.contains(&hop_id)
    }

    fn set_queued_hop_index(&mut self, hop_id: i64, index: usize) -> () {
        if hop_id >= 0 {
            if let Some(generation) = self.hop_state_generation.as_mut() {
                generation[hop_id as usize] = self.current_hop_state_generation;
                self.hop_index_or_closed.as_mut().unwrap()[hop_id as usize] = index as i32;
                return;
            }
        }

        self.index_by_hop_id.insert(hop_id, index);
    }

    fn close_hop(&mut self, hop_id: i64) -> () {
        if hop_id >= 0 {
            if let Some(generation) = self.hop_state_generation.as_mut() {
                generation[hop_id as usize] = self.current_hop_state_generation;
                self.hop_index_or_closed.as_mut().unwrap()[hop_id as usize] = -1;
                return;
            }
        }

        self.index_by_hop_id.remove(&hop_id);
        self.closed_hop_ids.insert(hop_id);
    }

    fn sift_up(&mut self, start_index: usize) -> () {
        let candidate = self.items[start_index].clone();
        let mut index = start_index;

        while index > 0 {
            let parent_index = (index - 1) >> 1;
            let parent = self.items[parent_index].clone();
            if parent.f <= candidate.f {
                break;
            }

            let parent_hop_id = self.get_hop_id(&parent);
            self.items[index] = parent;
            self.set_queued_hop_index(parent_hop_id, index);
            index = parent_index;
        }

        let hop_id = self.get_hop_id(&candidate);
        self.items[index] = candidate;
        self.set_queued_hop_index(hop_id, index);
    }

    fn sift_down(&mut self, start_index: usize) -> () {
        let candidate = self.items[start_index].clone();
        let mut index = start_index;

        loop {
            let left = index * 2 + 1;
            if left >= self.items.len() {
                break;
            }

            let right = left + 1;
            let child_index =
                if right < self.items.len() && self.items[right].f < self.items[left].f {
                    right
                } else {
                    left
                };
            let child = self.items[child_index].clone();
            if candidate.f <= child.f {
                break;
            }

            let child_hop_id = self.get_hop_id(&child);
            self.items[index] = child;
            self.set_queued_hop_index(child_hop_id, index);
            index = child_index;
        }

        let hop_id = self.get_hop_id(&candidate);
        self.items[index] = candidate;
        self.set_queued_hop_index(hop_id, index);
    }
}

impl TinyHyperGraphCandidateQueue for IndexedCandidateHeap {
    fn len(&self) -> usize {
        IndexedCandidateHeap::length(self)
    }

    fn to_array(&self) -> Vec<Candidate> {
        IndexedCandidateHeap::to_array(self)
    }

    fn clear(&mut self) -> () {
        IndexedCandidateHeap::clear(self);
    }

    fn queue(&mut self, candidate: Candidate) -> () {
        IndexedCandidateHeap::queue(self, candidate);
    }

    fn dequeue(&mut self) -> Option<Candidate> {
        IndexedCandidateHeap::dequeue(self)
    }

    fn is_closed_hop(&self, port_id: i32, next_region_id: i32) -> bool {
        IndexedCandidateHeap::is_closed_hop(self, port_id, next_region_id)
    }
}
