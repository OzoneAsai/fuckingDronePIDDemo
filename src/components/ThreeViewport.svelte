<script>
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';
  import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
  import { airframe } from '../lib/airframeData.js';

  export let actualQuat = [1, 0, 0, 0];
  export let estimatedQuat = [1, 0, 0, 0];
  export let position = [0, 0, 0];
  export let worldTime = 0;

  let container;
  let renderer;
  let scene;
  let camera;
  let frameId;
  let resizeObserver;
  let droneGroup;
  let estimateMesh;
  let frameMesh;
  let gridHelper;
  let canvasEl;

  const size = new THREE.Vector2();
  const framePath = '/models/01-FRAME/JeNo3_ALL_VERSIONS_1.2.1.stl';

  function createScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a0f1f');
    scene.fog = new THREE.Fog('#0a0f1f', 8, 18);

    const ambient = new THREE.AmbientLight(0xbfd7ff, 0.4);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0x9ad5ff, 0x0b1220, 0.25);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(4, 6, 2);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 20;
    dir.shadow.camera.left = -6;
    dir.shadow.camera.right = 6;
    dir.shadow.camera.top = 6;
    dir.shadow.camera.bottom = -2;
    scene.add(dir);
    dir.target.position.set(0, 0, 0);
    scene.add(dir.target);

    const spot = new THREE.SpotLight(0x88b4ff, 0.45, 0, Math.PI / 5, 0.4, 1.2);
    spot.position.set(-3, 5.8, -1.5);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.camera.near = 0.5;
    spot.shadow.camera.far = 18;
    scene.add(spot);
    scene.add(spot.target);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
    camera.position.set(2.4, 1.9, 4.8);
    camera.lookAt(0, 0.4, 0);

    const roomMaterial = new THREE.MeshStandardMaterial({
      color: 0x111b31,
      roughness: 0.92,
      metalness: 0.05,
      side: THREE.BackSide
    });
    const roomMesh = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 16), roomMaterial);
    roomMesh.position.y = 3.2;
    roomMesh.receiveShadow = true;
    scene.add(roomMesh);

    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.95, metalness: 0.05 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const backWallMat = new THREE.MeshStandardMaterial({ color: 0x131c2f, roughness: 0.88, metalness: 0.1 });
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(16, 6.4), backWallMat);
    backWall.position.set(0, 3.2, -8);
    scene.add(backWall);

    const sideWallMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9, metalness: 0.08 });
    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(16, 6.4), sideWallMat);
    leftWall.position.set(-8, 3.2, 0);
    leftWall.rotation.y = Math.PI / 2;
    scene.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(16, 6.4), sideWallMat);
    rightWall.position.set(8, 3.2, 0);
    rightWall.rotation.y = -Math.PI / 2;
    scene.add(rightWall);

    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.85, metalness: 0.12 });
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), ceilingMat);
    ceiling.position.set(0, 6.4, 0);
    ceiling.rotation.x = Math.PI / 2;
    scene.add(ceiling);

    gridHelper = new THREE.GridHelper(16, 32, 0x38bdf8, 0x1f2937);
    gridHelper.material.opacity = 0.18;
    gridHelper.material.transparent = true;
    gridHelper.position.y = 0.001;
    scene.add(gridHelper);

    const padMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x172554, emissiveIntensity: 0.2, roughness: 0.4 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.01, 48), padMat);
    pad.position.y = 0.005;
    pad.receiveShadow = true;
    scene.add(pad);

    const axes = new THREE.AxesHelper(0.4);
    axes.position.y = 0.01;
    scene.add(axes);

    droneGroup = new THREE.Group();
    droneGroup.position.y = 0.02;
    droneGroup.castShadow = true;
    scene.add(droneGroup);

    const loader = new STLLoader();
    loader.load(framePath, (geometry) => {
      geometry.computeVertexNormals();
      geometry.center();
      const scale = airframe.geometry.wheelbase / 0.18; // approx scale relative to generated STL
      geometry.scale(scale, scale, scale);

      const material = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        metalness: 0.3,
        roughness: 0.6,
        emissive: 0x0f172a,
        emissiveIntensity: 0.2
      });
      frameMesh = new THREE.Mesh(geometry, material);
      frameMesh.castShadow = true;
      frameMesh.receiveShadow = true;
      frameMesh.rotation.x = Math.PI / 2;
      droneGroup.add(frameMesh);

      const cameraRig = new THREE.Group();
      cameraRig.position.set(0, -0.005, airframe.geometry.wheelbase * 0.3);

      const camBodyMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.45, roughness: 0.35 });
      const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.05), camBodyMat);
      camBody.castShadow = true;
      cameraRig.add(camBody);

      const lensMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0e7490, emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.2 });
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 32), lensMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.z = 0.04;
      lens.castShadow = true;
      cameraRig.add(lens);

      droneGroup.add(cameraRig);

      const estMaterial = new THREE.MeshBasicMaterial({ color: 0xfde68a, wireframe: true, transparent: true, opacity: 0.55 });
      estimateMesh = new THREE.Mesh(geometry.clone(), estMaterial);
      estimateMesh.rotation.x = Math.PI / 2;
      scene.add(estimateMesh);
    });
  }

  function handleResize() {
    if (!container || !renderer || !camera) return;
    const rect = container.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    size.set(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function updateTransforms() {
    if (!droneGroup) return;
    const [qx, qy, qz, qw] = [actualQuat[1], actualQuat[2], actualQuat[3], actualQuat[0]];
    droneGroup.quaternion.set(qx, qy, qz, qw);
    droneGroup.position.set(position[0], Math.max(position[2], 0) + 0.02, -position[1]);

    if (estimateMesh) {
      estimateMesh.quaternion.set(estimatedQuat[1], estimatedQuat[2], estimatedQuat[3], estimatedQuat[0]);
      estimateMesh.position.set(position[0], Math.max(position[2], 0) + 0.02, -position[1]);
    }
  }

  function animate() {
    frameId = requestAnimationFrame(animate);
    updateTransforms();
    renderer.render(scene, camera);
  }

  onMount(() => {
    renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    createScene();
    handleResize();
    window.addEventListener('resize', handleResize);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => handleResize());
      resizeObserver.observe(container);
    }
    animate();
  });

  onDestroy(() => {
    cancelAnimationFrame(frameId);
    window.removeEventListener('resize', handleResize);
    resizeObserver?.disconnect();
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer = undefined;
    }
    gridHelper = undefined;
    scene?.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((mat) => mat.dispose?.());
        } else {
          obj.material.dispose?.();
        }
      }
    });
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
