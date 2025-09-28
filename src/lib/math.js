export const EPS = 1e-9;

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function vec3(x = 0, y = 0, z = 0) {
  return [x, y, z];
}

export function vec3Add(out, a, b) {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}

export function vec3Sub(out, a, b) {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

export function vec3Scale(out, a, s) {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
}

export function vec3AddScaled(out, a, b, s) {
  out[0] = a[0] + b[0] * s;
  out[1] = a[1] + b[1] * s;
  out[2] = a[2] + b[2] * s;
  return out;
}

export function vec3Cross(out, a, b) {
  const ax = a[0], ay = a[1], az = a[2];
  const bx = b[0], by = b[1], bz = b[2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
}

export function quat(w = 1, x = 0, y = 0, z = 0) {
  return [w, x, y, z];
}

export function quatNormalize(q) {
  const norm = Math.hypot(q[0], q[1], q[2], q[3]);
  if (norm < EPS) {
    q[0] = 1;
    q[1] = q[2] = q[3] = 0;
    return q;
  }
  const inv = 1 / norm;
  q[0] *= inv;
  q[1] *= inv;
  q[2] *= inv;
  q[3] *= inv;
  return q;
}

export function quatDerivative(out, q, omega) {
  const [w, x, y, z] = q;
  const [wx, wy, wz] = omega;
  out[0] = -0.5 * (x * wx + y * wy + z * wz);
  out[1] = 0.5 * (w * wx + y * wz - z * wy);
  out[2] = 0.5 * (w * wy - x * wz + z * wx);
  out[3] = 0.5 * (w * wz + x * wy - y * wx);
  return out;
}

export function quatIntegrate(out, q, omega, dt) {
  const dq = quat();
  quatDerivative(dq, q, omega);
  out[0] = q[0] + dq[0] * dt;
  out[1] = q[1] + dq[1] * dt;
  out[2] = q[2] + dq[2] * dt;
  out[3] = q[3] + dq[3] * dt;
  return quatNormalize(out);
}

export function quatToRotationMatrix(q) {
  const [w, x, y, z] = q;
  const ww = w * w;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;

  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy)
  ];
}

export function rotateVectorByMatrix(out, m, v) {
  out[0] = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
  out[1] = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
  out[2] = m[6] * v[0] + m[7] * v[1] + m[8] * v[2];
  return out;
}

export function rotateVectorByQuat(out, q, v) {
  const m = quatToRotationMatrix(q);
  return rotateVectorByMatrix(out, m, v);
}

export function transposeRotation(m) {
  return [
    m[0], m[3], m[6],
    m[1], m[4], m[7],
    m[2], m[5], m[8]
  ];
}

export function eulerFromQuat(q) {
  const [w, x, y, z] = q;
  const sinr = 2 * (w * x + y * z);
  const cosr = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr, cosr);

  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);

  const siny = 2 * (w * z + x * y);
  const cosy = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny, cosy);

  return { roll, pitch, yaw };
}

export function quatFromEuler(roll, pitch, yaw) {
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);

  return quat(
    cy * cp * cr + sy * sp * sr,
    cy * cp * sr - sy * sp * cr,
    cy * sp * cr + sy * cp * sr,
    sy * cp * cr - cy * sp * sr
  );
}

export function radiansToDegrees(rad) {
  return rad * (180 / Math.PI);
}

export function degreesToRadians(deg) {
  return deg * (Math.PI / 180);
}

export function wrapPi(angle) {
  let a = angle;
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}
