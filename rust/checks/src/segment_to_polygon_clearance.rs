use crate::is_point_in_pad::Pad;
use crate::line_intersections::max;
use crate::types::{Math, Point};

pub struct PillCenterLine {
    pub start: Point,
    pub end: Point,
    pub radius: f64,
}

fn rotate_point(point: Point, angle_degrees: f64, math: Math) -> Point {
    let angle = (angle_degrees * std::f64::consts::PI) / 180.0;
    Point {
        x: point.x * (math.cos)(angle) - point.y * (math.sin)(angle),
        y: point.x * (math.sin)(angle) + point.y * (math.cos)(angle),
    }
}

pub fn get_rotated_rect_points(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    ccw_rotation: f64,
    math: Math,
) -> Vec<Point> {
    let half_width = width / 2.0;
    let half_height = height / 2.0;
    [
        Point {
            x: -half_width,
            y: -half_height,
        },
        Point {
            x: half_width,
            y: -half_height,
        },
        Point {
            x: half_width,
            y: half_height,
        },
        Point {
            x: -half_width,
            y: half_height,
        },
    ]
    .into_iter()
    .map(|point| {
        let rotated = rotate_point(point, ccw_rotation, math);
        Point {
            x: x + rotated.x,
            y: y + rotated.y,
        }
    })
    .collect()
}

pub fn get_pill_center_line_for_pad(pad: &Pad, math: Math) -> PillCenterLine {
    let ccw_rotation = if pad.shape == "rotated_pill" {
        pad.rotation
    } else {
        0.0
    };
    let half_line_length = max(max(pad.width, pad.height) / 2.0 - pad.radius, 0.0);
    let axis = if pad.width >= pad.height {
        Point {
            x: half_line_length,
            y: 0.0,
        }
    } else {
        Point {
            x: 0.0,
            y: half_line_length,
        }
    };
    let rotated_axis = rotate_point(axis, ccw_rotation, math);
    PillCenterLine {
        start: Point {
            x: pad.x - rotated_axis.x,
            y: pad.y - rotated_axis.y,
        },
        end: Point {
            x: pad.x + rotated_axis.x,
            y: pad.y + rotated_axis.y,
        },
        radius: pad.radius,
    }
}

pub fn get_polygon_points_for_pad(pad: &Pad, math: Math) -> Result<Vec<Point>, String> {
    if pad.kind == "pcb_smtpad" {
        if pad.shape == "polygon" {
            return pad
                .points
                .clone()
                .ok_or_else(|| "Polygon pad points required".into());
        }
        if pad.shape == "rotated_rect" {
            return Ok(get_rotated_rect_points(
                pad.x,
                pad.y,
                pad.width,
                pad.height,
                pad.rotation,
                math,
            ));
        }
    }
    if pad.kind == "pcb_plated_hole"
        && let (Some(width), Some(height)) = (pad.rect_pad_width, pad.rect_pad_height)
    {
        return Ok(get_rotated_rect_points(
            pad.x,
            pad.y,
            width,
            height,
            pad.rect_rotation.unwrap_or(0.0),
            math,
        ));
    }
    Err(format!(
        "Expected polygonal pad geometry, got {} with shape \"{}\"",
        pad.kind, pad.shape
    ))
}
