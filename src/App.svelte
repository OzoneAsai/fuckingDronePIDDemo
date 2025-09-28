<script>
  import { onMount } from 'svelte';
  import Sk from 'skulpt';
  import ThreeViewport from './components/ThreeViewport.svelte';
  import LineChart from './components/LineChart.svelte';
  import { airframe } from './lib/airframeData.js';
  import { propulsionLimits } from './lib/propulsion.js';
  import { radiansToDegrees } from './lib/math.js';

const timelineDuration = 30;
const defaultPython = `# command(time_s, throttle, roll_deg, pitch_deg, yaw_deg)
# time is relative to the 30 s session clock. Use None to keep a value.
# Example: gentle takeoff, hold, then land.
command(0.0, 0.0, 0, 0, 0)
command(1.5, 0.55, 0, 0, 0)
command(4.0, 0.52, 0, 0, 0)
command(15.0, 0.5, 0, 0, 0)
command(22.0, 0.45, 0, 0, 0)
command(27.0, 0.2, 0, 0, 0)
command(29.5, 0.0, 0, 0, 0)
`;

  const rotorLabels = Array.from({ length: airframe.propulsion.rotorCount }, (_, i) => `Prop${i + 1}`);
  const propAliasMap = new Map();
  rotorLabels.forEach((label, index) => {
    const aliases = [label, `prop${index + 1}`, `Prop${index + 1}`, `motor${index + 1}`, `m${index + 1}`, `${index + 1}`];
    aliases.forEach((alias) => propAliasMap.set(String(alias).toLowerCase(), index));
  });

  function resolvePropIdentifier(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return null;
    return propAliasMap.has(normalized) ? propAliasMap.get(normalized) : null;
  }

  function formatPropLabel(index) {
    return rotorLabels[index] ?? `Prop${index + 1}`;
  }

  let worker;
  let ready = false;
  let latest = null;
  let estimation = null;
  let measurement = null;
  let actuators = null;
  let timeline = { time: 0, duration: timelineDuration, sessionId: 0, absolute: 0 };

  let setpointDeg = { roll: 0, pitch: 0, yaw: 0 };
  let throttleCmd = 0.0;
  let hoverThrottleEstimate = 0.5;

  const pid = {
    roll: { kp: 4.0, ki: 0.5, kd: 1.5 },
    pitch: { kp: 4.0, ki: 0.5, kd: 1.5 },
    yaw: { kp: 2.0, ki: 0.3, kd: 0.8 }
  };

  let errorDeg = { roll: 0, pitch: 0, yaw: 0 };
  let altitudeHistory = [];
  let attitudeHistory = [];
  let rmsError = 0;

  let pythonCode = defaultPython;
  let autopilot = { schedule: [], pointer: 0, lastSessionId: 0, active: false, rotorOverrides: {} };
  let autopilotLoop = true;
  let autopilotConsole = '';
  let autopilotError = '';
  let autopilotStatus = '未実行';
  let lastAutomationCommand = null;

  onMount(() => {
    worker = new Worker(new URL('./worker/simWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type !== 'state') return;
      latest = data.snapshot;
      estimation = data.estimation;
      measurement = data.measurement;
      actuators = data.actuators;

      if (latest?.hoverThrottle !== undefined && !ready) {
        hoverThrottleEstimate = latest.hoverThrottle;
      }

      if (latest?.timeline) {
        timeline = latest.timeline;
        if (data.sessionReset) {
          handleSessionReset();
        }
      }

      const radErrors = data.errors ?? { roll: 0, pitch: 0, yaw: 0 };
      errorDeg = {
        roll: radiansToDegrees(radErrors.roll ?? 0),
        pitch: radiansToDegrees(radErrors.pitch ?? 0),
        yaw: radiansToDegrees(radErrors.yaw ?? 0)
      };

      updateHistories();
      ready = true;
      applyAutomation();
    };

    worker.postMessage({
      type: 'init',
      dt: 0.005,
      filterAlpha: 0.06,
      publishRate: 60,
      pid,
      sessionDuration: timelineDuration
    });

    return () => {
      worker?.terminate();
    };
  });

  function handleSessionReset() {
    altitudeHistory = [];
    attitudeHistory = [];
    if (autopilot.rotorOverrides && Object.keys(autopilot.rotorOverrides).length) {
      sendRotorOverrides(autopilot.rotorOverrides, false);
    }
    if (!autopilot.schedule.length) return;
    if (autopilotLoop) {
      autopilot.pointer = 0;
      autopilot.lastSessionId = timeline.sessionId;
      lastAutomationCommand = null;
      autopilotStatus = 'セッションがリセットしました。自動プログラムを再実行します。';
    } else {
      autopilot.active = false;
      autopilotStatus = 'セッションがリセットしたため自動制御を停止しました。';
    }
  }

  function appendHistory(history, sample) {
    const next = [...history, sample];
    if (next.length > 600) {
      return next.slice(next.length - 600);
    }
    return next;
  }

  function computeRmsError(err) {
    return Math.sqrt((err.roll ** 2 + err.pitch ** 2 + err.yaw ** 2) / 3);
  }

  function computeAttitudeScore(err) {
    const rms = computeRmsError(err);
    return Math.max(0, Math.min(100, 100 - rms * 8));
  }

  function updateHistories() {
    const altitude = latest?.state?.position?.[2] ?? 0;
    altitudeHistory = appendHistory(altitudeHistory, { time: timeline.time, value: altitude });
    rmsError = computeRmsError(errorDeg);
    const score = computeAttitudeScore(errorDeg);
    attitudeHistory = appendHistory(attitudeHistory, { time: timeline.time, value: score });
  }

  function updateSetpoint(axis, value) {
    setpointDeg = { ...setpointDeg, [axis]: value };
    sendSetpoint();
  }

  function updateThrottle(value) {
    throttleCmd = Math.max(0, Math.min(value, 1));
    sendSetpoint();
  }

  function sendSetpoint() {
    if (!worker || !ready) return;
    worker.postMessage({
      type: 'setpoint',
      roll: setpointDeg.roll,
      pitch: setpointDeg.pitch,
      yaw: setpointDeg.yaw,
      throttle: throttleCmd
    });
  }

  function sendRotorOverrides(overrides = {}, replace = false) {
    if (!worker) return;
    worker.postMessage({ type: 'rotorOverrides', overrides, replace });
  }

  function changePid(axis, key, value) {
    pid[axis] = { ...pid[axis], [key]: value };
    worker?.postMessage({ type: 'pid', axis, gains: pid[axis] });
    if (axis === 'roll') {
      pid.pitch = { ...pid.pitch, [key]: value };
      worker?.postMessage({ type: 'pid', axis: 'pitch', gains: pid.pitch });
    }
  }

  function builtinRead(x) {
    if (!Sk.builtinFiles || !Sk.builtinFiles['files'][x]) {
      throw new Error(`File not found: ${x}`);
    }
    return Sk.builtinFiles['files'][x];
  }

  async function runAutomation() {
    autopilotConsole = '';
    autopilotError = '';
    autopilotStatus = 'Skulptで解析中…';

    const queue = [];
    const rotorOverrideMap = new Map();

    Sk.configure({
      output: (text) => {
        autopilotConsole = autopilotConsole + text;
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
      const entry = {
        time: timeJs,
        throttle: toJs(throttle),
        roll: toJs(roll),
        pitch: toJs(pitch),
        yaw: toJs(yaw)
      };
      queue.push(entry);
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
        autopilotConsole = `${autopilotConsole}updateRot(${formatPropLabel(index)}, None) → オーバーライド解除\n`;
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
      autopilotConsole = `${autopilotConsole}${line}\n`;
      return Sk.builtin.none.none$;
    });

    try {
      await Sk.misceval.asyncToPromise(() => Sk.importMainWithBody('<stdin>', false, pythonCode, true));
      queue.sort((a, b) => a.time - b.time);
      const overrides = {};
      rotorOverrideMap.forEach((value, index) => {
        overrides[index] = value;
      });
      const overrideCount = Object.keys(overrides).length;

      autopilot = {
        schedule: queue,
        pointer: 0,
        lastSessionId: timeline.sessionId,
        active: queue.length > 0,
        rotorOverrides: overrides
      };
      const summary = [];
      if (queue.length) summary.push(`コマンド ${queue.length} 件`);
      if (overrideCount) summary.push(`プロペラ更新 ${overrideCount} 件`);
      autopilotStatus = summary.length
        ? `${summary.join(' / ')}を読み込みました。`
        : 'コマンドが登録されませんでした。';
      lastAutomationCommand = null;
      if (!queue.length && !overrideCount) {
        autopilotConsole = `${autopilotConsole}\n⚠️ command() 呼び出しが見つかりません。`;
      }
      sendRotorOverrides(overrides, true);
    } catch (err) {
      autopilot.active = false;
      autopilotStatus = '自動制御プログラムの解析に失敗しました。';
      autopilotError = err.toString();
    }
  }

  function clearAutomation() {
    autopilot = { schedule: [], pointer: 0, lastSessionId: timeline.sessionId, active: false, rotorOverrides: {} };
    sendRotorOverrides({}, true);
    autopilotConsole = '';
    autopilotError = '';
    autopilotStatus = '自動制御をリセットしました。';
    lastAutomationCommand = null;
  }

  function applyAutomation() {
    if (!autopilot.active || !timeline) return;
    if (autopilot.lastSessionId !== timeline.sessionId) {
      if (autopilotLoop) {
        autopilot.pointer = 0;
        autopilot.lastSessionId = timeline.sessionId;
        lastAutomationCommand = null;
      } else {
        autopilot.active = false;
        autopilotStatus = '自動制御は1セッションで停止します。';
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

  function applyAutomationCommand(command) {
    let changed = false;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    if (command.roll !== undefined) {
      setpointDeg = { ...setpointDeg, roll: clamp(Number(command.roll), -90, 90) };
      changed = true;
    }
    if (command.pitch !== undefined) {
      setpointDeg = { ...setpointDeg, pitch: clamp(Number(command.pitch), -90, 90) };
      changed = true;
    }
    if (command.yaw !== undefined) {
      setpointDeg = { ...setpointDeg, yaw: clamp(Number(command.yaw), -180, 180) };
      changed = true;
    }
    if (command.throttle !== undefined) {
      throttleCmd = clamp(Number(command.throttle), 0, 1);
      changed = true;
    }
    if (changed) {
      sendSetpoint();
      autopilotStatus = `t=${command.time.toFixed(2)} s でコマンド適用`;
    }
  }

  $: actualEuler = latest?.state?.eulerDeg ?? { roll: 0, pitch: 0, yaw: 0 };
  $: estimatedEulerDeg = estimation
    ? {
        roll: radiansToDegrees(estimation.roll),
        pitch: radiansToDegrees(estimation.pitch),
        yaw: radiansToDegrees(estimation.yaw)
      }
    : { roll: 0, pitch: 0, yaw: 0 };
  $: motorRpm = latest?.motors?.rpm ?? [0, 0, 0, 0];
  $: commandRpm = actuators?.rpmCommands ?? [0, 0, 0, 0];
  $: thrusts = actuators?.thrusts ?? [0, 0, 0, 0];
  $: quadQuat = latest?.state?.quaternion ?? [1, 0, 0, 0];
  $: timelineProgress = timeline ? Math.min(1, timeline.time / timeline.duration) : 0;
  $: timelineRemaining = timeline ? Math.max(0, timeline.duration - timeline.time) : timelineDuration;
  $: altitude = latest?.state?.position?.[2] ?? 0;
  $: hoverPercent = (hoverThrottleEstimate * 100).toFixed(1);
  $: throttlePercent = (throttleCmd * 100).toFixed(1);
  $: attitudeScore = computeAttitudeScore(errorDeg);
  $: rotorOverrideList = Object.entries(autopilot.rotorOverrides ?? {})
    .map(([index, rpm]) => {
      const idx = Number(index);
      if (!Number.isFinite(idx) || idx < 0) return null;
      const value = rpm === null || rpm === undefined ? null : Number(rpm);
      return { index: idx, rpm: Number.isFinite(value) ? value : null };
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
</script>

<main>
  <div class="layout">
    <div class="column column--main">
      <div class="viewport-card">
        <div class="timeline">
          <div class="timeline__header">
            <span>セッション {timeline.sessionId + 1}</span>
            <span>{timeline.time.toFixed(2)} / {timeline.duration.toFixed(2)} s</span>
          </div>
          <div class="timeline__bar">
            <div class="timeline__progress" style={`width: ${(timelineProgress * 100).toFixed(1)}%;`}></div>
          </div>
          <div class="timeline__footer">リセットまで残り {timelineRemaining.toFixed(2)} s</div>
        </div>
        <ThreeViewport
          actualQuat={quadQuat}
          estimatedQuat={estimation?.quaternion ?? quadQuat}
          position={latest?.state?.position ?? [0, 0, 0]}
          worldTime={timeline?.time ?? 0}
        />
      </div>

      <div class="metrics-grid">
        <div class="metric-card">
          <h3>高度</h3>
          <p>{altitude.toFixed(2)} m</p>
        </div>
        <div class="metric-card">
          <h3>Roll</h3>
          <p>{actualEuler.roll.toFixed(2)}°<br /><small>推定 {estimatedEulerDeg.roll.toFixed(2)}°</small></p>
        </div>
        <div class="metric-card">
          <h3>Pitch</h3>
          <p>{actualEuler.pitch.toFixed(2)}°<br /><small>推定 {estimatedEulerDeg.pitch.toFixed(2)}°</small></p>
        </div>
        <div class="metric-card">
          <h3>Yaw</h3>
          <p>{actualEuler.yaw.toFixed(2)}°<br /><small>推定 {estimatedEulerDeg.yaw.toFixed(2)}°</small></p>
        </div>
        <div class="metric-card">
          <h3>スロットル</h3>
          <p>{throttlePercent}%<br /><small>ホバ基準 {hoverPercent}%</small></p>
        </div>
        <div class="metric-card">
          <h3>姿勢スコア</h3>
          <p>{attitudeScore.toFixed(1)} / 100<br /><small>RMS誤差 {rmsError.toFixed(2)}°</small></p>
        </div>
      </div>

      <div class="metrics-grid motors">
        {#each motorRpm as rpm, i}
          <div class="metric-card">
            <h3>Motor {i + 1}</h3>
            <p>{rpm.toFixed(0)} rpm<br /><small>指令 {commandRpm[i]?.toFixed(0)} rpm / 推力 {thrusts[i]?.toFixed(2)} N</small></p>
          </div>
        {/each}
      </div>
    </div>

    <div class="column column--sidebar">
      <LineChart label="Altitude" unit="m" data={altitudeHistory} duration={timelineDuration} format={(v) => v.toFixed(2)} />
      <LineChart label="Attitude Score" unit="pts" data={attitudeHistory} duration={timelineDuration} min={0} max={100} format={(v) => v.toFixed(1)} />

      <div class="sidebar-card">
        <h3>Skulpt 離陸プログラム</h3>
        <p class="hint">command(time, throttle, roll, pitch, yaw)。未指定は None を渡してください。スロットルは0.0〜1.0。</p>
        <textarea bind:value={pythonCode} rows="12"></textarea>
        <div class="button-row">
          <button class="primary" on:click={runAutomation}>Skulpt 実行</button>
          <button on:click={clearAutomation}>リセット</button>
        </div>
        <label class="toggle">
          <input type="checkbox" bind:checked={autopilotLoop} />
          <span>セッション毎に自動再実行</span>
        </label>
        <div class="autopilot-status">{autopilotStatus}</div>
        {#if rotorOverrideList.length}
          <div class="prop-map">
            {#each rotorOverrideList as override}
              <span>{formatPropLabel(override.index)} → {override.rpm === null ? '解除' : `${override.rpm.toFixed(0)} rpm`}</span>
            {/each}
          </div>
        {/if}
        {#if lastAutomationCommand}
          <div class="autopilot-status">最新コマンド: t={lastAutomationCommand.time.toFixed(2)}s, thr={lastAutomationCommand.throttle ?? '—'}</div>
        {/if}
        {#if autopilotConsole}
          <pre class="console">{autopilotConsole}</pre>
        {/if}
        {#if autopilotError}
          <pre class="console console--error">{autopilotError}</pre>
        {/if}
      </div>

      <div class="sidebar-card">
        <h3>手動コントロール</h3>
        <div class="field">
          <label for="roll-setpoint">Roll Setpoint (°)</label>
          <div class="slider-row">
            <span>{setpointDeg.roll.toFixed(1)}</span>
            <input id="roll-setpoint" type="range" min="-45" max="45" step="0.5" bind:value={setpointDeg.roll} on:input={(e) => updateSetpoint('roll', parseFloat(e.currentTarget.value))} />
            <span>±45</span>
          </div>
        </div>
        <div class="field">
          <label for="pitch-setpoint">Pitch Setpoint (°)</label>
          <div class="slider-row">
            <span>{setpointDeg.pitch.toFixed(1)}</span>
            <input id="pitch-setpoint" type="range" min="-45" max="45" step="0.5" bind:value={setpointDeg.pitch} on:input={(e) => updateSetpoint('pitch', parseFloat(e.currentTarget.value))} />
            <span>±45</span>
          </div>
        </div>
        <div class="field">
          <label for="yaw-setpoint">Yaw Setpoint (°)</label>
          <div class="slider-row">
            <span>{setpointDeg.yaw.toFixed(1)}</span>
            <input id="yaw-setpoint" type="range" min="-90" max="90" step="0.5" bind:value={setpointDeg.yaw} on:input={(e) => updateSetpoint('yaw', parseFloat(e.currentTarget.value))} />
            <span>±90</span>
          </div>
        </div>
        <div class="field">
          <label for="throttle-setpoint">Throttle (0-100%)</label>
          <div class="slider-row">
            <span>{throttlePercent}</span>
            <input id="throttle-setpoint" type="range" min="0" max="1" step="0.01" bind:value={throttleCmd} on:input={(e) => updateThrottle(parseFloat(e.currentTarget.value))} />
            <span>{hoverPercent}</span>
          </div>
        </div>
        <div class="field">
          <h4>PID ゲイン</h4>
          <small class="hint">Roll調整はPitchにミラーリングされます。</small>
          <div class="slider-row">
            <span>Kp</span>
            <input type="range" min="0" max="12" step="0.1" bind:value={pid.roll.kp} on:input={(e) => changePid('roll', 'kp', parseFloat(e.currentTarget.value))} />
            <span>{pid.roll.kp.toFixed(1)}</span>
          </div>
          <div class="slider-row">
            <span>Ki</span>
            <input type="range" min="0" max="5" step="0.05" bind:value={pid.roll.ki} on:input={(e) => changePid('roll', 'ki', parseFloat(e.currentTarget.value))} />
            <span>{pid.roll.ki.toFixed(2)}</span>
          </div>
          <div class="slider-row">
            <span>Kd</span>
            <input type="range" min="0" max="6" step="0.05" bind:value={pid.roll.kd} on:input={(e) => changePid('roll', 'kd', parseFloat(e.currentTarget.value))} />
            <span>{pid.roll.kd.toFixed(2)}</span>
          </div>
        </div>
        <div class="field">
          <h4>tmp.json 機体仕様</h4>
          <pre class="json-spec">{JSON.stringify({
            frame: airframe.spec.selection.frame,
            mass_breakdown: airframe.spec.mass_breakdown,
            inertia: airframe.spec.inertia_estimates,
            propulsion: {
              diameter_m: airframe.propulsion.diameter,
              hover_rpm: airframe.propulsion.hoverRpm,
              max_rpm: propulsionLimits.maxRpm
            }
          }, null, 2)}</pre>
        </div>
      </div>
    </div>
  </div>
</main>
