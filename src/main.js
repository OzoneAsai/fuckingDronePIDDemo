import Sk from 'skulpt';
import './app.css';
import { createHangarViewport } from './viewport.js';
import { createHistoryChart } from './charts.js';
import { airframe } from './lib/airframeData.js';
import { propulsionLimits } from './lib/propulsion.js';
import { radiansToDegrees, clamp } from './lib/math.js';

const timelineDuration = 30;
const defaultPython = `# command(time_s, throttle, roll_deg, pitch_deg, yaw_deg)
# Example: gentle takeoff, hold, then land.
command(0.0, 0.0, 0, 0, 0)
command(1.8, 0.55, 0, 0, 0)
command(4.0, 0.52, 0, 0, 0)
command(15.0, 0.5, 0, 0, 0)
command(22.0, 0.45, 0, 0, 0)
command(27.0, 0.25, 0, 0, 0)
command(29.5, 0.0, 0, 0, 0)
`;

const rotorLabels = Array.from({ length: airframe.propulsion.rotorCount }, (_, i) => `Prop${i + 1}`);
const propAliasMap = new Map();
rotorLabels.forEach((label, index) => {
  const aliases = [label, `prop${index + 1}`, `motor${index + 1}`, `m${index + 1}`, `${index + 1}`];
  aliases.forEach((alias) => propAliasMap.set(String(alias).toLowerCase(), index));
});

