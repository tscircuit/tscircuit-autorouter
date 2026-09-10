use crate::types::{AnglePairArrays, DynamicAnglePair, DynamicAnglePairArrays};

pub fn create_dynamic_angle_pair_arrays(
    angle_pairs: &[DynamicAnglePair],
) -> DynamicAnglePairArrays {
    let mut result = DynamicAnglePairArrays::default();

    for &[net, lesser, z1, greater, z2] in angle_pairs {
        result.net_ids.push(net);
        result.lesser_angles.push(lesser);
        result.greater_angles.push(greater);
        result
            .layer_masks
            .push(1_i32.wrapping_shl(z1 as u32) | 1_i32.wrapping_shl(z2 as u32));
    }

    result
}

pub fn count_new_intersections_with_values(
    existing_pairs: &impl AnglePairArrays,
    new_net: i32,
    new_lesser_angle: i32,
    new_greater_angle: i32,
    new_layer_mask: i32,
    entry_exit_layer_changes: i32,
) -> (i32, i32, i32) {
    let mut same = 0;
    let mut crossing = 0;

    for i in 0..existing_pairs.net_ids().len() {
        if new_net == existing_pairs.net_ids()[i] {
            continue;
        }

        let lesser_inside = new_lesser_angle < existing_pairs.lesser_angles()[i]
            && existing_pairs.lesser_angles()[i] < new_greater_angle;
        let greater_inside = new_lesser_angle < existing_pairs.greater_angles()[i]
            && existing_pairs.greater_angles()[i] < new_greater_angle;
        if lesser_inside == greater_inside {
            continue;
        }

        if (new_layer_mask & existing_pairs.layer_masks()[i]) != 0 {
            same += 1;
        } else {
            crossing += 1;
        }
    }

    (same, crossing, entry_exit_layer_changes)
}

pub fn count_new_intersections(
    existing_pairs: &impl AnglePairArrays,
    new_pair: DynamicAnglePair,
) -> (i32, i32, i32) {
    let [net, lesser, z1, greater, z2] = new_pair;
    count_new_intersections_with_values(
        existing_pairs,
        net,
        lesser,
        greater,
        1_i32.wrapping_shl(z1 as u32) | 1_i32.wrapping_shl(z2 as u32),
        (z1 != z2) as i32,
    )
}
pub use count_new_intersections as count_intersections_from_angle_pairs_dynamic;
