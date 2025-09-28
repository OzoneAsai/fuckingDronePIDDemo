import { airframe } from './airframeData.js';
import { clamp } from './math.js';

function interpolate(x, xs, ys) {
  const n = xs.length;
  if (n === 0) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  for (let i = 0; i < n - 1; i += 1) {
    if (x >= xs[i] && x <= xs[i + 1]) {
      const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
      return ys[i] + t * (ys[i + 1] - ys[i]);
    }
  }
  return ys[n - 1];
}

export function computeCtCq(n, axialVelocity) {
  const { diameter, advanceRatios, ctTable, cqTable } = airframe.propulsion;
  if (n < 1e-3) {
    return { ct: 0, cq: 0, J: 0 };
  }
  const J = clamp(Math.abs(axialVelocity) / (n * diameter), advanceRatios[0], advanceRatios[advanceRatios.length - 1]);
  const ct = interpolate(J, advanceRatios, ctTable);
  const cq = interpolate(J, advanceRatios, cqTable);
  return { ct, cq, J };
}

export function thrustAndTorqueFromRpm(rpm, axialVelocity) {
  const n = Math.max(rpm, 0) / 60;
  const { ct, cq } = computeCtCq(n, axialVelocity);
  const rho = airframe.env.airDensity;
  const d = airframe.propulsion.diameter;
  const thrust = ct * rho * n * n * d ** 4;
  const torque = cq * rho * n * n * d ** 5;
  return { thrust, torque, ct, cq };
}

export function rpmFromThrust(thrust) {
  const rho = airframe.env.airDensity;
  const d = airframe.propulsion.diameter;
  const ct = airframe.propulsion.ct0;
  const n = Math.sqrt(Math.max(thrust, 0) / (Math.max(ct, 1e-6) * rho * d ** 4));
  return n * 60;
}

export function thrustFromRpm(rpm) {
  return thrustAndTorqueFromRpm(rpm, 0).thrust;
}

export const propulsionLimits = {
  maxRpm: airframe.propulsion.maxRpm,
  hoverRpm: airframe.propulsion.hoverRpm,
  yawTorqueFactor: airframe.geometry.yawTorqueFactor
};
