// 3D view of a Built-in Studio project's room with its cabinets in place. Loaded
// lazily so three.js stays out of the main bundle. Walls between the camera and
// the room fade out (a dollhouse cutaway) so the cabinets stay in view.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Download, Eye, RotateCcw, SquareDashed } from 'lucide-react';
import type { Solid, SolidKind } from '../lib/shelving';
import { DOOR_OPACITY, SOLID_COLORS, solidGeometry } from '../lib/shelfRender';
import { WALLS, WALL_THICKNESS, wallBand, wallPieces, type CabinetBox, type Placement, type Room, type Wall } from '../lib/builtinRoom';

export interface RoomCabinet {
  id: number;
  label: string;
  solids: Solid[];
  box: CabinetBox;
  placement: Placement;
  colors?: Partial<Record<SolidKind, number>>;
}

interface Props {
  room: Room;
  cabinets: RoomCabinet[];
  label: string;
  /** File name (without extension) for a saved picture. */
  imageName: string;
}

const WALL_COLOR = 0xece7dc;
const FLOOR_COLOR = 0xc8a87e;
const GLASS_COLOR = 0x9cc7d8;
const DOOR_COLOR = 0xa77d52;
const FADED = 0.12;
const NORMALS: Record<Wall, THREE.Vector3> = {
  north: new THREE.Vector3(0, 0, -1),
  south: new THREE.Vector3(0, 0, 1),
  west: new THREE.Vector3(-1, 0, 0),
  east: new THREE.Vector3(1, 0, 0),
};

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  world: THREE.Group;
  key: THREE.DirectionalLight;
  render: () => void;
  /** Each wall's material and the fixtures (glass, doors) that hide with it. */
  walls: Map<Wall, { material: THREE.MeshStandardMaterial; fixtures: THREE.Object3D[] }>;
  cutaway: boolean;
  frameKey: string;
  userMoved: boolean;
}

