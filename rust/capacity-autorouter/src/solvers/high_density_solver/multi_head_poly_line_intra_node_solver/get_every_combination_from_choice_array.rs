pub fn get_every_combination_from_choice_array<T: Clone>(choices: &[Vec<T>]) -> Vec<Vec<T>> {
    let mut results = vec![vec![]];
    for choice_set in choices {
        let mut next = Vec::new();
        for combination in &results {
            for choice in choice_set {
                let mut combination = combination.clone();
                combination.push(choice.clone());
                next.push(combination);
            }
        }
        results = next;
    }
    results
}
