<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    ArcRotateCamera,
    Color3,
    Color4,
    DirectionalLight,
    Engine,
    HemisphericLight,
    Mesh,
    MeshBuilder,
    Quaternion,
    Scene,
    SceneLoader,
    ShadowGenerator,
    StandardMaterial,
    TransformNode,
    Vector3
  } from '@babylonjs/core';
  import '@babylonjs/loaders';
  import { airframe } from '../lib/airframeData.js';

  export let actualQuat = [1, 0, 0, 0];
  export let estimatedQuat = [1, 0, 0, 0];
  export let position = [0, 0, 0];
  export let worldTime = 0;

  let container;
  let canvasEl;
  let engine;
  let scene;
  let camera;
  let droneRoot;
  let estimateRoot;
  let shadowGenerator;
  let resizeObserver;
  let renderLoop;
  let handleResize = () => {};

  const framePath = '/models/01-FRAME/JeNo3_ALL_VERSIONS_1.2.1.stl';

  function createRoom(newScene) {
    const room = MeshBuilder.CreateBox(
      'hangar-shell',
      { width: 18, height: 7, depth: 18, sideOrientation: Mesh.BACKSIDE },
      newScene
    );
    const roomMat = new StandardMaterial('hangar-shell-mat', newScene);
    roomMat.diffuseColor = Color3.FromHexString('#0b1220');
    roomMat.emissiveColor = Color3.FromHexString('#0a1120').scale(0.3);
    roomMat.specularColor = Color3.Black();
    room.material = roomMat;
    room.position.y = 3.2;

    const ground = MeshBuilder.CreateGround('hangar-ground', { width: 16, height: 16 }, newScene);
    const groundMat = new StandardMaterial('hangar-ground-mat', newScene);
    groundMat.diffuseColor = Color3.FromHexString('#1e293b');
    groundMat.specularColor = new Color3(0.02, 0.03, 0.04);
    ground.material = groundMat;
    ground.receiveShadows = true;

    const pad = MeshBuilder.CreateCylinder('launch-pad', { diameter: 1.2, height: 0.02, tessellation: 48 }, newScene);
    const padMat = new StandardMaterial('launch-pad-mat', newScene);
    padMat.diffuseColor = Color3.FromHexString('#0ea5e9');
    padMat.emissiveColor = Color3.FromHexString('#172554').scale(0.8);
    padMat.specularColor = Color3.FromHexString('#1e40af').scale(0.25);
    pad.material = padMat;
    pad.position.y = 0.01;
    pad.receiveShadows = true;

    const lines = [];
    const half = 8;
    const step = 1;
    for (let i = -half; i <= half; i += step) {
      lines.push([new Vector3(i, 0.001, -half), new Vector3(i, 0.001, half)]);
      lines.push([new Vector3(-half, 0.001, i), new Vector3(half, 0.001, i)]);
    }
    const grid = MeshBuilder.CreateLineSystem('hangar-grid', { lines }, newScene);
    grid.color = new Color3(0.2, 0.56, 0.86);
    grid.alpha = 0.18;
    grid.isPickable = false;
    grid.alwaysSelectAsActiveMesh = true;

    const axisLength = 0.5;
    const axes = [
      { name: 'axis-x', points: [Vector3.Zero(), new Vector3(axisLength, 0, 0)], color: new Color3(0.9, 0.3, 0.3) },
      { name: 'axis-y', points: [Vector3.Zero(), new Vector3(0, axisLength, 0)], color: new Color3(0.4, 0.85, 0.5) },
      { name: 'axis-z', points: [Vector3.Zero(), new Vector3(0, 0, axisLength)], color: new Color3(0.35, 0.6, 0.95) }
    ];
    axes.forEach(({ name, points, color }) => {
      const axis = MeshBuilder.CreateLines(name, { points }, newScene);
      axis.color = color;
      axis.alpha = 0.8;
      axis.isPickable = false;
      axis.alwaysSelectAsActiveMesh = true;
      axis.position.y = 0.02;
    });
  }

  function loadFrame(newScene) {
    const frameDir = framePath.substring(0, framePath.lastIndexOf('/') + 1);
    const frameFile = framePath.substring(frameDir.length);
    const scale = airframe.geometry.wheelbase / 0.18;

    const frameMaterial = new StandardMaterial('jeno-frame-mat', newScene);
    frameMaterial.diffuseColor = Color3.FromHexString('#38bdf8');
    frameMaterial.emissiveColor = Color3.FromHexString('#0f172a').scale(0.6);
    frameMaterial.specularColor = new Color3(0.25, 0.35, 0.45);
    frameMaterial.backFaceCulling = false;

    const estimateMaterial = new StandardMaterial('jeno-frame-estimate', newScene);
    estimateMaterial.diffuseColor = Color3.FromHexString('#fde68a');
    estimateMaterial.alpha = 0.55;
    estimateMaterial.wireframe = true;
    estimateMaterial.backFaceCulling = false;
    estimateMaterial.specularColor = Color3.Black();

    SceneLoader.ImportMesh(
      '',
      frameDir,
      frameFile,
      newScene,
      (meshes) => {
        meshes.forEach((mesh, index) => {
          mesh.parent = droneRoot;
          mesh.scaling = new Vector3(scale, scale, scale);
          mesh.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), Math.PI / 2);
          mesh.material = frameMaterial;
          mesh.receiveShadows = true;
          mesh.alwaysSelectAsActiveMesh = true;
          mesh.isPickable = false;
          shadowGenerator?.addShadowCaster(mesh);

          const clone = mesh.clone(`${mesh.name || 'frame'}-estimate`);
          if (clone) {
            clone.parent = estimateRoot;
            if (clone.rotationQuaternion) {
              clone.rotationQuaternion = clone.rotationQuaternion.clone();
            }
            clone.material = estimateMaterial;
            clone.receiveShadows = false;
            clone.alwaysSelectAsActiveMesh = true;
            clone.isPickable = false;
          }
        });
      }
    );
  }

  function createScene() {
    const newScene = new Scene(engine);
    newScene.useRightHandedSystem = true;
    newScene.clearColor = new Color4(0.04, 0.07, 0.13, 1);
    newScene.fogMode = Scene.FOGMODE_LINEAR;
    newScene.fogStart = 9;
    newScene.fogEnd = 22;
    newScene.fogColor = new Color3(0.05, 0.09, 0.18);

    camera = new ArcRotateCamera('hangar-camera', -Math.PI / 4, 1.05, 6.2, new Vector3(0, 0.45, 0), newScene);
    camera.lowerRadiusLimit = 4.2;
    camera.upperRadiusLimit = 7.8;
    camera.minZ = 0.1;
    camera.maxZ = 60;
    camera.fov = (45 * Math.PI) / 180;
    camera.wheelPrecision = 1000;
    camera.panningSensibility = 0;
    camera.inputs.clear();

    const hemi = new HemisphericLight('hangar-hemi', new Vector3(0, 1, 0), newScene);
    hemi.intensity = 0.4;
    hemi.groundColor = new Color3(0.06, 0.08, 0.14);

    const key = new DirectionalLight('hangar-key', new Vector3(-0.45, -1, -0.3), newScene);
    key.position = new Vector3(4.5, 6.5, -2.4);
    key.intensity = 1.25;

    shadowGenerator = new ShadowGenerator(2048, key);
    shadowGenerator.useBlurExponentialShadowMap = true;
    shadowGenerator.blurKernel = 32;

    createRoom(newScene);

    droneRoot = new TransformNode('drone-root', newScene);
    droneRoot.rotationQuaternion = Quaternion.Identity();
    droneRoot.position = new Vector3(0, 0.02, 0);

    estimateRoot = new TransformNode('estimate-root', newScene);
    estimateRoot.rotationQuaternion = Quaternion.Identity();
    estimateRoot.position = new Vector3(0, 0.02, 0);

    loadFrame(newScene);

    return newScene;
  }

  function updateTransforms() {
    if (!droneRoot) return;

    const ay = Math.max(position[2], 0) + 0.02;
    droneRoot.position.set(position[0], ay, -position[1]);
    if (droneRoot.rotationQuaternion) {
      droneRoot.rotationQuaternion.set(actualQuat[1], actualQuat[2], actualQuat[3], actualQuat[0]);
      droneRoot.rotationQuaternion.normalize();
    }

    if (estimateRoot) {
      estimateRoot.position.set(position[0], ay, -position[1]);
      if (estimateRoot.rotationQuaternion) {
        estimateRoot.rotationQuaternion.set(estimatedQuat[1], estimatedQuat[2], estimatedQuat[3], estimatedQuat[0]);
        estimateRoot.rotationQuaternion.normalize();
      }
    }
  }

  onMount(() => {
    engine = new Engine(canvasEl, true, { preserveDrawingBuffer: true, stencil: true });
    scene = createScene();

    handleResize = () => {
      if (!engine) return;
      engine.resize();
    };

    window.addEventListener('resize', handleResize);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => handleResize());
      resizeObserver.observe(container);
    }

    renderLoop = () => {
      updateTransforms();
      scene.render();
    };

    engine.runRenderLoop(renderLoop);
    handleResize();
  });

  onDestroy(() => {
    window.removeEventListener('resize', handleResize);
    resizeObserver?.disconnect();

    if (engine && renderLoop) {
      engine.stopRenderLoop(renderLoop);
    }

    scene?.dispose();
    engine?.dispose();

    engine = undefined;
    scene = undefined;
    shadowGenerator = undefined;
    droneRoot = undefined;
    estimateRoot = undefined;
  });

  $: updateTransforms();
