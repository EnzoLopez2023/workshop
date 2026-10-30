// Interactive 3D preview for the Shelf Builder. Loaded lazily so three.js never
// weighs on the rest of Workshop. The renderer lives for the component's
// lifetime; only the part meshes are rebuilt when the design changes.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Ruler, RotateCcw, Crosshair } from 'lucide-react';
import type { Solid, SolidKind } from '../lib/shelving';
import { DOOR_OPACITY, SOLID_COLORS as COLORS, solidGeometry } from '../lib/shelfRender';

/** How the parts are drawn: solid, see-through (to show what's inside and behind), or as wire frames. */
export type ViewMode = 'shaded' | 'xray' | 'wireframe';

interface Props {
  solids: Solid[];
  mode?: ViewMode;
  width: number;
  height: number;
  depth: number;
  wallMounted: boolean;
  label: string;
  /** Finish colours that replace the plywood tones for some kinds of part. */
  colors?: Partial<Record<SolidKind, number>>;
  /** Formats a length; with it, overall width, height and depth are drawn on the model. */
  formatLength?: (inches: number) => string;
  /**
   * Where the model's box starts (model x and z), when it isn't at 0, 0 — a blind corner
   * running left, or a corner run's return reaching forward — so it's centred and framed.
   */
  origin?: [number, number];
  /** Parts to pick out (the settings being edited), by name; `highlightKey` changes when it does. */
  highlight?: (name: string) => boolean;
  highlightKey?: string;
  /** A click on a part, by its name (a drawer still slides out, a door swings open). */
  onPick?: (name: string) => void;
  /**
   * With this, the overall dimension labels are editable: click one, type a new length, press Enter.
   * `parseLength` reads what's typed (inches), returning null when it can't.
   */
  onEditDimension?: (axis: 'width' | 'height' | 'depth', inches: number) => void;
  parseLength?: (text: string) => number | null;
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
  /** Parts that slide out (drawers) or swing open (doors), by group name. */
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
  /** The measure tool: up to two picked points (scene coordinates), the line between them, and its label. */
  measurePts: THREE.Vector3[];
  measureNames?: string[];
  measureLine: THREE.Line;
  placeMeasure: (label: MeasureLabel | null) => void;
}

interface MeasureLabel { x: number; y: number; value: number; parts: [string, string] }

interface DimLabel { axis: 'width' | 'height' | 'depth'; x: number; y: number; value: number }

/** How far a drawer travels per frame, as a share of what's left — a quick ease-out. */
const SLIDE_EASE = 0.22;
const ZERO = new THREE.Vector3();

