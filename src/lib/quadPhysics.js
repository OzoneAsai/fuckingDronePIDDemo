import { airframe } from './airframeData.js';
import { vec3, vec3AddScaled, quat, quatIntegrate, quatToRotationMatrix, rotateVectorByMatrix, transposeRotation, vec3Cross } from './math.js';
import { thrustAndTorqueFromRpm, propulsionLimits } from './propulsion.js';

const spinDirections = [-1, 1, -1, 1];

export function createQuadState() {
  return {
    position: vec3(0, 0, 0),
    velocity: vec3(0, 0, 0),
    omega: vec3(0, 0, 0),
    quaternion: quat(1, 0, 0, 0),
    motor: {
      rpm: new Array(airframe.propulsion.rotorCount).fill(0),
      commandRpm: new Array(airframe.propulsion.rotorCount).fill(0),
      thrust: new Array(airframe.propulsion.rotorCount).fill(0),
      torque: new Array(airframe.propulsion.rotorCount).fill(0)
    },
    params: {
      mass: airframe.dynamics.mass,
      inertia: airframe.dynamics.inertia,
      gravity: airframe.env.gravity,
      linearDamping: 0.4,
      angularDamping: 0.015,
      motorTimeConstant: Math.max(airframe.dynamics.motorTimeConstant, 0.002)
    },
    worldAcc: vec3(0, 0, 0),
    onGround: true
  };
}

export function stepQuad(state, rotorRpmCommands, dt) {
  const { mass, inertia, gravity, linearDamping, angularDamping, motorTimeConstant } = state.params;
  const rot = quatToRotationMatrix(state.quaternion);
  const rotT = transposeRotation(rot);
  const bodyVelocity = rotateVectorByMatrix(vec3(), rotT, state.velocity);

  const alpha = dt / (motorTimeConstant + dt);
  let totalThrust = 0;
  const thrustBody = vec3(0, 0, 0);
  const torqueBody = vec3(0, 0, 0);

  for (let i = 0; i < state.motor.rpm.length; i += 1) {
    const target = Math.min(Math.max(rotorRpmCommands[i], 0), propulsionLimits.maxRpm);
    state.motor.commandRpm[i] = target;
    state.motor.rpm[i] += (target - state.motor.rpm[i]) * alpha;

    const axialVelocity = -bodyVelocity[2];
    const { thrust, torque } = thrustAndTorqueFromRpm(state.motor.rpm[i], axialVelocity);
    state.motor.thrust[i] = thrust;
    state.motor.torque[i] = torque;

    totalThrust += thrust;

    const rotor = airframe.geometry.rotorPositions[i];
    const force = vec3(0, 0, thrust);
    thrustBody[2] += thrust;

    const lever = [rotor.x, rotor.y, 0];
    const cross = vec3();
    vec3Cross(cross, lever, force);
    torqueBody[0] += cross[0];
    torqueBody[1] += cross[1];
    torqueBody[2] += cross[2] + spinDirections[i] * torque;
  }

  const thrustWorld = rotateVectorByMatrix(vec3(), rot, thrustBody);
  const dragForce = [-linearDamping * state.velocity[0], -linearDamping * state.velocity[1], -linearDamping * state.velocity[2]];
  const forceWorld = [
    thrustWorld[0] + dragForce[0],
    thrustWorld[1] + dragForce[1],
    thrustWorld[2] + dragForce[2] - mass * gravity
  ];

  const accWorld = [forceWorld[0] / mass, forceWorld[1] / mass, forceWorld[2] / mass];
  state.worldAcc = accWorld;
  vec3AddScaled(state.velocity, state.velocity, accWorld, dt);
  vec3AddScaled(state.position, state.position, state.velocity, dt);

  // Simple ground contact at z = 0 with damping
  if (state.position[2] < 0) {
    state.position[2] = 0;
    if (state.velocity[2] < 0) state.velocity[2] = 0;
    state.velocity[0] *= 0.65;
    state.velocity[1] *= 0.65;
  }

  const inertiaVec = [inertia.xx * state.omega[0], inertia.yy * state.omega[1], inertia.zz * state.omega[2]];
  const omegaCross = vec3();
  vec3Cross(omegaCross, state.omega, inertiaVec);
  const angAcc = [
    (torqueBody[0] - omegaCross[0] - angularDamping * state.omega[0]) / inertia.xx,
    (torqueBody[1] - omegaCross[1] - angularDamping * state.omega[1]) / inertia.yy,
    (torqueBody[2] - omegaCross[2] - angularDamping * state.omega[2]) / inertia.zz
  ];

  state.omega[0] += angAcc[0] * dt;
  state.omega[1] += angAcc[1] * dt;
  state.omega[2] += angAcc[2] * dt;

  state.quaternion = quatIntegrate(state.quaternion, state.quaternion, state.omega, dt);

  state.onGround = state.position[2] <= 1e-4 && totalThrust < mass * gravity * 0.9;
  if (state.onGround) {
    state.omega[0] *= 0.6;
    state.omega[1] *= 0.6;
    state.omega[2] *= 0.6;
  }

  return {
    totalThrust,
    torqueBody,
    thrustBody,
    thrustWorld,
    accWorld
  };
}
