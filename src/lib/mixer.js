import { airframe } from './airframeData.js';
import { clamp } from './math.js';

export function mixForces({ tau, collective }) {
  const { yawTorqueFactor } = airframe.geometry;
  const d = airframe.geometry.armOffset;
  const K = yawTorqueFactor;
  const D = d === 0 ? 1e-3 : d;
  const Ksafe = Math.abs(K) < 1e-4 ? 1e-4 : K;

  const X = tau.x / D;
  const Y = tau.y / D;
  const Z = tau.z / Ksafe;
  const S = collective;

  const t1 = (S + X - Y - Z) / 4;
  const t2 = (S - X - Y + Z) / 4;
  const t3 = (S - X + Y - Z) / 4;
  const t4 = (S + X + Y + Z) / 4;

  const thrusts = [t1, t2, t3, t4];
  return thrusts.map((t) => clamp(t, 0, Infinity));
}
