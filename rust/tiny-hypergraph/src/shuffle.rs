pub fn create_mulberry32(seed: u32) -> impl FnMut() -> f64 {
    let mut state = seed;
    move || {
        state = state.wrapping_add(0x6d2b79f5);
        let mut t = state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
}

pub fn shuffle<T: Clone>(items: &[T], seed: u32) -> Vec<T> {
    let mut shuffled = items.to_vec();
    let mut random = create_mulberry32(seed);

    for i in (1..shuffled.len()).rev() {
        let j = (random() * (i + 1) as f64).floor() as usize;
        shuffled.swap(i, j);
    }

    shuffled
}
