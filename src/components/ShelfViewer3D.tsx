// Interactive 3D preview for the Shelf Builder. Loaded lazily so three.js never
// weighs on the rest of Workshop. The renderer lives for the component's
// lifetime; only the part meshes are rebuilt when the design changes.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RotateCcw } from 'lucide-react';
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
  edgeMaterial: THREE.LineBasicMaterial;
  render: () => void;
  /** Overall width × height × depth currently framed. */
  envelope: [number, number, number] | null;
  /** Once the user orbits, resizes keep their angle instead of re-framing. */
  userMoved: boolean;
  /** Parts that slide out (drawers), by group name. */
  movers: Map<string, THREE.Group>;
}

/** How far a drawer travels per frame, as a share of what's left — a quick ease-out. */
const SLIDE_EASE = 0.22;

export default function ShelfViewer3D({ solids, width, height, depth, wallMounted, label, colors }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [error, setError] = useState('');
  /** Which drawers are open, by group name; kept across design changes. */
  const openRef = useRef(new Set<string>());
  const [openCount, setOpenCount] = useState(0);
  const [movable, setMovable] = useState(0);

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

    const materials = Object.fromEntries(
      Object.entries(COLORS).map(([kind, color]) => [
        kind,
        new THREE.MeshStandardMaterial({
          color, roughness: 0.78, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
          ...(kind === 'door' ? { transparent: true, opacity: DOOR_OPACITY, depthWrite: false } : {}),
        }),
      ]),
    ) as Record<SolidKind, THREE.MeshStandardMaterial>;
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
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

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
      renderer, scene, camera, controls, parts, ground, wall, key, materials, edgeMaterial, render,
      envelope: null,
      userMoved: false,
      movers: new Map(),
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      scene.traverse(child => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => m.dispose());
        }
      });
      Object.values(materials).forEach(m => m.dispose());
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
    const { parts, materials, edgeMaterial } = stage;

    parts.children.slice().forEach(child => {
      child.traverse(node => {
        if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) node.geometry.dispose();
      });
      parts.remove(child);
    });

    // Center the unit on x, floor at y = 0, front edge toward the camera (+z).
    // A drawer's parts share a group so they slide out together.
    stage.movers.clear();
    for (const solid of solids) {
      const geometry = solidGeometry(solid);
      const mesh = new THREE.Mesh(geometry, materials[solid.kind]);
      mesh.castShadow = solid.kind !== 'door';
      mesh.receiveShadow = true;
      mesh.name = solid.name;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), edgeMaterial));
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
    setOpenCount(openRef.current.size);
    parts.position.set(-width / 2, 0, depth / 2);

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
          {movable > 0 && (
            <div className="shelf-viewer-drawers" data-open={openCount}>
              <button type="button" onClick={toggleAll} aria-pressed={allOpen}>
                {allOpen ? 'Close drawers' : 'Open drawers'}
              </button>
              <small>or click a drawer</small>
            </div>
          )}
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
