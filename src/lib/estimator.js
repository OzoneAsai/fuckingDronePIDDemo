import { quat, quatIntegrate, eulerFromQuat, quatFromEuler, wrapPi } from './math.js';

export class ComplementaryFilter {
  constructor(alpha = 0.05) {
    this.alpha = alpha;
    this.quaternion = quat();
  }

  reset(initialQuat = quat()) {
    this.quaternion = [...initialQuat];
  }

  update({ gyro, acc }, dt) {
    this.quaternion = quatIntegrate(this.quaternion, this.quaternion, gyro, dt);
    const accMag = Math.hypot(acc[0], acc[1], acc[2]);
    let roll = 0;
    let pitch = 0;
    let yaw = 0;

    const { roll: rollGyro, pitch: pitchGyro, yaw: yawGyro } = eulerFromQuat(this.quaternion);
    roll = rollGyro;
    pitch = pitchGyro;
    yaw = yawGyro;

    if (accMag > 1e-4) {
      const ax = acc[0] / accMag;
      const ay = acc[1] / accMag;
      const az = acc[2] / accMag;
      const rollAcc = Math.atan2(ay, az);
      const pitchAcc = Math.atan2(-ax, Math.hypot(ay, az));
      roll = wrapPi((1 - this.alpha) * rollGyro + this.alpha * rollAcc);
      pitch = wrapPi((1 - this.alpha) * pitchGyro + this.alpha * pitchAcc);
    }

    this.quaternion = quatFromEuler(roll, pitch, yaw);
    return { roll, pitch, yaw, quaternion: [...this.quaternion] };
  }
}
