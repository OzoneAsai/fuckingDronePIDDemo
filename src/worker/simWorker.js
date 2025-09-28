import { createSimulator } from '../lib/simulator.js';
import { degreesToRadians } from '../lib/math.js';

let simulator = null;
let loopHandle = null;
let publishIntervalSteps = 10;
let lastStep = null;
let totalSteps = 0;
let publishedPackets = 0;

function startLoop() {
  if (!simulator || loopHandle) return;
  const intervalMs = simulator.dt * 1000;
  let stepCount = 0;
  console.log('[SimWorker] Starting loop', { intervalMs, publishIntervalSteps });
  loopHandle = setInterval(() => {
    lastStep = simulator.step();
    totalSteps += 1;
    stepCount += 1;
    if (stepCount >= publishIntervalSteps) {
      stepCount = 0;
      publishedPackets += 1;
      if (publishedPackets <= 5 || publishedPackets % 60 === 0) {
        console.log('[SimWorker] Publishing state', {
          publishedPackets,
          totalSteps,
          timeline: lastStep?.timeline
        });
      }
      postMessage({
        type: 'state',
        snapshot: simulator.getSnapshot(),
        estimation: lastStep?.estimation,
        measurement: lastStep?.measurement,
        actuators: {
          thrusts: lastStep?.thrusts,
          rpmCommands: lastStep?.rotorRpmCommands,
          tau: lastStep?.tau,
          overrides: lastStep?.rotorOverrides
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
    console.log('[SimWorker] Loop stopped');
  }
}

self.onmessage = (event) => {
  const msg = event.data;
  if (!msg) return;
  console.log('[SimWorker] Message received', msg.type);
  switch (msg.type) {
    case 'init': {
      const { dt = 0.005, pid, filterAlpha = 0.05, publishRate = 60, sessionDuration = 30 } = msg;
      simulator = createSimulator({ dt, pidGains: pid, filterAlpha, sessionDuration });
      publishIntervalSteps = Math.max(1, Math.round(1 / (publishRate * dt)));
      totalSteps = 0;
      publishedPackets = 0;
      startLoop();
      break;
    }
    case 'setpoint': {
      if (!simulator) break;
      const { roll, pitch, yaw, throttle } = msg;
      console.log('[SimWorker] Applying setpoint', { roll, pitch, yaw, throttle });
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
      console.log('[SimWorker] Updating PID', { axis, gains });
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
      console.log('[SimWorker] Resume requested');
      startLoop();
      break;
    }
    case 'rotorOverrides': {
      if (!simulator) break;
      console.log('[SimWorker] Rotor override message', msg);
      simulator.setRotorOverrides(msg.overrides ?? {}, { replace: !!msg.replace });
      break;
    }
    default:
      console.warn('[SimWorker] Unknown message type', msg.type);
      break;
  }
};
