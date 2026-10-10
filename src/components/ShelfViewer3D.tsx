// Interactive 3D preview for the Shelf Builder. Loaded lazily so three.js never
// weighs on the rest of Workshop. The renderer lives for the component's
// lifetime; only the part meshes are rebuilt when the design changes.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Ruler, RotateCcw } from 'lucide-react';
import type { Solid, SolidKind } from '../lib/shelving';
import { DOOR_OPACITY, SOLID_COLORS as COLORS, solidGeometry } from '../lib/shelfRender';

interface Props {
  solids: Solid[];
  width: number;
  height: number;
  depth: number;
  wallMounted: boolean;
  label: string;
  /** Finish colours that replace the plywood tones for some kinds of part. */
  colors?: Partial<Record<SolidKind, number>>;
  /** Formats a length; with it, overall width, height and depth are drawn on the model. */
  formatLength?: (inches: number) => string;
}


interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  parts: THREE.Group;
  ground: THREE.Mesh;
  wall: THREE.Mesh;
  key: THREE.DirectionalLight;
  materials: Record<SolidKind, THREE.MeshStandardMaterial>;
  /** Finished (styled) doors: the door colour, drawn solid. */
  solidDoor: THREE.MeshStandardMaterial;
  edgeMaterial: THREE.LineBasicMaterial;
  render: () => void;
  /** Overall width × height × depth currently framed. */
  envelope: [number, number, number] | null;
  /** Once the user orbits, resizes keep their angle instead of re-framing. */
  userMoved: boolean;
  /** Parts that slide out (drawers), by group name. */
  movers: Map<string, THREE.Group>;
  /** Parts with an exploded-view offset (three.js axes). */
  explodables: { mesh: THREE.Mesh; offset: THREE.Vector3 }[];
  exploded: boolean;
  /** The design's overall box (assembled, drawers shut), in scene coordinates. */
  bounds: THREE.Box3 | null;
  /** Dimension lines along the box edges nearest the camera, redrawn as it moves. */
  dims: THREE.LineSegments;
  showDims: boolean;
  /** Where the labels go on screen, updated every frame. */
  placeLabels: (labels: DimLabel[] | null) => void;
}

interface DimLabel { axis: 'width' | 'height' | 'depth'; x: number; y: number; value: number }

/** How far a drawer travels per frame, as a share of what's left — a quick ease-out. */
const SLIDE_EASE = 0.22;
const ZERO = new THREE.Vector3();