export default function RoomViewer3D({ room, cabinets, label, imageName }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [error, setError] = useState('');
  const [hover, setHover] = useState('');
  const [cutaway, setCutaway] = useState(true);

  // ── One-time stage ──────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err) {
      console.error('WebGL unavailable', err);
      setError('3D needs WebGL, which this browser has turned off. The top view still shows the layout.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 10000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8f80, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    scene.add(key, key.target);
    const world = new THREE.Group();
    scene.add(world);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.495;

    let frame = 0;
    const loop = () => {
      frame = 0;
      const moving = controls.update();
      applyCutaway();
      renderer.render(scene, camera);
      if (moving) frame = requestAnimationFrame(loop);
    };
    const render = () => { if (!frame) frame = requestAnimationFrame(loop); };
    controls.addEventListener('change', render);
    controls.addEventListener('start', () => { if (stageRef.current) stageRef.current.userMoved = true; });

    // Fade walls whose outside faces the camera.
    const applyCutaway = () => {
      const stage = stageRef.current;
      if (!stage) return;
      const toCamera = camera.position.clone().sub(controls.target);
      for (const [wall, { material, fixtures }] of stage.walls) {
        const hide = stage.cutaway && toCamera.dot(NORMALS[wall]) > 0 && Math.abs(toCamera.dot(NORMALS[wall])) > toCamera.length() * 0.2;
        material.transparent = hide;
        material.opacity = hide ? FADED : 1;
        material.depthWrite = !hide;
        for (const f of fixtures) f.visible = !hide;
      }
    };

    const raycaster = new THREE.Raycaster();
    let hoverFrame = 0;
    const onMove = (e: PointerEvent) => {
      if (e.buttons || hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        const stage = stageRef.current;
        if (!stage) return;
        const rect = renderer.domElement.getBoundingClientRect();
        raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
        const hit = raycaster.intersectObjects(stage.world.children, true).find(h => h.object instanceof THREE.Mesh && h.object.visible && !(h.object.material as THREE.Material).transparent);
        let node: THREE.Object3D | null = hit?.object ?? null;
        while (node && !node.userData.cabinet) node = node.parent;
        setHover(node ? `${node.userData.cabinet as string} — ${hit!.object.name}` : '');
      });
    };
    const onLeave = () => setHover('');
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    const resize = () => {
      const { width: w, height: h } = host.getBoundingClientRect();
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      render();
    };
    stageRef.current = { renderer, scene, camera, controls, world, key, render, walls: new Map(), cutaway: true, frameKey: '', userMoved: false };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(hoverFrame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
      stageRef.current = null;
    };
  }, []);

  // ── Room and cabinets ───────────────────────────────────────────────────────
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const { world } = stage;
    disposeTree(world);
    world.clear();
    stage.walls.clear();

    const T = WALL_THICKNESS;
    const H = room.height;
    const wallMaterials = new Map<Wall, THREE.MeshStandardMaterial>();
    for (const w of WALLS) {
      if (!room.walls[w]) continue;
      const material = new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.95 });
      wallMaterials.set(w, material);
      stage.walls.set(w, { material, fixtures: [] });
    }
    const box = (rect: { x0: number; x1: number; y0: number; y1: number }, y0: number, y1: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(rect.x1 - rect.x0, y1 - y0, rect.y1 - rect.y0), material);
      mesh.position.set((rect.x0 + rect.x1) / 2, (y0 + y1) / 2, (rect.y0 + rect.y1) / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      world.add(mesh);
      return mesh;
    };

    // Floor, reaching under the walls and into closets.
    const floorMat = new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.85 });
    const floor = box({ x0: -T, x1: room.width + T, y0: -T, y1: room.depth + T }, -1, 0, floorMat);
    floor.castShadow = false;
    floor.name = 'Floor';

    for (const piece of wallPieces(room)) {
      const mesh = box(wallBand(room, piece.wall, piece.a0, piece.a1), piece.y0, piece.y1, wallMaterials.get(piece.wall)!);
      mesh.name = 'Wall';
    }

    const glassMat = new THREE.MeshStandardMaterial({ color: GLASS_COLOR, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.1, depthWrite: false });
    const doorMat = new THREE.MeshStandardMaterial({ color: DOOR_COLOR, roughness: 0.7 });
    for (const o of room.openings) {
      const entry = stage.walls.get(o.wall);
      if (!entry) continue;
      const a0 = o.offset;
      const a1 = o.offset + o.width;
      if (o.kind === 'window') {
        const pane = box(wallBand(room, o.wall, a0, a1, T * 0.55), o.sill, o.sill + o.height, glassMat);
        pane.castShadow = false;
        pane.name = 'Window';
        // Move the pane out to the middle of the wall.
        pane.position.add(NORMALS[o.wall].clone().multiplyScalar(T * 0.225));
        entry.fixtures.push(pane);
      } else if (o.kind === 'door') {
        const leaf = box(wallBand(room, o.wall, a0, a1, 1.5), 0, o.height, doorMat);
        leaf.position.add(NORMALS[o.wall].clone().multiplyScalar((T - 1.5) / 2 - 0.25));
        leaf.name = 'Door';
        entry.fixtures.push(leaf);
      } else if (o.kind === 'closet') {
        // The closet's back and sides, behind the wall, faded with it.
        const depth = o.depth ?? 24;
        const material = entry.material;
        const back = wallBand(room, o.wall, a0 - T, a1 + T, T + depth + T);
        const outer = wallBand(room, o.wall, a0 - T, a1 + T, T + depth);
        box(subtractBand(back, outer), 0, H, material).name = 'Closet wall';
        for (const a of [a0 - T, a1]) {
          const side = wallBand(room, o.wall, a, a + T, T + depth);
          const inner = wallBand(room, o.wall, a, a + T, T);
          box(subtractBand(side, inner), 0, H, material).name = 'Closet wall';
        }
        const closetFloor = box(wallBand(room, o.wall, a0, a1, T + depth), -1, 0, floorMat);
        closetFloor.castShadow = false;
      }
    }

    // Cabinets, each in its own group turned and moved to its placement.
    const materialCache = new Map<string, THREE.MeshStandardMaterial>();
    const material = (kind: SolidKind, color: number, see: boolean) => {
      const keyName = `${kind}:${color}:${see}`;
      let m = materialCache.get(keyName);
      if (!m) {
        m = new THREE.MeshStandardMaterial({
          color, roughness: 0.78, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
          ...(see ? { transparent: true, opacity: DOOR_OPACITY, depthWrite: false } : {}),
        });
        materialCache.set(keyName, m);
      }
      return m;
    };
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x15332e, transparent: true, opacity: 0.35 });
    for (const c of cabinets) {
      const outer = new THREE.Group();
      outer.userData.cabinet = c.label;
      const inner = new THREE.Group();
      inner.position.set(-(c.box.minX + c.box.maxX) / 2, 0, (c.box.minZ + c.box.maxZ) / 2);
      for (const solid of c.solids) {
        const geometry = solidGeometry(solid);
        const see = solid.kind === 'door' && !solid.opaque;
        const mesh = new THREE.Mesh(geometry, material(solid.kind, c.colors?.[solid.kind] ?? SOLID_COLORS[solid.kind], see));
        mesh.castShadow = !see;
        mesh.receiveShadow = true;
        mesh.name = solid.name;
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), edgeMaterial));
        inner.add(mesh);
      }
      outer.add(inner);
      outer.position.set(c.placement.x, 0, c.placement.y);
      outer.rotation.y = -THREE.MathUtils.degToRad(c.placement.rotation);
      world.add(outer);
    }

    const span = Math.max(room.width, room.depth, room.height) + T * 2;
    const center = new THREE.Vector3(room.width / 2, 0, room.depth / 2);
    stage.key.position.set(center.x - span * 0.4, span * 1.3, center.z + span * 0.7);
    stage.key.target.position.copy(center);
    const shadowCam = stage.key.shadow.camera;
    shadowCam.left = -span; shadowCam.right = span; shadowCam.top = span; shadowCam.bottom = -span;
    shadowCam.near = 1; shadowCam.far = span * 4;
    shadowCam.updateProjectionMatrix();

    const frameKey = `${room.width}x${room.depth}x${room.height}`;
    if (stage.frameKey !== frameKey || !stage.userMoved) {
      stage.frameKey = frameKey;
      stage.userMoved = false;
      frameRoom(stage, room, 'corner');
    }
    stage.render();
  }, [room, cabinets]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.cutaway = cutaway;
    stage.render();
  }, [cutaway]);

  const view = (kind: 'corner' | 'top') => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.userMoved = kind === 'top';
    frameRoom(stage, room, kind);
    stage.render();
  };

  const saveImage = () => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.renderer.render(stage.scene, stage.camera);
    const a = document.createElement('a');
    a.href = stage.renderer.domElement.toDataURL('image/png');
    a.download = `${imageName.replace(/[^\w\- ]+/g, '').trim() || 'room'}.png`;
    a.click();
  };

  return (
    <div className="shelf-viewer room-viewer" role="img" aria-label={`${label}. Drag to orbit, scroll or pinch to zoom.`}>
      <div ref={hostRef} className="shelf-viewer-canvas" />
      {error ? (
        <p className="shelf-viewer-status" role="status">{error}</p>
      ) : (
        <>
          <div className="room-viewer-tools">
            <button type="button" onClick={() => view('corner')} aria-label="Reset 3D view" title="Reset view">
              <RotateCcw size={16} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => view('top')} aria-label="Look down from above" title="From above">
              <Eye size={16} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setCutaway(c => !c)} aria-pressed={!cutaway} aria-label={cutaway ? 'Show every wall' : 'Fade the walls in the way'} title={cutaway ? 'Show every wall' : 'Fade walls in the way'}>
              <SquareDashed size={16} aria-hidden="true" />
            </button>
            <button type="button" onClick={saveImage} aria-label="Save a picture" title="Save picture">
              <Download size={16} aria-hidden="true" />
            </button>
          </div>
          {hover && <span className="shelf-viewer-hover" aria-hidden="true">{hover}</span>}
        </>
      )}
    </div>
  );
}

