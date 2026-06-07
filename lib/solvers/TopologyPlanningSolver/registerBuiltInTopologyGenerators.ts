/**
 * These imports are here on purpose.
 *
 * When one of these files loads, it adds its solver to the shared
 * `TopologyGenerator` registry. Later, the planner asks that registry for the
 * right solver based on the detected component kind.
 *
 * Without these imports, the registry stays empty and topology planning cannot
 * create the BGA/QFP/SOIC generator it needs.
 *
 * @note Add new built-in topology generator imports here so registration stays
 * in one obvious place.
 */
import "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import "lib/solvers/QfpTopologyGeneratorSolver/QfpTopologyGeneratorSolver"
import "lib/solvers/QfpThermalPadTopologyGeneratorSolver/QfpThermalPadTopologyGeneratorSolver"
import "lib/solvers/SoicTopologyGeneratorSolver/SoicTopologyGeneratorSolver"