export default function ShelfViewer3D({ solids, width, height, depth, wallMounted, label, colors, formatLength }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [error, setError] = useState('');
  /** Which drawers are open, by group name; kept across design changes. */
  const openRef = useRef(new Set<string>());
  const [openCount, setOpenCount] = useState(0);
  const [movable, setMovable] = useState(0);
  const [hover, setHover] = useState('');
  const [exploded, setExploded] = useState(false);
  const [explodable, setExplodable] = useState(false);
  const [showDims, setShowDims] = useState(true);
  const [dimLabels, setDimLabels] = useState<DimLabel[] | null>(null);

  // ── One-time stage ──────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err) {
      console.error('WebGL unavailable', err);
      setError('3D preview needs WebGL, which this browser has turned off. Use the drawing instead.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 5000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a96, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    scene.add(key, key.target);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.18 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0xdfe8e5, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    wall.receiveShadow = true;
    scene.add(wall);

    const parts = new THREE.Group();
    scene.add(parts);

    // Overall dimensions: drawn over everything, in the drawings' pencil blue.
    const dims = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x356d85, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    dims.renderOrder = 10;
    dims.frustumCulled = false;
    scene.add(dims);

    const materials = Object.fromEntries(
      Object.entries(COLORS).map(([kind, color]) => [
        kind,
        new THREE.MeshStandardMaterial({
          color, roughness: 0.78, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
          ...(kind === 'door' ? { transparent: true, opacity: DOOR_OPACITY, depthWrite: false } : {}),
        }),
      ]),
    ) as Record<SolidKind, THREE.MeshStandardMaterial>;
    // Finished doors (Shaker or with pulls) are drawn solid, like drawer fronts.
    const solidDoor = new THREE.MeshStandardMaterial({ color: COLORS.door, roughness: 0.78, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x15332e, transparent: true, opacity: 0.55 });

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.495; // stay above the floor

    // Render on demand: damping needs a few frames after each interaction.
    let frame = 0;
    const loop = () => {
      frame = 0;
      const moving = controls.update();
      // Ease each drawer toward open or shut.
      let sliding = false;
      for (const group of stageRef.current?.movers.values() ?? []) {
        const target = group.userData.open ? group.userData.travel as number : 0;
        const gap = target - group.position.z;
        if (Math.abs(gap) > 0.01) {
          group.position.z += gap * SLIDE_EASE;
          sliding = true;
        } else if (gap !== 0) {
          group.position.z = target;
        }
      }
      // And each part toward its exploded (or assembled) position.
      const stage = stageRef.current;
      for (const { mesh, offset } of stage?.explodables ?? []) {
        const target = stage!.exploded ? offset : ZERO;
        const d = mesh.position.distanceTo(target);
        if (d > 0.01) { mesh.position.lerp(target, SLIDE_EASE); sliding = true; } else if (d > 0) mesh.position.copy(target);
      }
      if (stage) updateDims(stage);
      renderer.render(scene, camera);
      if (moving || sliding) frame = requestAnimationFrame(loop);
    };
    const render = () => {
      if (!frame) frame = requestAnimationFrame(loop);
    };
    controls.addEventListener('change', render);
    controls.addEventListener('start', () => {
      if (stageRef.current) stageRef.current.userMoved = true;
    });

    // A click (not a drag to orbit) on a drawer opens or shuts it.
    const raycaster = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      const stage = stageRef.current;
      if (!start || !stage || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      for (const hit of raycaster.intersectObjects(stage.parts.children, true)) {
        let node: THREE.Object3D | null = hit.object;
        while (node && !node.userData.group) node = node.parent;
        if (node) { toggleRef.current(node.userData.group as string); break; }
        if (hit.object instanceof THREE.Mesh) break; // the nearest solid part isn't a drawer
      }
    };
    // Hovering names the part under the pointer.
    let hoverFrame = 0;
    const onMove = (e: PointerEvent) => {
      if (e.buttons || hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        const stage = stageRef.current;
        if (!stage) return;
        const rect = renderer.domElement.getBoundingClientRect();
        const pointer = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(stage.parts.children, true).find(h => h.object instanceof THREE.Mesh);
        setHover(hit ? hit.object.name : '');
      });
    };
    const onLeave = () => setHover('');
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    const resize = () => {
      const { width: w, height: h } = host.getBoundingClientRect();
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      const stage = stageRef.current;
      if (stage?.envelope && !stage.userMoved) frameCamera(stage, ...stage.envelope);
      render();
    };
    stageRef.current = {
      renderer, scene, camera, controls, parts, ground, wall, key, materials, solidDoor, edgeMaterial, render,
      envelope: null,
      userMoved: false,
      movers: new Map(),
      explodables: [],
      exploded: false,
      bounds: null,
      dims,
      showDims: true,
      placeLabels: labels => setDimLabels(prev => (sameLabels(prev, labels) ? prev : labels)),
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(hoverFrame);
      controls.dispose();
      scene.traverse(child => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => m.dispose());
        }
      });
      Object.values(materials).forEach(m => m.dispose());
      solidDoor.dispose();
      edgeMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stageRef.current = null;
    };
  }, []);

  // ── Parts ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const { parts, materials, solidDoor, edgeMaterial } = stage;

    parts.children.slice().forEach(child => {
      child.traverse(node => {
        if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) node.geometry.dispose();
      });
      parts.remove(child);
    });

    // Center the unit on x, floor at y = 0, front edge toward the camera (+z).
    // A drawer's parts share a group so they slide out together.
    stage.movers.clear();
    stage.explodables = [];
    for (const solid of solids) {
      const geometry = solidGeometry(solid);
      const opaqueDoor = solid.kind === 'door' && solid.opaque;
      const mesh = new THREE.Mesh(geometry, opaqueDoor ? solidDoor : materials[solid.kind]);
      mesh.castShadow = solid.kind !== 'door' || opaqueDoor === true;
      mesh.receiveShadow = true;
      mesh.name = solid.name;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), edgeMaterial));
      if (solid.explode) {
        // Depth runs back from the front, so it's three's −z.
        const offset = new THREE.Vector3(solid.explode[0], solid.explode[1], -solid.explode[2]);
        stage.explodables.push({ mesh, offset });
        if (stage.exploded) mesh.position.copy(offset);
      }
      if (solid.group && solid.travel) {
        let group = stage.movers.get(solid.group);
        if (!group) {
          group = new THREE.Group();
          group.userData = { group: solid.group, travel: solid.travel, open: openRef.current.has(solid.group) };
          group.position.z = group.userData.open ? solid.travel : 0;
          stage.movers.set(solid.group, group);
          parts.add(group);
        }
        group.add(mesh);
      } else {
        parts.add(mesh);
      }
    }
    // Forget drawers that no longer exist.
    for (const name of [...openRef.current]) if (!stage.movers.has(name)) openRef.current.delete(name);
    setMovable(stage.movers.size);
    setExplodable(stage.explodables.length > 0);
    setOpenCount(openRef.current.size);
    parts.position.set(-width / 2, 0, depth / 2);
    // The overall box, from the parts as built (not opened or exploded), leaving out context
    // like an existing desk.
    const bounds = new THREE.Box3();
    for (const solid of solids) {
      if (/\(existing\)/.test(solid.name) || solid.kind === 'wall-cleat') continue;
      const g = solidGeometry(solid);
      g.computeBoundingBox();
      if (g.boundingBox) bounds.union(g.boundingBox);
      g.dispose();
    }
    stage.bounds = bounds.isEmpty() ? null : bounds.translate(parts.position.clone());

    const span = Math.max(width, height, depth);
    stage.ground.scale.set(span * 4, span * 4, 1);
    stage.wall.visible = wallMounted;
    stage.wall.scale.set(width * 1.8, height * 1.6, 1);
    stage.wall.position.set(0, height * 0.55, -depth / 2 - 0.01);
    stage.key.position.set(-span * 0.6, span * 1.4, span * 1.2);
    const shadowCam = stage.key.shadow.camera;
    shadowCam.left = -span; shadowCam.right = span; shadowCam.top = span; shadowCam.bottom = -span;
    shadowCam.near = 1; shadowCam.far = span * 5;
    shadowCam.updateProjectionMatrix();

    // Re-frame only when the envelope changes, so shelf tweaks keep the user's angle.
    const previous = stage.envelope;
    if (!previous || previous[0] !== width || previous[1] !== height || previous[2] !== depth) {
      stage.envelope = [width, height, depth];
      stage.userMoved = false;
      frameCamera(stage, width, height, depth);
    }
    stage.render();
  }, [solids, width, height, depth, wallMounted]);

  // Finish colours only recolour the shared materials; nothing is rebuilt.
  const colorKey = JSON.stringify(colors ?? {});
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    for (const [kind, material] of Object.entries(stage.materials) as [SolidKind, THREE.MeshStandardMaterial][]) {
      material.color.setHex(colors?.[kind] ?? COLORS[kind]);
    }
    stage.solidDoor.color.setHex(colors?.door ?? COLORS.door);
    stage.render();
    // colorKey stands in for the colours object.
  }, [colorKey]);

  const setOpen = (names: string[], open: boolean) => {
    const stage = stageRef.current;
    if (!stage) return;
    for (const name of names) {
      const group = stage.movers.get(name);
      if (!group) continue;
      group.userData.open = open;
      if (open) openRef.current.add(name); else openRef.current.delete(name);
    }
    setOpenCount(openRef.current.size);
    stage.render();
  };
  const toggleRef = useRef((name: string) => setOpen([name], !openRef.current.has(name)));
  toggleRef.current = (name: string) => setOpen([name], !openRef.current.has(name));
  const allOpen = movable > 0 && openCount === movable;
  const toggleAll = () => setOpen([...(stageRef.current?.movers.keys() ?? [])], !allOpen);
  // Exploding opens every drawer so its parts have room to spread.
  const toggleExploded = () => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.exploded = !stage.exploded;
    setExploded(stage.exploded);
    if (stage.exploded) setOpen([...stage.movers.keys()], true);
    else stage.render();
  };

  // Dimensions on or off.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.showDims = showDims && !!formatLength;
    stage.render();
  }, [showDims, formatLength]);

  const resetView = () => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.userMoved = false;
    frameCamera(stage, width, height, depth);
    stage.render();
  };

  return (
    <div className="shelf-viewer" role="img" aria-label={`${label}. Drag to orbit, scroll or pinch to zoom.`}>
      <div ref={hostRef} className="shelf-viewer-canvas" />
      {error ? (
        <p className="shelf-viewer-status" role="status">{error}</p>
      ) : (
        <>
          <button type="button" className="shelf-viewer-reset" onClick={resetView} aria-label="Reset 3D view" title="Reset view">
            <RotateCcw size={16} aria-hidden="true" />
          </button>
          {(movable > 0 || explodable) && (
            <div className="shelf-viewer-drawers" data-open={openCount}>
              {movable > 0 && (
                <button type="button" onClick={toggleAll} aria-pressed={allOpen}>
                  {allOpen ? 'Close drawers' : 'Open drawers'}
                </button>
              )}
              {explodable && (
                <button type="button" onClick={toggleExploded} aria-pressed={exploded}>
                  {exploded ? 'Assemble' : 'Explode'}
                </button>
              )}
              {movable > 0 && <small>or click a drawer</small>}
            </div>
          )}
          {formatLength && showDims && dimLabels?.map(l => (
            <span key={l.axis} className={`shelf-viewer-dim is-${l.axis}`} style={{ left: l.x, top: l.y }}>
              <small>{l.axis === 'width' ? 'W' : l.axis === 'height' ? 'H' : 'D'}</small> {formatLength(l.value)}
            </span>
          ))}
          {formatLength && (
            <button type="button" className="shelf-viewer-dims-toggle" onClick={() => setShowDims(v => !v)} aria-pressed={showDims}
              aria-label={showDims ? 'Hide dimensions' : 'Show dimensions'} title={showDims ? 'Hide dimensions' : 'Show dimensions'}>
              <Ruler size={16} aria-hidden="true" />
            </button>
          )}
          {hover && <span className="shelf-viewer-hover" aria-hidden="true">{hover}</span>}
        </>
      )}
    </div>
  );
}


