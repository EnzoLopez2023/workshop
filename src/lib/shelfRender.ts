// three.js helpers shared by the interactive Shelf Builder viewer and the
// build-guide illustrations. Imported only from lazily loaded code so three.js
// stays out of the main bundle.

import * as THREE from 'three';
import type { Solid, SolidKind } from './shelving';
import type { GuideScene } from './buildGuide';

// Plywood face tones; edges get a drafting-ink outline so parts read at any angle.
export const SOLID_COLORS: Record<SolidKind, number> = {
  case: 0xd8b98c,
  shelf: 0xe3c79d,
  back: 0xc9a979,
  cleat: 0x9fbccb,
  'wall-cleat': 0x7fa3b5,
  groove: 0xc0552f,
  // Paler than fixed shelves so adjustable ones stand out; pins in dark metal.
  adjustable: 0xf7ecd8,
  pin: 0x4a5056,
  pinhole: 0x2b2118,
  frame: 0xb7895a,
  door: 0xe6cfa6,
  // Drawer units: painted-white fronts like the ALEX, plywood boxes, steel slides.
  'drawer-front': 0xf4f1ea,
  'drawer-box': 0xe3c79d,
  slide: 0x8d969c,
  foot: 0x3a3f44,
  caster: 0x2f3337,
  // Dividers and marker ribs: lighter than the boxes so they read inside them.
  insert: 0xf2dfbd,
};

/** Doors are drawn see-through so the shelves behind them stay readable. */
export const DOOR_OPACITY = 0.38;

/** Parts added in the current guide step: pencil-blue so they stand out from plywood. */
const HIGHLIGHT_COLOR = 0x6fb0d4;
const INK = 0x15332e;

export function solidGeometry(solid: Solid): THREE.BufferGeometry {
  const geometry = shapeGeometry(solid);
  if (solid.pose) {
    const [rx, ry, rz] = solid.pose.rotate ?? [0, 0, 0];
    if (rx) geometry.rotateX(rx);
    if (ry) geometry.rotateY(ry);
    if (rz) geometry.rotateZ(rz);
    const [dx, dy, dz] = solid.pose.offset ?? [0, 0, 0];
    geometry.translate(dx, dy, -dz);
  }
  return geometry;
}

function shapeGeometry(solid: Solid): THREE.BufferGeometry {
  if (solid.shape === 'box') {
    const [x0, y0, z0] = solid.min;
    const [x1, y1, z1] = solid.max;
    const geometry = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    // Depth runs back from the front edge, so flip z into three's toward-camera axis.
    geometry.translate((x0 + x1) / 2, (y0 + y1) / 2, -(z0 + z1) / 2);
    return geometry;
  }
  if (solid.shape === 'plate') {
    // Outline is already in the front (x, y) plane; extrude toward the camera, then
    // shift so it spans depth z0..z1 (three's z is the negative of depth).
    const shape = new THREE.Shape(solid.outline.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const hole of solid.holes ?? []) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: solid.z1 - solid.z0, bevelEnabled: false, curveSegments: 4 });
    geometry.translate(0, 0, -solid.z1);
    return geometry;
  }
  // Profile is (z, y); draw it in the shape's (x, y) plane, then extrude along x.
  const shape = new THREE.Shape(solid.profile.map(([z, y]) => new THREE.Vector2(z, y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: solid.x1 - solid.x0, bevelEnabled: false });
  geometry.rotateY(Math.PI / 2); // (x, y, z) → (z, y, −x): extrusion runs along +x, depth flips to −z
  geometry.translate(solid.x0, 0, 0);
  return geometry;
}

