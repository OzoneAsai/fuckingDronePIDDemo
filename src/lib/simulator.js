import { airframe } from './airframeData.js';
import { createQuadState, stepQuad } from './quadPhysics.js';
import { ComplementaryFilter } from './estimator.js';
import { PIDController } from './pid.js';
import { createImuModel } from './imu.js';
import { mixForces } from './mixer.js';
import { rpmFromThrust, thrustFromRpm, propulsionLimits } from './propulsion.js';
import { eulerFromQuat, radiansToDegrees, wrapPi } from './math.js';

export function createSimulator({ dt = 0.005, pidGains, filterAlpha = 0.05, sessionDuration = 30 } = {}) {
  console.log('[Simulator] createSimulator', { dt, filterAlpha, sessionDuration });
  let state = createQuadState();
  let estimator = new ComplementaryFilter(filterAlpha);
  estimator.reset(state.quaternion);
  let imu = createImuModel();

  const rotorCount = airframe.propulsion.rotorCount;

  const pid = {
    roll: new PIDController({ kp: 4.0, ki: 0.5, kd: 1.5, outputLimit: 0.8 }),
    pitch: new PIDController({ kp: 4.0, ki: 0.5, kd: 1.5, outputLimit: 0.8 }),
    yaw: new PIDController({ kp: 2.0, ki: 0.3, kd: 0.8, outputLimit: 0.4 })
  };

  if (pidGains) {
    Object.entries(pidGains).forEach(([axis, gains]) => {
      if (pid[axis]) pid[axis].setGains(gains);
    });
  }

  const mass = airframe.dynamics.mass;
  const gravity = airframe.env.gravity;
  const hoverCollective = mass * gravity;
  const maxThrustPerRotor = thrustFromRpm(propulsionLimits.maxRpm);
  const maxCollective = maxThrustPerRotor * rotorCount;
  const hoverThrottle = hoverCollective / Math.max(maxCollective, 1e-6);

  const setpoint = {
    roll: 0,
    pitch: 0,
    yaw: 0,
    throttle: 0
  };

  let rotorRpmCommands = new Array(rotorCount).fill(0);
  let manualRotorOverrides = new Array(rotorCount).fill(null);

  const timeline = {
    time: 0,
    duration: sessionDuration,
    sessionId: 0,
    absolute: 0
  };

  function resetState() {
    console.log('[Simulator] resetState invoked');
    state = createQuadState();
    estimator = new ComplementaryFilter(filterAlpha);
    estimator.reset(state.quaternion);
    imu = createImuModel();
    rotorRpmCommands = new Array(rotorCount).fill(0);
    Object.values(pid).forEach((controller) => controller.reset());
  }

  function setRotorOverrides(overrides = {}, { replace = false } = {}) {
    console.log('[Simulator] setRotorOverrides', { overrides, replace });
    if (replace || manualRotorOverrides.length !== rotorCount) {
      manualRotorOverrides = new Array(rotorCount).fill(null);
    }
    if (!overrides) return;
    const applyValue = (idx, value) => {
      if (!Number.isInteger(idx) || idx < 0 || idx >= rotorCount) return;
      if (value === null || value === undefined) {
        manualRotorOverrides[idx] = null;
        return;
      }
      const rpmValue = Number(value);
      if (!Number.isFinite(rpmValue)) return;
      const clamped = Math.max(0, Math.min(rpmValue, propulsionLimits.maxRpm));
      manualRotorOverrides[idx] = clamped;
    };
    if (Array.isArray(overrides)) {
      overrides.forEach((value, idx) => applyValue(idx, value));
    } else {
      Object.entries(overrides).forEach(([key, value]) => {
        applyValue(Number(key), value);
      });
    }
  }

  function setSetpoint(newSetpoint) {
    console.log('[Simulator] setSetpoint', newSetpoint);
    if ('roll' in newSetpoint) setpoint.roll = newSetpoint.roll;
    if ('pitch' in newSetpoint) setpoint.pitch = newSetpoint.pitch;
    if ('yaw' in newSetpoint) setpoint.yaw = newSetpoint.yaw;
    if ('throttle' in newSetpoint) setpoint.throttle = Math.max(0, Math.min(newSetpoint.throttle, 1));
  }

  function updatePid(axis, gains) {
    console.log('[Simulator] updatePid', { axis, gains });
    if (pid[axis]) pid[axis].setGains(gains);
  }

  function step() {
    const measurement = imu.measure(state, state.worldAcc ?? [0, 0, 0]);
    const estimation = estimator.update(measurement, dt);

    const errors = {
      roll: wrapPi(setpoint.roll - estimation.roll),
      pitch: wrapPi(setpoint.pitch - estimation.pitch),
      yaw: wrapPi(setpoint.yaw - estimation.yaw)
    };

    const tau = {
      x: pid.roll.update(errors.roll, dt),
      y: pid.pitch.update(errors.pitch, dt),
      z: pid.yaw.update(errors.yaw, dt)
    };

    const collective = Math.max(0, Math.min(setpoint.throttle, 1)) * maxCollective;
    const thrusts = mixForces({ tau, collective });

    for (let i = 0; i < thrusts.length; i += 1) {
      const desiredRpm = rpmFromThrust(Math.min(thrusts[i], maxThrustPerRotor));
      const command = Math.min(desiredRpm, propulsionLimits.maxRpm);
      const override = manualRotorOverrides[i];
      if (override !== null && override !== undefined) {
        rotorRpmCommands[i] = Math.max(0, Math.min(override, propulsionLimits.maxRpm));
      } else {
        rotorRpmCommands[i] = command;
      }
    }

    const result = stepQuad(state, rotorRpmCommands, dt);

    timeline.time += dt;
    timeline.absolute += dt;
    let sessionReset = false;
    if (timeline.time >= timeline.duration) {
      timeline.sessionId += 1;
      timeline.time = 0;
      sessionReset = true;
      console.log('[Simulator] Session duration reached, resetting', { sessionId: timeline.sessionId });
      resetState();
    }

    return {
      measurement,
      estimation,
      tau,
      thrusts,
      rotorRpmCommands: [...rotorRpmCommands],
      rotorOverrides: [...manualRotorOverrides],
      errors,
      timeline: { ...timeline },
      sessionReset,
      result
    };
  }

  function getSnapshot() {
    const eulerActual = eulerFromQuat(state.quaternion);
    return {
      dt,
      mass,
      gravity,
      hoverThrottle,
      setpoint: { ...setpoint },
      timeline: { ...timeline },
      pid: {
        roll: { kp: pid.roll.kp, ki: pid.roll.ki, kd: pid.roll.kd },
        pitch: { kp: pid.pitch.kp, ki: pid.pitch.ki, kd: pid.pitch.kd },
        yaw: { kp: pid.yaw.kp, ki: pid.yaw.ki, kd: pid.yaw.kd }
      },
      state: {
        position: [...state.position],
        velocity: [...state.velocity],
        omega: [...state.omega],
        quaternion: [...state.quaternion],
        euler: eulerActual,
        eulerDeg: {
          roll: radiansToDegrees(eulerActual.roll),
          pitch: radiansToDegrees(eulerActual.pitch),
          yaw: radiansToDegrees(eulerActual.yaw)
        }
      },
      motors: {
        rpm: [...state.motor.rpm],
        commandRpm: [...rotorRpmCommands],
        thrust: [...state.motor.thrust],
        overrides: [...manualRotorOverrides]
      },
      airframe: {
        mass,
        inertia: airframe.dynamics.inertia,
        wheelbase: airframe.geometry.wheelbase,
        yawTorqueFactor: airframe.geometry.yawTorqueFactor,
        hoverRpm: propulsionLimits.hoverRpm,
        maxRpm: propulsionLimits.maxRpm,
        maxCollective
      }
    };
  }

  return { step, setSetpoint, updatePid, getSnapshot, reset: resetState, setRotorOverrides, dt };
}
