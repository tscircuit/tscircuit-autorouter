pub fn seeded_random(seed: f64) -> impl FnMut() -> f64 {
    let mut s = seed;
    for _ in 0..10 {
        s = (s * 16807.0) % 2147483647.0;
    }
    let mut state0 = s;
    s = (seed * 69069.0 + 1.0) % 2147483647.0;
    for _ in 0..10 {
        s = (s * 48271.0) % 2147483647.0;
    }
    let mut state1 = s;

    move || {
        let mut s1 = state0 as i64 as i32;
        let s0 = state1;
        state0 = s0;
        s1 ^= s1.wrapping_shl(23);
        s1 ^= ((s1 as u32) >> 17) as i32;
        s1 ^= s0 as i64 as i32;
        s1 ^= ((s0 as i64 as u32) >> 26) as i32;
        state1 = s1 as f64;
        let result = (state0 + state1) / 4294967296.0;
        result - result.floor()
    }
}

pub fn clone_and_shuffle_array<T: Clone>(arr: &[T], seed: f64) -> Vec<T> {
    if seed == 0.0 || arr.is_empty() {
        return arr.to_vec();
    }
    if arr.len() <= 4 {
        let options: &[&[usize]] = match arr.len() {
            1 => &[&[0]],
            2 => &[&[0, 1], &[1, 0]],
            3 => &[
                &[0, 1, 2],
                &[2, 0, 1],
                &[1, 0, 2],
                &[0, 2, 1],
                &[1, 2, 0],
                &[2, 1, 0],
            ],
            4 => &[
                &[0, 1, 2, 3],
                &[2, 0, 1, 3],
                &[1, 3, 2, 0],
                &[3, 0, 1, 2],
                &[0, 2, 1, 3],
                &[2, 1, 3, 0],
                &[3, 0, 2, 1],
                &[1, 2, 0, 3],
                &[3, 1, 0, 2],
                &[0, 3, 2, 1],
                &[2, 3, 0, 1],
                &[2, 3, 1, 0],
                &[1, 2, 3, 0],
                &[3, 1, 2, 0],
                &[0, 1, 3, 2],
                &[0, 2, 3, 1],
                &[0, 3, 1, 2],
                &[1, 0, 2, 3],
                &[1, 0, 3, 2],
                &[1, 3, 0, 2],
                &[2, 0, 3, 1],
                &[2, 1, 0, 3],
                &[3, 2, 0, 1],
                &[3, 2, 1, 0],
            ],
            _ => unreachable!(),
        };
        let index = seed % options.len() as f64;
        assert!(
            index >= 0.0 && index.fract() == 0.0,
            "Invalid preshuffled case"
        );
        return options[index as usize]
            .iter()
            .map(|&i| arr[i].clone())
            .collect();
    }

    let mut random = seeded_random(seed);
    let mut shuffled = arr.to_vec();
    for i in 0..shuffled.len() {
        let i1 = (random() * shuffled.len() as f64).floor() as usize;
        let i2 = (random() * (i + 1) as f64).floor() as usize;
        shuffled.swap(i1, i2);
    }
    shuffled
}
