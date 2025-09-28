<script>
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';
  import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
  import { airframe } from '../lib/airframeData.js';

  export let actualQuat = [1, 0, 0, 0];
  export let estimatedQuat = [1, 0, 0, 0];
  export let position = [0, 0, 0];

  let container;
  let renderer;
  let scene;
  let camera;
  let frameId;
  let droneGroup;
  let estimateMesh;
  let frameMesh;
  let gridHelper;

  const size = new THREE.Vector2();
  const framePath = '/models/01-FRAME/JeNo3_ALL_VERSIONS_1.2.1.stl';

  function createScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#0f172a');
    scene.fog = new THREE.Fog('#0f172a', 6, 14);

    const ambient = new THREE.AmbientLight(0xbfd7ff, 0.55);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0x9ad5ff, 0x0b1220, 0.32);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(4, 6, 4);
    dir.castShadow = true;
    scene.add(dir);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
    camera.position.set(3.5, 2.8, 3.2);
    camera.lookAt(0, 0.25, 0);

    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.95, metalness: 0.05 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

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

      const estMaterial = new THREE.MeshBasicMaterial({ color: 0xfde68a, wireframe: true, transparent: true, opacity: 0.55 });
      estimateMesh = new THREE.Mesh(geometry.clone(), estMaterial);
      estimateMesh.rotation.x = Math.PI / 2;
      scene.add(estimateMesh);
    });
  }

  function handleResize() {
    if (!container || !renderer || !camera) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    size.set(rect.width, rect.height);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height, false);
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
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.classList.add('viewport-canvas');
    container.appendChild(renderer.domElement);

    createScene();
    handleResize();
    window.addEventListener('resize', handleResize);
    animate();
  });

  onDestroy(() => {
    cancelAnimationFrame(frameId);
    window.removeEventListener('resize', handleResize);
    if (renderer) {
      renderer.dispose();
      renderer.domElement?.remove();
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

<div class="canvas-wrapper" bind:this={container}></div>

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

  @media (max-width: 720px) {
    .canvas-wrapper {
      min-height: 320px;
    }
  }
</style>
