use crate::bindings::high_density::specialized_utils::math::{
    Point, distance, max, min, point_to_segment_distance,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathPoint {
    #[serde(flatten)]
    pub point: Point,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub t: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_special: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub special_type: Option<char>,
}
impl From<Point> for PathPoint {
    fn from(point: Point) -> Self {
        Self {
            point,
            t: None,
            is_special: None,
            special_type: None,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JLine {
    pub starts_at: char,
    pub goes_to: char,
    pub points: Vec<PathPoint>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JPair {
    #[serde(rename = "line1")]
    pub line1: JLine,
    #[serde(rename = "line2")]
    pub line2: JLine,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimalPath {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starts_at: Option<char>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goes_to: Option<char>,
    pub points: Vec<PathPoint>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DumbbellPaths {
    pub j_pair: Option<JPair>,
    pub optimal_path: OptimalPath,
}
#[derive(Clone, Copy)]
struct Segment {
    start: Point,
    end: Point,
}
struct DumbbellPoints {
    midpoint: Point,
    a_opp: Point,
    a_right: Point,
    a_left: Point,
    b_opp: Point,
    b_right: Point,
    b_left: Point,
}

fn midpoint(a: Point, b: Point) -> Point {
    Point {
        x: (a.x + b.x) / 2.0,
        y: (a.y + b.y) / 2.0,
    }
}
fn calculate_points(a: Point, b: Point, r: f64) -> DumbbellPoints {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len = (dx * dx + dy * dy).sqrt();
    let ux = dx / len;
    let uy = dy / len;
    let px = -uy;
    let py = ux;
    DumbbellPoints {
        midpoint: midpoint(a, b),
        a_opp: Point {
            x: a.x - ux * r,
            y: a.y - uy * r,
        },
        a_right: Point {
            x: a.x + px * r,
            y: a.y + py * r,
        },
        a_left: Point {
            x: a.x - px * r,
            y: a.y - py * r,
        },
        b_opp: Point {
            x: b.x + ux * r,
            y: b.y + uy * r,
        },
        b_right: Point {
            x: b.x + px * r,
            y: b.y + py * r,
        },
        b_left: Point {
            x: b.x - px * r,
            y: b.y - py * r,
        },
    }
}
fn is_point_on_segment(p: Point, s: Segment) -> bool {
    let d1 = distance(p, s.start);
    let d2 = distance(p, s.end);
    let length = distance(s.start, s.end);
    (d1 + d2 - length).abs() < 0.0001
}
fn intersect(l1: Segment, l2: Segment) -> bool {
    let p1 = l1.start;
    let p2 = l1.end;
    let p3 = l2.start;
    let p4 = l2.end;
    if is_point_on_segment(p1, l2)
        || is_point_on_segment(p2, l2)
        || is_point_on_segment(p3, l1)
        || is_point_on_segment(p4, l1)
    {
        return true;
    }
    let d1x = p2.x - p1.x;
    let d1y = p2.y - p1.y;
    let d2x = p4.x - p3.x;
    let d2y = p4.y - p3.y;
    let det = d1x * d2y - d1y * d2x;
    if det.abs() < 0.0001 {
        return false;
    }
    let dx = p3.x - p1.x;
    let dy = p3.y - p1.y;
    let t = (dx * d2y - dy * d2x) / det;
    let u = (dx * d1y - dy * d1x) / det;
    t > 0.0 && t < 1.0 && u > 0.0 && u < 1.0
}
fn do_paths_intersect(a: &[PathPoint], b: &[PathPoint]) -> bool {
    let aa: Vec<Segment> = a
        .windows(2)
        .map(|p| Segment {
            start: p[0].point,
            end: p[1].point,
        })
        .collect();
    let bb: Vec<Segment> = b
        .windows(2)
        .map(|p| Segment {
            start: p[0].point,
            end: p[1].point,
        })
        .collect();
    for a in aa {
        for b in &bb {
            if intersect(a, *b) {
                return true;
            }
        }
    }
    false
}
fn path_length(points: &[PathPoint]) -> f64 {
    let mut len = 0.0;
    for p in points.windows(2) {
        let dx = p[1].point.x - p[0].point.x;
        let dy = p[1].point.y - p[0].point.y;
        len += (dx * dx + dy * dy).sqrt();
    }
    len
}
fn closest_point_on_segment(s: Segment, center: Point) -> PathPoint {
    let dx = s.end.x - s.start.x;
    let dy = s.end.y - s.start.y;
    let l2 = dx * dx + dy * dy;
    if l2 == 0.0 {
        return PathPoint {
            t: Some(0.0),
            ..s.start.into()
        };
    }
    let t = max(
        0.0,
        min(
            1.0,
            ((center.x - s.start.x) * dx + (center.y - s.start.y) * dy) / l2,
        ),
    );
    PathPoint {
        point: Point {
            x: s.start.x + t * dx,
            y: s.start.y + t * dy,
        },
        t: Some(t),
        is_special: None,
        special_type: None,
    }
}
fn subdivision_point(s: Segment, center: Point, r: f64, which: char) -> PathPoint {
    let closest = closest_point_on_segment(s, center);
    let dist = distance(closest.point, center);
    if dist >= r {
        return closest;
    }
    let dx = closest.point.x - center.x;
    let dy = closest.point.y - center.y;
    let norm = (dx * dx + dy * dy).sqrt();
    let point = if norm == 0.0 {
        let dx = s.end.x - s.start.x;
        let dy = s.end.y - s.start.y;
        let norm = (dx * dx + dy * dy).sqrt();
        Point {
            x: center.x + (r * dx) / norm,
            y: center.y + (r * dy) / norm,
        }
    } else {
        Point {
            x: center.x + (r * dx) / norm,
            y: center.y + (r * dy) / norm,
        }
    };
    PathPoint {
        point,
        t: closest.t,
        is_special: Some(true),
        special_type: Some(which),
    }
}
fn filter_close(points: Vec<PathPoint>, radius: f64) -> Vec<PathPoint> {
    if points.len() <= 1 {
        return points;
    }
    let mut filtered = vec![points[0]];
    for p in &points[1..] {
        if distance(filtered.last().unwrap().point, p.point) > radius / 10.0 {
            filtered.push(*p);
        }
    }
    filtered
}
fn subdivide_optimal_path(
    path: &[PathPoint],
    count: f64,
    a: Point,
    b: Point,
    radius: f64,
) -> Vec<PathPoint> {
    if path.len() < 2 {
        return path.to_vec();
    }
    let mut result = vec![path[0]];
    for pair in path.windows(2) {
        let s = Segment {
            start: pair[0].point,
            end: pair[1].point,
        };
        let mid = midpoint(s.start, s.end);
        let da = distance(mid, a);
        let db = distance(mid, b);
        if (da <= radius || db <= radius) && (da - db).abs() > 0.0001 {
            let closest_a = closest_point_on_segment(s, a);
            let closest_b = closest_point_on_segment(s, b);
            let adjusted_a = if distance(closest_a.point, a) < radius {
                Some(subdivision_point(s, a, radius, 'A'))
            } else {
                None
            };
            let adjusted_b = if distance(closest_b.point, b) < radius {
                Some(subdivision_point(s, b, radius, 'B'))
            } else {
                None
            };
            let mut subdivisions = vec![];
            let length = distance(s.start, s.end);
            if length > radius / 2.0 && count > 0.0 {
                let mut j = 1.0;
                while j <= count {
                    let t = j / (count + 1.0);
                    let p = Point {
                        x: s.start.x + t * (s.end.x - s.start.x),
                        y: s.start.y + t * (s.end.y - s.start.y),
                    };
                    j += 1.0;
                    if distance(p, a) < radius || distance(p, b) < radius {
                        continue;
                    }
                    if adjusted_a.is_some_and(|a| (t - a.t.unwrap()).abs() < 0.1)
                        || adjusted_b.is_some_and(|b| (t - b.t.unwrap()).abs() < 0.1)
                    {
                        continue;
                    }
                    subdivisions.push(PathPoint {
                        point: p,
                        t: Some(t),
                        is_special: Some(false),
                        special_type: None,
                    });
                }
            }
            if let Some(a) = adjusted_a {
                subdivisions.push(a);
            }
            if let Some(b) = adjusted_b {
                subdivisions.push(b);
            }
            subdivisions.sort_by(|a, b| {
                (a.t.unwrap() - b.t.unwrap())
                    .partial_cmp(&0.0)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            result.extend(filter_close(subdivisions, radius));
        }
        result.push(pair[1]);
    }
    filter_close(result, radius)
}
fn subdivide_j_line_path(
    line: &JLine,
    opposite: Point,
    r: f64,
    m: f64,
    _count: f64,
    radius: f64,
) -> Vec<PathPoint> {
    let path = &line.points;
    if path.len() < 2 {
        return path.clone();
    }
    let threshold = r + m;
    let mut result = vec![path[0]];
    for pair in path.windows(2) {
        let s = Segment {
            start: pair[0].point,
            end: pair[1].point,
        };
        let dist = point_to_segment_distance(opposite, s.start, s.end);
        if dist < threshold {
            let closest = closest_point_on_segment(s, opposite);
            let dx = closest.point.x - opposite.x;
            let dy = closest.point.y - opposite.y;
            let norm = (dx * dx + dy * dy).sqrt();
            let adjusted = if norm > 1e-6 {
                Some(Point {
                    x: opposite.x + (threshold * dx) / norm,
                    y: opposite.y + (threshold * dy) / norm,
                })
            } else {
                let dx = s.end.x - s.start.x;
                let dy = s.end.y - s.start.y;
                let norm = (dx * dx + dy * dy).sqrt();
                if norm > 1e-6 {
                    Some(Point {
                        x: opposite.x + (threshold * dx) / norm,
                        y: opposite.y + (threshold * dy) / norm,
                    })
                } else {
                    None
                }
            };
            if let Some(p) = adjusted
                && distance(s.start, p) > radius / 10.0
            {
                result.push(p.into());
            }
        }
        if distance(result.last().unwrap().point, s.end) > radius / 10.0 {
            result.push(pair[1]);
        }
    }
    filter_close(result, radius)
}

#[expect(
    clippy::too_many_arguments,
    reason = "Keep the argument list aligned with the TypeScript source."
)]
pub fn compute_dumbbell_paths(
    a: Point,
    b: Point,
    c: Point,
    d: Point,
    e: Point,
    f: Point,
    radius: f64,
    margin: f64,
    subdivisions: f64,
) -> DumbbellPaths {
    let inner = calculate_points(a, b, radius);
    let outer = calculate_points(a, b, radius + margin);
    let paths: Vec<Vec<PathPoint>> = vec![
        vec![
            c,
            inner.b_left,
            inner.b_opp,
            inner.b_right,
            midpoint(inner.midpoint, midpoint(inner.b_right, inner.a_right)),
            midpoint(inner.midpoint, midpoint(inner.a_left, inner.b_left)),
            inner.a_left,
            inner.a_opp,
            inner.a_right,
            d,
        ],
        vec![
            c,
            inner.b_right,
            inner.b_opp,
            inner.b_left,
            midpoint(inner.midpoint, midpoint(inner.a_left, inner.b_left)),
            midpoint(inner.midpoint, midpoint(inner.a_right, inner.b_right)),
            inner.a_right,
            inner.a_opp,
            inner.a_left,
            d,
        ],
        vec![
            d,
            inner.b_left,
            inner.b_opp,
            inner.b_right,
            midpoint(inner.midpoint, midpoint(inner.a_right, inner.b_right)),
            midpoint(inner.midpoint, midpoint(inner.a_left, inner.b_left)),
            inner.a_left,
            inner.a_opp,
            inner.a_right,
            c,
        ],
        vec![
            d,
            inner.b_right,
            inner.b_opp,
            inner.b_left,
            midpoint(inner.midpoint, midpoint(inner.a_left, inner.b_left)),
            midpoint(inner.midpoint, midpoint(inner.a_right, inner.b_right)),
            inner.a_right,
            inner.a_opp,
            inner.a_left,
            c,
        ],
    ]
    .into_iter()
    .map(|path| path.into_iter().map(PathPoint::from).collect())
    .collect();
    let mut valid = vec![];
    for (i, path) in paths.into_iter().enumerate() {
        let first = Segment {
            start: path[0].point,
            end: path[1].point,
        };
        let last = Segment {
            start: path[path.len() - 2].point,
            end: path[path.len() - 1].point,
        };
        let mid = Segment {
            start: path[3].point,
            end: path[4].point,
        };
        if !intersect(first, last) && !intersect(first, mid) && !intersect(last, mid) {
            let length = path_length(&path);
            valid.push((i + 1, path, length));
        }
    }
    let mut optimal = OptimalPath {
        starts_at: None,
        goes_to: None,
        points: vec![],
    };
    if !valid.is_empty() {
        valid.sort_by(|a, b| {
            (a.2 - b.2)
                .partial_cmp(&0.0)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let (index, mut path, _) = valid.remove(0);
        let first = path[0].point;
        let d3 = distance(first, path[2].point);
        let d4 = distance(first, path[3].point);
        let closer = if d3 < d4 { 2 } else { 3 };
        if d3 < distance(first, path[1].point) || d4 < distance(first, path[1].point) {
            path.drain(1..closer);
        }
        let n = path.len();
        let last = path[n - 1].point;
        let d3 = distance(last, path[n - 3].point);
        let d4 = distance(last, path[n - 4].point);
        let closer = if d3 < d4 { n - 3 } else { n - 4 };
        if d3 < distance(last, path[n - 2].point) || d4 < distance(last, path[n - 2].point) {
            path.drain(closer + 1..n - 1);
        }
        optimal = OptimalPath {
            starts_at: Some(if index <= 2 { 'C' } else { 'D' }),
            goes_to: Some(if index <= 2 { 'D' } else { 'C' }),
            points: path,
        };
    }
    let subdivided = if subdivisions > 0.0 {
        subdivide_optimal_path(&optimal.points, subdivisions, a, b, radius)
    } else {
        optimal.points.clone()
    };
    let mut j_pair = None;
    if !optimal.points.is_empty() {
        let right = midpoint(inner.a_right, inner.b_right);
        let left = midpoint(inner.b_left, inner.a_left);
        let lines = vec![
            ('E', 'B', vec![e, b]),
            ('E', 'A', vec![e, a]),
            ('F', 'B', vec![f, b]),
            ('F', 'A', vec![f, a]),
            ('E', 'B', vec![e, right, b]),
            ('E', 'A', vec![e, right, a]),
            ('F', 'B', vec![f, right, b]),
            ('F', 'A', vec![f, right, a]),
            ('E', 'B', vec![e, left, b]),
            ('E', 'A', vec![e, left, a]),
            ('F', 'B', vec![f, left, b]),
            ('F', 'A', vec![f, left, a]),
            ('E', 'B', vec![e, outer.a_right, right, b]),
            ('F', 'B', vec![f, outer.b_right, right, b]),
            ('E', 'A', vec![e, outer.b_left, left, a]),
            ('F', 'A', vec![f, outer.a_left, left, a]),
            ('E', 'B', vec![e, outer.a_left, left, b]),
            ('E', 'A', vec![e, outer.b_right, right, a]),
            ('E', 'B', vec![e, outer.a_opp, outer.a_right, right, b]),
            ('E', 'A', vec![e, outer.b_opp, outer.b_left, left, a]),
            ('F', 'B', vec![f, outer.a_opp, outer.a_left, left, b]),
            ('F', 'A', vec![f, outer.b_opp, outer.b_right, right, a]),
            ('F', 'A', vec![f, outer.b_opp, outer.b_left, left, a]),
            ('E', 'B', vec![e, outer.a_opp, outer.a_left, left, b]),
            ('E', 'A', vec![e, outer.b_opp, outer.b_right, right, a]),
            (
                'E',
                'B',
                vec![e, outer.a_left, outer.a_opp, outer.a_right, right, b],
            ),
            (
                'E',
                'A',
                vec![e, outer.b_right, outer.b_opp, outer.b_left, left, a],
            ),
            (
                'F',
                'B',
                vec![f, outer.a_right, outer.a_opp, outer.a_left, left, b],
            ),
            (
                'F',
                'A',
                vec![f, outer.b_left, outer.b_opp, outer.b_right, right, a],
            ),
            (
                'F',
                'A',
                vec![f, outer.b_right, outer.b_opp, outer.b_left, left, a],
            ),
            (
                'E',
                'B',
                vec![e, outer.a_right, outer.a_opp, outer.a_left, left, b],
            ),
            (
                'E',
                'A',
                vec![e, outer.b_left, outer.b_opp, outer.b_right, right, a],
            ),
        ];
        let lines: Vec<JLine> = lines
            .into_iter()
            .map(|(starts_at, goes_to, points)| JLine {
                starts_at,
                goes_to,
                points: points.into_iter().map(PathPoint::from).collect(),
            })
            .collect();
        let mut eline = None;
        let mut fline = None;
        for line in lines.iter().filter(|line| line.starts_at == 'E') {
            if do_paths_intersect(&line.points, &optimal.points) {
                continue;
            }
            eline = Some(line.clone());
            break;
        }
        for line in lines.iter().filter(|line| line.starts_at == 'F') {
            if do_paths_intersect(&line.points, &optimal.points) {
                continue;
            }
            fline = Some(line.clone());
            break;
        }
        if let (Some(mut line1), Some(mut line2)) = (eline, fline) {
            let o1 = if line1.goes_to == 'A' { b } else { a };
            let o2 = if line2.goes_to == 'A' { b } else { a };
            line1.points = subdivide_j_line_path(&line1, o1, radius, margin, subdivisions, radius);
            line2.points = subdivide_j_line_path(&line2, o2, radius, margin, subdivisions, radius);
            j_pair = Some(JPair { line1, line2 });
        }
    }
    optimal.points = subdivided;
    DumbbellPaths {
        j_pair,
        optimal_path: optimal,
    }
}
