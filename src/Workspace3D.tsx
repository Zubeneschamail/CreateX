import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  ConstructionPlane,
  DEFAULT_GEOMETRY_COLOR,
  getEdgeById,
  getFaceById,
  getPointById,
  getSolidById,
  InteractionTool,
  SceneModel,
  ShapeDraft,
  ShapeTool,
  SelectionTarget,
  targetEquals,
  Vec3Tuple,
} from "./model";
import { isPrimaryModifier } from "./shortcuts";

type WorkspaceProps = {
  boxSelectShortcutLabel: string;
  constructionPlane: ConstructionPlane;
  constructionPlaneOffset: number;
  facesOnly: boolean;
  hoveredTarget: SelectionTarget | null;
  interactionTool: InteractionTool;
  model: SceneModel;
  onBoxSelectPoints: (pointIds: string[]) => void;
  onClearSelection: () => void;
  onCreatePoint: (position: Vec3Tuple) => void;
  onCreateShape: (shape: ShapeDraft) => void;
  onHoverTarget: (target: SelectionTarget | null) => void;
  onSelectTarget: (target: SelectionTarget) => void;
  onTranslateSelectionCancel: () => void;
  onTranslateSelectionEnd: (delta: Vec3Tuple) => void;
  onTranslateSelectionMove: (delta: Vec3Tuple) => void;
  onTranslateSelectionStart: () => boolean;
  selectedEdgeIds: string[];
  selectedFaceIds: string[];
  selectedPointIds: string[];
  selectedTranslationPointIds: string[];
  selectedTarget: SelectionTarget | null;
  shapeTool: ShapeTool;
};

type ThreeHandles = {
  axes: THREE.AxesHelper;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  edgesGroup: THREE.Group;
  facesGroup: THREE.Group;
  frameId: number;
  grid: THREE.GridHelper;
  gridPlane: THREE.Plane;
  planeGrid: THREE.GridHelper;
  pointsGroup: THREE.Group;
  previewGroup: THREE.Group;
  raycaster: THREE.Raycaster;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
};

const POINT_RADIUS = 0.075;
const POINT_VISIBLE_RADIUS = POINT_RADIUS / 2;
const EDGE_RADIUS = 0.025;
const EDGE_VISIBLE_RADIUS = EDGE_RADIUS / 2;
const EDGE_PICK_RADIUS = 0.12;
const BASE_POINT_COLOR = DEFAULT_GEOMETRY_COLOR;
const SELECTED_COLOR = "#f97316";
const HOVER_COLOR = "#38bdf8";
const BUILD_COLOR = "#eab308";
const SHAPE_PREVIEW_COLOR = "#f97316";
const SHAPE_PREVIEW_SEGMENTS = 80;

type SelectionBox = {
  height: number;
  left: number;
  top: number;
  width: number;
};

const PLANE_SETTINGS: Record<
  ConstructionPlane,
  {
    normal: THREE.Vector3;
    rotation: THREE.Euler;
    helperPosition: (offset: number) => THREE.Vector3;
  }
> = {
  xz: {
    helperPosition: (offset) => new THREE.Vector3(0, offset + 0.006, 0),
    normal: new THREE.Vector3(0, 1, 0),
    rotation: new THREE.Euler(0, 0, 0),
  },
  xy: {
    helperPosition: (offset) => new THREE.Vector3(0, 0, offset + 0.006),
    normal: new THREE.Vector3(0, 0, 1),
    rotation: new THREE.Euler(Math.PI / 2, 0, 0),
  },
  yz: {
    helperPosition: (offset) => new THREE.Vector3(offset + 0.006, 0, 0),
    normal: new THREE.Vector3(1, 0, 0),
    rotation: new THREE.Euler(0, 0, -Math.PI / 2),
  },
};

