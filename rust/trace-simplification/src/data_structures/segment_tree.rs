use indexmap::{IndexMap, IndexSet};
use crate::types::{Point, PointRef};
use intra_node_routing::js_number::js_number_to_string;

pub type Segment = [PointRef; 2];
pub type SegmentWithId = (PointRef, PointRef, String);

#[derive(Clone, Debug)]
pub struct SegmentTree {
    pub buckets: IndexMap<(i64, i64), Vec<SegmentWithId>>,
    pub cell_size: f64,
    pub segment_margin: f64,
    pub segments: Vec<Segment>,
}

impl SegmentTree {
    pub fn new(segments: Vec<Segment>, segment_margin: f64) -> Self {
        let mut tree = Self { buckets: IndexMap::new(), cell_size: 0.4, segment_margin, segments };
        let mut segments_by_id = IndexSet::new();
        for segment in &tree.segments {
            let segment_key = Self::get_segment_key(segment);
            if !segments_by_id.insert(segment_key.clone()) { continue; }
            let a = segment[0].borrow();
            let b = segment[1].borrow();
            let min_index_x = (a.x.min(b.x) / tree.cell_size).floor() as i64;
            let max_index_x = (a.x.max(b.x) / tree.cell_size).floor() as i64;
            let min_index_y = (a.y.min(b.y) / tree.cell_size).floor() as i64;
            let max_index_y = (a.y.max(b.y) / tree.cell_size).floor() as i64;
            for ix in min_index_x..=max_index_x {
                for iy in min_index_y..=max_index_y {
                    tree.buckets.entry((ix, iy)).or_default().push((segment[0].clone(), segment[1].clone(), segment_key.clone()));
                }
            }
        }
        tree
    }

    pub fn get_bucket_key(&self, x: f64, y: f64) -> (i64, i64) {
        ((x / self.cell_size).floor() as i64, (y / self.cell_size).floor() as i64)
    }

    pub fn get_segment_key(segment: &Segment) -> String {
        let a = segment[0].borrow();
        let b = segment[1].borrow();
        [a.x, a.y, a.z, b.x, b.y, b.z].map(js_number_to_string).join("-")
    }

    pub fn get_segments_that_could_intersect(&self, a: &Point, b: &Point) -> Vec<SegmentWithId> {
        let mut segments = Vec::new();
        let mut already_added_segments = IndexSet::new();
        let min_x = a.x.min(b.x) - self.segment_margin;
        let min_y = a.y.min(b.y) - self.segment_margin;
        let max_x = a.x.max(b.x) + self.segment_margin;
        let max_y = a.y.max(b.y) + self.segment_margin;
        let min_index_x = (min_x / self.cell_size).floor() as i64;
        let max_index_x = (max_x / self.cell_size).floor() as i64;
        let min_index_y = (min_y / self.cell_size).floor() as i64;
        let max_index_y = (max_y / self.cell_size).floor() as i64;
        for ix in min_index_x..=max_index_x {
            for iy in min_index_y..=max_index_y {
                if let Some(bucket) = self.buckets.get(&(ix, iy)) {
                    for segment in bucket {
                        if already_added_segments.insert(&segment.2) { segments.push(segment.clone()); }
                    }
                }
            }
        }
        segments
    }
}
