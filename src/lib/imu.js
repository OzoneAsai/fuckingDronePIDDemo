import { rotateVectorByMatrix, quatToRotationMatrix, transposeRotation } from './math.js';

export function createImuModel({ gyroBiasStd = 0.001, accBiasStd = 0.02, gyroNoiseStd = 0.01, accNoiseStd = 0.1 } = {}) {
  const gyroBias = [randomNormal() * gyroBiasStd, randomNormal() * gyroBiasStd, randomNormal() * gyroBiasStd];
  const accBias = [randomNormal() * accBiasStd, randomNormal() * accBiasStd, randomNormal() * accBiasStd];

  function measure(state, worldAcc) {
    const gyro = [
      state.omega[0] + gyroBias[0] + randomNormal() * gyroNoiseStd,
      state.omega[1] + gyroBias[1] + randomNormal() * gyroNoiseStd,
      state.omega[2] + gyroBias[2] + randomNormal() * gyroNoiseStd
    ];

    const rot = quatToRotationMatrix(state.quaternion);
    const rotT = transposeRotation(rot);
    const gravity = [0, 0, state.params.gravity];
    const accWorld = [
      worldAcc[0] + gravity[0],
      worldAcc[1] + gravity[1],
      worldAcc[2] + gravity[2]
    ];
    const accBody = [0, 0, 0];
    rotateVectorByMatrix(accBody, rotT, accWorld);
    accBody[0] += accBias[0] + randomNormal() * accNoiseStd;
    accBody[1] += accBias[1] + randomNormal() * accNoiseStd;
    accBody[2] += accBias[2] + randomNormal() * accNoiseStd;

    return { gyro, acc: accBody };
  }

  function randomNormal() {
    // Box-Muller transform
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  return { measure };
}
