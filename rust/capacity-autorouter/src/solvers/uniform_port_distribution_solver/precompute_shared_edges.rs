use indexmap::IndexMap;
use crate::solvers::uniform_port_distribution_solver::types::{Bounds, Name, OwnerPair, SharedEdge};
use crate::solvers::uniform_port_distribution_solver::get_owner_pair_key::get_owner_pair_key;
use crate::solvers::uniform_port_distribution_solver::get_shared_edge_for_node_pair::get_shared_edge_for_node_pair;

pub fn precompute_shared_edges(owner_pairs: &[OwnerPair], node_bounds: &IndexMap<Name, Bounds>) -> IndexMap<Name, SharedEdge> {
    let mut shared_edges = IndexMap::new();
    for owner_pair in owner_pairs {
        let [node_a_id, node_b_id] = owner_pair;
        if node_a_id == node_b_id { continue; }
        let Some(shared_edge) = get_shared_edge_for_node_pair(node_a_id, node_b_id, node_bounds) else { continue; };
        shared_edges.insert(get_owner_pair_key(owner_pair), shared_edge);
    }
    shared_edges
}
