import { rotateVectorByMatrix, quatToRotationMatrix, transposeRotation } from './math.js';

export function createImuModel({
  gyroBiasStd = 0.001,
  accBiasStd = 0.02,
  gyroNoiseStd = 0.01,
  accNoiseStd = 0.1,
  magBiasStd = 0.02,
  magNoiseStd = 0.005,
  altNoiseStd = 0.05,
  tofNoiseStd = 0.02,
  fieldHeight = 50,
  earthMagField = [0.21, 0.0, 0.43]
} = {}) {
  const gyroBias = [randomNormal() * gyroBiasStd, randomNormal() * gyroBiasStd, randomNormal() * gyroBiasStd];
  const accBias = [randomNormal() * accBiasStd, randomNormal() * accBiasStd, randomNormal() * accBiasStd];
  const magBias = [randomNormal() * magBiasStd, randomNormal() * magBiasStd, randomNormal() * magBiasStd];

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

    const magBody = [0, 0, 0];
    rotateVectorByMatrix(magBody, rotT, earthMagField);
    magBody[0] += magBias[0] + randomNormal() * magNoiseStd;
    magBody[1] += magBias[1] + randomNormal() * magNoiseStd;
    magBody[2] += magBias[2] + randomNormal() * magNoiseStd;

    const altitudeTrue = Math.max(0, Math.min(state.position[2], fieldHeight));
    const altitudeMeasured = Math.max(0, altitudeTrue + randomNormal() * altNoiseStd);

    const bodyDown = [0, 0, 0];
    rotateVectorByMatrix(bodyDown, rot, [0, 0, -1]);
    const downCos = Math.max(0, -bodyDown[2]);
    let tof = null;
    if (downCos > 1e-3) {
      const range = Math.max(0, altitudeTrue / downCos + randomNormal() * tofNoiseStd);
      tof = Math.min(range, fieldHeight * 1.2);
    }

    return {
      gyro,
      acc: accBody,
      mag: magBody,
      alt: altitudeMeasured,
      absAltitude: altitudeTrue,
      tof,
      altitude: {
        estimated: altitudeMeasured,
        true: altitudeTrue,
        fieldHeight
      }
    };
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
