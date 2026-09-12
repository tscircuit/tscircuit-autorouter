type GetHops<'a, S, O, D> = dyn Fn(&S) -> Vec<DistinctOwnerBlockerHop<S, O, D>> + 'a;

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::hash::Hash;
use std::rc::Rc;

#[derive(Clone, Debug)]
pub struct DistinctOwnerBlockerHop<S, O, D = serde_json::Value> {
    pub state: S,
    pub distance: f64,
    pub owners: Option<Vec<O>>,
    pub data: Option<D>,
}

pub struct DistinctOwnerBlockerSearchOptions<'a, S, K, O, D = serde_json::Value> {
    pub start: S,
    pub get_state_key: &'a dyn Fn(&S) -> K,
    pub is_goal: &'a dyn Fn(&S) -> bool,
    pub get_hops: &'a GetHops<'a, S, O, D>,
    pub max_expanded_labels: Option<usize>,
}

#[derive(Clone, Debug)]
pub struct DistinctOwnerBlockerSearchSuccess<S, O, D = serde_json::Value> {
    pub states: Vec<S>,
    pub hops: Vec<DistinctOwnerBlockerHop<S, O, D>>,
    pub owners: HashSet<O>,
    pub distance: f64,
    pub expanded_label_count: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DistinctOwnerBlockerSearchFailureReason {
    NoPath,
    ExpansionLimit,
}

#[derive(Clone, Debug)]
pub struct DistinctOwnerBlockerSearchFailure {
    pub reason: DistinctOwnerBlockerSearchFailureReason,
    pub expanded_label_count: usize,
}

#[derive(Clone, Debug)]
pub enum DistinctOwnerBlockerSearchResult<S, O, D = serde_json::Value> {
    Success(DistinctOwnerBlockerSearchSuccess<S, O, D>),
    Failure(DistinctOwnerBlockerSearchFailure),
}
type LabelRef<S, O, D> = Rc<RefCell<SearchLabel<S, O, D>>>;

struct SearchLabel<S, O, D> {
    state: S,
    owners: HashSet<O>,
    distance: f64,
    parent: Option<LabelRef<S, O, D>>,
    incoming_hop: Option<DistinctOwnerBlockerHop<S, O, D>>,
    queue_order: usize,
    active: bool,
}

fn compare_labels<S, O, D>(left: &SearchLabel<S, O, D>, right: &SearchLabel<S, O, D>) -> f64 {
    let owner_difference = left.owners.len() as f64 - right.owners.len() as f64;
    if owner_difference != 0.0 {
        return owner_difference;
    }

    let distance_difference = left.distance - right.distance;
    if distance_difference != 0.0 {
        return distance_difference;
    }

    left.queue_order as f64 - right.queue_order as f64
}

struct SearchLabelQueue<S, O, D> {
    heap: Vec<LabelRef<S, O, D>>,
}

impl<S, O, D> SearchLabelQueue<S, O, D> {
    fn push(&mut self, label: LabelRef<S, O, D>) {
        self.heap.push(label);
        let mut index = self.heap.len() - 1;

        while index > 0 {
            let parent = (index - 1) / 2;
            if compare_labels(&self.heap[parent].borrow(), &self.heap[index].borrow()) <= 0.0 {
                break;
            }

            self.heap.swap(parent, index);
            index = parent;
        }
    }

