use indexmap::IndexSet;
use rustc_hash::FxBuildHasher;

/// Direct port of createPostProcessingModel's route/obstacle alias expansion.
/// IDs intern JavaScript strings at the boundary, preserving UTF-16 equality.
/// None means no assignment occurred, so the caller keeps the original array.
pub fn expand_obstacle_connected_ids(
    aliases_by_route: &[Vec<u32>],
    connected_to_by_obstacle: &[Vec<u32>],
) -> Vec<Option<Vec<u32>>> {
    let mut replacements: Vec<Option<Vec<u32>>> = vec![None; connected_to_by_obstacle.len()];
    for route_aliases in aliases_by_route {
        let aliases: IndexSet<u32, FxBuildHasher> = route_aliases.iter().copied().collect();
        for (index, original) in connected_to_by_obstacle.iter().enumerate() {
            let connected_to = replacements[index].as_ref().unwrap_or(original);
            if !connected_to.iter().any(|name| aliases.contains(name)) {
                continue;
            }
            let expanded: IndexSet<u32, FxBuildHasher> = connected_to.iter()
                .chain(aliases.iter())
                .copied()
                .collect();
            replacements[index] = Some(expanded.into_iter().collect());
        }
    }
    replacements
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sequential_expansion_preserves_order_duplicates_and_assignment_presence() {
        let aliases = vec![vec![2, 1, 2], vec![3, 2], vec![4, 3], vec![]];
        let obstacles = vec![vec![1, 1], vec![8, 8], vec![], vec![4], vec![2, 1]];
        let result = expand_obstacle_connected_ids(&aliases, &obstacles);
        assert_eq!(result, vec![
            Some(vec![1, 2, 3, 4]),
            None,
            None,
            Some(vec![4, 3]),
            Some(vec![2, 1, 3, 4]),
        ]);
        assert_eq!(obstacles[0],vec![1, 1]);
        assert_eq!(obstacles[1],vec![8, 8]);
        assert_eq!(expand_obstacle_connected_ids(&[vec![1]], &[vec![1]]),vec![Some(vec![1])]);
        assert_eq!(expand_obstacle_connected_ids(&[], &obstacles),vec![None; obstacles.len()]);
        let mut reversed = aliases;
        reversed.reverse();
        assert_eq!(expand_obstacle_connected_ids(&reversed, &[vec![1]]),vec![Some(vec![1, 2])]);
    }
}