const app = document.getElementById('app') ?? document.body.appendChild(document.createElement('div'));
app.innerHTML = `
  <div class="app-shell">
    <header class="app-header">
      <h1 class="app-title">IMU Based Drone PID Demo <span class="badge">Beta</span></h1>
      <p class="app-subtitle">
        30秒ごとにリセットされるセッションで、IMU推定とPID制御を使ってJeNo3クアッドをホバリングさせるデモです。
        サイドバーのスライダーでセットポイントやPIDゲインを変更し、SkulptでPython製の自動操縦スクリプトも実行できます。
      </p>
    </header>
    <main class="app-main">
      <div class="layout">
        <section class="column">
          <article class="panel viewport-panel">
            <div class="timeline">
              <div class="timeline-header">
                <span>T0 = 0 s</span>
                <span>セッション #<span id="session-id">0</span></span>
              </div>
              <div class="timeline-bar">
                <div class="timeline-progress" id="timeline-progress"></div>
              </div>
              <div class="timeline-footer">
                <span>経過 <span id="timeline-elapsed">0.00 s</span></span>
                <span>残り <span id="timeline-remaining">30.00 s</span></span>
              </div>
            </div>
            <div class="canvas-wrapper">
              <canvas id="hangar-canvas"></canvas>
              <div class="canvas-overlay">
                <span class="clock-chip" id="clock-chip">T +0.00 s</span>
                <span class="status-chip" id="status-chip">Grounded</span>
              </div>
            </div>
          </article>

          <article class="panel">
            <h2>Flight Metrics</h2>
            <div class="metrics-grid">
              <div class="metric-card">
                <h3>Actual attitude</h3>
                <strong id="attitude-actual">0° / 0° / 0°</strong>
              </div>
              <div class="metric-card">
                <h3>Estimated attitude</h3>
                <strong id="attitude-estimate">0° / 0° / 0°</strong>
              </div>
              <div class="metric-card">
                <h3>Altitude</h3>
                <strong id="altitude-display">0.00 m</strong>
              </div>
              <div class="metric-card">
                <h3>Attitude error RMS</h3>
                <strong id="attitude-error">0.00 °</strong>
              </div>
            </div>
          </article>

          <article class="panel">
            <h2>Telemetry Charts</h2>
            <div class="chart-grid">
              <div class="chart-card">
                <h3>Altitude</h3>
                <canvas id="altitude-chart"></canvas>
              </div>
              <div class="chart-card">
                <h3>Attitude Score</h3>
                <canvas id="attitude-chart"></canvas>
              </div>
            </div>
          </article>
        </section>

        <aside class="column">
          <article class="panel">
            <h2>Setpoints</h2>
            <div class="control-group">
              <div class="control-block">
                <h3>姿勢ターゲット</h3>
                <div class="control-row">
                  <label for="roll-slider">Roll (°)</label>
                  <input type="range" id="roll-slider" min="-45" max="45" step="1" value="0" />
                  <span class="slider-value" id="roll-value">0°</span>
                </div>
                <div class="control-row">
                  <label for="pitch-slider">Pitch (°)</label>
                  <input type="range" id="pitch-slider" min="-45" max="45" step="1" value="0" />
                  <span class="slider-value" id="pitch-value">0°</span>
                </div>
                <div class="control-row">
                  <label for="yaw-slider">Yaw (°)</label>
                  <input type="range" id="yaw-slider" min="-90" max="90" step="1" value="0" />
                  <span class="slider-value" id="yaw-value">0°</span>
                </div>
              </div>

              <div class="control-block">
                <h3>推力</h3>
                <div class="control-row">
                  <label for="throttle-slider">Throttle</label>
                  <input type="range" id="throttle-slider" min="0" max="1" step="0.01" value="0" />
                  <span class="slider-value" id="throttle-value">0%</span>
                </div>
              </div>
            </div>
          </article>

          <article class="panel">
            <h2>PID Gains</h2>
            <div class="control-group">
              ${['roll', 'pitch', 'yaw']
                .map(
                  (axis) => `
                  <div class="control-block" data-axis="${axis}">
                    <h3>${axis.toUpperCase()}</h3>
                    <div class="control-row">
                      <label for="${axis}-kp">Kp</label>
                      <input type="range" id="${axis}-kp" min="0" max="10" step="0.1" value="${axis === 'yaw' ? 2 : 4}" />
                      <span class="slider-value" id="${axis}-kp-value"></span>
                    </div>
                    <div class="control-row">
                      <label for="${axis}-ki">Ki</label>
                      <input type="range" id="${axis}-ki" min="0" max="2" step="0.05" value="${axis === 'yaw' ? 0.3 : 0.5}" />
                      <span class="slider-value" id="${axis}-ki-value"></span>
                    </div>
                    <div class="control-row">
                      <label for="${axis}-kd">Kd</label>
                      <input type="range" id="${axis}-kd" min="0" max="4" step="0.1" value="${axis === 'yaw' ? 0.8 : 1.5}" />
                      <span class="slider-value" id="${axis}-kd-value"></span>
                    </div>
                  </div>
                `)
                .join('')}
            </div>
          </article>

          <article class="panel">
            <h2>Automation (Skulpt)</h2>
            <textarea id="python-editor" class="code-input" spellcheck="false"></textarea>
            <div class="button-row">
              <button class="primary" id="run-python">Run Python</button>
              <button class="secondary" id="clear-python">Clear</button>
              <button class="secondary" id="load-default">Load Default</button>
            </div>
            <div class="automation-status" id="automation-status">未実行</div>
            <div class="console-output" id="automation-console"></div>
            <div class="automation-status" id="automation-error"></div>
            <div class="footer-note">
              updateRot(Prop1, 12000) のように個別ロータのRPMを上書きできます。Noneを渡すと解除されます。
            </div>
          </article>
        </aside>
      </div>
    </main>
  </div>
`;

const dom = {
  session: document.getElementById('session-id'),
  progress: document.getElementById('timeline-progress'),
  elapsed: document.getElementById('timeline-elapsed'),
  remaining: document.getElementById('timeline-remaining'),
  clock: document.getElementById('clock-chip'),
  status: document.getElementById('status-chip'),
  attitudeActual: document.getElementById('attitude-actual'),
  attitudeEstimate: document.getElementById('attitude-estimate'),
  altitude: document.getElementById('altitude-display'),
  attitudeError: document.getElementById('attitude-error'),
  pythonEditor: document.getElementById('python-editor'),
  automationStatus: document.getElementById('automation-status'),
  automationConsole: document.getElementById('automation-console'),
  automationError: document.getElementById('automation-error'),
  throttleSlider: document.getElementById('throttle-slider'),
  throttleValue: document.getElementById('throttle-value'),
  runButton: document.getElementById('run-python'),
  clearButton: document.getElementById('clear-python'),
  loadDefaultButton: document.getElementById('load-default')
};

dom.pythonEditor.value = defaultPython;

dom.throttleValue.textContent = '0%';

const sliderEls = {
  roll: document.getElementById('roll-slider'),
  pitch: document.getElementById('pitch-slider'),
  yaw: document.getElementById('yaw-slider')
};

