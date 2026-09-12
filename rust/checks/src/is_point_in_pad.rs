use crate::line_intersections::{max, point_to_segment_distance};
use crate::segment_to_polygon_clearance::{
    get_pill_center_line_for_pad, get_polygon_points_for_pad,
};
use crate::types::{Math, Point, number, point};
use serde_json::Value;

pub struct Pad {
    pub kind: String,
    pub shape: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub radius: f64,
    pub outer_diameter: f64,
    pub outer_width: f64,
    pub outer_height: f64,
    pub rotation: f64,
    pub rect_pad_width: Option<f64>,
    pub rect_pad_height: Option<f64>,
    pub rect_rotation: Option<f64>,
    pub points: Option<Vec<Point>>,
}

impl Pad {
    pub fn read(value: &Value) -> Self {
        let rect_rotation = value
            .get("rect_ccw_rotation")
            .filter(|v| v.is_number() || v.get("$traceNumber").is_some())
            .map(|v| number(Some(v)));
        Self {
            kind: value
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("undefined")
                .to_owned(),
            shape: value
                .get("shape")
                .and_then(Value::as_str)
                .unwrap_or("undefined")
                .to_owned(),
            x: number(value.get("x")),
            y: number(value.get("y")),
            width: number(value.get("width")),
            height: number(value.get("height")),
            radius: number(value.get("radius")),
            outer_diameter: number(value.get("outer_diameter")),
            outer_width: number(value.get("outer_width")),
            outer_height: number(value.get("outer_height")),
            rotation: number(value.get("ccw_rotation")),
            rect_pad_width: value.get("rect_pad_width").map(|v| number(Some(v))),
            rect_pad_height: value.get("rect_pad_height").map(|v| number(Some(v))),
            rect_rotation,
            points: value
                .get("points")
                .and_then(Value::as_array)
                .map(|points| points.iter().map(point).collect()),
        }
    }
}

const POINT_ON_SEGMENT_TOLERANCE_MM: f64 = 1e-9;
const POINT_IN_PAD_TOLERANCE_MM: f64 = 1e-9;

fn get_distance_between_points(a: Point, b: Point) -> f64 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    (dx * dx + dy * dy).sqrt()
}

