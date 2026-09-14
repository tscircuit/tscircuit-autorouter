use super::bus_solver_types::BUS_CANDIDATE_EPSILON;
use crate::core::TinyHyperGraphTopology;
use crate::types::RegionId;

#[derive(Clone, Debug)]
struct RegionSearchCandidate {
    region_id: RegionId,
    cost: f64,
}

fn compare_region_candidates(left: &RegionSearchCandidate, right: &RegionSearchCandidate) -> f64 {
    left.cost - right.cost
}

pub fn compute_center_goal_hop_distance(
    region_count: usize,
    goal: RegionId,
    neighbors: &[Vec<RegionId>],
) -> Vec<i32> {
    let mut distances = vec![-1; region_count];
    if goal < 0 {
        return distances;
    }

    let mut queue = vec![goal];
    distances[goal as usize] = 0;
    let mut index = 0;

    while index < queue.len() {
        let current = queue[index];
        index += 1;
        let next_distance = distances[current as usize] + 1;

        for &neighbor in neighbors.get(current as usize).into_iter().flatten() {
            if distances[neighbor as usize] != -1 {
                continue;
            }

            distances[neighbor as usize] = next_distance;
            queue.push(neighbor);
        }
    }

    distances
}

pub fn compute_region_distance_to_goal(
    topology: &TinyHyperGraphTopology,
    goal: RegionId,
    neighbors: &[Vec<RegionId>],
) -> Vec<f64> {
    let mut distances = vec![f64::INFINITY; topology.region_count];
    let mut queue = crate::min_heap::MinHeap::new(vec![], compare_region_candidates);
    distances[goal as usize] = 0.0;
    queue.queue(RegionSearchCandidate {
        region_id: goal,
        cost: 0.0,
    });

    while let Some(current) = queue.dequeue() {
        if current.cost > distances[current.region_id as usize] + BUS_CANDIDATE_EPSILON {
            continue;
        }

        for &next in neighbors
            .get(current.region_id as usize)
            .into_iter()
            .flatten()
        {
            let edge = (topology.region_center_x[current.region_id as usize]
                - topology.region_center_x[next as usize])
                .hypot(
                    topology.region_center_y[current.region_id as usize]
                        - topology.region_center_y[next as usize],
                );
            let cost = current.cost + edge;
            if cost >= distances[next as usize] {
                continue;
            }

            distances[next as usize] = cost;
            queue.queue(RegionSearchCandidate {
                region_id: next,
                cost,
            });
        }
    }

    distances
}
