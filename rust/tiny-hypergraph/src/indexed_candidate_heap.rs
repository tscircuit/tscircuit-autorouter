use crate::core::{Candidate, TinyHyperGraphCandidateQueue};
use crate::types::RegionId;
use rustc_hash::FxBuildHasher;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug)]
pub struct CompactCandidateHopIndex {
    pub hop_capacity: usize,
    pub hop_slot_stride: usize,
    pub first_region_by_port_id: Vec<i32>,
    pub second_region_by_port_id: Vec<i32>,
    pub incident_port_region: Vec<Vec<RegionId>>,
}

#[derive(Clone, Copy)]
struct HeapEntry {
    f: f64,
    hop_id: i64,
    payload: usize,
}

pub struct IndexedCandidateHeap {
    items: Vec<HeapEntry>,
    payloads: Vec<Option<Candidate>>,
    free_payloads: Vec<usize>,
    index_by_hop_id: HashMap<i64, usize, FxBuildHasher>,
    closed_hop_ids: HashSet<i64, FxBuildHasher>,
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
            payloads: Vec::new(),
            free_payloads: Vec::new(),
            index_by_hop_id: HashMap::with_hasher(FxBuildHasher),
            closed_hop_ids: HashSet::with_hasher(FxBuildHasher),
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
        self.items
            .iter()
            .map(|entry| {
                self.payloads[entry.payload]
                    .as_ref()
                    .expect("Queued candidate payload")
                    .clone()
            })
            .collect()
    }

    pub fn clear(&mut self) {
        self.items.clear();
        self.payloads.clear();
        self.free_payloads.clear();
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

    pub fn queue(&mut self, candidate: Candidate) {
        let hop_id = self.get_hop_id(&candidate);
        if self.is_hop_closed(hop_id) {
            return;
        }

        if let Some(existing_index) = self.get_queued_hop_index(hop_id) {
            let entry = self.items[existing_index];
            let existing = self.payloads[entry.payload]
                .as_ref()
                .expect("Queued candidate payload");
            if candidate.g >= existing.g {
                return;
            }

            let sift_up = candidate.f <= existing.f;
            self.items[existing_index].f = candidate.f;
            self.payloads[entry.payload] = Some(candidate);
            if sift_up {
                self.sift_up(existing_index);
            } else {
                self.sift_down(existing_index);
            }

            return;
        }

        let index = self.items.len();
        let entry = HeapEntry {
            f: candidate.f,
            hop_id,
            payload: if let Some(slot) = self.free_payloads.pop() {
                self.payloads[slot] = Some(candidate);
                slot
            } else {
                let slot = self.payloads.len();
                self.payloads.push(Some(candidate));
                slot
            },
        };
        self.items.push(entry);
        self.sift_up(index);
    }

    pub fn dequeue(&mut self) -> Option<Candidate> {
        if self.items.is_empty() {
            return None;
        }
        let best = self.items.swap_remove(0);
        self.close_hop(best.hop_id);
        if !self.items.is_empty() {
            self.sift_down(0);
        }

        let candidate = self.payloads[best.payload]
            .take()
            .expect("Dequeued candidate payload");
        self.free_payloads.push(best.payload);
        Some(candidate)
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
            for (slot, &region) in regions.iter().enumerate().skip(2) {
                if region == next_region_id {
                    return base + slot as i64;
                }
            }
        }

        -regular - 1
    }

    fn get_queued_hop_index(&self, hop_id: i64) -> Option<usize> {
        if hop_id >= 0
            && let Some(generation) = &self.hop_state_generation
        {
            // Compact nonnegative hops are stored only in these arrays;
            // fallback maps can contain only negative hops in this mode.
            if generation.get(hop_id as usize).copied() != Some(self.current_hop_state_generation) {
                return None;
            }
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
            && let Some(generation) = &self.hop_state_generation
        {
            if generation.get(hop_id as usize).copied() != Some(self.current_hop_state_generation) {
                return false;
            }
            return self.hop_index_or_closed.as_ref().unwrap()[hop_id as usize] == -1;
        }
        self.closed_hop_ids.contains(&hop_id)
    }

    fn set_queued_hop_index(&mut self, hop_id: i64, index: usize) {
        if hop_id >= 0
            && let Some(generation) = self.hop_state_generation.as_mut()
        {
            generation[hop_id as usize] = self.current_hop_state_generation;
            self.hop_index_or_closed.as_mut().unwrap()[hop_id as usize] = index as i32;
            return;
        }

        self.index_by_hop_id.insert(hop_id, index);
    }

    fn close_hop(&mut self, hop_id: i64) {
        if hop_id >= 0
            && let Some(generation) = self.hop_state_generation.as_mut()
        {
            generation[hop_id as usize] = self.current_hop_state_generation;
            self.hop_index_or_closed.as_mut().unwrap()[hop_id as usize] = -1;
            return;
        }

        self.index_by_hop_id.remove(&hop_id);
        self.closed_hop_ids.insert(hop_id);
    }

    fn sift_up(&mut self, start_index: usize) {
        let candidate = self.items[start_index];
        let mut index = start_index;

        while index > 0 {
            let parent_index = (index - 1) >> 1;
            let parent = self.items[parent_index];
            if parent.f <= candidate.f {
                break;
            }

            let parent_hop_id = parent.hop_id;
            self.items[index] = parent;
            self.set_queued_hop_index(parent_hop_id, index);
            index = parent_index;
        }

        let hop_id = candidate.hop_id;
        self.items[index] = candidate;
        self.set_queued_hop_index(hop_id, index);
    }

    fn sift_down(&mut self, start_index: usize) {
        let candidate = self.items[start_index];
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
            let child = self.items[child_index];
            if candidate.f <= child.f {
                break;
            }

            let child_hop_id = child.hop_id;
            self.items[index] = child;
            self.set_queued_hop_index(child_hop_id, index);
            index = child_index;
        }

        let hop_id = candidate.hop_id;
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

    fn clear(&mut self) {
        IndexedCandidateHeap::clear(self);
    }

    fn queue(&mut self, candidate: Candidate) {
        IndexedCandidateHeap::queue(self, candidate);
    }

    fn dequeue(&mut self) -> Option<Candidate> {
        IndexedCandidateHeap::dequeue(self)
    }

    fn is_closed_hop(&self, port_id: i32, next_region_id: i32) -> bool {
        IndexedCandidateHeap::is_closed_hop(self, port_id, next_region_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::rc::Rc;

    #[test]
    fn compact_payloads_preserve_queue_order_replacement_and_retained_ancestry() {
        for compact in [false, true] {
            let index = compact.then(|| CompactCandidateHopIndex {
                hop_capacity: 32,
                hop_slot_stride: 2,
                first_region_by_port_id: vec![0; 16],
                second_region_by_port_id: vec![1; 16],
                incident_port_region: vec![vec![0, 1]; 16],
            });
            let mut heap = IndexedCandidateHeap::new(3, index);
            let parent = Rc::new(Candidate::default());
            let candidate = |port_id, f, g| Candidate {
                port_id,
                next_region_id: 0,
                f,
                g,
                prev_candidate: Some(parent.clone()),
                ..Default::default()
            };
            for port in 0..3 {
                heap.queue(candidate(port, 1.0, 1.0));
            }
            let held = heap.to_array();
            assert_eq!(
                held.iter().map(|c| c.port_id).collect::<Vec<_>>(),
                vec![0, 1, 2]
            );
            for expected in [0, 2, 1] {
                let popped = heap.dequeue().unwrap();
                assert_eq!(popped.port_id, expected);
                assert!(Rc::ptr_eq(popped.prev_candidate.as_ref().unwrap(), &parent));
                heap.queue(candidate(expected, -1.0, -1.0));
                assert!(heap.is_closed_hop(expected, 0));
            }
            assert_eq!(heap.length(), 0);
            assert_eq!(heap.payloads.len(), 3);
            heap.queue(candidate(3, 2.0, 2.0));
            assert_eq!(heap.payloads.len(), 3);
            assert_eq!(held[0].g, 1.0);
            heap.clear();
            for port in 0..3 {
                heap.queue(candidate(port, 1.0, 1.0));
            }
            heap.queue(candidate(2, -1.0, 1.0)); // Equal g does not replace.
            assert_eq!(heap.to_array()[0].port_id, 0);
            heap.queue(candidate(2, -1.0, 0.0));
            assert_eq!(heap.dequeue().unwrap().port_id, 2);
            heap.queue(candidate(0, 3.0, -1.0)); // Lower g can require sifting down.
            assert_eq!(heap.dequeue().unwrap().port_id, 1);
            assert_eq!(heap.dequeue().unwrap().port_id, 0);
            heap.clear();
            heap.queue(candidate(0, 1.0, 0.0));
            heap.queue(candidate(1, f64::NAN, 0.0));
            heap.queue(candidate(2, 0.0, 0.0));
            assert_eq!(
                heap.to_array()
                    .iter()
                    .map(|c| c.port_id)
                    .collect::<Vec<_>>(),
                vec![2, 0, 1]
            );
            for expected in [2, 0, 1] {
                assert_eq!(heap.dequeue().unwrap().port_id, expected);
            }
            heap.clear();
            heap.queue(candidate(0, -0.0, 0.0));
            heap.queue(candidate(1, 0.0, 0.0));
            heap.queue(candidate(2, -0.0, 0.0));
            assert_eq!(heap.to_array()[0].f.to_bits(), (-0.0f64).to_bits());
            for expected in [0, 2, 1] {
                assert_eq!(heap.dequeue().unwrap().port_id, expected);
            }
            heap.clear();
            let mut fallback = candidate(0, 2.0, 1.0);
            fallback.next_region_id = 2;
            heap.queue(fallback);
            assert_eq!(heap.dequeue().unwrap().next_region_id, 2);
            assert!(heap.is_closed_hop(0, 2));
            heap.clear();
            assert!(!heap.is_closed_hop(0, 2));
            // Exercise dense and fallback domains together while fallback maps
            // are nonempty, then invalidate dense stamps including epoch wrap.
            for wrap in [false, true] {
                if wrap {
                    heap.current_hop_state_generation = u32::MAX;
                }
                let mut fallback = candidate(0, 2.0, 1.0);
                fallback.next_region_id = 2;
                heap.queue(fallback);
                let fresh = heap.get_hop_id_from_values(1, 0);
                assert_eq!(heap.get_queued_hop_index(fresh), None);
                assert!(!heap.is_hop_closed(fresh));
                heap.queue(candidate(1, 1.0, 1.0));
                assert_eq!(heap.get_queued_hop_index(fresh), Some(0));
                if compact {
                    assert!(heap.index_by_hop_id.keys().all(|id| *id < 0));
                }
                assert_eq!(heap.dequeue().unwrap().port_id, 1);
                assert_eq!(heap.dequeue().unwrap().next_region_id, 2);
                assert!(heap.is_hop_closed(fresh));
                if compact {
                    assert!(heap.closed_hop_ids.iter().all(|id| *id < 0));
                }
                heap.clear();
                assert_eq!(heap.get_queued_hop_index(fresh), None);
                assert!(!heap.is_hop_closed(fresh));
                assert!(!heap.is_closed_hop(0, 2));
                if compact && wrap {
                    assert_eq!(heap.current_hop_state_generation, 1);
                }
            }
            assert!(Rc::ptr_eq(
                held[0].prev_candidate.as_ref().unwrap(),
                &parent
            ));
        }
    }
}
