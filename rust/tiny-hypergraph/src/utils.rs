pub fn range(len: usize) -> Vec<i32> {
    let mut values = Vec::with_capacity(len);

    for i in 0..len {
        values.push(i as i32);
    }

    values
}
