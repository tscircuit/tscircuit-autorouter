use crate::types::{DynamicAnglePair, Integer};

#[derive(Clone, Copy, Debug)]
pub struct Center {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct AnglePairPort {
    pub x: f64,
    pub y: f64,
    pub z: i32,
    pub net: Integer,
}

pub fn map_ports_to_angle_pairs(
    center: Center,
    ports: &[(AnglePairPort, AnglePairPort)],
) -> Vec<DynamicAnglePair> {
    let mut angle_pairs = Vec::new();

    for (p1, p2) in ports {
        // JS Math.round rounds ties toward positive infinity.
        let a = (((p1.y - center.y).atan2(p1.x - center.x) * 36000.0) + 0.5).floor() as i32;
        let b = (((p2.y - center.y).atan2(p2.x - center.x) * 36000.0) + 0.5).floor() as i32;
        angle_pairs.push(if a < b {
            [p1.net, a, p1.z, b, p2.z]
        } else {
            [p1.net, b, p2.z, a, p1.z]
        });
    }

    angle_pairs
}
