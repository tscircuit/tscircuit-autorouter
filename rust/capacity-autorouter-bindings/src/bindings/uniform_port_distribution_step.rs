use js_sys::Function;
use wasm_bindgen::prelude::*;
use capacity_autorouter::solvers::uniform_port_distribution_solver::live_values::get;
use capacity_autorouter::solvers::uniform_port_distribution_solver::redistribute_port_points_on_shared_edge;
use capacity_autorouter::solvers::uniform_port_distribution_solver::should_ignore_port_point;
use capacity_autorouter::solvers::uniform_port_distribution_solver::should_ignore_shared_edge;
use capacity_autorouter::solvers::uniform_port_distribution_solver::uniform_port_distribution_solver::live;

#[wasm_bindgen(js_name = stepUniformPortDistribution)]
pub fn step_uniform_port_distribution(
    #[wasm_bindgen(
        unchecked_param_type = "import('../../../lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver').UniformPortDistributionSolver"
    )]
    solver: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "import('../../../lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver').UniformPortDistributionSolverInput"
    )]
    input: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "typeof import('../../../lib/bindings/uniform-port-distribution/UniformPortDistributionLiveValues').spreadUniformPortPoint"
    )]
    spread_point: Function,
    #[wasm_bindgen(
        unchecked_param_type = "typeof import('../../../lib/bindings/uniform-port-distribution/UniformPortDistributionLiveValues').findUniformInputNode"
    )]
    find_node: Function,
    #[wasm_bindgen(
        unchecked_param_type = "typeof import('../../../lib/bindings/uniform-port-distribution/UniformPortDistributionLiveValues').findUniformInputPoint"
    )]
    find_point: Function,
    #[wasm_bindgen(
        unchecked_param_type = "typeof import('../../../lib/bindings/uniform-port-distribution/UniformPortDistributionLiveValues').readUniformObstacleScalars"
    )]
    read_obstacle: Function,
) -> Result<(), JsValue> {
    live::step(
        &solver,
        &input,
        &spread_point,
        &find_node,
        &find_point,
        &read_obstacle,
    )
}
#[wasm_bindgen(js_name = rebuildUniformPortDistributionNodes)]
pub fn rebuild_uniform_port_distribution_nodes(
    #[wasm_bindgen(
        unchecked_param_type = "import('../../../lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver').UniformPortDistributionSolver"
    )]
    solver: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "import('../../../lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver').UniformPortDistributionSolverInput"
    )]
    input: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "typeof import('../../../lib/bindings/uniform-port-distribution/UniformPortDistributionLiveValues').spreadUniformPortPoint"
    )]
    spread_point: Function,
    #[wasm_bindgen(
        unchecked_param_type = "typeof import('../../../lib/bindings/uniform-port-distribution/UniformPortDistributionLiveValues').spreadUniformNode"
    )]
    spread_node: Function,
) -> Result<(), JsValue> {
    live::rebuild_nodes(&solver, &input, &spread_point, &spread_node)
}
#[wasm_bindgen(js_name = shouldIgnoreUniformPortPoint)]
pub fn should_ignore_uniform_port_point(
    #[wasm_bindgen(
        unchecked_param_type = "{ portPoint: import('../../../lib/types/high-density-types').PortPoint; ownerNodeIds: import('../../../lib/solvers/UniformPortDistributionSolver/types').OwnerPair; inputNodes: import('../../../lib/solvers/PortPointPathingSolver/PortPointPathingSolver').InputNodeWithPortPoints[] }"
    )]
    params: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "typeof import('../../../lib/bindings/uniform-port-distribution/UniformPortDistributionLiveValues').findUniformInputNode"
    )]
    find_node: Function,
    #[wasm_bindgen(
        unchecked_param_type = "typeof import('../../../lib/bindings/uniform-port-distribution/UniformPortDistributionLiveValues').findUniformInputPoint"
    )]
    find_point: Function,
) -> Result<bool, JsValue> {
    should_ignore_port_point::should_ignore_port_point(
        &get(&params, "portPoint")?,
        &get(&params, "ownerNodeIds")?,
        &get(&params, "inputNodes")?,
        &find_node,
        &find_point,
    )
}
#[wasm_bindgen(js_name = shouldIgnoreUniformSharedEdge)]
pub fn should_ignore_uniform_shared_edge(
    #[wasm_bindgen(
        unchecked_param_type = "{ sharedEdge: import('../../../lib/solvers/UniformPortDistributionSolver/types').SharedEdge; obstacles: import('../../../lib/types').Obstacle[] }"
    )]
    params: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "typeof import('../../../lib/bindings/uniform-port-distribution/UniformPortDistributionLiveValues').readUniformObstacleScalars"
    )]
    read_obstacle: Function,
) -> Result<bool, JsValue> {
    should_ignore_shared_edge::should_ignore_shared_edge(
        &get(&params, "sharedEdge")?,
        &get(&params, "obstacles")?,
        &read_obstacle,
    )
}
#[wasm_bindgen(js_name = redistributeUniformPortPointsOnSharedEdge, unchecked_return_type = "import('../../../lib/solvers/UniformPortDistributionSolver/types').PortPointWithOwnerPair[]")]
pub fn redistribute_uniform_port_points_on_shared_edge(
    #[wasm_bindgen(
        unchecked_param_type = "{ sharedEdge: import('../../../lib/solvers/UniformPortDistributionSolver/types').SharedEdge; portPoints: import('../../../lib/solvers/UniformPortDistributionSolver/types').PortPointWithOwnerPair[] }"
    )]
    params: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "typeof import('../../../lib/bindings/uniform-port-distribution/UniformPortDistributionLiveValues').spreadUniformPortPoint"
    )]
    spread_point: Function,
) -> Result<JsValue, JsValue> {
    redistribute_port_points_on_shared_edge::redistribute_port_points_on_shared_edge(
        &get(&params, "sharedEdge")?,
        &get(&params, "portPoints")?,
        &spread_point,
    )
}