</script>

<div class="canvas-wrapper" bind:this={container}>
  <canvas class="viewport-canvas" bind:this={canvasEl}></canvas>
  <div class="world-overlay">
    <span class="world-label">World time</span>
    <span class="world-value">{worldTime.toFixed(2)} s</span>
  </div>
</div>

<style>
  .canvas-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 420px;
    border-radius: 1.25rem;
    overflow: hidden;
    box-shadow: 0 40px 80px rgba(15, 23, 42, 0.35);
    background: radial-gradient(circle at 40% 12%, rgba(14, 165, 233, 0.18), rgba(15, 23, 42, 0.96));
  }

  .canvas-wrapper::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(circle at 50% 35%, rgba(14, 165, 233, 0.12), transparent 60%),
      linear-gradient(135deg, rgba(148, 163, 184, 0.15) 0%, rgba(14, 116, 144, 0.02) 60%, transparent 100%);
    mix-blend-mode: screen;
  }

  :global(.viewport-canvas) {
    width: 100%;
    height: 100%;
    display: block;
  }

  .world-overlay {
    position: absolute;
    top: 1rem;
    left: 1rem;
    padding: 0.5rem 0.85rem;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.72);
    color: #e2e8f0;
    font-size: 0.875rem;
    letter-spacing: 0.04em;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    box-shadow: 0 8px 20px rgba(2, 6, 23, 0.45);
    pointer-events: none;
    text-transform: uppercase;
  }

  .world-label {
    font-weight: 600;
    opacity: 0.7;
  }

  .world-value {
    font-variant-numeric: tabular-nums;
    font-size: 1rem;
    font-weight: 700;
  }

  @media (max-width: 720px) {
    .canvas-wrapper {
      min-height: 320px;
    }
  }
</style>