const sliderValues = {
  roll: document.getElementById('roll-value'),
  pitch: document.getElementById('pitch-value'),
  yaw: document.getElementById('yaw-value')
};

const pidSliders = ['roll', 'pitch', 'yaw'].reduce((acc, axis) => {
  acc[axis] = {
    kp: document.getElementById(`${axis}-kp`),
    ki: document.getElementById(`${axis}-ki`),
    kd: document.getElementById(`${axis}-kd`),
    labels: {
      kp: document.getElementById(`${axis}-kp-value`),
      ki: document.getElementById(`${axis}-ki-value`),
      kd: document.getElementById(`${axis}-kd-value`)
    }
  };
  return acc;
}, {});

const setpointState = {
  roll: 0,
  pitch: 0,
  yaw: 0,
  throttle: 0
};

const pidState = {
  roll: { kp: 4.0, ki: 0.5, kd: 1.5 },
  pitch: { kp: 4.0, ki: 0.5, kd: 1.5 },
  yaw: { kp: 2.0, ki: 0.3, kd: 0.8 }
};

function updateSetpointLabels() {
  sliderValues.roll.textContent = `${setpointState.roll.toFixed(0)}°`;
  sliderValues.pitch.textContent = `${setpointState.pitch.toFixed(0)}°`;
  sliderValues.yaw.textContent = `${setpointState.yaw.toFixed(0)}°`;
  dom.throttleValue.textContent = `${Math.round(setpointState.throttle * 100)}%`;
}

updateSetpointLabels();

['roll', 'pitch', 'yaw'].forEach((axis) => {
  sliderEls[axis].addEventListener('input', () => {
    setpointState[axis] = Number(sliderEls[axis].value);
    updateSetpointLabels();
    sendSetpoint();
  });
});

dom.throttleSlider.addEventListener('input', () => {
  setpointState.throttle = Number(dom.throttleSlider.value);
  updateSetpointLabels();
  sendSetpoint();
});

['roll', 'pitch', 'yaw'].forEach((axis) => {
  const sliders = pidSliders[axis];
  if (!sliders) return;
  ['kp', 'ki', 'kd'].forEach((key) => {
    const slider = sliders[key];
    const label = sliders.labels[key];
    const precision = key === 'ki' ? 2 : 1;
    if (slider) {
      slider.value = String(pidState[axis][key]);
      label.textContent = pidState[axis][key].toFixed(precision);
      slider.addEventListener('input', () => {
        const value = Number(slider.value);
        pidState[axis][key] = value;
        label.textContent = value.toFixed(precision);
        updatePid(axis);
      });
    }
  });
});

const canvas = document.getElementById('hangar-canvas');
const viewport = createHangarViewport(canvas);
const altitudeChart = createHistoryChart(document.getElementById('altitude-chart'), {
  range: [-0.2, 3],
  color: '#22d3ee',
  timeWindow: timelineDuration
});
const attitudeChart = createHistoryChart(document.getElementById('attitude-chart'), {
  range: [0, 100],
  color: '#fbbf24',
  timeWindow: timelineDuration
});

let workerReady = false;
let timeline = { time: 0, duration: timelineDuration, sessionId: 0, absolute: 0 };
let latestSnapshot = null;
let latestEstimation = null;
let lastAutomationCommand = null;
let autopConsole = '';
let autopError = '';
let autopStatus = '未実行';
let defaultAutomationArmed = true;
let defaultAutomationLaunched = false;

const autopilot = {
  schedule: [],
  pointer: 0,
  lastSessionId: 0,
  active: false,
  rotorOverrides: {},
  loop: true
};

dom.runButton.addEventListener('click', () => {
  runAutomation();
});

dom.clearButton.addEventListener('click', () => {
  clearAutomation();
});

dom.loadDefaultButton.addEventListener('click', () => {
  dom.pythonEditor.value = defaultPython;
  autopStatus = 'デフォルトスクリプトを読み込みました。';
  updateAutomationDisplays();
  defaultAutomationArmed = true;
});

function updateAutomationDisplays() {
  dom.automationStatus.textContent = autopStatus;
  dom.automationConsole.textContent = autopConsole.trim() ? autopConsole : 'Skulpt 標準出力なし';
  dom.automationConsole.scrollTop = dom.automationConsole.scrollHeight;
  dom.automationError.textContent = autopError;
}

