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
    Scene,
    ShadowGenerator,
    StandardMaterial,
    TransformNode,
    Vector3
  } from '@babylonjs/core';

  let container;
  let canvas;
  let engine;
  let scene;
  let camera;
  let droneRoot;
  let rotorNodes = [];
  let resizeObserver;
  let renderLoop;
  let beforeRenderObserver;
  let handleResize = () => {};
  let animationTime = 0;
  let renderFrameCount = 0;

  function createRoom(newScene) {
    const room = MeshBuilder.CreateBox(
      'simplified-room',
      { width: 12, height: 5, depth: 12, sideOrientation: Mesh.BACKSIDE },
      newScene
    );
    const roomMat = new StandardMaterial('simplified-room-mat', newScene);
    roomMat.diffuseColor = Color3.FromHexString('#111827');
    roomMat.emissiveColor = Color3.FromHexString('#0b1220').scale(0.25);
    roomMat.specularColor = Color3.Black();
    room.material = roomMat;
    room.position.y = 2.4;

    const ground = MeshBuilder.CreateGround('simplified-ground', { width: 10.5, height: 10.5 }, newScene);
    const groundMat = new StandardMaterial('simplified-ground-mat', newScene);
    groundMat.diffuseColor = Color3.FromHexString('#1f2937');
    groundMat.specularColor = new Color3(0.03, 0.04, 0.05);
    ground.material = groundMat;
    ground.receiveShadows = true;

    const lines = [];
    const half = 5;
    const step = 1;
    for (let i = -half; i <= half; i += step) {
      lines.push([new Vector3(i, 0.001, -half), new Vector3(i, 0.001, half)]);
      lines.push([new Vector3(-half, 0.001, i), new Vector3(half, 0.001, i)]);
    }
    const grid = MeshBuilder.CreateLineSystem('simplified-grid', { lines }, newScene);
    grid.color = new Color3(0.25, 0.45, 0.75);
    grid.alpha = 0.2;
    grid.isPickable = false;
    grid.alwaysSelectAsActiveMesh = true;
  }

  function buildDrone(newScene, shadowGen) {
    rotorNodes = [];
    droneRoot = new TransformNode('simplified-drone-root', newScene);
    droneRoot.position = new Vector3(0, 0.12, 0);

    const body = MeshBuilder.CreateBox('simplified-body', { width: 0.35, height: 0.05, depth: 0.35 }, newScene);
    const bodyMat = new StandardMaterial('simplified-body-mat', newScene);
    bodyMat.diffuseColor = Color3.FromHexString('#38bdf8');
    bodyMat.specularColor = new Color3(0.2, 0.3, 0.4);
    body.material = bodyMat;
    body.position.y = 0.12;
    body.parent = droneRoot;
    body.receiveShadows = true;
    shadowGen.addShadowCaster(body);

    const armLength = 0.32;
    const armMat = new StandardMaterial('simplified-arm-mat', newScene);
    armMat.diffuseColor = Color3.FromHexString('#0f172a');
    armMat.specularColor = new Color3(0.05, 0.06, 0.07);

    const rotorMat = new StandardMaterial('simplified-rotor-mat', newScene);
    rotorMat.diffuseColor = Color3.FromHexString('#e2e8f0');
    rotorMat.specularColor = new Color3(0.3, 0.3, 0.3);

    const offsets = [
      new Vector3(1, 0, 1),
      new Vector3(-1, 0, 1),
      new Vector3(-1, 0, -1),
      new Vector3(1, 0, -1)
    ];

    offsets.forEach((offset, index) => {
      const arm = MeshBuilder.CreateCylinder('simplified-arm', { diameter: 0.02, height: armLength }, newScene);
      arm.material = armMat;
      arm.rotation.z = Math.PI / 2;
      arm.position = new Vector3(offset.x * armLength * 0.35, 0.12, offset.z * armLength * 0.35);
      arm.parent = droneRoot;
      shadowGen.addShadowCaster(arm);

      const rotor = MeshBuilder.CreateCylinder('simplified-rotor', { diameter: 0.14, height: 0.01, tessellation: 32 }, newScene);
      rotor.material = rotorMat;
      rotor.rotation.x = Math.PI / 2;
      rotor.position = new Vector3(offset.x * armLength * 0.5, 0.15, offset.z * armLength * 0.5);
      rotor.parent = droneRoot;
      rotorNodes.push({ mesh: rotor, direction: index % 2 === 0 ? 1 : -1 });
      shadowGen.addShadowCaster(rotor);
    });
  }

  function createScene() {
    console.log('[Simplified] Creating scene');
    const newScene = new Scene(engine);
    animationTime = 0;
    newScene.useRightHandedSystem = true;
    newScene.clearColor = new Color4(0.05, 0.08, 0.15, 1);

    camera = new ArcRotateCamera('simplified-camera', -Math.PI / 4, 1.05, 4.5, new Vector3(0, 0.3, 0), newScene);
    camera.lowerRadiusLimit = 3.5;
    camera.upperRadiusLimit = 5.5;
    camera.minZ = 0.1;
    camera.maxZ = 30;
    camera.fov = (48 * Math.PI) / 180;
    camera.panningSensibility = 0;
    camera.wheelPrecision = 800;
    camera.inputs.clear();

    const hemi = new HemisphericLight('simplified-hemi', new Vector3(0, 1, 0), newScene);
    hemi.intensity = 0.6;
    hemi.groundColor = new Color3(0.08, 0.1, 0.18);

    const key = new DirectionalLight('simplified-key', new Vector3(-0.55, -1, -0.25), newScene);
    key.position = new Vector3(3.5, 4.5, -2.5);
    key.intensity = 1.1;

    const shadowGen = new ShadowGenerator(1024, key);
    shadowGen.useBlurExponentialShadowMap = true;
    shadowGen.blurKernel = 16;

    createRoom(newScene);
    buildDrone(newScene, shadowGen);

    beforeRenderObserver = newScene.onBeforeRenderObservable.add(() => {
      const dt = newScene.getEngine().getDeltaTime() * 0.001;
      if (!droneRoot) return;

      animationTime += dt;
      droneRoot.rotation.y = animationTime * 0.6;
      droneRoot.position.y = 0.12 + Math.sin(animationTime * 1.8) * 0.02;

      rotorNodes.forEach(({ mesh, direction }) => {
        mesh.rotation.y += dt * 40 * direction;
      });
    });

    return newScene;
  }

  onMount(() => {
    console.log('[Simplified] onMount - initializing engine');
    engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    scene = createScene();

    handleResize = () => {
      if (!engine) return;
      console.log('[Simplified] handleResize', {
        width: canvas?.clientWidth,
        height: canvas?.clientHeight
      });
      engine.resize();
    };

    window.addEventListener('resize', handleResize);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => handleResize());
      resizeObserver.observe(container);
    }

    renderLoop = () => {
      renderFrameCount += 1;
      if (renderFrameCount <= 5 || renderFrameCount % 120 === 0) {
        console.log('[Simplified] renderLoop tick', { frame: renderFrameCount, animationTime });
      }
      scene.render();
    };

    engine.runRenderLoop(renderLoop);
    handleResize();
  });

  onDestroy(() => {
    console.log('[Simplified] onDestroy');
    window.removeEventListener('resize', handleResize);
    resizeObserver?.disconnect();

    if (engine && renderLoop) {
      engine.stopRenderLoop(renderLoop);
    }

    if (scene && beforeRenderObserver) {
      scene.onBeforeRenderObservable.remove(beforeRenderObserver);
    }

    scene?.dispose();
    engine?.dispose();

    rotorNodes = [];
    animationTime = 0;
    engine = undefined;
    scene = undefined;
    droneRoot = undefined;
    renderFrameCount = 0;
  });
</script>

<div class="simplified-wrapper" bind:this={container}>
  <canvas class="simplified-canvas" bind:this={canvas}></canvas>
</div>

<style>
  .simplified-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100vh;
    background: radial-gradient(circle at top, #0f172a, #020617 65%);
  }

  .simplified-canvas {
    width: min(640px, 90vw);
    height: min(480px, 70vh);
    border-radius: 1.5rem;
    box-shadow: 0 35px 80px rgba(8, 12, 24, 0.5);
    background: rgba(15, 23, 42, 0.9);
  }
</style>