fn is_point_on_segment(point: Point, start: Point, end: Point) -> bool {
    let cross_product =
        (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
    if cross_product.abs() > POINT_ON_SEGMENT_TOLERANCE_MM {
        return false;
    }
    let dot_product =
        (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
    if dot_product < -POINT_ON_SEGMENT_TOLERANCE_MM {
        return false;
    }
    let squared_length =
        (end.x - start.x) * (end.x - start.x) + (end.y - start.y) * (end.y - start.y);
    dot_product <= squared_length + POINT_ON_SEGMENT_TOLERANCE_MM
}

fn is_point_in_polygon(point: Point, polygon: &[Point]) -> bool {
    let mut inside = false;
    let mut j = polygon.len().wrapping_sub(1);
    for (i, pi) in polygon.iter().enumerate() {
        let pj = polygon[j];
        if is_point_on_segment(point, *pi, pj) {
            return true;
        }
        let intersects = (pi.y > point.y) != (pj.y > point.y)
            && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
        if intersects {
            inside = !inside;
        }
        j = i;
    }
    inside
}

pub fn is_point_in_pad(point: Point, pad: &Pad, math: Math) -> Result<bool, String> {
    if pad.kind == "pcb_smtpad" {
        if pad.shape == "circle" {
            return Ok(
                get_distance_between_points(point, Point { x: pad.x, y: pad.y })
                    <= pad.radius + POINT_IN_PAD_TOLERANCE_MM,
            );
        }
        if pad.shape == "rect" {
            let half_width = pad.width / 2.0;
            let half_height = pad.height / 2.0;
            return Ok(
                (point.x - pad.x).abs() <= half_width + POINT_IN_PAD_TOLERANCE_MM
                    && (point.y - pad.y).abs() <= half_height + POINT_IN_PAD_TOLERANCE_MM,
            );
        }
        if pad.shape == "rotated_rect" {
            return Ok(is_point_in_polygon(
                point,
                &get_polygon_points_for_pad(pad, math)?,
            ));
        }
        if pad.shape == "pill" || pad.shape == "rotated_pill" {
            if pad.shape == "rotated_pill" {
                let pill = get_pill_center_line_for_pad(pad, math);
                return Ok(point_to_segment_distance(point, pill.start, pill.end)
                    <= pill.radius + POINT_IN_PAD_TOLERANCE_MM);
            }
            let half_width = pad.width / 2.0;
            let half_height = pad.height / 2.0;
            let radius = pad.radius;
            if (point.x - pad.x).abs() <= half_width - radius + POINT_IN_PAD_TOLERANCE_MM
                && (point.y - pad.y).abs() <= half_height + POINT_IN_PAD_TOLERANCE_MM
            {
                return Ok(true);
            }
            let corner_x = max((point.x - pad.x).abs() - (half_width - radius), 0.0);
            let corner_y = max((point.y - pad.y).abs() - (half_height - radius), 0.0);
            let radius_with_tolerance = radius + POINT_IN_PAD_TOLERANCE_MM;
            return Ok(corner_x * corner_x + corner_y * corner_y
                <= radius_with_tolerance * radius_with_tolerance);
        }
        if pad.shape == "polygon" {
            return Ok(is_point_in_polygon(
                point,
                pad.points.as_deref().ok_or("Polygon pad points required")?,
            ));
        }
    }
    if pad.kind == "pcb_plated_hole" {
        if pad.shape == "circle" {
            return Ok(
                get_distance_between_points(point, Point { x: pad.x, y: pad.y })
                    <= pad.outer_diameter / 2.0 + POINT_IN_PAD_TOLERANCE_MM,
            );
        }
        if pad.rect_pad_width.is_some() && pad.rect_pad_height.is_some() {
            return Ok(is_point_in_polygon(
                point,
                &get_polygon_points_for_pad(pad, math)?,
            ));
        }
        if pad.shape == "oval" || pad.shape == "pill" {
            return Ok((point.x - pad.x).abs()
                <= pad.outer_width / 2.0 + POINT_IN_PAD_TOLERANCE_MM
                && (point.y - pad.y).abs() <= pad.outer_height / 2.0 + POINT_IN_PAD_TOLERANCE_MM);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::line_intersections::{does_line_intersect_line, min};
    use serde_json::json;

    #[test]
    fn pad_boundaries_rotations_and_degenerate_segments_match_source_rules() {
        let math = Math::default();
        let rect = Pad::read(
            &json!({"type":"pcb_smtpad","shape":"rect","x":0,"y":0,"width":2,"height":2}),
        );
        assert!(
            is_point_in_pad(
                Point {
                    x: 1.0 + 0.5e-9,
                    y: 0.0
                },
                &rect,
                math
            )
            .unwrap()
        );
        assert!(
            !is_point_in_pad(
                Point {
                    x: 1.0 + 2e-9,
                    y: 0.0
                },
                &rect,
                math
            )
            .unwrap()
        );
        let polygon = Pad::read(&json!({"type":"pcb_smtpad","shape":"polygon","points":[]}));
        assert!(!is_point_in_pad(Point { x: 0.0, y: 0.0 }, &polygon, math).unwrap());
        let rotated = Pad::read(
            &json!({"type":"pcb_smtpad","shape":"rotated_pill","x":0,"y":0,"width":4,"height":2,"radius":1,"ccw_rotation":90}),
        );
        assert!(is_point_in_pad(Point { x: 0.0, y: 2.0 }, &rotated, math).unwrap());
        assert!(!is_point_in_pad(Point { x: 1.1, y: 0.0 }, &rotated, math).unwrap());
        let zero = Point { x: 0.0, y: 0.0 };
        let one = Point { x: 1.0, y: 0.0 };
        assert!(does_line_intersect_line([zero, zero], [one, one], 1.0));
        assert!(!does_line_intersect_line([zero, zero], [one, one], 0.999));
        assert!(min(0.0, -0.0).is_sign_negative());
        assert!(min(f64::NAN, 1.0).is_nan());
    }
}
