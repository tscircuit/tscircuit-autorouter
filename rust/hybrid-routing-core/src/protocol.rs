use crate::CoreError;
use serde::{Deserialize, Serialize};

pub const CORE_PROTOCOL_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchRequest {
    pub protocol_version: u32,
    pub region_id: String,
    pub bounds: Bounds,
    pub active_bounds: Bounds,
    #[serde(default)]
    pub activation_bounds: Vec<Bounds>,
    pub layer_names: Vec<String>,
    pub start: RoutePoint,
    pub goal: RoutePoint,
    pub legal_via_spans: Vec<LayerSpan>,
    pub obstacles: Vec<Geometry>,
    pub resolution_mm: f64,
    pub trace_width_mm: f64,
    pub clearance_mm: f64,
    pub via_pad_diameter_mm: f64,
    pub maximum_vias: u32,
    pub maximum_expansions: u32,
    pub deterministic_seed: u32,
}

impl SearchRequest {
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.protocol_version != CORE_PROTOCOL_VERSION {
            return Err(CoreError::UnsupportedProtocolVersion {
                actual: self.protocol_version,
                expected: CORE_PROTOCOL_VERSION,
            });
        }
        if self.region_id.is_empty() {
            return Err(CoreError::InvalidRules("regionId must not be empty".into()));
        }
        self.bounds.validate("bounds")?;
        self.active_bounds.validate("activeBounds")?;
        if !self.bounds.contains_bounds(&self.active_bounds) {
            return Err(CoreError::InvalidRules(
                "activeBounds must be contained by bounds".into(),
            ));
        }
        let mut previous_bounds = self.active_bounds;
        for (activation_index, activation_bounds) in
            self.activation_bounds.iter().enumerate()
        {
            activation_bounds.validate(&format!(
                "activationBounds[{activation_index}]"
            ))?;
            if !self.bounds.contains_bounds(activation_bounds) {
                return Err(CoreError::InvalidRules(format!(
                    "activationBounds[{activation_index}] must be contained by bounds"
                )));
            }
            if !activation_bounds.contains_bounds(&previous_bounds) {
                return Err(CoreError::InvalidRules(format!(
                    "activationBounds[{activation_index}] must contain the previous active bounds"
                )));
            }
            previous_bounds = *activation_bounds;
        }
        if self.layer_names.is_empty() {
            return Err(CoreError::InvalidRules("layerNames must not be empty".into()));
        }
        if self.layer_names.iter().any(|layer| layer.is_empty()) {
            return Err(CoreError::InvalidRules("layer names must not be empty".into()));
        }
        let unique_layer_count = self
            .layer_names
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len();
        if unique_layer_count != self.layer_names.len() {
            return Err(CoreError::InvalidRules("layerNames must be unique".into()));
        }
        self.validate_point(&self.start, "start")?;
        self.validate_point(&self.goal, "goal")?;
        if !self.active_bounds.contains_point(self.start.x, self.start.y)
            || !self.active_bounds.contains_point(self.goal.x, self.goal.y)
        {
            return Err(CoreError::InvalidRules(
                "start and goal must be within activeBounds".into(),
            ));
        }
        for span in &self.legal_via_spans {
            if !self.layer_names.contains(&span.from_layer)
                || !self.layer_names.contains(&span.to_layer)
            {
                return Err(CoreError::InvalidRules(format!(
                    "via span {} to {} references an unknown layer",
                    span.from_layer, span.to_layer
                )));
            }
            if span.from_layer == span.to_layer {
                return Err(CoreError::InvalidRules(
                    "a legal via span must change layers".into(),
                ));
            }
        }
        validate_positive(self.resolution_mm, "resolutionMm")?;
        validate_positive(self.trace_width_mm, "traceWidthMm")?;
        validate_positive(self.via_pad_diameter_mm, "viaPadDiameterMm")?;
        validate_non_negative(self.clearance_mm, "clearanceMm")?;
        if self.maximum_expansions == 0 {
            return Err(CoreError::InvalidRules(
                "maximumExpansions must be greater than zero".into(),
            ));
        }
        for obstacle in &self.obstacles {
            obstacle.validate()?;
            if !self.layer_names.contains(&obstacle.layer().to_string()) {
                return Err(CoreError::InvalidRules(format!(
                    "obstacle references unknown layer {}",
                    obstacle.layer()
                )));
            }
        }
        Ok(())
    }

    fn validate_point(&self, point: &RoutePoint, name: &str) -> Result<(), CoreError> {
        validate_finite(point.x, &format!("{name}.x"))?;
        validate_finite(point.y, &format!("{name}.y"))?;
        if !self.bounds.contains_point(point.x, point.y) {
            return Err(CoreError::InvalidRules(format!(
                "{name} must be within bounds"
            )));
        }
        if !self.layer_names.contains(&point.layer) {
            return Err(CoreError::InvalidRules(format!(
                "{name} references unknown layer {}",
                point.layer
            )));
        }
        Ok(())
    }
}

fn validate_finite(value: f64, name: &str) -> Result<(), CoreError> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(CoreError::InvalidRules(format!("{name} must be finite")))
    }
}

