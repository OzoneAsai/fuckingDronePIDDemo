import { clamp } from './math.js';

export class PIDController {
  constructor({ kp = 0, ki = 0, kd = 0, integralLimit = 10, outputLimit = 10, derivativeAlpha = 0.8 } = {}) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
    this.integralLimit = integralLimit;
    this.outputLimit = outputLimit;
    this.derivativeAlpha = derivativeAlpha;
    this.reset();
  }

  reset() {
    this.integral = 0;
    this.prevError = 0;
    this.derivative = 0;
    this.lastOutput = 0;
  }

  setGains({ kp, ki, kd, derivativeAlpha, outputLimit, integralLimit }) {
    if (kp !== undefined) this.kp = kp;
    if (ki !== undefined) this.ki = ki;
    if (kd !== undefined) this.kd = kd;
    if (derivativeAlpha !== undefined) this.derivativeAlpha = derivativeAlpha;
    if (outputLimit !== undefined) this.outputLimit = outputLimit;
    if (integralLimit !== undefined) this.integralLimit = integralLimit;
  }

  update(error, dt) {
    this.integral += error * dt * this.ki;
    this.integral = clamp(this.integral, -this.integralLimit, this.integralLimit);

    const rawDerivative = (error - this.prevError) / Math.max(dt, 1e-5);
    this.derivative = this.derivativeAlpha * this.derivative + (1 - this.derivativeAlpha) * rawDerivative;

    const output = this.kp * error + this.integral + this.kd * this.derivative;
    this.prevError = error;
    this.lastOutput = clamp(output, -this.outputLimit, this.outputLimit);
    return this.lastOutput;
  }
}