function builtinRead(x) {
  if (!Sk.builtinFiles || !Sk.builtinFiles['files'][x]) {
    throw new Error(`File not found: ${x}`);
  }
  return Sk.builtinFiles['files'][x];
}

function resolvePropIdentifier(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  return propAliasMap.has(normalized) ? propAliasMap.get(normalized) : null;
}

function formatPropLabel(index) {
  return rotorLabels[index] ?? `Prop${index + 1}`;
}

function sendSetpoint() {
  if (!workerReady) return;
  worker.postMessage({
    type: 'setpoint',
    roll: setpointState.roll,
    pitch: setpointState.pitch,
    yaw: setpointState.yaw,
    throttle: setpointState.throttle
  });
}

function updatePid(axis) {
  if (!pidState[axis]) return;
  worker.postMessage({ type: 'pid', axis, gains: pidState[axis] });
}

function sendRotorOverrides(overrides = {}, replace = false) {
  worker.postMessage({ type: 'rotorOverrides', overrides, replace });
}

async function runAutomation({ fromAuto = false } = {}) {
  if (!fromAuto) {
    defaultAutomationArmed = false;
  }
  autopConsole = '';
  autopError = '';
  autopStatus = 'Skulptで解析中…';
  updateAutomationDisplays();

  const queue = [];
  const rotorOverrideMap = new Map();

  Sk.configure({
    output: (text) => {
      autopConsole += text;
      updateAutomationDisplays();
    },
    read: builtinRead,
    __future__: Sk.python3,
    execLimit: 10000
  });

  Sk.sysmodules = new Sk.builtin.dict([]);
  rotorLabels.forEach((label, index) => {
    Sk.builtins[`Prop${index + 1}`] = new Sk.builtin.str(label);
  });

  Sk.builtins.command = new Sk.builtin.func(function (time, throttle, roll, pitch, yaw) {
    if (time === undefined) {
      throw new Sk.builtin.ValueError('command() には少なくとも時間が必要です');
    }
    const toJs = (value) => {
      if (value === undefined) return undefined;
      const js = Sk.ffi.remapToJs(value);
      return js === null ? undefined : js;
    };
    const timeJs = Number(toJs(time));
    if (!Number.isFinite(timeJs) || timeJs < 0) {
      throw new Sk.builtin.ValueError('時間は0以上の数値で指定してください');
    }
    queue.push({
      time: timeJs,
      throttle: toJs(throttle),
      roll: toJs(roll),
      pitch: toJs(pitch),
      yaw: toJs(yaw)
    });
    return Sk.builtin.none.none$;
  });

  Sk.builtins.updateRot = new Sk.builtin.func(function (prop, rpm) {
    if (prop === undefined || rpm === undefined) {
      throw new Sk.builtin.ValueError('updateRot(prop, rpm) には2つの引数が必要です');
    }
    const identifier = Sk.ffi.remapToJs(prop);
    const index = resolvePropIdentifier(identifier);
    if (index === null) {
      throw new Sk.builtin.ValueError('updateRot(): Prop1〜Prop4 など既知の識別子で指定してください');
    }
    const rpmJs = Sk.ffi.remapToJs(rpm);
    if (rpmJs === null) {
      rotorOverrideMap.set(index, null);
      autopConsole = `${autopConsole}updateRot(${formatPropLabel(index)}, None) → オーバーライド解除\n`;
      updateAutomationDisplays();
      return Sk.builtin.none.none$;
    }
    const rpmNumber = Number(rpmJs);
    if (!Number.isFinite(rpmNumber)) {
      throw new Sk.builtin.ValueError('updateRot(): RPM には数値を指定してください');
    }
    const clamped = Math.max(0, Math.min(rpmNumber, propulsionLimits.maxRpm));
    let line = `updateRot(${formatPropLabel(index)}, ${clamped.toFixed(0)} rpm)`;
    if (clamped !== rpmNumber) {
      line += `  # 入力 ${rpmNumber.toFixed(0)} をクランプ`;
    }
    rotorOverrideMap.set(index, clamped);
    autopConsole = `${autopConsole}${line}\n`;
    updateAutomationDisplays();
    return Sk.builtin.none.none$;
  });

  try {
    await Sk.misceval.asyncToPromise(() => Sk.importMainWithBody('<stdin>', false, dom.pythonEditor.value, true));
    queue.sort((a, b) => a.time - b.time);
    const overrides = {};
    rotorOverrideMap.forEach((value, index) => {
      overrides[index] = value;
    });
    autopilot.schedule = queue;
    autopilot.pointer = 0;
    autopilot.lastSessionId = timeline.sessionId;
    autopilot.active = queue.length > 0;
    autopilot.rotorOverrides = overrides;

    const overrideCount = Object.keys(overrides).filter((key) => overrides[key] !== undefined).length;
    const summary = [];
    if (queue.length) summary.push(`コマンド ${queue.length} 件`);
    if (overrideCount) summary.push(`プロペラ更新 ${overrideCount} 件`);
    autopStatus = summary.length ? `${summary.join(' / ')}を読み込みました。` : 'コマンドが登録されませんでした。';
    lastAutomationCommand = null;
    updateAutomationDisplays();
    sendRotorOverrides(overrides, true);
    applyAutomation();
    if (!queue.length && !overrideCount) {
      autopConsole = `${autopConsole}\n⚠️ command() 呼び出しが見つかりません。`;
      updateAutomationDisplays();
    }
  } catch (error) {
    autopilot.active = false;
    autopStatus = '自動制御プログラムの解析に失敗しました。';
    autopError = error.toString();
    updateAutomationDisplays();
    console.error('[automation] Skulpt execution failed', error);
  }
}