fn validate_positive(value: f64, name: &str) -> Result<(), CoreError> {
    validate_finite(value, name)?;
    if value > 0.0 {
        Ok(())
    } else {
        Err(CoreError::InvalidRules(format!(
            "{name} must be greater than zero"
        )))
    }
}

fn validate_non_negative(value: f64, name: &str) -> Result<(), CoreError> {
    validate_finite(value, name)?;
    if value >= 0.0 {
        Ok(())
    } else {
        Err(CoreError::InvalidRules(format!(
            "{name} must not be negative"
        )))
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bounds {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
}

impl Bounds {
    fn validate(&self, name: &str) -> Result<(), CoreError> {
        validate_finite(self.min_x, &format!("{name}.minX"))?;
        validate_finite(self.max_x, &format!("{name}.maxX"))?;
        validate_finite(self.min_y, &format!("{name}.minY"))?;
        validate_finite(self.max_y, &format!("{name}.maxY"))?;
        if self.min_x >= self.max_x || self.min_y >= self.max_y {
            return Err(CoreError::InvalidRules(format!(
                "{name} must have positive width and height"
            )));
        }
        Ok(())
    }

    pub fn contains_point(&self, x: f64, y: f64) -> bool {
        x >= self.min_x && x <= self.max_x && y >= self.min_y && y <= self.max_y
    }

    fn contains_bounds(&self, other: &Bounds) -> bool {
        self.contains_point(other.min_x, other.min_y)
            && self.contains_point(other.max_x, other.max_y)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RoutePoint {
    pub x: f64,
    pub y: f64,
    pub layer: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayerSpan {
    pub from_layer: String,
    pub to_layer: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Geometry {
    Circle {
        geometry_id: String,
        layer: String,
        center_x: f64,
        center_y: f64,
        radius_mm: f64,
    },
    Segment {
        geometry_id: String,
        layer: String,
        start_x: f64,
        start_y: f64,
        end_x: f64,
        end_y: f64,
        width_mm: f64,
    },
    RotatedRect {
        geometry_id: String,
        layer: String,
        center_x: f64,
        center_y: f64,
        width_mm: f64,
        height_mm: f64,
        rotation_degrees: f64,
    },
}

impl Geometry {
    pub fn layer(&self) -> &str {
        match self {
            Self::Circle { layer, .. }
            | Self::Segment { layer, .. }
            | Self::RotatedRect { layer, .. } => layer,
        }
    }

    fn validate(&self) -> Result<(), CoreError> {
        let (geometry_id, dimensions) = match self {
            Self::Circle {
                geometry_id,
                center_x,
                center_y,
                radius_mm,
                ..
            } => {
                validate_finite(*center_x, "circle.centerX")?;
                validate_finite(*center_y, "circle.centerY")?;
                (geometry_id, vec![("circle.radiusMm", *radius_mm)])
            }
            Self::Segment {
                geometry_id,
                start_x,
                start_y,
                end_x,
                end_y,
                width_mm,
                ..
            } => {
                validate_finite(*start_x, "segment.startX")?;
                validate_finite(*start_y, "segment.startY")?;
                validate_finite(*end_x, "segment.endX")?;
                validate_finite(*end_y, "segment.endY")?;
                (geometry_id, vec![("segment.widthMm", *width_mm)])
            }
            Self::RotatedRect {
                geometry_id,
                center_x,
                center_y,
                width_mm,
                height_mm,
                rotation_degrees,
                ..
            } => {
                validate_finite(*center_x, "rotatedRect.centerX")?;
                validate_finite(*center_y, "rotatedRect.centerY")?;
                validate_finite(*rotation_degrees, "rotatedRect.rotationDegrees")?;
                (
                    geometry_id,
                    vec![
                        ("rotatedRect.widthMm", *width_mm),
                        ("rotatedRect.heightMm", *height_mm),
                    ],
                )
            }
        };
        if geometry_id.is_empty() {
            return Err(CoreError::InvalidRules(
                "geometryId must not be empty".into(),
            ));
        }
        for (name, dimension) in dimensions {
            validate_positive(dimension, name)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum CoreResponse {
    Solved {
        protocol_version: u32,
        region_id: String,
        route: Vec<RoutePoint>,
        vias: Vec<Via>,
        cost: CandidateCost,
        work: WorkCounters,
    },
    Failed {
        protocol_version: u32,
        region_id: String,
        code: CoreFailureCode,
        message: String,
        work: WorkCounters,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Via {
    pub x: f64,
    pub y: f64,
    pub from_layer: String,
    pub to_layer: String,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateCost {
    pub via_count: u32,
    pub total_length_mm: f64,
    pub bend_count: u32,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkCounters {
    pub search_expansions: u32,
    pub spatial_index_queries: u32,
    pub geometry_predicate_calls: u32,
    pub generated_neighbors: u32,
    pub peak_open_set_size: u32,
    pub activated_rings: u32,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CoreFailureCode {
    SearchBudgetExhausted,
    NoLegalPath,
}
