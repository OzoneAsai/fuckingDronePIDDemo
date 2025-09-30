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
  Vector3,
  VertexBuffer
} from '@babylonjs/core';
import '@babylonjs/loaders';
import { airframe } from './lib/airframeData.js';

const FRAME_PATH = '/models/01-FRAME/JeNo3_ALL_VERSIONS_1.2.1.stl';

export function createHangarViewport(canvas) {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    antialias: true
  });

  let scene;
  let droneRoot;
  let estimateRoot;
  let shadowGenerator;
  let renderLoop;
  let resizeObserver;
  let actualQuat = [1, 0, 0, 0];
  let estimatedQuat = [1, 0, 0, 0];
  let position = [0, 0, 0];
  let frameGroundOffset = 0.02;

  function analyzeFrameGeometry(meshes) {
    const boundsMin = [Infinity, Infinity, Infinity];
    const boundsMax = [-Infinity, -Infinity, -Infinity];
    const radii = [];

    for (const mesh of meshes) {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!positions) continue;

      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          continue;
        }
        if (x < boundsMin[0]) boundsMin[0] = x;
        if (y < boundsMin[1]) boundsMin[1] = y;
        if (z < boundsMin[2]) boundsMin[2] = z;
        if (x > boundsMax[0]) boundsMax[0] = x;
        if (y > boundsMax[1]) boundsMax[1] = y;
        if (z > boundsMax[2]) boundsMax[2] = z;

        const radius = Math.hypot(x, y);
        if (Number.isFinite(radius)) {
          radii.push(radius);
        }
      }
    }

    radii.sort((a, b) => a - b);
    const medianRadius = radii.length ? radii[Math.floor(radii.length / 2)] : null;
    const extents = boundsMax.map((value, index) => value - boundsMin[index]);

    return {
      medianRadius,
      extents,
      boundsMin,
      boundsMax
    };
  }

  function determineStaticRotation(extents) {
    if (!extents) {
      return Quaternion.Identity();
    }
    const smallest = Math.min(...extents);
    const index = extents.findIndex((value) => value === smallest);

    switch (index) {
      case 2:
        // STL was Z-up; rotate -90° around X so Z becomes Babylon Y.
        return Quaternion.RotationAxis(Vector3.Right(), -Math.PI / 2);
      case 0:
        // X-up → rotate +90° around Z to align with Babylon Y.
        return Quaternion.RotationAxis(Vector3.Forward(), Math.PI / 2);
      case 1:
      default:
        return Quaternion.Identity();
    }
  }

  function createRoom(targetScene) {
    const room = MeshBuilder.CreateBox(
      'hangar-shell',
      { width: 18, height: 7, depth: 18, sideOrientation: Mesh.BACKSIDE },
      targetScene
    );
    const roomMat = new StandardMaterial('hangar-shell-mat', targetScene);
    roomMat.diffuseColor = Color3.FromHexString('#0b1220');
    roomMat.emissiveColor = Color3.FromHexString('#0a1120').scale(0.3);
    roomMat.specularColor = Color3.Black();
    room.material = roomMat;
    room.position.y = 3.2;

    const ground = MeshBuilder.CreateGround('hangar-ground', { width: 16, height: 16 }, targetScene);
    const groundMat = new StandardMaterial('hangar-ground-mat', targetScene);
    groundMat.diffuseColor = Color3.FromHexString('#1e293b');
    groundMat.specularColor = new Color3(0.02, 0.03, 0.04);
    ground.material = groundMat;
    ground.receiveShadows = true;

    const pad = MeshBuilder.CreateCylinder('launch-pad', { diameter: 1.2, height: 0.02, tessellation: 48 }, targetScene);
    const padMat = new StandardMaterial('launch-pad-mat', targetScene);
    padMat.diffuseColor = Color3.FromHexString('#0ea5e9');
    padMat.emissiveColor = Color3.FromHexString('#172554').scale(0.8);
    padMat.specularColor = Color3.FromHexString('#1e40af').scale(0.25);
    pad.material = padMat;
    pad.position.y = 0.01;
    pad.receiveShadows = true;

    const lines = [];
    const half = 8;
    for (let i = -half; i <= half; i += 1) {
      lines.push([new Vector3(i, 0.001, -half), new Vector3(i, 0.001, half)]);
      lines.push([new Vector3(-half, 0.001, i), new Vector3(half, 0.001, i)]);
    }
    const grid = MeshBuilder.CreateLineSystem('hangar-grid', { lines }, targetScene);
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
      const axis = MeshBuilder.CreateLines(name, { points }, targetScene);
      axis.color = color;
      axis.alpha = 0.8;
      axis.isPickable = false;
      axis.alwaysSelectAsActiveMesh = true;
      axis.position.y = 0.02;
    });
  }

  function loadFrame(targetScene) {
    const frameDir = FRAME_PATH.substring(0, FRAME_PATH.lastIndexOf('/') + 1);
    const frameFile = FRAME_PATH.substring(frameDir.length);
    let staticRotation = Quaternion.Identity();
    let scale = 0.001;
    const frameMaterial = new StandardMaterial('jeno-frame-mat', targetScene);
    frameMaterial.diffuseColor = Color3.FromHexString('#38bdf8');
    frameMaterial.emissiveColor = Color3.FromHexString('#0f172a').scale(0.6);
    frameMaterial.specularColor = new Color3(0.25, 0.35, 0.45);
    frameMaterial.backFaceCulling = false;

    const estimateMaterial = new StandardMaterial('jeno-frame-estimate', targetScene);
    estimateMaterial.diffuseColor = Color3.FromHexString('#fde68a');
    estimateMaterial.alpha = 0.55;
    estimateMaterial.wireframe = true;
    estimateMaterial.backFaceCulling = false;
    estimateMaterial.specularColor = Color3.Black();

    SceneLoader.ImportMesh('', frameDir, frameFile, targetScene, (meshes) => {
      if (!meshes || meshes.length === 0) {
        return;
      }

      const { medianRadius, extents, boundsMin } = analyzeFrameGeometry(meshes);
      staticRotation = determineStaticRotation(extents);

      if (typeof medianRadius === 'number' && medianRadius > 0) {
        scale = airframe.geometry.armOffset / medianRadius;
      } else if (extents && Number.isFinite(extents[0]) && Number.isFinite(extents[1])) {
        const planarExtent = Math.hypot(extents[0], extents[1]);
        if (planarExtent > 0) {
          scale = airframe.geometry.wheelbase / planarExtent;
        }
      } else {
        scale = 0.001;
      }

      if (Number.isFinite(boundsMin[2])) {
        const scaledGround = boundsMin[2] * scale;
        frameGroundOffset = Math.max(0.004, -scaledGround + 0.002);
      } else {
        frameGroundOffset = 0.02;
      }

      meshes?.forEach((mesh) => {
        mesh.parent = droneRoot;
        mesh.scaling = new Vector3(scale, scale, scale);
        mesh.rotationQuaternion = staticRotation.clone();
        mesh.material = frameMaterial;
        mesh.receiveShadows = true;
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        shadowGenerator?.addShadowCaster(mesh);

        const clone = mesh.clone(`${mesh.name || 'frame'}-estimate`);
        if (clone) {
          clone.parent = estimateRoot;
          clone.scaling = new Vector3(scale, scale, scale);
          clone.rotationQuaternion = staticRotation.clone();
          clone.material = estimateMaterial;
          clone.receiveShadows = false;
          clone.isPickable = false;
          clone.alwaysSelectAsActiveMesh = true;
        }
      });
    });
  }

  function createScene() {
    const targetScene = new Scene(engine);
    targetScene.useRightHandedSystem = true;
    targetScene.clearColor = new Color4(0.04, 0.07, 0.13, 1);
    targetScene.fogMode = Scene.FOGMODE_LINEAR;
    targetScene.fogStart = 9;
    targetScene.fogEnd = 22;
    targetScene.fogColor = new Color3(0.05, 0.09, 0.18);

    const camera = new ArcRotateCamera('hangar-camera', -Math.PI / 4, 1.05, 6.2, new Vector3(0, 0.45, 0), targetScene);
    camera.lowerRadiusLimit = 4.2;
    camera.upperRadiusLimit = 7.8;
    camera.minZ = 0.1;
    camera.maxZ = 60;
    camera.fov = (45 * Math.PI) / 180;
    camera.inputs.clear();

    const hemi = new HemisphericLight('hangar-hemi', new Vector3(0, 1, 0), targetScene);
    hemi.intensity = 0.4;
    hemi.groundColor = new Color3(0.06, 0.08, 0.14);

    const key = new DirectionalLight('hangar-key', new Vector3(-0.45, -1, -0.3), targetScene);
    key.position = new Vector3(4.5, 6.5, -2.4);
    key.intensity = 1.25;

    shadowGenerator = new ShadowGenerator(2048, key);
    shadowGenerator.useBlurExponentialShadowMap = true;
    shadowGenerator.blurKernel = 32;

    createRoom(targetScene);

    droneRoot = new TransformNode('drone-root', targetScene);
    droneRoot.rotationQuaternion = Quaternion.Identity();
    droneRoot.position = new Vector3(0, 0.02, 0);

    estimateRoot = new TransformNode('estimate-root', targetScene);
    estimateRoot.rotationQuaternion = Quaternion.Identity();
    estimateRoot.position = new Vector3(0, 0.02, 0);

    loadFrame(targetScene);

    return targetScene;
  }

  function updateTransforms() {
    if (!droneRoot) return;
    const y = Math.max(position[2], 0) + frameGroundOffset;
    droneRoot.position.set(position[0], y, -position[1]);
    if (droneRoot.rotationQuaternion) {
      droneRoot.rotationQuaternion.set(actualQuat[1], actualQuat[2], actualQuat[3], actualQuat[0]);
      droneRoot.rotationQuaternion.normalize();
    }
    if (estimateRoot) {
      estimateRoot.position.set(position[0], y, -position[1]);
      if (estimateRoot.rotationQuaternion) {
        estimateRoot.rotationQuaternion.set(estimatedQuat[1], estimatedQuat[2], estimatedQuat[3], estimatedQuat[0]);
        estimateRoot.rotationQuaternion.normalize();
      }
    }
  }

  scene = createScene();

  const handleResize = () => {
    if (!engine) return;
    engine.resize();
  };

  window.addEventListener('resize', handleResize);
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(canvas.parentElement ?? canvas);
  }

  renderLoop = () => {
    updateTransforms();
    scene.render();
  };

  engine.runRenderLoop(renderLoop);
  handleResize();

  return {
    update({ actualQuaternion, estimatedQuaternion, position: nextPosition } = {}) {
      if (Array.isArray(actualQuaternion) && actualQuaternion.length === 4) {
        actualQuat = [...actualQuaternion];
      }
      if (Array.isArray(estimatedQuaternion) && estimatedQuaternion.length === 4) {
        estimatedQuat = [...estimatedQuaternion];
      }
      if (Array.isArray(nextPosition) && nextPosition.length === 3) {
        position = [...nextPosition];
      }
    },
    getFrameGroundOffset() {
      return frameGroundOffset;
    },
    dispose() {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      if (engine && renderLoop) {
        engine.stopRenderLoop(renderLoop);
      }
      scene?.dispose();
      engine?.dispose();
    }
  };
}