const applyConstructionPlane = (
  handles: Pick<ThreeHandles, "gridPlane" | "planeGrid">,
  plane: ConstructionPlane,
  offset: number,
) => {
  const settings = PLANE_SETTINGS[plane];
  handles.gridPlane.set(settings.normal, -offset);
  handles.planeGrid.rotation.copy(settings.rotation);
  handles.planeGrid.position.copy(settings.helperPosition(offset));
};

const pointerToNdc = (
  event: PointerEvent,
  element: HTMLElement,
  target = new THREE.Vector2(),
) => {
  const rect = element.getBoundingClientRect();
  target.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  target.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  return target;
};

const makeSelectionBox = (
  root: HTMLElement,
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): SelectionBox => {
  const rootRect = root.getBoundingClientRect();
  const clampedStartX = Math.min(Math.max(startX, rootRect.left), rootRect.right);
  const clampedStartY = Math.min(Math.max(startY, rootRect.top), rootRect.bottom);
  const clampedCurrentX = Math.min(
    Math.max(currentX, rootRect.left),
    rootRect.right,
  );
  const clampedCurrentY = Math.min(
    Math.max(currentY, rootRect.top),
    rootRect.bottom,
  );

  return {
    height: Math.abs(clampedCurrentY - clampedStartY),
    left: Math.min(clampedStartX, clampedCurrentX) - rootRect.left,
    top: Math.min(clampedStartY, clampedCurrentY) - rootRect.top,
    width: Math.abs(clampedCurrentX - clampedStartX),
  };
};

const disposeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    const maybeMesh = child as THREE.Mesh;

    if (maybeMesh.geometry) {
      maybeMesh.geometry.dispose();
    }

    const material = (maybeMesh as THREE.Mesh).material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else if (material) {
      material.dispose();
    }
  });
};

const clearGroup = (group: THREE.Group) => {
  group.children.forEach(disposeObject);
  group.clear();
};

const getShapeRadii = (
  plane: ConstructionPlane,
  center: THREE.Vector3,
  current: THREE.Vector3,
  tool: Exclude<ShapeTool, "none">,
) => {
  if (tool === "circle" || tool === "sphere") {
    const radius = center.distanceTo(current);
    return { radiusA: radius, radiusB: radius };
  }

  if (plane === "xy") {
    return {
      radiusA: Math.abs(current.x - center.x),
      radiusB: Math.abs(current.y - center.y),
    };
  }

  if (plane === "yz") {
    return {
      radiusA: Math.abs(current.y - center.y),
      radiusB: Math.abs(current.z - center.z),
    };
  }

  return {
    radiusA: Math.abs(current.x - center.x),
    radiusB: Math.abs(current.z - center.z),
  };
};

const getShapeVertices = (
  center: THREE.Vector3,
  radiusA: number,
  radiusB: number,
  plane: ConstructionPlane,
  segments = SHAPE_PREVIEW_SEGMENTS,
) => {
  const vertices: number[] = [];

  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    const axisA = Math.cos(angle) * radiusA;
    const axisB = Math.sin(angle) * radiusB;

    if (plane === "xy") {
      vertices.push(center.x + axisA, center.y + axisB, center.z);
    } else if (plane === "yz") {
      vertices.push(center.x, center.y + axisA, center.z + axisB);
    } else {
      vertices.push(center.x + axisA, center.y, center.z + axisB);
    }
  }

  return vertices;
};

const updateShapePreview = (
  handles: ThreeHandles,
  plane: ConstructionPlane,
  center: THREE.Vector3,
  radiusA: number,
  radiusB: number,
  tool: Exclude<ShapeTool, "none">,
) => {
  clearGroup(handles.previewGroup);

  if (radiusA < 0.01 || radiusB < 0.01) {
    return;
  }

  const previewPlanes: ConstructionPlane[] =
    tool === "sphere" ? ["xz", "xy", "yz"] : [plane];

  for (const previewPlane of previewPlanes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        getShapeVertices(
          center,
          radiusA,
          tool === "sphere" ? radiusA : radiusB,
          previewPlane,
        ),
        3,
      ),
    );

    const material = new THREE.LineBasicMaterial({
      color: SHAPE_PREVIEW_COLOR,
      depthTest: false,
      opacity: previewPlane === plane ? 0.95 : 0.58,
      transparent: true,
    });
    const line = new THREE.LineLoop(geometry, material);
    line.renderOrder = 5;
    handles.previewGroup.add(line);
  }
};