function clearAutomation() {
  autopilot.schedule = [];
  autopilot.pointer = 0;
  autopilot.lastSessionId = timeline.sessionId;
  autopilot.active = false;
  autopilot.rotorOverrides = {};
  autopConsole = '';
  autopError = '';
  autopStatus = '自動制御をリセットしました。';
  defaultAutomationArmed = false;
  defaultAutomationLaunched = false;
  updateAutomationDisplays();
  sendRotorOverrides({}, true);
}

function applyAutomationCommand(command) {
  let changed = false;
  if (command.roll !== undefined) {
    setpointState.roll = clamp(Number(command.roll), -90, 90);
    sliderEls.roll.value = String(setpointState.roll);
    changed = true;
  }
  if (command.pitch !== undefined) {
    setpointState.pitch = clamp(Number(command.pitch), -90, 90);
    sliderEls.pitch.value = String(setpointState.pitch);
    changed = true;
  }
  if (command.yaw !== undefined) {
    setpointState.yaw = clamp(Number(command.yaw), -180, 180);
    sliderEls.yaw.value = String(setpointState.yaw);
    changed = true;
  }
  if (command.throttle !== undefined) {
    setpointState.throttle = clamp(Number(command.throttle), 0, 1);
    dom.throttleSlider.value = String(setpointState.throttle);
    changed = true;
  }
  if (changed) {
    updateSetpointLabels();
    sendSetpoint();
    autopStatus = `t=${command.time.toFixed(2)} s でコマンド適用`;
    updateAutomationDisplays();
  }
}

function applyAutomation() {
  if (!autopilot.active || !timeline) return;
  if (autopilot.lastSessionId !== timeline.sessionId) {
    if (autopilot.loop) {
      autopilot.pointer = 0;
      autopilot.lastSessionId = timeline.sessionId;
      lastAutomationCommand = null;
    } else {
      autopilot.active = false;
      autopStatus = '自動制御は1セッションで停止します。';
      updateAutomationDisplays();
      return;
    }
  }

  while (autopilot.pointer < autopilot.schedule.length && autopilot.schedule[autopilot.pointer].time <= timeline.time + 1e-4) {
    const command = autopilot.schedule[autopilot.pointer];
    applyAutomationCommand(command);
    autopilot.pointer += 1;
    autopilot.lastSessionId = timeline.sessionId;
    lastAutomationCommand = command;
  }
}

function handleSessionReset() {
  altitudeChart.clear();
  attitudeChart.clear();
  if (Object.keys(autopilot.rotorOverrides || {}).length) {
    sendRotorOverrides(autopilot.rotorOverrides, true);
  }
  if (!autopilot.schedule.length) return;
  if (autopilot.loop) {
    autopilot.pointer = 0;
    autopilot.lastSessionId = timeline.sessionId;
    lastAutomationCommand = null;
    autopStatus = 'セッションがリセットしました。自動プログラムを再実行します。';
  } else {
    autopilot.active = false;
    autopStatus = 'セッションがリセットしたため自動制御を停止しました。';
  }
  updateAutomationDisplays();
}

