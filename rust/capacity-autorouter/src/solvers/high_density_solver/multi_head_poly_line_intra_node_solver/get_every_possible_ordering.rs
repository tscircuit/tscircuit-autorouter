pub fn get_every_possible_ordering<T: Clone>(array: &[T]) -> Vec<Vec<T>> {
    if array.is_empty() { return vec![vec![]]; }
    let mut result = Vec::new();
    for index in 0..array.len() {
        let rest: Vec<_> = array[..index].iter().chain(array[index + 1..].iter()).cloned().collect();
        for permutation in get_every_possible_ordering(&rest) {
            let mut entry = vec![array[index].clone()];
            entry.extend(permutation);
            result.push(entry);
        }
    }
    result
}