function solidCenter(solid: Solid): [number, number, number] {
  if (solid.shape === 'box') {
    return [0, 1, 2].map(i => (solid.min[i] + solid.max[i]) / 2) as [number, number, number];
  }
  if (solid.shape === 'plate') {
    const xs = solid.outline.map(p => p[0]);
    const ys = solid.outline.map(p => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, (solid.z0 + solid.z1) / 2];
  }
  const ys = solid.profile.map(p => p[1]);
  const zs = solid.profile.map(p => p[0]);
  return [(solid.x0 + solid.x1) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
}

export interface GuideRenderInput {
  solids: Solid[];
  scenes: GuideScene[];
  width: number;
  height: number;
  depth: number;
  wallMounted: boolean;
  /** CSS pixels of each image; rendered at 1.5× for print sharpness. */
  imageWidth?: number;
  imageHeight?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: { cancelled: boolean };
  /** Finish colours that replace the plywood tones for some kinds of part. */
  colors?: Partial<Record<SolidKind, number>>;
}

const VIEW_DIRECTIONS: Record<GuideScene['view'], THREE.Vector3> = {
  front: new THREE.Vector3(0.55, 0.32, 1),
  exploded: new THREE.Vector3(0.75, 0.5, 1),
  back: new THREE.Vector3(-0.65, 0.35, -1),
  panels: new THREE.Vector3(0.3, 1.25, 0.85),
  // Looking down into open drawers.
  above: new THREE.Vector3(0.35, 1.6, 0.8),
  // Close-ups of one part or assembly, from the front right and above.
  detail: new THREE.Vector3(0.95, 0.85, 1),
  // A joint up close, from the front right, looking at the end grain and the inside face.
  corner: new THREE.Vector3(0.7, 0.75, 1),
};

/** Renders each scene to a PNG data URL with a single offscreen WebGL context. */
export async function renderGuideScenes(input: GuideRenderInput): Promise<string[]> {
  const { solids, scenes, width, height, depth, wallMounted, onProgress, signal } = input;
  const imageWidth = input.imageWidth ?? 880;
  const imageHeight = input.imageHeight ?? 660;
  const byName = new Map(solids.map(s => [s.name, s]));

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1.5);
  renderer.setSize(imageWidth, imageHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const camera = new THREE.PerspectiveCamera(30, imageWidth / imageHeight, 0.5, 5000);
  const span = Math.max(width, height, depth);
  const materials = new Map<string, THREE.Material>();
  const material = (key: string, make: () => THREE.Material) => {
    let m = materials.get(key);
    if (!m) { m = make(); materials.set(key, m); }
    return m;
  };
  const surface = (color: number) => new THREE.MeshStandardMaterial({
    color, roughness: 0.78, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const edgeNormal = material('edge', () => new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.5 }));
  const edgeStrong = material('edge-strong', () => new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.9 }));
  const geometries: THREE.BufferGeometry[] = [];
  const images: string[] = [];

  try {
    for (const [index, scene] of scenes.entries()) {
      if (signal?.cancelled) break;
      const stage = new THREE.Scene();
      stage.add(new THREE.HemisphereLight(0xffffff, 0x8a9a96, 1.5));
      const key = new THREE.DirectionalLight(0xffffff, 1.6);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.bias = -0.0005;
      const shadowCam = key.shadow.camera;
      shadowCam.left = -span * 1.5; shadowCam.right = span * 1.5; shadowCam.top = span * 1.5; shadowCam.bottom = -span * 1.5;
      shadowCam.near = 1; shadowCam.far = span * 6;
      stage.add(key, key.target);

      const group = new THREE.Group();
      const exploded = scene.view === 'exploded';
      const makeMesh = (solid: Solid, highlighted: boolean, geometry: THREE.BufferGeometry) => {
        const marking = solid.kind === 'groove' || solid.kind === 'pinhole';
        const base = input.colors?.[solid.kind] ?? SOLID_COLORS[solid.kind];
        const color = marking ? SOLID_COLORS[solid.kind] : highlighted ? HIGHLIGHT_COLOR : base;
        const door = solid.kind === 'door';
        const mesh = new THREE.Mesh(geometry, material(`surface-${color}-${door ? 'door' : 'solid'}`, () => {
          const m = surface(color);
          if (door) { m.transparent = true; m.opacity = highlighted ? 0.7 : DOOR_OPACITY; m.depthWrite = false; }
          return m;
        }));
        mesh.castShadow = !marking && !door;
        mesh.receiveShadow = true;
        // Pin holes can number in the hundreds; outlines would only add noise.
        if (solid.kind !== 'pinhole') {
          const edges = new THREE.EdgesGeometry(geometry, 30);
          geometries.push(edges);
          mesh.add(new THREE.LineSegments(edges, highlighted ? edgeStrong : edgeNormal));
        }
        return mesh;
      };
      const add = (name: string, highlighted: boolean) => {
        const solid = byName.get(name);
        if (!solid) return;
        const geometry = solidGeometry(solid);
        geometries.push(geometry);
        if (exploded) {
          // Spread parts away from the centre (and the back straight out behind) so each reads on its own.
          const [cx, cy, cz] = solidCenter(solid);
          const backward = solid.kind === 'back' ? depth * 1.4 : (cz - depth / 2) * 0.6;
          geometry.translate((cx - width / 2) * 0.45, (cy - height / 2) * 0.3, -backward);
        }
        group.add(makeMesh(solid, highlighted, geometry));
      };

      if (scene.view === 'panels') {
        // Lay each panel flat with the face that gets grooves pointing up, one row per panel.
        scene.visible.forEach((name, row) => {
          const panel = byName.get(name);
          if (!panel || panel.shape !== 'box') return;
          const grooves = scene.highlight
            .map(n => byName.get(n))
            .filter((g): g is Extract<Solid, { shape: 'box' }> => !!g && g.shape === 'box' && g.on === name);
          const up = grooves.filter(g => g.face === 1).length;
          const down = grooves.filter(g => g.face === -1).length;
          const face: 1 | -1 = name === 'Right side' || down > up ? -1 : 1;
          const thickness = panel.max[0] - panel.min[0];
          const centered = new THREE.Group();
          centered.position.x = -(panel.min[0] + panel.max[0]) / 2;
          const panelGeometry = solidGeometry(panel);
          geometries.push(panelGeometry);
          centered.add(makeMesh(panel, false, panelGeometry));
          for (const g of grooves.filter(g => g.face === face)) {
            const geometry = solidGeometry(g);
            geometries.push(geometry);
            centered.add(makeMesh(g, true, geometry));
          }
          const rotated = new THREE.Group();
          rotated.rotation.z = face * Math.PI / 2; // grooved face (±x) → up (+y)
          rotated.add(centered);
          const placed = new THREE.Group();
          placed.position.set(face === 1 ? height / 2 : -height / 2, thickness / 2, -row * depth * 1.45);
          placed.add(rotated);
          group.add(placed);
        });
      } else {
        group.position.set(-width / 2, 0, depth / 2);
        scene.visible.forEach(name => add(name, false));
        scene.highlight.forEach(name => add(name, true));
      }
      stage.add(group);

      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      const groundGeometry = new THREE.PlaneGeometry(span * 8, span * 8);
      geometries.push(groundGeometry);
      const ground = new THREE.Mesh(groundGeometry, material('ground', () => new THREE.ShadowMaterial({ opacity: 0.16 })));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = exploded ? box.min.y - 0.5 : Math.min(0, box.min.y);
      ground.receiveShadow = true;
      stage.add(ground);

      if (wallMounted && scene.view === 'front') {
        const wallGeometry = new THREE.PlaneGeometry(width * 1.8, height * 1.5);
        geometries.push(wallGeometry);
        const wall = new THREE.Mesh(wallGeometry, material('wall', () => new THREE.MeshStandardMaterial({ color: 0xdfe8e5, transparent: true, opacity: 0.5 })));
        wall.position.set(0, height * 0.55, -depth / 2 - 0.02);
        wall.receiveShadow = true;
        stage.add(wall);
      }

      key.position.copy(center).add(new THREE.Vector3(-span * 0.6, span * 1.4, scene.view === 'back' ? -span : span * 1.2));
      key.target.position.copy(center);

      // Fit the bounding sphere of what's drawn in the narrower field of view.
      const radius = Math.max(size.length() / 2, 1);
      const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
      const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
      const distance = radius / Math.sin(Math.min(halfV, halfH)) * 1.02;
      camera.position.copy(center).addScaledVector(VIEW_DIRECTIONS[scene.view].clone().normalize(), distance);
      camera.near = distance / 50;
      camera.far = distance * 20;
      camera.lookAt(center);
      camera.updateProjectionMatrix();

      renderer.render(stage, camera);
      images.push(renderer.domElement.toDataURL('image/png'));
      onProgress?.(index + 1, scenes.length);
      // Yield between images so the page stays responsive. (Not requestAnimationFrame:
      // it pauses in background tabs and would stall the guide mid-way.)
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally {
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return images;
}