const worker = new Worker(new URL('./worker/simWorker.js', import.meta.url), { type: 'module' });

worker.onmessage = (event) => {
  const data = event.data;
  if (!data || data.type !== 'state') return;
  const snapshot = data.snapshot ?? latestSnapshot;
  if (!snapshot) return;
  latestSnapshot = snapshot;
  latestEstimation = data.estimation ?? latestEstimation;
  timeline = snapshot.timeline ?? data.timeline ?? timeline;

  dom.session.textContent = String(timeline.sessionId ?? 0);
  dom.elapsed.textContent = `${(timeline.time ?? 0).toFixed(2)} s`;
  const remaining = Math.max(0, (timeline.duration ?? timelineDuration) - (timeline.time ?? 0));
  dom.remaining.textContent = `${remaining.toFixed(2)} s`;
  const progressRatio = Math.min(1, Math.max(0, (timeline.time ?? 0) / (timeline.duration || timelineDuration)));
  dom.progress.style.width = `${(progressRatio * 100).toFixed(1)}%`;
  dom.clock.textContent = `T +${(timeline.time ?? 0).toFixed(2)} s`;

  const attitudeDeg = snapshot.state?.eulerDeg ?? { roll: 0, pitch: 0, yaw: 0 };
  dom.attitudeActual.textContent = `${attitudeDeg.roll.toFixed(1)}° / ${attitudeDeg.pitch.toFixed(1)}° / ${attitudeDeg.yaw.toFixed(1)}°`;

  const est = latestEstimation
    ? {
        roll: radiansToDegrees(latestEstimation.roll),
        pitch: radiansToDegrees(latestEstimation.pitch),
        yaw: radiansToDegrees(latestEstimation.yaw)
      }
    : { roll: 0, pitch: 0, yaw: 0 };
  dom.attitudeEstimate.textContent = `${est.roll.toFixed(1)}° / ${est.pitch.toFixed(1)}° / ${est.yaw.toFixed(1)}°`;

  const altitude = snapshot.state?.position?.[2] ?? 0;
  dom.altitude.textContent = `${altitude.toFixed(2)} m`;
  dom.status.textContent = altitude > 0.1 ? 'In flight' : 'Grounded';

  const errorsRad = data.errors ?? { roll: 0, pitch: 0, yaw: 0 };
  const errorsDeg = {
    roll: radiansToDegrees(errorsRad.roll ?? 0),
    pitch: radiansToDegrees(errorsRad.pitch ?? 0),
    yaw: radiansToDegrees(errorsRad.yaw ?? 0)
  };
  const rms = Math.sqrt((errorsDeg.roll ** 2 + errorsDeg.pitch ** 2 + errorsDeg.yaw ** 2) / 3);
  dom.attitudeError.textContent = `${rms.toFixed(2)} °`;
  const attitudeScore = Math.max(0, Math.min(100, 100 - rms * 8));

  altitudeChart.push({ time: timeline.time ?? 0, value: altitude });
  attitudeChart.push({ time: timeline.time ?? 0, value: attitudeScore });

  viewport.update({
    actualQuaternion: snapshot.state?.quaternion,
    estimatedQuaternion: latestEstimation?.quaternion ?? snapshot.state?.quaternion,
    position: snapshot.state?.position
  });

  if (data.sessionReset) {
    handleSessionReset();
  }

  workerReady = true;
  applyAutomation();

  if (defaultAutomationArmed && !defaultAutomationLaunched) {
    defaultAutomationLaunched = true;
    runAutomation({ fromAuto: true });
  }
};

worker.postMessage({
  type: 'init',
  dt: 0.005,
  filterAlpha: 0.06,
  publishRate: 60,
  pid: pidState,
  sessionDuration: timelineDuration
});

window.addEventListener('beforeunload', () => {
  viewport.dispose();
  worker.terminate();
});

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[sw] Service workers are not supported in this browser');
    return;
  }

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');
      console.log('[sw] Registered service worker', registration);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          console.log('[sw] Installing worker state', installing.state);
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[sw] Controller changed');
      });
    } catch (error) {
      console.error('[sw] Failed to register service worker', error);
    }
  };

  if (document.readyState === 'complete') {
    void register();
  } else {
    window.addEventListener('load', () => void register(), { once: true });
  }
}

registerServiceWorker();
