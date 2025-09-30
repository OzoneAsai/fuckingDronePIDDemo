import airframeSpec from '../../tmp.json';

const rho = airframeSpec.environment_model.rho0_kg_per_m3;
const fieldHeight = 50;
const ct0 = airframeSpec.propulsion_model.aero_coeffs_assumed.C_T0;
const cq0 = airframeSpec.propulsion_model.aero_coeffs_assumed.C_Q0;
const diameter = airframeSpec.components.propellers.diameter_m;
const wheelbase = airframeSpec.airframe.wheelbase_m_est;
const armOffset = wheelbase / (2 * Math.SQRT2);
const mass = airframeSpec.mass_breakdown.auw_kg;
const inertia = {
  xx: airframeSpec.inertia_estimates.Ixx_kgm2_est,
  yy: airframeSpec.inertia_estimates.Iyy_kgm2_est,
  zz: airframeSpec.inertia_estimates.Izz_kgm2_est
};
const hoverRpm = airframeSpec.performance_targets.hover.hover_rpm;
const motorKv = airframeSpec.components.motors.kv_rpm_per_V;
const batteryVoltage = airframeSpec.components.battery.nominal_voltage_V;
const maxRpmIdeal = motorKv * batteryVoltage;
const maxRpm = Math.min(maxRpmIdeal, hoverRpm * 2.8);
const rotorCount = airframeSpec.airframe.rotor_count;

const yawTorqueFactor = (cq0 / ct0) * diameter;

const ctTable = airframeSpec.propulsion_model.ct_cq_table.C_T;
const cqTable = airframeSpec.propulsion_model.ct_cq_table.C_Q;
const advanceRatios = airframeSpec.propulsion_model.ct_cq_table.J;

export const airframe = {
  spec: airframeSpec,
  env: {
    gravity: airframeSpec.environment_model.gravity_mps2,
    airDensity: rho,
    fieldHeight
  },
  geometry: {
    wheelbase,
    armOffset,
    rotorPositions: [
      { x: armOffset, y: armOffset },
      { x: armOffset, y: -armOffset },
      { x: -armOffset, y: -armOffset },
      { x: -armOffset, y: armOffset }
    ],
    yawTorqueFactor
  },
  propulsion: {
    diameter,
    ct0,
    cq0,
    advanceRatios,
    ctTable,
    cqTable,
    maxRpm,
    hoverRpm,
    rotorCount
  },
  dynamics: {
    mass,
    inertia,
    motorTimeConstant: 1 / (2 * Math.PI * airframeSpec.control_limits.rate_controller_bandwidth_hz_est)
  }
};