    fn pop(&mut self) -> Option<LabelRef<S, O, D>> {
        let first = self.heap.first()?.clone();
        let last = self.heap.pop().unwrap();
        if self.heap.is_empty() {
            return Some(first);
        }

        self.heap[0] = last;
        let mut index = 0;

        loop {
            let left = index * 2 + 1;
            let right = left + 1;
            let mut best = index;
            if left < self.heap.len()
                && compare_labels(&self.heap[left].borrow(), &self.heap[best].borrow()) < 0.0
            {
                best = left;
            }

            if right < self.heap.len()
                && compare_labels(&self.heap[right].borrow(), &self.heap[best].borrow()) < 0.0
            {
                best = right;
            }

            if best == index {
                break;
            }

            self.heap.swap(index, best);
            index = best;
        }

        Some(first)
    }
}

fn is_owner_subset<O: Eq + Hash>(
    possible_subset: &HashSet<O>,
    possible_superset: &HashSet<O>,
) -> bool {
    if possible_subset.len() > possible_superset.len() {
        return false;
    }

    for owner in possible_subset {
        if !possible_superset.contains(owner) {
            return false;
        }
    }

    true
}

fn label_dominates<S, O: Eq + Hash, D>(
    left: &SearchLabel<S, O, D>,
    right: &SearchLabel<S, O, D>,
) -> bool {
    if left.distance > right.distance {
        return false;
    }

    is_owner_subset(&left.owners, &right.owners)
}

fn reconstruct_successful_search<S: Clone, O: Clone + Eq + Hash, D: Clone>(
    goal: LabelRef<S, O, D>,
    expanded_label_count: usize,
) -> DistinctOwnerBlockerSearchSuccess<S, O, D> {
    let mut states = Vec::new();
    let mut hops = Vec::new();
    let mut cursor = Some(goal.clone());

    while let Some(label) = cursor {
        let label = label.borrow();
        states.push(label.state.clone());
        if let Some(hop) = &label.incoming_hop {
            hops.push(hop.clone());
        }

        cursor = label.parent.clone();
    }

    states.reverse();
    hops.reverse();
    let goal = goal.borrow();
    DistinctOwnerBlockerSearchSuccess {
        states,
        hops,
        owners: goal.owners.clone(),
        distance: goal.distance,
        expanded_label_count,
    }
}

fn get_next_active_label<S, O, D>(
    queue: &mut SearchLabelQueue<S, O, D>,
) -> Option<LabelRef<S, O, D>> {
    loop {
        let label = queue.pop()?;
        if label.borrow().active {
            return Some(label);
        }
    }
}

pub fn find_distinct_owner_blocker_path<
    S: Clone,
    K: Clone + Eq + Hash,
    O: Clone + Eq + Hash,
    D: Clone,
>(
    options: DistinctOwnerBlockerSearchOptions<'_, S, K, O, D>,
) -> DistinctOwnerBlockerSearchResult<S, O, D> {
    // usize makes the source's non-negative integer limit invariant explicit.
    let max_expanded_labels = options.max_expanded_labels.unwrap_or(usize::MAX);
    let mut labels_by_state_key: HashMap<K, Vec<LabelRef<S, O, D>>> = HashMap::new();
    let mut queue = SearchLabelQueue { heap: Vec::new() };
    let mut next_queue_order = 0;
    let mut expanded_label_count = 0;
    let start_key = (options.get_state_key)(&options.start);
    let start = Rc::new(RefCell::new(SearchLabel {
        state: options.start,
        owners: HashSet::new(),
        distance: 0.0,
        parent: None,
        incoming_hop: None,
        queue_order: next_queue_order,
        active: true,
    }));
    next_queue_order += 1;
    labels_by_state_key.insert(start_key, vec![start.clone()]);
    queue.push(start);

    loop {
        let Some(current) = get_next_active_label(&mut queue) else {
            return DistinctOwnerBlockerSearchResult::Failure(DistinctOwnerBlockerSearchFailure {
                reason: DistinctOwnerBlockerSearchFailureReason::NoPath,
                expanded_label_count,
            });
        };
        if (options.is_goal)(&current.borrow().state) {
            return DistinctOwnerBlockerSearchResult::Success(reconstruct_successful_search(
                current,
                expanded_label_count,
            ));
        }

        if expanded_label_count >= max_expanded_labels {
            return DistinctOwnerBlockerSearchResult::Failure(DistinctOwnerBlockerSearchFailure {
                reason: DistinctOwnerBlockerSearchFailureReason::ExpansionLimit,
                expanded_label_count,
            });
        }

        expanded_label_count += 1;

        for hop in (options.get_hops)(&current.borrow().state) {
            assert!(
                hop.distance.is_finite() && hop.distance >= 0.0,
                "Distinct-owner blocker hops require finite distances >= 0"
            );
            let mut owners = current.borrow().owners.clone();
            if let Some(hop_owners) = &hop.owners {
                owners.extend(hop_owners.iter().cloned());
            }

            let distance = current.borrow().distance + hop.distance;
            assert!(
                distance.is_finite(),
                "Distinct-owner blocker path distance overflowed"
            );
            let state_key = (options.get_state_key)(&hop.state);
            let candidate = Rc::new(RefCell::new(SearchLabel {
                state: hop.state.clone(),
                owners,
                distance,
                parent: Some(current.clone()),
                incoming_hop: Some(hop),
                queue_order: next_queue_order,
                active: true,
            }));
            next_queue_order += 1;
            let existing = labels_by_state_key.entry(state_key.clone()).or_default();
            if existing
                .iter()
                .any(|label| label_dominates(&label.borrow(), &candidate.borrow()))
            {
                continue;
            }

            let mut surviving = Vec::new();

            for label in existing.iter() {
                if label_dominates(&candidate.borrow(), &label.borrow()) {
                    label.borrow_mut().active = false;
                } else {
                    surviving.push(label.clone());
                }
            }

            surviving.push(candidate.clone());
            labels_by_state_key.insert(state_key, surviving);
            queue.push(candidate);
        }
    }
}