export default function ShelfViewer3D({ solids, mode = 'shaded', width, height, depth, wallMounted, label, colors, formatLength, origin, highlight, highlightKey, onPick, onEditDimension, parseLength }: Props) {
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;
  const [originX, originZ] = origin ?? [0, 0];
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [error, setError] = useState('');
  /** Which drawers are open, by group name; kept across design changes. */
  const openRef = useRef(new Set<string>());
  const [openCount, setOpenCount] = useState(0);
  const [movable, setMovable] = useState(0);
  const [moverKinds, setMoverKinds] = useState({ drawers: false, doors: false });
  const [hover, setHover] = useState('');
  const [exploded, setExploded] = useState(false);
  const [explodable, setExplodable] = useState(false);
  const [showDims, setShowDims] = useState(true);
  const [dimLabels, setDimLabels] = useState<DimLabel[] | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [measure, setMeasure] = useState<MeasureLabel | null>(null);
  const [editing, setEditing] = useState<DimLabel['axis'] | null>(null);
  const [draft, setDraft] = useState('');
  const measuringRef = useRef(false);
  measuringRef.current = measuring;

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
    // The measure tool's line, drawn over everything like the dimensions.
    const measureLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xd9531e, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    measureLine.renderOrder = 11;
    measureLine.frustumCulled = false;
    measureLine.visible = false;
    scene.add(measureLine);

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
      // Ease each drawer (sliding) and door (swinging on its hinge) toward open or shut.
      let sliding = false;
      for (const group of stageRef.current?.movers.values() ?? []) {
        const swing = group.userData.swing as number;
        const target = group.userData.open ? (swing || group.userData.travel as number) : 0;
        const now = swing ? group.rotation.y : group.position.z;
        const gap = target - now;
        const next = Math.abs(gap) > (swing ? 0.002 : 0.01) ? now + gap * SLIDE_EASE : target;
        if (next !== now) {
          if (swing) group.rotation.y = next; else group.position.z = next;
          if (next !== target) sliding = true;
        }
      }
      // And each part toward its exploded (or assembled) position.
      const stage = stageRef.current;
      for (const { mesh, offset } of stage?.explodables ?? []) {
        const target = stage!.exploded ? offset : ZERO;
        const d = mesh.position.distanceTo(target);
        if (d > 0.01) { mesh.position.lerp(target, SLIDE_EASE); sliding = true; } else if (d > 0) mesh.position.copy(target);
      }
      if (stage) { updateDims(stage); updateMeasure(stage); }
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

    // A click (not a drag to orbit) on a drawer or door opens or shuts it.
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
      if (measuringRef.current) {
        const hit = raycaster.intersectObjects(stage.parts.children, true).find(h => h.object instanceof THREE.Mesh);
        if (!hit) return;
        // Snap to the part's nearest corner when the click lands close to one.
        const box = new THREE.Box3().setFromObject(hit.object);
        let point = hit.point.clone();
        let best = 1.5;
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          const corner = new THREE.Vector3(x, y, z);
          const d = corner.distanceTo(hit.point);
          if (d < best) { best = d; point = corner; }
        }
        if (stage.measurePts.length >= 2) { stage.measurePts = []; stage.measureNames = []; }
        stage.measurePts.push(point);
        stage.measureNames = [...(stage.measureNames ?? []), hit.object.name];
        stage.render();
        return;
      }
      for (const hit of raycaster.intersectObjects(stage.parts.children, true)) {
        if (!(hit.object instanceof THREE.Mesh)) continue;
        // The nearest solid part: report it, and open or shut it if it's a drawer or door.
        pickRef.current?.(hit.object.name);
        let node: THREE.Object3D | null = hit.object;
        while (node && !node.userData.group) node = node.parent;
        if (node) toggleRef.current(node.userData.group as string);
        break;
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
      measurePts: [],
      measureLine,
      placeMeasure: label => setMeasure(prev => (prev === label || (prev && label && Math.abs(prev.x - label.x) < 0.5 && Math.abs(prev.y - label.y) < 0.5 && prev.value === label.value) ? prev : label)),
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
      mesh.userData.baseMaterial = mesh.material;
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
      if (solid.group && (solid.travel || solid.swing)) {
        let group = stage.movers.get(solid.group);
        if (!group) {
          group = new THREE.Group();
          const open = openRef.current.has(solid.group);
          group.userData = { group: solid.group, travel: solid.travel ?? 0, swing: solid.swing?.angle ?? 0, open };
          if (solid.swing) {
            // A door turns about its hinge line: the outer group sits on it, the inner one puts the parts back.
            const [px, pz] = solid.swing.pivot;
            group.position.set(px, 0, -pz);
            const inner = new THREE.Group();
            inner.position.set(-px, 0, pz);
            group.add(inner);
            group.userData.inner = inner;
            group.rotation.y = open ? solid.swing.angle : 0;
          } else {
            group.position.z = open ? solid.travel! : 0;
          }
          stage.movers.set(solid.group, group);
          parts.add(group);
        }
        ((group.userData.inner as THREE.Group | undefined) ?? group).add(mesh);
      } else {
        parts.add(mesh);
      }
    }
    // Forget drawers that no longer exist.
    for (const name of [...openRef.current]) if (!stage.movers.has(name)) openRef.current.delete(name);
    setMovable(stage.movers.size);
    const kinds = [...stage.movers.values()].map(g => (g.userData.swing ? 'door' : 'drawer'));
    setMoverKinds({ drawers: kinds.includes('drawer'), doors: kinds.includes('door') });
    setExplodable(stage.explodables.length > 0);
    setOpenCount(openRef.current.size);
    parts.position.set(-(originX + width / 2), 0, originZ + depth / 2);
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
    applyHighlight(stage);
    stage.render();
  }, [solids, width, height, depth, wallMounted, originX, originZ]);

  // The parts whose settings are being edited glow pencil-blue; the rest keep their finish.
  const highlightMaterial = useRef<THREE.MeshStandardMaterial | null>(null);
  const applyHighlight = (stage: Stage) => {
    const pick = highlightRef.current;
    if (!highlightMaterial.current) {
      highlightMaterial.current = new THREE.MeshStandardMaterial({ color: 0x6fb0d4, emissive: 0x1b4a5e, emissiveIntensity: 0.55, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    }
    stage.parts.traverse(node => {
      if (!(node instanceof THREE.Mesh) || !node.userData.baseMaterial) return;
      node.material = pick && pick(node.name) ? highlightMaterial.current! : node.userData.baseMaterial as THREE.Material;
    });
  };
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    applyHighlight(stage);
    stage.render();
    // highlightKey stands in for the highlight function.
  }, [highlightKey]);

  // View mode: the shared materials turn see-through or wire; nothing is rebuilt.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const xray = mode === 'xray';
    const set = (m: THREE.MeshStandardMaterial, seeThrough: number | null) => {
      // Wireframe hides the faces and leaves each part's edge lines.
      const opacity = mode === 'wireframe' ? 0 : xray ? Math.min(seeThrough ?? 1, 0.28) : seeThrough ?? 1;
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = opacity >= 1;
      m.needsUpdate = true;
    };
    for (const [kind, material] of Object.entries(stage.materials) as [SolidKind, THREE.MeshStandardMaterial][]) {
      set(material, kind === 'door' ? DOOR_OPACITY : null);
    }
    set(stage.solidDoor, null);
    stage.edgeMaterial.opacity = mode === 'wireframe' ? 0.95 : xray ? 0.7 : 0.55;
    stage.render();
  }, [mode, solids]);

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

  // Leaving the measure tool clears its points.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || measuring) return;
    stage.measurePts = [];
    stage.render();
  }, [measuring]);

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
                  {`${allOpen ? 'Close' : 'Open'} ${moverKinds.drawers && moverKinds.doors ? 'all' : moverKinds.doors ? 'doors' : 'drawers'}`}
                </button>
              )}
              {explodable && (
                <button type="button" onClick={toggleExploded} aria-pressed={exploded}>
                  {exploded ? 'Assemble' : 'Explode'}
                </button>
              )}
              {movable > 0 && <small>or click a {moverKinds.drawers && moverKinds.doors ? 'drawer or door' : moverKinds.doors ? 'door' : 'drawer'}</small>}
            </div>
          )}
          {formatLength && showDims && dimLabels?.map(l => {
            const letter = l.axis === 'width' ? 'W' : l.axis === 'height' ? 'H' : 'D';
            const editable = !!onEditDimension && !!parseLength && !measuring;
            if (editing === l.axis) {
              const commit = () => {
                const value = parseLength?.(draft) ?? null;
                if (value !== null && value > 0) onEditDimension?.(l.axis, value);
                setEditing(null);
              };
              return (
                <span key={l.axis} className={`shelf-viewer-dim is-${l.axis} is-editing`} style={{ left: l.x, top: l.y }}>
                  <small>{letter}</small>
                  <input
                    autoFocus
                    value={draft}
                    aria-label={`New overall ${l.axis}`}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); }}
                    onBlur={commit}
                  />
                </span>
              );
            }
            return editable ? (
              <button key={l.axis} type="button" className={`shelf-viewer-dim is-${l.axis} is-editable`} style={{ left: l.x, top: l.y }}
                title={`Click to set the overall ${l.axis}`} onClick={() => { setDraft(formatLength(l.value)); setEditing(l.axis); }}>
                <small>{letter}</small> {formatLength(l.value)}
              </button>
            ) : (
              <span key={l.axis} className={`shelf-viewer-dim is-${l.axis}`} style={{ left: l.x, top: l.y }}>
                <small>{letter}</small> {formatLength(l.value)}
              </span>
            );
          })}
          {formatLength && measuring && measure && (
            <span className="shelf-viewer-dim is-measure" style={{ left: measure.x, top: measure.y }}>
              <small>Δ</small> {formatLength(measure.value)}
            </span>
          )}
          {formatLength && (
            <button type="button" className="shelf-viewer-measure-toggle" onClick={() => setMeasuring(v => !v)} aria-pressed={measuring}
              aria-label={measuring ? 'Stop measuring' : 'Measure between two points'} title={measuring ? 'Stop measuring' : 'Measure: click two points on the model (they snap to corners)'}>
              <Crosshair size={16} aria-hidden="true" />
            </button>
          )}
          {measuring && <span className="shelf-viewer-hover" aria-hidden="true">{measure ? 'Click again to start a new measurement' : 'Click two points on the model'}</span>}
          {formatLength && (
            <button type="button" className="shelf-viewer-dims-toggle" onClick={() => setShowDims(v => !v)} aria-pressed={showDims}
              aria-label={showDims ? 'Hide dimensions' : 'Show dimensions'} title={showDims ? 'Hide dimensions' : 'Show dimensions'}>
              <Ruler size={16} aria-hidden="true" />
            </button>
          )}
          {hover && !measuring && <span className="shelf-viewer-hover" aria-hidden="true">{hover}</span>}
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


/** The measure tool: draws the line between the two picked points and places its label at the midpoint. */
function updateMeasure(stage: Stage) {
  const { measurePts: pts, measureLine, camera, renderer } = stage;
  if (pts.length === 0) {
    measureLine.visible = false;
    stage.placeMeasure(null);
    return;
  }
  const geometry = measureLine.geometry as THREE.BufferGeometry;
  geometry.setFromPoints(pts.length === 2 ? pts : [pts[0], pts[0]]);
  measureLine.visible = true;
  if (pts.length < 2) {
    stage.placeMeasure(null);
    return;
  }
  const mid = pts[0].clone().add(pts[1]).multiplyScalar(0.5).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  stage.placeMeasure(mid.z > 1 ? null : {
    x: (mid.x + 1) / 2 * rect.width, y: (1 - mid.y) / 2 * rect.height,
    value: pts[0].distanceTo(pts[1]), parts: [stage.measureNames?.[0] ?? '', stage.measureNames?.[1] ?? ''],
  });
}
