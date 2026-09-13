use json_bindings::SpecialNumber;

pub fn encode_loaded_numbers(
    loaded: &mut tiny_hypergraph::compat::load_serialized_hyper_graph::LoadedHyperGraph,
) -> Vec<SpecialNumber> {
    let mut numbers = Vec::new();
    let topology = &mut loaded.topology;
    let mut fields = vec![
        ("topology", "regionWidth", &mut topology.region_width),
        ("topology", "regionHeight", &mut topology.region_height),
        ("topology", "regionCenterX", &mut topology.region_center_x),
        ("topology", "regionCenterY", &mut topology.region_center_y),
        ("topology", "portX", &mut topology.port_x),
        ("topology", "portY", &mut topology.port_y),
    ];
    if let Some(penalties) = &mut loaded.problem.port_penalty {
        fields.push(("problem", "portPenalty", penalties));
    }
    for (section, field, values) in fields {
        for (index, number) in values.iter_mut().enumerate() {
            if !number.is_finite() {
                numbers.push(SpecialNumber {
                    path: vec![section.into(), field.into(), index.to_string()],
                    value: if number.is_nan() {
                        "NaN"
                    } else if number.is_sign_positive() {
                        "Infinity"
                    } else {
                        "-Infinity"
                    }
                    .into(),
                });
                *number = 0.0;
            }
        }
    }
    numbers
}
