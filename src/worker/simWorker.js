import { createSimulator } from '../lib/simulator.js';
import { degreesToRadians } from '../lib/math.js';

let simulator = null;
let loopHandle = null;
let publishIntervalSteps = 10;
let lastStep = null;

function startLoop() {
  if (!simulator || loopHandle) return;
  const intervalMs = simulator.dt * 1000;
  let stepCount = 0;
  loopHandle = setInterval(() => {
    lastStep = simulator.step();
    stepCount += 1;
    if (stepCount >= publishIntervalSteps) {
      stepCount = 0;
      postMessage({
        type: 'state',
        snapshot: simulator.getSnapshot(),
        estimation: lastStep?.estimation,
        measurement: lastStep?.measurement,
        actuators: {
          thrusts: lastStep?.thrusts,
          rpmCommands: lastStep?.rotorRpmCommands,
          tau: lastStep?.tau
        },
        errors: lastStep?.errors,
        sessionReset: lastStep?.sessionReset,
        timeline: lastStep?.timeline
      });
    }
  }, intervalMs);
}

function stopLoop() {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
}

self.onmessage = (event) => {
  const msg = event.data;
  if (!msg) return;
  switch (msg.type) {
    case 'init': {
      const { dt = 0.005, pid, filterAlpha = 0.05, publishRate = 60, sessionDuration = 30 } = msg;
      simulator = createSimulator({ dt, pidGains: pid, filterAlpha, sessionDuration });
      publishIntervalSteps = Math.max(1, Math.round(1 / (publishRate * dt)));
      startLoop();
      break;
    }
    case 'setpoint': {
      if (!simulator) break;
      const { roll, pitch, yaw, throttle } = msg;
      simulator.setSetpoint({
        roll: roll !== undefined ? degreesToRadians(roll) : undefined,
        pitch: pitch !== undefined ? degreesToRadians(pitch) : undefined,
        yaw: yaw !== undefined ? degreesToRadians(yaw) : undefined,
        throttle
      });
      break;
    }
    case 'pid': {
      if (!simulator) break;
      const { axis, gains } = msg;
      simulator.updatePid(axis, gains);
      break;
    }
    case 'snapshot': {
      if (!simulator) break;
      postMessage({ type: 'state', snapshot: simulator.getSnapshot(), estimation: lastStep?.estimation, measurement: lastStep?.measurement });
      break;
    }
    case 'pause': {
      stopLoop();
      break;
    }
    case 'resume': {
      startLoop();
      break;
    }
    default:
      break;
  }
};