const makeTarget = (kind: SelectionTarget["kind"], id: string) => ({ kind, id });

const isTarget = (
  kind: SelectionTarget["kind"],
  id: string,
  target: SelectionTarget | null,
) => target?.kind === kind && target.id === id;

const makeEdgeMesh = (
  start: THREE.Vector3,
  end: THREE.Vector3,
  color: string,
) => {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(
    EDGE_VISIBLE_RADIUS,
    EDGE_VISIBLE_RADIUS,
    length,
    12,
  );
  const material = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.08,
    roughness: 0.45,
  });
  const mesh = new THREE.Mesh(geometry, material);

  mesh.position.copy(start.clone().add(end).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );

  return mesh;
};

const pickTarget = (
  handles: ThreeHandles,
  event: PointerEvent,
  domElement: HTMLCanvasElement,
  model: SceneModel,
) => {
  const ndc = pointerToNdc(event, domElement);
  handles.raycaster.setFromCamera(ndc, handles.camera);

  const pointHits = handles.raycaster.intersectObjects(
    handles.pointsGroup.children,
    false,
  );
  if (pointHits[0]?.object.userData.target) {
    return pointHits[0].object.userData.target as SelectionTarget;
  }

  let closestEdge: SelectionTarget | null = null;
  let closestEdgeDistance = EDGE_PICK_RADIUS * EDGE_PICK_RADIUS;
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();

  for (const edge of model.edges) {
    const startPoint = getPointById(model, edge.points[0]);
    const endPoint = getPointById(model, edge.points[1]);

    if (!startPoint || !endPoint) {
      continue;
    }

    start.set(...startPoint.position);
    end.set(...endPoint.position);
    const distance = handles.raycaster.ray.distanceSqToSegment(start, end);

    if (distance < closestEdgeDistance) {
      closestEdgeDistance = distance;
      closestEdge = makeTarget("edge", edge.id);
    }
  }

  if (closestEdge) {
    return closestEdge;
  }

  const edgeHits = handles.raycaster.intersectObjects(
    handles.edgesGroup.children,
    false,
  );
  if (edgeHits[0]?.object.userData.target) {
    return edgeHits[0].object.userData.target as SelectionTarget;
  }

  const faceHits = handles.raycaster.intersectObjects(
    handles.facesGroup.children,
    false,
  );
  if (faceHits[0]?.object.userData.target) {
    return faceHits[0].object.userData.target as SelectionTarget;
  }

  return null;
};

const getTargetPointIds = (model: SceneModel, target: SelectionTarget) => {
  if (target.kind === "point") {
    return [target.id];
  }

  if (target.kind === "edge") {
    return getEdgeById(model, target.id)?.points || [];
  }

  if (target.kind === "face") {
    return getFaceById(model, target.id)?.points || [];
  }

  const solid = getSolidById(model, target.id);
  if (!solid) {
    return [];
  }

  const pointIds = new Set<string>();
  for (const faceId of solid.faces) {
    getFaceById(model, faceId)?.points.forEach((pointId) =>
      pointIds.add(pointId),
    );
  }

  return [...pointIds];
};

const isTargetInSelection = (
  model: SceneModel,
  target: SelectionTarget,
  selectedTranslationPointIds: string[],
) => {
  const selectedPointIds = new Set(selectedTranslationPointIds);
  const targetPointIds = getTargetPointIds(model, target);

  return (
    targetPointIds.length > 0 &&
    targetPointIds.every((pointId) => selectedPointIds.has(pointId))
  );
};

