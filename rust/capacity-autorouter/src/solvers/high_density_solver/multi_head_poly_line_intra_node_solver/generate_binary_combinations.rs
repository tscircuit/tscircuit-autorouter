pub fn generate_binary_combinations(one_count: usize, length: usize) -> Result<Vec<Vec<usize>>, String> {
    if one_count > length { return Err("oneCount cannot be greater than length".into()); }
    fn generate(current: &mut Vec<usize>, ones_left: usize, position: usize, result: &mut Vec<Vec<usize>>) {
        if position == current.len() {
            if ones_left == 0 { result.push(current.clone()); }
            return;
        }
        current[position] = 0;
        generate(current, ones_left, position + 1, result);
        if ones_left > 0 {
            current[position] = 1;
            generate(current, ones_left - 1, position + 1, result);
        }
    }
    let mut result = Vec::new();
    generate(&mut vec![0; length], one_count, 0, &mut result);
    Ok(result)
}
