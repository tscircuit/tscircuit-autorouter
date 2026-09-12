pub struct SeededRandom { state0: f64, state1: f64 }

impl SeededRandom {
    pub fn new(seed: f64) -> Self {
        let mut s = seed;
        for _ in 0..10 { s = (s * 16807.0) % 2147483647.0; }
        let state0 = s;
        s = (seed * 69069.0 + 1.0) % 2147483647.0;
        for _ in 0..10 { s = (s * 48271.0) % 2147483647.0; }
        Self { state0, state1: s }
    }

    pub fn next(&mut self) -> f64 {
        let mut s1 = self.state0 as i64 as i32;
        let s0 = self.state1 as i64 as i32;
        self.state0 = self.state1;
        s1 ^= s1.wrapping_shl(23);
        s1 ^= ((s1 as u32) >> 17) as i32;
        s1 ^= s0;
        s1 ^= ((s0 as u32) >> 26) as i32;
        self.state1 = s1 as f64;
        let result = (self.state0 + self.state1) / 4294967296.0;
        result - result.floor()
    }
}

pub fn clone_and_shuffle_array<T: Clone>(array: &[T], seed: f64) -> Vec<T> {
    if seed == 0.0 || array.is_empty() { return array.to_vec(); }
    let orders: &[&[usize]] = match array.len() {
        1 => &[&[0]],
        2 => &[&[0, 1],&[1, 0]],
        3 => &[&[0, 1, 2],&[2, 0, 1],&[1, 0, 2],&[0, 2, 1],&[1, 2, 0],&[2, 1, 0]],
        4 => &[&[0, 1, 2, 3],&[2, 0, 1, 3],&[1, 3, 2, 0],&[3, 0, 1, 2],&[0, 2, 1, 3],&[2, 1, 3, 0],&[3, 0, 2, 1],&[1, 2, 0, 3],&[3, 1, 0, 2],&[0, 3, 2, 1],&[2, 3, 0, 1],&[2, 3, 1, 0],&[1, 2, 3, 0],&[3, 1, 2, 0],&[0, 1, 3, 2],&[0, 2, 3, 1],&[0, 3, 1, 2],&[1, 0, 2, 3],&[1, 0, 3, 2],&[1, 3, 0, 2],&[2, 0, 3, 1],&[2, 1, 0, 3],&[3, 2, 0, 1],&[3, 2, 1, 0]],
        _ => &[],
    };
    if array.len() <= 4 {
        let index = seed % orders.len() as f64;
        assert!(index >= 0.0 && index.fract() == 0.0, "Invalid preshuffled case");
        return orders[index as usize].iter().map(|&index| array[index].clone()).collect();
    }
    let mut random = SeededRandom::new(seed);
    let mut shuffled = array.to_vec();
    for index in 0..shuffled.len() {
        let first = (random.next() * shuffled.len() as f64).floor() as usize;
        let second = (random.next() * (index + 1) as f64).floor() as usize;
        shuffled.swap(first, second);
    }
    shuffled
}
