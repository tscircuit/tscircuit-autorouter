// Flatbush 4.6.2 constructor/add/finish/search and their helpers.
// Copyright (c) 2018, Vladimir Agafonkin. ISC license: see FLATBUSH-LICENSE.

use std::cell::{RefCell, RefMut};

#[derive(Clone, Debug, Default)]
struct SearchScratch {
    queue: Vec<(usize, usize)>,
    results: Vec<usize>,
}

#[derive(Clone, Debug)]
pub struct Flatbush {
    search_scratch: RefCell<SearchScratch>,
    num_items: usize,
    node_size: usize,
    level_bounds: Vec<usize>,
    boxes: Vec<f64>,
    indices: Vec<usize>,
    pos: usize,
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

impl Flatbush {
    pub fn new(num_items: usize) -> Self {
        assert!(num_items > 0, "Unexpected numItems value: {num_items}.");
        let node_size = 16;
        let mut n = num_items;
        let mut num_nodes = n;
        let mut level_bounds = vec![n * 4];
        loop {
            n = n.div_ceil(node_size);
            num_nodes += n;
            level_bounds.push(num_nodes * 4);
            if n == 1 { break; }
        }
        Self {
            search_scratch: RefCell::new(SearchScratch::default()),
            num_items, node_size, level_bounds,
            boxes: vec![0.0; num_nodes * 4], indices: vec![0; num_nodes],
            pos: 0, min_x: f64::INFINITY, min_y: f64::INFINITY,
            max_x: f64::NEG_INFINITY, max_y: f64::NEG_INFINITY,
        }
    }

    pub fn snapshot_arrays(&self) -> (&[f64], &[usize], &[usize], usize, usize) {
        (
            &self.boxes,
            &self.indices,
            &self.level_bounds,
            self.node_size,
            self.num_items,
        )
    }

