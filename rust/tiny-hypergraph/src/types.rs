pub type PortId = i32;
pub type RegionId = i32;
pub type Integer = i32;
pub type RouteId = i32;
pub type NetId = i32;
pub type HopId = i64;
/// Computed as port1_id * port_count + port2_id.
pub type SegmentId = i64;
pub type LossySegmentIdHash = i32;
pub type LesserAngle = i32;
pub type GreaterAngle = i32;
pub type Z1 = i32;
pub type Z2 = i32;
pub type DynamicAnglePair = [i32; 5];
pub type SameLayerIntersectionCount = i32;
pub type CrossingLayerIntersectionCount = i32;
pub type EntryExitLayerChanges = i32;

#[derive(Clone, Debug, Default)]
pub struct DynamicAnglePairArrays {
    pub net_ids: Vec<i32>,
    pub lesser_angles: Vec<i32>,
    pub greater_angles: Vec<i32>,
    pub layer_masks: Vec<i32>,
}

#[derive(Clone, Debug, Default)]
pub struct RegionIntersectionCache {
    pub net_ids: Vec<i32>,
    pub lesser_angles: Vec<i32>,
    pub greater_angles: Vec<i32>,
    pub layer_masks: Vec<i32>,
    pub existing_same_layer_intersections: Integer,
    pub existing_crossing_layer_intersections: Integer,
    pub existing_entry_exit_layer_changes: Integer,
    pub existing_region_cost: f64,
    pub existing_segment_count: usize,
}

pub trait AnglePairArrays {
    fn net_ids(&self) -> &[i32];

    fn lesser_angles(&self) -> &[i32];

    fn greater_angles(&self) -> &[i32];

    fn layer_masks(&self) -> &[i32];
}
macro_rules! impl_angle_pair_arrays {
    ($type:ty) => {
        impl AnglePairArrays for $type {
            fn net_ids(&self) -> &[i32] {
                &self.net_ids
            }

            fn lesser_angles(&self) -> &[i32] {
                &self.lesser_angles
            }

            fn greater_angles(&self) -> &[i32] {
                &self.greater_angles
            }

            fn layer_masks(&self) -> &[i32] {
                &self.layer_masks
            }
        }
    };
}
impl_angle_pair_arrays!(DynamicAnglePairArrays);
impl_angle_pair_arrays!(RegionIntersectionCache);
