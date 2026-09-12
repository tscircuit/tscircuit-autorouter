pub fn create_symmetric_array(length: usize, one_count: usize) -> Vec<usize> {
    let mut result = vec![0; length];
    if one_count == 0 { return result; }
    if one_count == length { result.fill(1); return result; }
    if one_count as f64 <= length as f64 / 2.0 {
        let gap = length / one_count;
        let start = (length - (gap * (one_count - 1) + 1)) / 2;
        for index in 0..one_count { result[start + index * gap] = 1; }
    } else {
        let zero_count = length - one_count;
        let gap = length / zero_count;
        let start = (length - (gap * (zero_count - 1) + 1)) / 2;
        result.fill(1);
        for index in 0..zero_count { result[start + index * gap] = 0; }
    }
    result
}