    pub fn add(&mut self, min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> usize {
        let pos = self.pos;
        let index = pos >> 2;
        self.indices[index] = index;
        self.boxes[pos..pos + 4].copy_from_slice(&[min_x, min_y, max_x, max_y]);
        self.pos = pos + 4;
        if min_x < self.min_x { self.min_x = min_x; }
        if min_y < self.min_y { self.min_y = min_y; }
        if max_x > self.max_x { self.max_x = max_x; }
        if max_y > self.max_y { self.max_y = max_y; }
        index
    }

    pub fn finish(&mut self) {
        assert_eq!(self.pos >> 2, self.num_items, "Incorrect number of Flatbush items");
        if self.num_items <= self.node_size {
            self.boxes[self.pos..self.pos + 4].copy_from_slice(&[self.min_x, self.min_y, self.max_x, self.max_y]);
            self.pos += 4;
            return;
        }
        let width = self.max_x - self.min_x;
        let height = self.max_y - self.min_y;
        let sx = 65535.0 / if width == 0.0 { 1.0 } else { width };
        let sy = 65535.0 / if height == 0.0 { 1.0 } else { height };
        let mut values = Vec::with_capacity(self.num_items);
        for i in 0..self.num_items {
            let pos = i * 4;
            let x = (sx * ((self.boxes[pos] + self.boxes[pos + 2]) / 2.0 - self.min_x)) as i32;
            let y = (sy * ((self.boxes[pos + 1] + self.boxes[pos + 3]) / 2.0 - self.min_y)) as i32;
            values.push(hilbert(x, y));
        }
        sort(&mut values, &mut self.boxes, &mut self.indices, 0, self.num_items - 1, self.node_size);

        let mut pos = self.num_items * 4;
        let mut read_pos = 0;
        for i in 0..self.level_bounds.len() - 1 {
            let end = self.level_bounds[i];
            while read_pos < end {
                let node_index = read_pos;
                let mut min_x = self.boxes[read_pos];
                let mut min_y = self.boxes[read_pos + 1];
                let mut max_x = self.boxes[read_pos + 2];
                let mut max_y = self.boxes[read_pos + 3];
                read_pos += 4;
                for _ in 1..self.node_size {
                    if read_pos >= end { break; }
                    min_x = min_x.min(self.boxes[read_pos]);
                    min_y = min_y.min(self.boxes[read_pos + 1]);
                    max_x = max_x.max(self.boxes[read_pos + 2]);
                    max_y = max_y.max(self.boxes[read_pos + 3]);
                    read_pos += 4;
                }
                self.indices[pos >> 2] = node_index;
                self.boxes[pos..pos + 4].copy_from_slice(&[min_x, min_y, max_x, max_y]);
                pos += 4;
            }
        }
        self.pos = pos;
    }

    pub fn search(&self, min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Vec<usize> {
        let mut results = Vec::new();
        self.search_into(min_x, min_y, max_x, max_y, &mut results);
        results
    }

    pub(crate) fn search_reusing(&self, min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> RefMut<'_, Vec<usize>> {
        let mut scratch = self.search_scratch.borrow_mut();
        let SearchScratch { queue, results } = &mut *scratch;
        self.search_with_buffers(min_x, min_y, max_x, max_y, results, queue);
        RefMut::map(scratch, |scratch| &mut scratch.results)
    }

    pub(crate) fn search_into(&self, min_x: f64, min_y: f64, max_x: f64, max_y: f64, results: &mut Vec<usize>) {
        let mut scratch = self.search_scratch.borrow_mut();
        self.search_with_buffers(min_x, min_y, max_x, max_y, results, &mut scratch.queue);
    }

    fn search_with_buffers(&self, min_x: f64, min_y: f64, max_x: f64, max_y: f64,
        results: &mut Vec<usize>, queue: &mut Vec<(usize, usize)>) {
        assert_eq!(self.pos, self.boxes.len(), "Data not yet indexed - call index.finish().");
        let num_items4 = self.num_items * 4;
        let mut node_index = self.boxes.len() - 4;
        let mut level = self.level_bounds.len() - 1;
        queue.clear();
        results.clear();
        let mut contained = false;
        loop {
            let end = (node_index + self.node_size * 4).min(self.level_bounds[level]);
            let is_node = node_index >= num_items4;
            if contained {
                self.collect_contained(node_index, end, level, num_items4, results);
            } else {
                let (boxes, _) = self.boxes[node_index..end].as_chunks::<4>();
                let indices = &self.indices[node_index >> 2..end >> 2];
                for (bounds, &index) in boxes.iter().zip(indices) {
                    let [x0, y0, x1, y1] = *bounds;
                    if max_x < x0 { continue; }
                    if max_y < y0 { continue; }
                    if min_x > x1 { continue; }
                    if min_y > y1 { continue; }
                    if is_node {
                        let c = usize::from(min_x <= x0 && min_y <= y0 && max_x >= x1 && max_y >= y1);
                        queue.push((index | c, level - 1));
                    } else {
                        results.push(index);
                    }
                }
            }
            let Some((next_index, next_level)) = queue.pop() else { break; };
            node_index = next_index & !1;
            level = next_level;
            contained = next_index & 1 == 1;
        }
    }

    fn collect_contained(&self, node_index: usize, end: usize, level: usize, num_items4: usize, results: &mut Vec<usize>) {
        let mut pos = node_index;
        for _ in (1..=level).rev() { pos = self.indices[pos >> 2]; }
        let leaf_end = (pos + (end - node_index) * self.node_size.pow(level as u32)).min(num_items4);
        while pos < leaf_end {
            results.push(self.indices[pos >> 2]);
            pos += 4;
        }
    }
}

fn sort(values: &mut [i32], boxes: &mut [f64], indices: &mut [usize], left: usize, right: usize, node_size: usize) {
    let mut stack = vec![(left, right)];
    while let Some((l, r)) = stack.pop() {
        if r - l <= node_size && l / node_size >= r / node_size { continue; }
        let a = values[l];
        let b = values[(l + r) >> 1];
        let c = values[r];
        let pivot = if (a > b) != (a > c) { a } else if (b < a) != (b < c) { b } else { c };
        let mut i = l as isize - 1;
        let mut j = r + 1;
        loop {
            loop { i += 1; if values[i as usize] >= pivot { break; } }
            loop { j -= 1; if values[j] <= pivot { break; } }
            if i as usize >= j { break; }
            values.swap(i as usize, j);
            for offset in 0..4 { boxes.swap(4 * i as usize + offset, 4 * j + offset); }
            indices.swap(i as usize, j);
        }
        stack.push((l, j));
        stack.push((j + 1, r));
    }
}

fn hilbert(x: i32, y: i32) -> i32 {
    let mut a = x ^ y;
    let mut b = 0xffff ^ a;
    let mut c = 0xffff ^ (x | y);
    let mut d = x & (y ^ 0xffff);
    let mut aa = a | (b >> 1);
    let mut bb = (a >> 1) ^ a;
    let mut cc = c ^ ((c >> 1) ^ (b & (d >> 1)));
    let mut dd = d ^ ((a & (c >> 1)) ^ (d >> 1));
    a = (aa & (aa >> 2)) ^ (bb & (bb >> 2));
    b = (aa & (bb >> 2)) ^ (bb & ((aa ^ bb) >> 2));
    c = cc ^ ((aa & (cc >> 2)) ^ (bb & (dd >> 2)));
    d = dd ^ ((bb & (cc >> 2)) ^ ((aa ^ bb) & (dd >> 2)));
    aa = (a & (a >> 4)) ^ (b & (b >> 4));
    bb = (a & (b >> 4)) ^ (b & ((a ^ b) >> 4));
    cc = c ^ ((a & (c >> 4)) ^ (b & (d >> 4)));
    dd = d ^ ((b & (c >> 4)) ^ ((a ^ b) & (d >> 4)));
    c = cc ^ ((aa & (cc >> 8)) ^ (bb & (dd >> 8)));
    d = dd ^ ((bb & (cc >> 8)) ^ ((aa ^ bb) & (dd >> 8)));
    c ^= c >> 1;
    d ^= d >> 1;
    a = x ^ y;
    b = d | (0xffff ^ (a | c));
    a = (a | a.wrapping_shl(8)) & 0x00ff00ff;
    a = (a | a.wrapping_shl(4)) & 0x0f0f0f0f;
    a = (a | a.wrapping_shl(2)) & 0x33333333;
    a = (a | a.wrapping_shl(1)) & 0x55555555;
    b = (b | b.wrapping_shl(8)) & 0x00ff00ff;
    b = (b | b.wrapping_shl(4)) & 0x0f0f0f0f;
    b = (b | b.wrapping_shl(2)) & 0x33333333;
    b = (b | b.wrapping_shl(1)) & 0x55555555;
    ((b.wrapping_shl(1) | a) as u32).wrapping_sub(0x80000000) as i32
}
