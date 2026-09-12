import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { gatherBuildPlans } from "./build-plans";
import { SPECS, canPlace } from "./simulation";
import type { Entity, Game, Kind, RenderState, SceneApi, Vec3 } from "./types";

const v = (p: Vec3) => new THREE.Vector3(...p);
const UP = new THREE.Vector3(0, 1, 0);
const TEAM = [0x65e3db, 0xff7965, 0xf4c75e, 0xb893ff];

export function createScene(container: HTMLElement, initial: Game): SceneApi {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.setClearColor(0x060d18);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 1600);
  // Uniform base illumination keeps every player hemisphere readable.
  const ambient = new THREE.AmbientLight(0xc1ced0, 1.15);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffefd5, 2.3);
  sun.position.set(110, 170, 130);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc0d4df, 0.85);
  fill.position.set(-100, -50, -80);
  scene.add(fill);
  let game = initial;
  let state: RenderState = {
    selected: new Set(),
    hoveredCell: null,
    building: null,
    attackMode: false,
  };
  let distance = 143;
  const radial = v(game.world.cells[game.world.spawns[0]].dir);
  let orientation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    radial,
  );
  const raycaster = new THREE.Raycaster();
  const terrainGeo = new THREE.BufferGeometry();
  const positions: number[] = [],
    baseColors: number[] = [];
  const faceCells: number[][] = [];
  for (let i = 0; i < game.world.triangles.length; i += 3) {
    const ids = game.world.triangles.slice(i, i + 3);
    faceCells.push(ids);
    const height =
      ids.reduce((sum, id) => sum + game.world.cells[id].height, 0) / 3;
    const passable = ids.every((id) => game.world.cells[id].passable);
    const shade = new THREE.Color(passable ? 0x466958 : 0x404951);
    shade.lerp(
      new THREE.Color(passable ? 0x81886a : 0x989b93),
      Math.min(height / 16, 0.6),
    );
    shade.multiplyScalar(0.86 + ((i * 17) % 31) / 100);
    for (const id of ids) {
      positions.push(...game.world.cells[id].position);
      baseColors.push(shade.r, shade.g, shade.b);
    }
  }
  terrainGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  const colors = new Float32Array(baseColors);
  terrainGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    terrainGeo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      flatShading: true,
      side: THREE.DoubleSide,
    }),
  );
  scene.add(terrain);
  const rockCells = game.world.cells.filter(
    (cell) => !cell.passable && cell.id % 3 !== 0,
  );
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const rocks = new THREE.InstancedMesh(
    rockGeometry,
    new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }),
    rockCells.length,
  );
  const rockDummy = new THREE.Object3D();
  rockCells.forEach((cell, index) => {
    const variation = ((cell.id * 73) % 101) / 100;
    rockDummy.position
      .copy(v(cell.position))
      .addScaledVector(v(cell.dir), 0.25);
    rockDummy.quaternion.setFromUnitVectors(UP, v(cell.dir));
    rockDummy.rotateY(variation * 6.28);
    rockDummy.scale.set(
      1 + variation * 1.3,
      1 + variation * 2.2,
      0.8 + variation,
    );
    rockDummy.updateMatrix();
    rocks.setMatrixAt(index, rockDummy.matrix);
    rocks.setColorAt(index, new THREE.Color(0x535e60));
  });
  rocks.computeBoundingSphere();
  scene.add(rocks);
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(game.world.radius + 9.5, 64, 32),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      vertexShader:
        "varying vec3 n; varying vec3 eye; void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);eye=normalize(-p.xyz);gl_Position=projectionMatrix*p;}",
      fragmentShader:
        "varying vec3 n; varying vec3 eye; void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(eye))),4.);gl_FragColor=vec4(.12,.42,.55,rim*.28);}",
    }),
  );
  scene.add(atmosphere);
  const starPositions: number[] = [];
  for (let i = 0; i < 1100; i++) {
    const a = i * 2.39996,
      z = 1 - (2 * (i + 0.5)) / 1100,
      r = Math.sqrt(1 - z * z);
    starPositions.push(Math.cos(a) * r * 650, z * 650, Math.sin(a) * r * 650);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(starPositions, 3),
  );
  scene.add(
    new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0x8ba8c4,
        size: 1.0,
        transparent: true,
        opacity: 0.65,
        sizeAttenuation: false,
      }),
    ),
  );
  const nodeGeo = new THREE.OctahedronGeometry(0.65);
  const nodeMaterial = new THREE.MeshStandardMaterial({
    color: 0xe9b45e,
    emissive: 0x8d5816,
    emissiveIntensity: 0.35,
    roughness: 0.45,
  });
  const metalCells = game.world.cells.filter((cell) => cell.metal);
  const nodes = new THREE.InstancedMesh(
    nodeGeo,
    nodeMaterial,
    metalCells.length,
  );
  nodes.frustumCulled = false;
  scene.add(nodes);
  const nodeDummy = new THREE.Object3D();
  const models = new Map<string, THREE.BufferGeometry>();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.65,
    metalness: 0.2,
    flatShading: true,
  });
  function model(kind: Kind, team: number) {
    const key = kind + team;
    if (models.has(key)) return models.get(key)!;
    const parts: THREE.BufferGeometry[] = [];
    const add = (
      geometry: THREE.BufferGeometry,
      x: number,
      y: number,
      z: number,
      color: number,
      rotation = 0,
    ) => {
      geometry.rotateX(rotation);
      geometry.translate(x, y, z);
      const col = new THREE.Color(color),
        array: number[] = [];
      for (let i = 0; i < geometry.attributes.position.count; i++)
        array.push(col.r, col.g, col.b);
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(array, 3),
      );
      parts.push(geometry.toNonIndexed());
      geometry.dispose();
    };
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      c: number,
    ) => add(new THREE.BoxGeometry(w, h, d), x, y, z, c);
    const cylinder = (
      x: number,
      y: number,
      z: number,
      r: number,
      h: number,
      c: number,
    ) => add(new THREE.CylinderGeometry(r, r, h, 8), x, y, z, c);
    const dark = 0x26353d,
      steel = 0x8caaa9,
      color = TEAM[team];
    if (kind === "commander" || kind === "heavy" || kind === "constructor") {
      const s = kind === "commander" ? 1.15 : kind === "heavy" ? 1 : 0.78;
      box(-0.43, 0.48, 0, 0.48, 0.85, 0.66, dark);
      box(0.43, 0.48, 0, 0.48, 0.85, 0.66, dark);
      box(0, 1.2, 0, 1.3, 0.82, 0.72, color);
      box(0, 1.85, 0.08, 0.55, 0.4, 0.5, steel);
      box(0, 1.85, 0.35, 0.4, 0.13, 0.1, 0xb6ffff);
      box(-0.93, 1.1, 0.2, 0.4, 0.75, 0.48, steel);
      box(0.93, 1.1, 0.35, 0.4, 0.48, 1.25, dark);
      const result = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      result.scale(s, s, s);
      models.set(key, result);
      return result;
    } else if (kind === "tank" || kind === "scout") {
      box(-0.64, 0.35, 0, 0.4, 0.5, 1.65, dark);
      box(0.64, 0.35, 0, 0.4, 0.5, 1.65, dark);
      box(0, 0.55, 0, 1.05, 0.55, 1.3, steel);
      cylinder(0, 0.95, -0.1, 0.5, 0.4, color);
      box(0, 1, 0.7, 0.17, 0.17, 1.1, dark);
    } else {
      const size = kind === "factory" ? 1.9 : 1.2;
      box(0, 0.2, 0, size * 2, 0.4, size * 2, dark);
      if (kind === "factory") {
        box(-1.35, 1.2, 0, 0.65, 1.7, 3, steel);
        box(1.35, 1.2, 0, 0.65, 1.7, 3, steel);
        box(0, 2.1, -0.65, 3.4, 0.55, 1.7, color);
        box(0, 0.45, 0, 2, 0.12, 2.8, color);
        box(-1.4, 2.7, -0.9, 0.2, 0.8, 0.2, dark);
        box(1.4, 2.7, -0.9, 0.2, 0.8, 0.2, dark);
      } else if (kind === "generator") {
        cylinder(0, 1, 0, 0.8, 1.4, steel);
        cylinder(0, 1.9, 0, 0.65, 0.45, color);
        cylinder(0, 2.2, 0, 0.35, 0.25, 0xc7ffff);
        for (let i = 0; i < 4; i++)
          box(
            Math.cos((i * Math.PI) / 2),
            0.85,
            Math.sin((i * Math.PI) / 2),
            0.3,
            1.2,
            0.3,
            dark,
          );
      } else if (kind === "extractor") {
        cylinder(0, 0.65, 0, 0.8, 0.7, color);
        box(-0.6, 1.7, 0, 0.2, 1.8, 0.3, steel);
        box(0.6, 1.7, 0, 0.2, 1.8, 0.3, steel);
        box(0, 2.5, 0, 1.4, 0.25, 0.4, color);
        cylinder(0, 1.4, 0, 0.22, 1.3, dark);
      } else {
        cylinder(0, 0.85, 0, 0.6, 1.2, steel);
        box(0, 1.6, 0, 1.1, 0.55, 0.9, color);
        box(-0.25, 1.6, 0.85, 0.17, 0.18, 1.3, dark);
        box(0.25, 1.6, 0.85, 0.17, 0.18, 1.3, dark);
      }
    }
    const result = mergeGeometries(parts)!;
    parts.forEach((p) => p.dispose());
    if (kind === "scout") result.scale(0.7, 0.7, 0.7);
    models.set(key, result);
    return result;
  }
  // Keep interpolated transforms separate from batched drawable instances.
  const visuals = new Map<number, THREE.Object3D>();
  const batches = new Map<string, THREE.InstancedMesh>();
  function batch(
    geometry: THREE.BufferGeometry,
    batchMaterial: THREE.Material,
    capacity = 4096,
  ) {
    const mesh = new THREE.InstancedMesh(geometry, batchMaterial, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(),
      game.world.radius + 25,
    );
    scene.add(mesh);
    return mesh;
  }
  const ringGeo = new THREE.RingGeometry(1, 1.12, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: TEAM[0],
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const barGeometry = new THREE.PlaneGeometry(1, 1);
  const ringBatch = batch(ringGeo, ringMat),
    barBatch = batch(barGeometry, ringMat);
  const dummy = new THREE.Object3D();
  const previewMat = new THREE.MeshBasicMaterial({
    color: 0x65e3db,
    transparent: true,
    opacity: 0.45,
    wireframe: true,
  });
  const preview = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(
    ringGeo,
    previewMat,
  );
  preview.visible = false;
  scene.add(preview);
  const planBatches = new Map<string, THREE.InstancedMesh>();
  const planMaterials = [true, false].map(
    (active) =>
      new THREE.MeshBasicMaterial({
        color: active ? 0x8effdf : 0xe6c987,
        transparent: true,
        opacity: active ? 0.64 : 0.32,
        wireframe: true,
        depthWrite: false,
      }),
  );
  const planRings = planMaterials.map((mat) =>
    batch(ringGeo, mat, game.world.cells.length * 4),
  );
  const labelMaterials = new Map<number, THREE.SpriteMaterial>();
  const planLabels: THREE.Sprite[] = [];
  let buildPlanCount = 0;
  function labelMaterial(step: number) {
    let material = labelMaterials.get(step);
    if (!material) {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "rgba(6,13,24,0.8)";
      ctx.fillRect(12, 2, 104, 60);
      ctx.font = "bold 44px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String(step), 64, 34);
      const map = new THREE.CanvasTexture(canvas);
      material = new THREE.SpriteMaterial({ map, depthWrite: false });
      labelMaterials.set(step, material);
    }
    return material;
  }
  function updateBuildPlans() {
    const plans = state.overview
      ? []
      : gatherBuildPlans(game, state.localTeam ?? 0);
    buildPlanCount = plans.length;
    for (const mesh of planBatches.values()) mesh.count = 0;
    for (const mesh of planRings) mesh.count = 0;
    for (const label of planLabels) label.visible = false;
    plans.forEach((plan, index) => {
      const tint = plan.active ? 0 : 1;
      const key = `${plan.kind}:${state.localTeam ?? 0}:${tint}`;
      let mesh = planBatches.get(key);
      if (!mesh) {
        mesh = batch(
          model(plan.kind, state.localTeam ?? 0),
          planMaterials[tint],
          game.world.cells.length,
        );
        planBatches.set(key, mesh);
      }
      const cell = game.world.cells[plan.cell];
      dummy.position.copy(v(cell.position)).addScaledVector(v(cell.dir), 0.2);
      dummy.quaternion.setFromUnitVectors(UP, v(cell.dir));
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(mesh.count++, dummy.matrix);
      dummy.scale.setScalar(SPECS[plan.kind].size + 0.45);
      dummy.updateMatrix();
      planRings[tint].setMatrixAt(planRings[tint].count++, dummy.matrix);
      let label = planLabels[index];
      if (!label) {
        label = new THREE.Sprite(labelMaterial(plan.step));
        planLabels.push(label);
        scene.add(label);
      }
      label.material = labelMaterial(plan.step);
      label.position.copy(v(cell.position)).addScaledVector(v(cell.dir), 4.5);
      label.scale.set(3, 1.5, 1);
      label.visible = true;
    });
    for (const mesh of [...planBatches.values(), ...planRings])
      mesh.instanceMatrix.needsUpdate = true;
  }
  const shotGeo = new THREE.SphereGeometry(0.15, 6, 4);
  const shotBatches = TEAM.map((color) =>
    batch(shotGeo, new THREE.MeshBasicMaterial({ color })),
  );
  const explosionBatch = batch(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshBasicMaterial({ color: 0xffc36d, wireframe: true }),
  );
  const shotCells = new Map<number, [number, number]>(),
    explosionCells = new Map<number, number>();
  const pathMaterial = new THREE.LineBasicMaterial({
    color: TEAM[0],
    transparent: true,
    opacity: 0.4,
  });
  const paths = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    pathMaterial,
  );
  scene.add(paths);
  let pathSignature = "";
  let lastViewer = -1;
  let lastFog = -1,
    lastOverview: boolean | undefined;
  function updateCamera() {
    const tactical = state.overview
      ? 0
      : THREE.MathUtils.clamp((170 - distance) / 60, 0, 1);
    camera.position.copy(
      new THREE.Vector3(0, -24 * tactical, distance).applyQuaternion(
        orientation,
      ),
    );
    camera.up.copy(UP).applyQuaternion(orientation);
    camera.lookAt(
      new THREE.Vector3(0, -4 * tactical, 60 * tactical).applyQuaternion(
        orientation,
      ),
    );
    const width = container.clientWidth || innerWidth,
      height = container.clientHeight || innerHeight;
    if (state.overview)
      camera.setViewOffset(width, height, -width * 0.19, 0, width, height);
    else camera.clearViewOffset();
    camera.updateMatrixWorld();
    // Camera-relative studio lighting preserves shape across the entire globe;
    // terrain vertex colors continue to control fog-of-war darkness.
    sun.position.set(-90, 120, 180).applyQuaternion(camera.quaternion);
    fill.position.set(130, -40, 100).applyQuaternion(camera.quaternion);
  }
  function setTransform(
    object: THREE.Object3D,
    entity: Entity,
    interpolate = 0,
  ) {
    const normal = v(entity.position).normalize();
    let forward = v(entity.heading).projectOnPlane(normal);
    if (forward.lengthSq() < 0.0001)
      forward = new THREE.Vector3(0, 0, 1).projectOnPlane(normal);
    if (forward.lengthSq() < 0.0001)
      forward = new THREE.Vector3(1, 0, 0).projectOnPlane(normal);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(normal, forward).normalize();
    object.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, normal, forward),
    );
    if (interpolate > 0 && object.position.lengthSq() > 1) {
      object.position.lerp(v(entity.position), 1 - Math.exp(-interpolate * 22));
      object.position.setLength(
        Math.max(object.position.length(), v(entity.position).length()),
      );
    } else object.position.copy(v(entity.position));
  }
  function visibleEntity(entity: Entity) {
    return (
      entity.team === (state.localTeam ?? 0) ||
      Boolean(game.visible[state.localTeam ?? 0][entity.cell])
    );
  }
  function unobscured(point: THREE.Vector3) {
    const direction = point.clone().sub(camera.position);
    const len = direction.length();
    raycaster.set(camera.position, direction.normalize());
    const hit = raycaster.intersectObject(terrain, false)[0];
    return !hit || hit.distance > len - 1.5;
  }
  const api: SceneApi = {
    canvas: renderer.domElement,
    render(nextGame, nextState, _dt) {
      game = nextGame;
      state = nextState;
      if (lastOverview !== state.overview) updateCamera();
      if (
        Math.floor(game.time * 4) !== lastFog ||
        lastOverview !== state.overview ||
        lastViewer !== (state.localTeam ?? 0)
      ) {
        lastFog = Math.floor(game.time * 4);
        lastViewer = state.localTeam ?? 0;
        ringMat.color.setHex(TEAM[lastViewer]);
        pathMaterial.color.setHex(TEAM[lastViewer]);
        lastOverview = state.overview;
        faceCells.forEach((ids, face) => {
          const visible = ids.some(
              (id) => game.visible[state.localTeam ?? 0][id],
            ),
            explored = ids.some(
              (id) => game.explored[state.localTeam ?? 0][id],
            );
          const brightness =
            state.overview || visible ? 1 : explored ? 0.4 : 0.12;
          for (let k = 0; k < 9; k++)
            colors[face * 9 + k] = baseColors[face * 9 + k] * brightness;
        });
        terrainGeo.attributes.color.needsUpdate = true;
        rockCells.forEach((cell, index) => {
          const brightness =
            state.overview || game.visible[state.localTeam ?? 0][cell.id]
              ? 1
              : game.explored[state.localTeam ?? 0][cell.id]
                ? 0.4
                : 0.12;
          rocks.setColorAt(
            index,
            new THREE.Color(0x535e60).multiplyScalar(brightness),
          );
        });
        if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
        nodes.count = 0;
        for (const cell of metalCells)
          if (state.overview || game.explored[state.localTeam ?? 0][cell.id]) {
            nodeDummy.position.copy(
              v(cell.position).addScaledVector(v(cell.dir), 0.8),
            );
            nodeDummy.scale.set(0.7, 1.7, 0.7);
            nodeDummy.quaternion.setFromUnitVectors(UP, v(cell.dir));
            nodeDummy.updateMatrix();
            nodes.setMatrixAt(nodes.count++, nodeDummy.matrix);
          }
        nodes.instanceMatrix.needsUpdate = true;
      }
      for (const id of visuals.keys())
        if (!game.entities.has(id)) visuals.delete(id);
      for (const mesh of batches.values()) {
        mesh.count = 0;
        mesh.userData.entityIds = [];
      }
      for (const entity of game.entities.values()) {
        let object = visuals.get(entity.id);
        if (!object) {
          object = new THREE.Object3D();
          visuals.set(entity.id, object);
        }
        setTransform(object, entity, _dt);
        object.scale.setScalar(0.25 + 0.75 * entity.progress);
        object.updateMatrix();
        if (!visibleEntity(entity)) continue;
        const key = entity.kind + entity.team;
        let mesh = batches.get(key);
        if (!mesh) {
          mesh = batch(model(entity.kind, entity.team), material);
          mesh.userData.entityIds = [];
          batches.set(key, mesh);
        }
        mesh.userData.entityIds.push(entity.id);
        mesh.setMatrixAt(mesh.count++, object.matrix);
      }
      for (const mesh of batches.values())
        mesh.instanceMatrix.needsUpdate = true;
      ringBatch.count = 0;
      barBatch.count = 0;
      const selected = state.overview
        ? []
        : [...state.selected]
            .map((id) => game.entities.get(id))
            .filter((entity): entity is Entity =>
              Boolean(entity && entity.team === (state.localTeam ?? 0)),
            );
      for (const entity of selected) {
        const object = visuals.get(entity.id)!;
        dummy.position
          .copy(object.position)
          .addScaledVector(v(entity.position).normalize(), 0.16);
        dummy.quaternion.copy(object.quaternion);
        dummy.scale.setScalar(SPECS[entity.kind].size + 0.45);
        dummy.updateMatrix();
        ringBatch.setMatrixAt(ringBatch.count++, dummy.matrix);
        dummy.position
          .copy(object.position)
          .addScaledVector(v(entity.position).normalize(), 3.1);
        dummy.quaternion.copy(camera.quaternion);
        dummy.scale.set(
          1.8 * Math.max(0.001, Math.min(1, entity.hp / SPECS[entity.kind].hp)),
          0.13,
          1,
        );
        dummy.updateMatrix();
        barBatch.setMatrixAt(barBatch.count++, dummy.matrix);
      }
      ringBatch.instanceMatrix.needsUpdate = true;
      barBatch.instanceMatrix.needsUpdate = true;
      const signature = selected
        .map(
          (entity) =>
            entity.id +
            ":" +
            entity.cell +
            ":" +
            entity.path.join(",") +
            ":" +
            JSON.stringify(entity.orders),
        )
        .join("|");
      if (signature !== pathSignature) {
        pathSignature = signature;
        const vertices: number[] = [];
        for (const entity of selected) {
          let previous = v(
            game.world.cells[entity.cell].position,
          ).addScaledVector(v(game.world.cells[entity.cell].dir), 0.25);
          const route = [...entity.path];
          let lastCell = route.at(-1) ?? entity.cell;
          for (const order of entity.orders) {
            if (order.type !== "build") continue;
            route.push(...game.world.path(lastCell, order.cell));
            lastCell = order.cell;
          }
          for (const cellId of route) {
            const cell = game.world.cells[cellId],
              next = v(cell.position).addScaledVector(v(cell.dir), 0.25);
            vertices.push(
              previous.x,
              previous.y,
              previous.z,
              next.x,
              next.y,
              next.z,
            );
            previous = next;
          }
        }
        paths.geometry.dispose();
        paths.geometry = new THREE.BufferGeometry();
        paths.geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(vertices, 3),
        );
        paths.visible = vertices.length > 0;
      }
      updateBuildPlans();
      preview.visible =
        !state.overview &&
        Boolean(state.building && state.hoveredCell !== null);
      if (preview.visible) {
        const cell = game.world.cells[state.hoveredCell!];
        preview.geometry = model(state.building!, state.localTeam ?? 0);
        preview.position.copy(v(cell.position));
        preview.quaternion.setFromUnitVectors(UP, v(cell.dir));
        previewMat.color.set(
          canPlace(game, state.localTeam ?? 0, state.building!, cell.id).valid
            ? 0x6fffd0
            : 0xff5b59,
        );
      }
      for (const mesh of shotBatches) mesh.count = 0;
      explosionBatch.count = 0;
      const liveShots = new Set(game.shots.map((shot) => shot.id)),
        liveExplosions = new Set(
          game.explosions.map((explosion) => explosion.id),
        );
      for (const id of shotCells.keys())
        if (!liveShots.has(id)) shotCells.delete(id);
      for (const id of explosionCells.keys())
        if (!liveExplosions.has(id)) explosionCells.delete(id);
      for (const shot of game.shots) {
        let cells = shotCells.get(shot.id);
        if (!cells) {
          cells = [game.world.nearest(shot.from), game.world.nearest(shot.to)];
          shotCells.set(shot.id, cells);
        }
        if (
          !game.visible[state.localTeam ?? 0][cells[0]] &&
          !game.visible[state.localTeam ?? 0][cells[1]]
        )
          continue;
        dummy.position.lerpVectors(
          v(shot.from),
          v(shot.to),
          Math.min(1, shot.age / shot.duration),
        );
        dummy.position.addScaledVector(dummy.position.clone().normalize(), 1.4);
        dummy.quaternion.identity();
        dummy.scale.setScalar(1.5);
        dummy.updateMatrix();
        const mesh = shotBatches[shot.team];
        mesh.setMatrixAt(mesh.count++, dummy.matrix);
      }
      for (const explosion of game.explosions) {
        let cell = explosionCells.get(explosion.id);
        if (cell === undefined) {
          cell = game.world.nearest(explosion.position);
          explosionCells.set(explosion.id, cell);
        }
        if (!game.visible[state.localTeam ?? 0][cell]) continue;
        dummy.position
          .copy(v(explosion.position))
          .addScaledVector(v(explosion.position).normalize(), 1);
        dummy.quaternion.identity();
        dummy.scale.setScalar(
          explosion.size * (0.3 + explosion.age / explosion.duration),
        );
        dummy.updateMatrix();
        explosionBatch.setMatrixAt(explosionBatch.count++, dummy.matrix);
      }
      for (const mesh of shotBatches) mesh.instanceMatrix.needsUpdate = true;
      explosionBatch.instanceMatrix.needsUpdate = true;
      renderer.render(scene, camera);
    },
    pick(x, y) {
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((x - rect.left) / rect.width) * 2 - 1,
          (-(y - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const ground = raycaster.intersectObject(terrain, false)[0];
      const hits = raycaster.intersectObjects(
        [...batches.values()].filter((mesh) => mesh.count > 0),
        false,
      );
      const hit = hits.find(
        (item) => !ground || item.distance < ground.distance + 0.15,
      );
      return {
        cell: ground
          ? game.world.nearest(ground.point.toArray() as Vec3)
          : null,
        entity:
          hit && hit.instanceId !== undefined
            ? (hit.object.userData.entityIds[hit.instanceId] as number)
            : null,
      };
    },
    selectRect(x1, y1, x2, y2) {
      const rect = renderer.domElement.getBoundingClientRect(),
        result: number[] = [];
      for (const entity of game.entities.values())
        if (entity.team === (state.localTeam ?? 0)) {
          const pos = (
            visuals.get(entity.id)?.position.clone() ?? v(entity.position)
          ).addScaledVector(v(entity.position).normalize(), 1);
          const screen = pos.clone().project(camera),
            x = rect.left + ((screen.x + 1) * rect.width) / 2,
            y = rect.top + ((1 - screen.y) * rect.height) / 2;
          if (
            screen.z >= -1 &&
            screen.z <= 1 &&
            x >= Math.min(x1, x2) &&
            x <= Math.max(x1, x2) &&
            y >= Math.min(y1, y2) &&
            y <= Math.max(y1, y2) &&
            unobscured(pos)
          )
            result.push(entity.id);
        }
      return result;
    },
    orbit(dx, dy) {
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-dy * 0.004, -dx * 0.004, 0, "YXZ"),
      );
      orientation.multiply(q).normalize();
      updateCamera();
    },
    zoom(delta) {
      distance = THREE.MathUtils.clamp(
        distance * Math.exp(delta * 0.0008),
        83,
        245,
      );
      updateCamera();
    },
    focus(cell) {
      orientation = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        v(game.world.cells[cell].dir),
      );
      distance = 110;
      updateCamera();
    },
    resize() {
      const width = container.clientWidth || innerWidth,
        height = container.clientHeight || innerHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      updateCamera();
    },
    project(cell) {
      const pos = v(game.world.cells[cell].position).addScaledVector(
        v(game.world.cells[cell].dir),
        0.6,
      );
      const screen = pos.clone().project(camera),
        rect = renderer.domElement.getBoundingClientRect();
      return {
        x: rect.left + ((screen.x + 1) * rect.width) / 2,
        y: rect.top + ((1 - screen.y) * rect.height) / 2,
        visible:
          screen.z >= -1 &&
          screen.z <= 1 &&
          Math.abs(screen.x) <= 1 &&
          Math.abs(screen.y) <= 1 &&
          unobscured(pos),
      };
    },
    diagnostics() {
      return {
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        buildPlans: buildPlanCount,
      };
    },
    dispose() {
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material)
          for (const m of Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material])
            m.dispose();
      });
      labelMaterials.forEach((material) => {
        material.map?.dispose();
        material.dispose();
      });
      planMaterials.forEach((material) => material.dispose());
      models.forEach((geometry) => geometry.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  api.resize();
  updateCamera();
  return api;
}