function frameCamera(stage: Stage, width: number, height: number, depth: number) {
  const { camera, controls } = stage;
  const radius = Math.hypot(width, height, depth) / 2;
  // Fit the bounding sphere in whichever field of view is narrower (phones are tall).
  const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
  const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
  const distance = radius / Math.sin(Math.min(halfV, halfH)) * 1.02;
  const target = new THREE.Vector3(0, height / 2, 0);
  // Three-quarter view from the front-right, slightly above, like a showroom photo.
  const direction = new THREE.Vector3(0.55, 0.32, 1).normalize();
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.near = distance / 50;
  camera.far = distance * 20;
  camera.updateProjectionMatrix();
  controls.update();
}

const sameLabels = (a: DimLabel[] | null, b: DimLabel[] | null) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((l, i) => l.axis === b[i].axis && Math.abs(l.x - b[i].x) < 0.5 && Math.abs(l.y - b[i].y) < 0.5 && l.value === b[i].value));

/**
 * Overall width, height and depth as dimension lines on the box edges nearest the camera
 * (so they never hide behind the model), with ticks at the ends, and the labels placed
 * at their midpoints on screen. Called every frame the view changes.
 */
function updateDims(stage: Stage) {
  const { dims, bounds: b, camera, renderer } = stage;
  if (!stage.showDims || !b) {
    dims.visible = false;
    stage.placeLabels(null);
    return;
  }
  dims.visible = true;
  const c = camera.position;
  const center = b.getCenter(new THREE.Vector3());
  const size = b.getSize(new THREE.Vector3());
  const o = Math.max(size.x, size.y, size.z) * 0.06; // offset out from the model
  const t = o * 0.35; // tick length
  const sx = c.x >= center.x ? 1 : -1;
  const sz = c.z >= center.z ? 1 : -1;
  const xNear = sx > 0 ? b.max.x : b.min.x;
  const zNear = sz > 0 ? b.max.z : b.min.z;
  const zFar = sz > 0 ? b.min.z : b.max.z;
  const y0 = b.min.y + 0.05;
  const segs: number[] = [];
  const line = (a: THREE.Vector3, d: THREE.Vector3) => segs.push(a.x, a.y, a.z, d.x, d.y, d.z);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Width: along the floor, in front of the near face.
  const zw = zNear + sz * o;
  line(v(b.min.x, y0, zw), v(b.max.x, y0, zw));
  for (const x of [b.min.x, b.max.x]) line(v(x, y0, zNear), v(x, y0, zw + sz * t));
  // Depth: along the floor, beside the near side.
  const xd = xNear + sx * o;
  line(v(xd, y0, b.min.z), v(xd, y0, b.max.z));
  for (const z of [b.min.z, b.max.z]) line(v(xNear, y0, z), v(xd + sx * t, y0, z));
  // Height: up the back corner of the near side, out beside it.
  const xh = xNear + sx * o;
  line(v(xh, b.min.y, zFar), v(xh, b.max.y, zFar));
  for (const y of [b.min.y, b.max.y]) line(v(xNear, y, zFar), v(xh + sx * t, y, zFar));
  const geometry = dims.geometry as THREE.BufferGeometry;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
  geometry.computeBoundingSphere();

  const rect = renderer.domElement.getBoundingClientRect();
  const place = (p: THREE.Vector3) => {
    const q = p.clone().project(camera);
    return q.z > 1 ? null : { x: (q.x + 1) / 2 * rect.width, y: (1 - q.y) / 2 * rect.height };
  };
  const labels: DimLabel[] = [];
  const add = (axis: DimLabel['axis'], at: THREE.Vector3, value: number) => {
    const p = place(at);
    if (p) labels.push({ axis, ...p, value });
  };
  add('width', v(center.x, y0, zw), size.x);
  add('depth', v(xd, y0, center.z), size.z);
  add('height', v(xh, center.y, zFar), size.y);
  stage.placeLabels(labels);
}

