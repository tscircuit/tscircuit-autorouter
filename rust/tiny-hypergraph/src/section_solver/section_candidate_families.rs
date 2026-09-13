use crate::core::TinyHyperGraphTopology;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TinyHyperGraphSectionCandidateFamily {
    SelfAll,
    SelfTouch,
    OnehopAll,
    OnehopTouch,
    TwohopAll,
    TwohopTouch,
    ThreehopAll,
    ThreehopTouch,
    FourhopAll,
    FourhopTouch,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TinyHyperGraphSectionPortSelectionRule {
    TouchesSelectedRegion,
    AllIncidentRegionsSelected,
}

#[derive(Clone, Debug)]
pub struct TinyHyperGraphSectionMaskCandidate {
    pub label: String,
    pub family: TinyHyperGraphSectionCandidateFamily,
    pub region_ids: Vec<i32>,
    pub port_selection_rule: TinyHyperGraphSectionPortSelectionRule,
}
use TinyHyperGraphSectionCandidateFamily::*;
pub const DEFAULT_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES:
    &[TinyHyperGraphSectionCandidateFamily] =
    &[SelfTouch, OnehopAll, OnehopTouch, TwohopAll, TwohopTouch];
pub const OPT_IN_DEEP_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES:
    &[TinyHyperGraphSectionCandidateFamily] =
    &[ThreehopAll, ThreehopTouch, FourhopAll, FourhopTouch];
pub const ALL_TINY_HYPERGRAPH_SECTION_CANDIDATE_FAMILIES:
    &[TinyHyperGraphSectionCandidateFamily] = &[
    SelfAll,
    SelfTouch,
    OnehopAll,
    OnehopTouch,
    TwohopAll,
    TwohopTouch,
    ThreehopAll,
    ThreehopTouch,
    FourhopAll,
    FourhopTouch,
];

pub fn create_section_mask_candidate(
    topology: &TinyHyperGraphTopology,
    hot_region_id: i32,
    family: TinyHyperGraphSectionCandidateFamily,
) -> TinyHyperGraphSectionMaskCandidate {
    let hops = match family {
        SelfAll | SelfTouch => 0,
        OnehopAll | OnehopTouch => 1,
        TwohopAll | TwohopTouch => 2,
        ThreehopAll | ThreehopTouch => 3,
        FourhopAll | FourhopTouch => 4,
    };
    let mut regions = vec![hot_region_id];

    for _ in 0..hops {
        let seeds = regions.clone();

        for seed in seeds {
            for port in &topology.region_incident_ports[seed as usize] {
                for region in &topology.incident_port_region[*port as usize] {
                    if !regions.contains(region) {
                        regions.push(*region);
                    }
                }
            }
        }
    }

    let name = serde_json::to_value(family)
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned();
    TinyHyperGraphSectionMaskCandidate {
        label: format!("hot-{hot_region_id}-{name}"),
        family,
        region_ids: regions,
        port_selection_rule: if name.ends_with("-all") {
            TinyHyperGraphSectionPortSelectionRule::AllIncidentRegionsSelected
        } else {
            TinyHyperGraphSectionPortSelectionRule::TouchesSelectedRegion
        },
    }
}

pub fn create_section_mask_candidates_for_hot_regions(
    topology: &TinyHyperGraphTopology,
    hot_region_ids: &[i32],
    families: &[TinyHyperGraphSectionCandidateFamily],
) -> Vec<TinyHyperGraphSectionMaskCandidate> {
    let mut result = vec![];

    for region in hot_region_ids {
        for family in families {
            result.push(create_section_mask_candidate(topology, *region, *family));
        }
    }

    result
}
