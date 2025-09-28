<script>
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';

  let container;
  let renderer;
  let scene;
  let camera;
  let frameId;
  let drone;

  function buildRoom(scene) {
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1e1f29, roughness: 0.8 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x12131c, roughness: 0.9 });
    const wallGeo = new THREE.PlaneGeometry(12, 4);

    const wallBack = new THREE.Mesh(wallGeo, wallMat);
    wallBack.position.set(0, 2, -6);
    wallBack.receiveShadow = true;
    scene.add(wallBack);

    const wallLeft = new THREE.Mesh(wallGeo, wallMat);
    wallLeft.rotation.y = Math.PI / 2;
    wallLeft.position.set(-6, 2, 0);
    wallLeft.receiveShadow = true;
    scene.add(wallLeft);

    const wallRight = new THREE.Mesh(wallGeo, wallMat);
    wallRight.rotation.y = -Math.PI / 2;
    wallRight.position.set(6, 2, 0);
    wallRight.receiveShadow = true;
    scene.add(wallRight);

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), wallMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 4;
    ceiling.receiveShadow = true;
    scene.add(ceiling);

    const grid = new THREE.GridHelper(12, 24, 0x303848, 0x202432);
    grid.position.y = 0.001;
    scene.add(grid);
  }

  function buildDrone() {
    const material = new THREE.MeshStandardMaterial({
      color: 0x3fb4ff,
      metalness: 0.2,
      roughness: 0.5
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.35), material);
    body.castShadow = true;
    body.position.y = 0.12;

    const armMaterial = new THREE.MeshStandardMaterial({ color: 0x161d2a, roughness: 0.7 });
    const rotorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });

    const group = new THREE.Group();
    group.add(body);

    const armLength = 0.32;
    const rotorRadius = 0.07;

    const armGeometry = new THREE.CylinderGeometry(0.01, 0.01, armLength, 16);
    const rotorGeometry = new THREE.CylinderGeometry(rotorRadius, rotorRadius, 0.01, 32);

    const offsets = [
      new THREE.Vector3(1, 0, 1),
      new THREE.Vector3(-1, 0, 1),
      new THREE.Vector3(-1, 0, -1),
      new THREE.Vector3(1, 0, -1)
    ];

    offsets.forEach((offset, index) => {
      const arm = new THREE.Mesh(armGeometry, armMaterial);
      arm.rotation.z = Math.PI / 2;
      arm.castShadow = true;
      arm.position.set(offset.x * armLength * 0.35, 0.12, offset.z * armLength * 0.35);
      group.add(arm);

      const rotor = new THREE.Mesh(rotorGeometry, rotorMaterial);
      rotor.rotation.x = Math.PI / 2;
      rotor.castShadow = true;
      rotor.position.set(offset.x * armLength * 0.5, 0.14, offset.z * armLength * 0.5);
      rotor.name = `rotor-${index}`;
      group.add(rotor);
    });

    group.position.y = 0.12;
    return group;
  }

  function init() {
    const width = container.clientWidth;
    const height = container.clientHeight;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d111f);

    const hemi = new THREE.HemisphereLight(0xf0f8ff, 0x080810, 0.6);
    scene.add(hemi);

    const spot = new THREE.SpotLight(0xffffff, 0.9, 20, Math.PI / 6, 0.45, 1.2);
    spot.position.set(3, 5, 2);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0003;
    scene.add(spot);
    scene.add(spot.target);

    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(-4, 2.5, -1.5);
    scene.add(fill);

    buildRoom(scene);

    drone = buildDrone();
    scene.add(drone);

    camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 50);
    camera.position.set(3.5, 1.8, 3.4);
    camera.lookAt(0, 0.3, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.classList.add('simplified-canvas');
    container.appendChild(renderer.domElement);

    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    const animate = (time) => {
      const t = time * 0.001;
      if (drone) {
        drone.rotation.y = t * 0.6;
        drone.position.y = 0.12 + Math.sin(t * 1.8) * 0.02;
        drone.children
          .filter((child) => child.name?.startsWith('rotor-'))
          .forEach((rotor, idx) => {
            const direction = idx % 2 === 0 ? 1 : -1;
            rotor.rotation.y = (t * 20 * direction) % (Math.PI * 2);
          });
      }
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (frameId) cancelAnimationFrame(frameId);
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss?.();
        renderer.domElement.remove();
      }
      scene?.traverse((object) => {
        if (object.isMesh) {
          object.geometry?.dispose?.();
          if (object.material?.dispose) {
            if (Array.isArray(object.material)) {
              object.material.forEach((mat) => mat.dispose());
            } else {
              object.material.dispose();
            }
          }
        }
      });
      scene = null;
      camera = null;
      renderer = null;
      drone = null;
    };
  }

  let destroy;

  onMount(() => {
    destroy = init();
  });

  onDestroy(() => {
    destroy?.();
  });
</script>

<div class="layout">
  <header>
    <h1>JeNo Simplified Hangar Preview</h1>
    <p>
      軽量版のレンダラーです。WebGLが有効な環境で床・壁・天井と簡易ドローンモデルが表示されれば、
      メインシミュレーションも実行できます。
    </p>
  </header>
  <section class="viewport" bind:this={container} aria-label="Simplified drone hangar viewport"></section>
  <aside>
    <h2>チェックリスト</h2>
    <ul>
      <li>床と壁が見えていますか？</li>
      <li>ドローンがゆっくり回転し、影が床に落ちていますか？</li>
      <li>FPSが極端に落ちる場合は、メイン版のパラメータを調整してください。</li>
    </ul>
    <p class="hint">
      正常に描画できたら <code>/index.html</code> のフル版に戻り、PID デモをお楽しみください。
    </p>
  </aside>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
    background: #070912;
    color: #f3f6ff;
  }

  .layout {
    min-height: 100vh;
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
    grid-template-rows: auto 1fr;
    gap: 1.5rem;
    padding: 1.5rem 2rem 2rem;
    box-sizing: border-box;
  }

  header {
    grid-column: 1 / -1;
    max-width: 960px;
  }

  header h1 {
    font-size: 1.75rem;
    margin: 0 0 0.5rem;
    letter-spacing: 0.02em;
  }

  header p {
    margin: 0;
    color: #c2c8dd;
    line-height: 1.5;
  }

  .viewport {
    position: relative;
    background: radial-gradient(circle at 20% 20%, #101425, #05060d 70%);
    border-radius: 1rem;
    overflow: hidden;
    min-height: 420px;
    box-shadow: 0 25px 60px rgba(4, 6, 16, 0.65);
  }

  .viewport :global(.simplified-canvas) {
    width: 100%;
    height: 100%;
    display: block;
  }

  aside {
    background: linear-gradient(160deg, rgba(22, 26, 44, 0.85), rgba(10, 12, 24, 0.95));
    border-radius: 1rem;
    padding: 1.5rem;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  aside h2 {
    margin-top: 0;
    font-size: 1.25rem;
  }

  aside ul {
    list-style: none;
    padding: 0;
    margin: 0 0 1rem;
  }

  aside li::before {
    content: '✔';
    color: #5bd4ff;
    margin-right: 0.5rem;
  }

  aside li {
    margin-bottom: 0.5rem;
    line-height: 1.4;
  }

  .hint {
    color: #90a0c0;
    font-size: 0.95rem;
  }

  code {
    font-family: 'Fira Code', 'Source Code Pro', monospace;
    background: rgba(255, 255, 255, 0.08);
    padding: 0.15rem 0.3rem;
    border-radius: 0.35rem;
  }

  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto auto;
    }

    aside {
      order: 3;
    }
  }
</style>