const getBoxSelectedPointIds = (
  handles: ThreeHandles,
  model: SceneModel,
  domElement: HTMLCanvasElement,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) => {
  const minX = Math.min(startX, endX);
  const maxX = Math.max(startX, endX);
  const minY = Math.min(startY, endY);
  const maxY = Math.max(startY, endY);
  const rect = domElement.getBoundingClientRect();
  const projected = new THREE.Vector3();

  handles.camera.updateMatrixWorld();

  return model.points
    .filter((point) => {
      projected.set(...point.position).project(handles.camera);

      if (projected.z < -1 || projected.z > 1) {
        return false;
      }

      const x = rect.left + ((projected.x + 1) / 2) * rect.width;
      const y = rect.top + ((-projected.y + 1) / 2) * rect.height;

      return x >= minX && x <= maxX && y >= minY && y <= maxY;
    })
    .map((point) => point.id);
};

function Workspace3D({
  boxSelectShortcutLabel,
  constructionPlane,
  constructionPlaneOffset,
  facesOnly,
  hoveredTarget,
  interactionTool,
  model,
  onBoxSelectPoints,
  onClearSelection,
  onCreatePoint,
  onCreateShape,
  onHoverTarget,
  onSelectTarget,
  onTranslateSelectionCancel,
  onTranslateSelectionEnd,
  onTranslateSelectionMove,
  onTranslateSelectionStart,
  selectedEdgeIds,
  selectedFaceIds,
  selectedPointIds,
  selectedTranslationPointIds,
  selectedTarget,
  shapeTool,
}: WorkspaceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const handlesRef = useRef<ThreeHandles | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const propsRef = useRef({
    constructionPlane,
    interactionTool,
    model,
    onBoxSelectPoints,
    onClearSelection,
    onCreatePoint,
    onCreateShape,
    onHoverTarget,
    onSelectTarget,
    onTranslateSelectionCancel,
    onTranslateSelectionEnd,
    onTranslateSelectionMove,
    onTranslateSelectionStart,
    selectedTranslationPointIds,
    shapeTool,
  });

  propsRef.current = {
    constructionPlane,
    interactionTool,
    model,
    onBoxSelectPoints,
    onClearSelection,
    onCreatePoint,
    onCreateShape,
    onHoverTarget,
    onSelectTarget,
    onTranslateSelectionCancel,
    onTranslateSelectionEnd,
    onTranslateSelectionMove,
    onTranslateSelectionStart,
    selectedTranslationPointIds,
    shapeTool,
  };

  useEffect(() => {
    if (!rootRef.current) {
      return;
    }

    const root = rootRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#101010");
    scene.fog = new THREE.Fog("#101010", 13, 25);

    const camera = new THREE.PerspectiveCamera(
      48,
      root.clientWidth / Math.max(root.clientHeight, 1),
      0.1,
      100,
    );
    camera.position.set(4.6, 4.2, 6.2);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(root.clientWidth, root.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    root.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    controls.minDistance = 2.2;
    controls.maxDistance = 16;
    controls.maxPolarAngle = Math.PI * 0.48;

    const ambientLight = new THREE.HemisphereLight("#f8fafc", "#262626", 1.9);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight("#ffffff", 2.2);
    keyLight.position.set(4, 7, 3);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight("#14b8a6", 0.85);
    fillLight.position.set(-5, 3, -2);
    scene.add(fillLight);

    const grid = new THREE.GridHelper(10, 40, "#525252", "#2c2c2c");
    scene.add(grid);

    const planeGrid = new THREE.GridHelper(10, 20, "#5eead4", "#115e59");
    planeGrid.renderOrder = 2;
    const planeGridMaterial = planeGrid.material as THREE.LineBasicMaterial;
    planeGridMaterial.transparent = true;
    planeGridMaterial.opacity = 0.86;
    scene.add(planeGrid);

    const axes = new THREE.AxesHelper(1.4);
    axes.renderOrder = 3;
    axes.position.set(0, 0, 0);
    scene.add(axes);

    const facesGroup = new THREE.Group();
    const edgesGroup = new THREE.Group();
    const pointsGroup = new THREE.Group();
    const previewGroup = new THREE.Group();
    scene.add(facesGroup, edgesGroup, pointsGroup, previewGroup);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 0.12;

    const handles: ThreeHandles = {
      axes,
      camera,
      controls,
      edgesGroup,
      facesGroup,
      frameId: 0,
      grid,
      gridPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      planeGrid,
      pointsGroup,
      previewGroup,
      raycaster,
      renderer,
      scene,
    };
    applyConstructionPlane(handles, constructionPlane, constructionPlaneOffset);
    handlesRef.current = handles;

    const pointerStart = {
      boxSelecting: false,
      pointerId: -1,
      x: 0,
      y: 0,
      time: 0,
    };
    const shapeDrawing = {
      active: false,
      pointerId: -1,
      tool: "circle" as Exclude<ShapeTool, "none">,
      center: new THREE.Vector3(),
      current: new THREE.Vector3(),
    };
    const translationDrag = {
      active: false,
      hasMoved: false,
      pointerId: -1,
      start: new THREE.Vector3(),
      current: new THREE.Vector3(),
      x: 0,
      y: 0,
    };
    const scratchPoint = new THREE.Vector3();
    const intersectActivePlane = (
      event: PointerEvent,
      target: THREE.Vector3,
    ) => {
      const ndc = pointerToNdc(event, renderer.domElement);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(handles.gridPlane, target);
    };
    const endBoxSelect = () => {
      pointerStart.boxSelecting = false;
      pointerStart.pointerId = -1;
      controls.enabled = true;
      setSelectionBox(null);
    };
    const endShapeDrawing = () => {
      shapeDrawing.active = false;
      shapeDrawing.pointerId = -1;
      controls.enabled = true;
      clearGroup(handles.previewGroup);
    };
    const getTranslationDelta = (): Vec3Tuple => [
      translationDrag.current.x - translationDrag.start.x,
      translationDrag.current.y - translationDrag.start.y,
      translationDrag.current.z - translationDrag.start.z,
    ];
    const endTranslationDrag = () => {
      translationDrag.active = false;
      translationDrag.hasMoved = false;
      translationDrag.pointerId = -1;
      controls.enabled = true;
      setIsTranslating(false);
    };

    const onPointerDown = (event: PointerEvent) => {
      const activeShapeTool = propsRef.current.shapeTool;
      if (event.button === 0 && activeShapeTool !== "none") {
        const intersection = intersectActivePlane(event, scratchPoint);

        if (!intersection) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        shapeDrawing.active = true;
        shapeDrawing.pointerId = event.pointerId;
        shapeDrawing.tool = activeShapeTool;
        shapeDrawing.center.copy(intersection);
        shapeDrawing.current.copy(intersection);
        pointerStart.x = event.clientX;
        pointerStart.y = event.clientY;
        pointerStart.time = window.performance.now();
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
        clearGroup(handles.previewGroup);
        propsRef.current.onHoverTarget(null);
        return;
      }

      if (
        event.button === 0 &&
        propsRef.current.interactionTool === "select" &&
        !isPrimaryModifier(event)
      ) {
        const target = pickTarget(
          handles,
          event,
          renderer.domElement,
          propsRef.current.model,
        );

        if (
          target &&
          isTargetInSelection(
            propsRef.current.model,
            target,
            propsRef.current.selectedTranslationPointIds,
          ) &&
          intersectActivePlane(event, scratchPoint) &&
          propsRef.current.onTranslateSelectionStart()
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          translationDrag.active = true;
          translationDrag.hasMoved = false;
          translationDrag.pointerId = event.pointerId;
          translationDrag.start.copy(scratchPoint);
          translationDrag.current.copy(scratchPoint);
          translationDrag.x = event.clientX;
          translationDrag.y = event.clientY;
          pointerStart.x = event.clientX;
          pointerStart.y = event.clientY;
          pointerStart.time = window.performance.now();
          controls.enabled = false;
          renderer.domElement.setPointerCapture(event.pointerId);
          setIsTranslating(true);
          propsRef.current.onHoverTarget(target);
          return;
        }
      }

      if (
        event.button === 0 &&
        isPrimaryModifier(event) &&
        !pickTarget(handles, event, renderer.domElement, propsRef.current.model)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        pointerStart.boxSelecting = true;
        pointerStart.pointerId = event.pointerId;
        pointerStart.x = event.clientX;
        pointerStart.y = event.clientY;
        pointerStart.time = window.performance.now();
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
        setSelectionBox(
          makeSelectionBox(root, event.clientX, event.clientY, event.clientX, event.clientY),
        );
        propsRef.current.onHoverTarget(null);
        return;
      }

      pointerStart.x = event.clientX;
      pointerStart.y = event.clientY;
      pointerStart.time = window.performance.now();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (shapeDrawing.active) {
        event.preventDefault();
        event.stopImmediatePropagation();

        if (intersectActivePlane(event, shapeDrawing.current)) {
          const { radiusA, radiusB } = getShapeRadii(
            propsRef.current.constructionPlane,
            shapeDrawing.center,
            shapeDrawing.current,
            shapeDrawing.tool,
          );
          updateShapePreview(
            handles,
            propsRef.current.constructionPlane,
            shapeDrawing.center,
            radiusA,
            radiusB,
            shapeDrawing.tool,
          );
        }

        return;
      }

      if (translationDrag.active) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const moved = Math.hypot(
          event.clientX - translationDrag.x,
          event.clientY - translationDrag.y,
        );
        translationDrag.hasMoved = translationDrag.hasMoved || moved > 2;

        if (intersectActivePlane(event, translationDrag.current)) {
          propsRef.current.onTranslateSelectionMove(getTranslationDelta());
        }

        return;
      }

      if (pointerStart.boxSelecting) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSelectionBox(
          makeSelectionBox(
            root,
            pointerStart.x,
            pointerStart.y,
            event.clientX,
            event.clientY,
          ),
        );
        return;
      }

      const target = pickTarget(
        handles,
        event,
        renderer.domElement,
        propsRef.current.model,
      );
      propsRef.current.onHoverTarget(target);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (shapeDrawing.active) {
        event.preventDefault();
        event.stopImmediatePropagation();

        intersectActivePlane(event, shapeDrawing.current);
        const { radiusA, radiusB } = getShapeRadii(
          propsRef.current.constructionPlane,
          shapeDrawing.center,
          shapeDrawing.current,
          shapeDrawing.tool,
        );

        if (renderer.domElement.hasPointerCapture(shapeDrawing.pointerId)) {
          renderer.domElement.releasePointerCapture(shapeDrawing.pointerId);
        }

        propsRef.current.onCreateShape({
          center: [
            shapeDrawing.center.x,
            shapeDrawing.center.y,
            shapeDrawing.center.z,
          ],
          plane: propsRef.current.constructionPlane,
          radiusA,
          radiusB,
          tool: shapeDrawing.tool,
        });
        endShapeDrawing();
        return;
      }

      if (translationDrag.active) {
        event.preventDefault();
        event.stopImmediatePropagation();

        intersectActivePlane(event, translationDrag.current);
        const delta = getTranslationDelta();

        if (renderer.domElement.hasPointerCapture(translationDrag.pointerId)) {
          renderer.domElement.releasePointerCapture(translationDrag.pointerId);
        }

        propsRef.current.onTranslateSelectionEnd(
          translationDrag.hasMoved ? delta : [0, 0, 0],
        );
        endTranslationDrag();
        return;
      }

      if (pointerStart.boxSelecting) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const moved = Math.hypot(
          event.clientX - pointerStart.x,
          event.clientY - pointerStart.y,
        );
        const selectedIds =
          moved > 5
            ? getBoxSelectedPointIds(
                handles,
                propsRef.current.model,
                renderer.domElement,
                pointerStart.x,
                pointerStart.y,
                event.clientX,
                event.clientY,
              )
            : [];

        if (renderer.domElement.hasPointerCapture(pointerStart.pointerId)) {
          renderer.domElement.releasePointerCapture(pointerStart.pointerId);
        }

        endBoxSelect();
        propsRef.current.onBoxSelectPoints(selectedIds);
        return;
      }

      const moved = Math.hypot(
        event.clientX - pointerStart.x,
        event.clientY - pointerStart.y,
      );
      const elapsed = window.performance.now() - pointerStart.time;

      if (moved > 5 || elapsed > 350) {
        return;
      }

      const target = pickTarget(
        handles,
        event,
        renderer.domElement,
        propsRef.current.model,
      );
      if (target) {
        propsRef.current.onSelectTarget(target);
        return;
      }

      if (propsRef.current.interactionTool !== "point") {
        propsRef.current.onClearSelection();
        propsRef.current.onHoverTarget(null);
        return;
      }

      const ndc = pointerToNdc(event, renderer.domElement);
      raycaster.setFromCamera(ndc, camera);

      if (raycaster.ray.intersectPlane(handles.gridPlane, scratchPoint)) {
        propsRef.current.onCreatePoint([
          scratchPoint.x,
          scratchPoint.y,
          scratchPoint.z,
        ]);
      }
    };

    const onPointerLeave = () => {
      if (translationDrag.active) {
        return;
      }

      if (pointerStart.boxSelecting) {
        return;
      }

      propsRef.current.onHoverTarget(null);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (shapeDrawing.active) {
        if (renderer.domElement.hasPointerCapture(event.pointerId)) {
          renderer.domElement.releasePointerCapture(event.pointerId);
        }

        endShapeDrawing();
        return;
      }

      if (translationDrag.active) {
        if (renderer.domElement.hasPointerCapture(event.pointerId)) {
          renderer.domElement.releasePointerCapture(event.pointerId);
        }

        propsRef.current.onTranslateSelectionCancel();
        endTranslationDrag();
        return;
      }

      if (!pointerStart.boxSelecting) {
        return;
      }

      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }

      endBoxSelect();
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown, true);
    renderer.domElement.addEventListener("pointermove", onPointerMove, true);
    renderer.domElement.addEventListener("pointerup", onPointerUp, true);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel, true);

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;

      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(root);

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      handles.frameId = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(handles.frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown, true);
      renderer.domElement.removeEventListener("pointermove", onPointerMove, true);
      renderer.domElement.removeEventListener("pointerup", onPointerUp, true);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel, true);
      controls.dispose();
      clearGroup(pointsGroup);
      clearGroup(edgesGroup);
      clearGroup(facesGroup);
      clearGroup(previewGroup);
      disposeObject(grid);
      disposeObject(planeGrid);
      disposeObject(axes);
      renderer.dispose();
      root.removeChild(renderer.domElement);
      handlesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) {
      return;
    }

    applyConstructionPlane(handles, constructionPlane, constructionPlaneOffset);
  }, [constructionPlane, constructionPlaneOffset]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) {
      return;
    }

    handles.axes.visible = !facesOnly;
    handles.grid.visible = !facesOnly;
    handles.planeGrid.visible = !facesOnly;
  }, [facesOnly]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) {
      return;
    }

    clearGroup(handles.facesGroup);
    clearGroup(handles.edgesGroup);
    clearGroup(handles.pointsGroup);

    for (const face of model.faces) {
      const points = face.points.map((id) => getPointById(model, id));
      if (points.some((point) => !point)) {
        continue;
      }

      const geometry = new THREE.BufferGeometry();
      const vertices = new Float32Array(points.flatMap((point) => point!.position));
      const indices: number[] = [];
      for (let index = 1; index < points.length - 1; index += 1) {
        indices.push(0, index, index + 1);
      }

      geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      const selectedSolid = selectedTarget?.kind === "solid"
        ? model.solids.find((solid) => solid.id === selectedTarget.id)
        : null;
      const isSelected =
        isTarget("face", face.id, selectedTarget) ||
        selectedFaceIds.includes(face.id) ||
        Boolean(selectedSolid?.faces.includes(face.id));
      const isHovered = isTarget("face", face.id, hoveredTarget);
      const material = new THREE.MeshStandardMaterial({
        color: isHovered ? HOVER_COLOR : face.color,
        metalness: 0.02,
        opacity: isSelected ? 0.78 : 0.52,
        roughness: 0.62,
        side: THREE.DoubleSide,
        transparent: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 1;
      mesh.userData.target = makeTarget("face", face.id);
      handles.facesGroup.add(mesh);
    }

    if (!facesOnly) {
      for (const edge of model.edges) {
        const startPoint = getPointById(model, edge.points[0]);
        const endPoint = getPointById(model, edge.points[1]);
        if (!startPoint || !endPoint) {
          continue;
        }

        const selected =
          isTarget("edge", edge.id, selectedTarget) ||
          selectedEdgeIds.includes(edge.id);
        const hovered = isTarget("edge", edge.id, hoveredTarget);
        const color = selected
          ? SELECTED_COLOR
          : hovered
            ? HOVER_COLOR
            : edge.color || DEFAULT_GEOMETRY_COLOR;
        const mesh = makeEdgeMesh(
          new THREE.Vector3(...startPoint.position),
          new THREE.Vector3(...endPoint.position),
          color,
        );
        mesh.castShadow = true;
        mesh.userData.target = makeTarget("edge", edge.id);
        handles.edgesGroup.add(mesh);
      }

      for (const point of model.points) {
        const selected = isTarget("point", point.id, selectedTarget);
        const hovered = isTarget("point", point.id, hoveredTarget);
        const isBuildPoint = selectedPointIds.includes(point.id);
        const color = selected
          ? SELECTED_COLOR
          : hovered
            ? HOVER_COLOR
            : isBuildPoint
              ? BUILD_COLOR
              : point.color || BASE_POINT_COLOR;
        const geometry = new THREE.SphereGeometry(
          selected || hovered ? POINT_VISIBLE_RADIUS * 1.28 : POINT_VISIBLE_RADIUS,
          24,
          16,
        );
        const material = new THREE.MeshStandardMaterial({
          color,
          emissive: selected || hovered || isBuildPoint ? color : "#000000",
          emissiveIntensity: selected || hovered || isBuildPoint ? 0.24 : 0,
          metalness: 0.2,
          roughness: 0.32,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...point.position);
        mesh.castShadow = true;
        mesh.userData.target = makeTarget("point", point.id);
        handles.pointsGroup.add(mesh);

        const hitGeometry = new THREE.SphereGeometry(POINT_RADIUS, 16, 10);
        const hitMaterial = new THREE.MeshBasicMaterial({
          colorWrite: false,
          depthWrite: false,
          transparent: true,
        });
        const hitMesh = new THREE.Mesh(hitGeometry, hitMaterial);
        hitMesh.position.copy(mesh.position);
        hitMesh.renderOrder = -1;
        hitMesh.userData.target = makeTarget("point", point.id);
        handles.pointsGroup.add(hitMesh);
      }
    }
  }, [
    facesOnly,
    hoveredTarget,
    model,
    selectedEdgeIds,
    selectedFaceIds,
    selectedPointIds,
    selectedTarget,
  ]);

  return (
    <div
      className={`workspace ${selectionBox ? "is-box-selecting" : ""} ${
        shapeTool !== "none" ? "is-shape-tool" : ""
      } ${interactionTool === "point" ? "is-point-tool" : ""} ${
        isTranslating ? "is-translating" : ""
      }`}
      ref={rootRef}
      title={boxSelectShortcutLabel}
    >
      {selectionBox && (
        <div
          className="selection-box"
          style={{
            height: selectionBox.height,
            left: selectionBox.left,
            top: selectionBox.top,
            width: selectionBox.width,
          }}
        />
      )}
    </div>
  );
}

export default Workspace3D;