/** `outer` minus the part of it covered by `inner`, when inner shares three of its edges. */
function subtractBand(outer: { x0: number; x1: number; y0: number; y1: number }, inner: { x0: number; x1: number; y0: number; y1: number }) {
  if (inner.x0 <= outer.x0 + 1e-6 && inner.x1 >= outer.x1 - 1e-6) {
    return inner.y0 <= outer.y0 + 1e-6 ? { ...outer, y0: inner.y1 } : { ...outer, y1: inner.y0 };
  }
  return inner.x0 <= outer.x0 + 1e-6 ? { ...outer, x0: inner.x1 } : { ...outer, x1: inner.x0 };
}

function frameRoom(stage: Stage, room: Room, kind: 'corner' | 'top') {
  const { camera, controls } = stage;
  const target = new THREE.Vector3(room.width / 2, room.height * (kind === 'top' ? 0 : 0.3), room.depth / 2);
  const radius = Math.hypot(room.width, room.depth, room.height) / 2 + WALL_THICKNESS;
  const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
  const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
  const distance = (radius / Math.sin(Math.min(halfV, halfH))) * 0.95;
  // From the open (south-east) side, a little above, or straight down with north up.
  const direction = kind === 'top' ? new THREE.Vector3(0, 1, 0.0001) : new THREE.Vector3(0.55, 0.6, 1).normalize();
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.near = distance / 100;
  camera.far = distance * 20;
  camera.updateProjectionMatrix();
  controls.update();
}

function disposeTree(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse(child => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => materials.add(m));
    }
  });
  materials.forEach(m => m.dispose());
}
