use crate::types::DynamicAnglePair;

pub fn count_intersections_from_angle_pairs_dynamic(
    angle_pairs: &[DynamicAnglePair],
) -> (i32, i32, i32) {
    let mut crossing = 0;
    let mut same = 0;

    for i in 0..angle_pairs.len() {
        let [n1, a, az, b, bz] = angle_pairs[i];

        for u in i + 1..angle_pairs.len() {
            let [n2, c, cz, d, dz] = angle_pairs[u];
            if n1 == n2 {
                continue;
            }

            let intersects = ((a < c && c < b) != (a < d && d < b)) as i32;
            if az == cz || bz == cz || az == dz || bz == dz {
                same += intersects;
            } else {
                crossing += intersects;
            }
        }
    }

    let changes = angle_pairs.iter().filter(|p| p[2] != p[4]).count() as i32;
    (same, crossing, changes)
}
