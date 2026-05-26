import * as THREE from "three";

export type Vec3Tuple = [number, number, number];

export const DEFAULT_GEOMETRY_COLOR = "#f8fafc";

export type ConstructionPlane = "xz" | "xy" | "yz";

export type ShapeTool = "none" | "circle" | "ellipse" | "sphere";

export type InteractionTool = "select" | "point" | "paint";

export type ShapeDraft = {
  center: Vec3Tuple;
  plane: ConstructionPlane;
  radiusA: number;
  radiusB: number;
  tool: Exclude<ShapeTool, "none">;
};

export type PointNode = {
  id: string;
  position: Vec3Tuple;
  color: string;
};

export type EdgeNode = {
  id: string;
  points: [string, string];
  color: string;
};

export type FaceNode = {
  id: string;
  points: string[];
  color: string;
};

export type SolidNode = {
  id: string;
  faces: string[];
};

export type SceneModel = {
  points: PointNode[];
  edges: EdgeNode[];
  faces: FaceNode[];
  solids: SolidNode[];
  nextPointId: number;
  nextEdgeId: number;
  nextFaceId: number;
  nextSolidId: number;
};

export type SelectableKind = "point" | "edge" | "face" | "solid";

export type SelectionTarget = {
  kind: SelectableKind;
  id: string;
};

export const emptyModel = (): SceneModel => ({
  points: [],
  edges: [],
  faces: [],
  solids: [],
  nextPointId: 1,
  nextEdgeId: 1,
  nextFaceId: 1,
  nextSolidId: 1,
});

export const cloneModel = (model: SceneModel): SceneModel => {
  if (typeof structuredClone === "function") {
    return structuredClone(model);
  }

  return JSON.parse(JSON.stringify(model)) as SceneModel;
};

export const targetEquals = (
  a: SelectionTarget | null,
  b: SelectionTarget | null,
) => a?.kind === b?.kind && a?.id === b?.id;

export const getPointById = (model: SceneModel, id: string) =>
  model.points.find((point) => point.id === id);

export const getEdgeById = (model: SceneModel, id: string) =>
  model.edges.find((edge) => edge.id === id);

export const getFaceById = (model: SceneModel, id: string) =>
  model.faces.find((face) => face.id === id);

export const getSolidById = (model: SceneModel, id: string) =>
  model.solids.find((solid) => solid.id === id);

export const hasEdgeBetween = (model: SceneModel, a: string, b: string) =>
  model.edges.some(
    (edge) =>
      (edge.points[0] === a && edge.points[1] === b) ||
      (edge.points[0] === b && edge.points[1] === a),
  );

export const hasFaceWithPoints = (
  model: SceneModel,
  ids: string[],
) => {
  const key = [...ids].sort().join("|");
  return model.faces.some((face) => [...face.points].sort().join("|") === key);
};

export const createEdgeIfMissing = (
  model: SceneModel,
  a: string,
  b: string,
  color = DEFAULT_GEOMETRY_COLOR,
) => {
  if (a === b || hasEdgeBetween(model, a, b)) {
    return;
  }

  model.edges.push({
    color,
    id: `e${model.nextEdgeId}`,
    points: [a, b],
  });
  model.nextEdgeId += 1;
};

export const polygonArea = (
  model: SceneModel,
  ids: string[],
) => {
  const points = ids.map((id) => getPointById(model, id));
  if (points.some((point) => !point)) {
    return 0;
  }

  const anchor = new THREE.Vector3(...points[0]!.position);
  let area = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const b = new THREE.Vector3(...points[index]!.position);
    const c = new THREE.Vector3(...points[index + 1]!.position);
    const ab = b.clone().sub(anchor);
    const ac = c.clone().sub(anchor);
    area += ab.cross(ac).length() / 2;
  }

  return area;
};

export const createPolygonFace = (
  model: SceneModel,
  ids: string[],
  color = DEFAULT_GEOMETRY_COLOR,
) => {
  const uniqueIds = new Set(ids);
  if (
    uniqueIds.size < 3 ||
    hasFaceWithPoints(model, ids) ||
    polygonArea(model, ids) < 0.0001
  ) {
    return null;
  }

  for (let index = 0; index < ids.length; index += 1) {
    createEdgeIfMissing(model, ids[index], ids[(index + 1) % ids.length]);
  }

  const faceId = `f${model.nextFaceId}`;
  model.faces.push({
    id: faceId,
    points: [...ids],
    color,
  });
  model.nextFaceId += 1;

  return faceId;
};

export const addPolygonFace = (
  model: SceneModel,
  ids: string[],
  color = DEFAULT_GEOMETRY_COLOR,
) => {
  return Boolean(createPolygonFace(model, ids, color));
};

export const addSolid = (model: SceneModel, faceIds: string[]) => {
  const uniqueFaceIds = [...new Set(faceIds)].filter((faceId) =>
    model.faces.some((face) => face.id === faceId),
  );

  if (uniqueFaceIds.length < 4) {
    return null;
  }

  const solidId = `s${model.nextSolidId}`;
  model.solids.push({
    id: solidId,
    faces: uniqueFaceIds,
  });
  model.nextSolidId += 1;

  return solidId;
};

export const triangleArea = (
  model: SceneModel,
  ids: [string, string, string],
) => polygonArea(model, ids);

export const addTriangleFace = (
  model: SceneModel,
  ids: [string, string, string],
  color = DEFAULT_GEOMETRY_COLOR,
) => addPolygonFace(model, ids, color);

export const deleteTarget = (model: SceneModel, target: SelectionTarget) => {
  if (target.kind === "point") {
    model.points = model.points.filter((point) => point.id !== target.id);
    model.edges = model.edges.filter(
      (edge) => !edge.points.includes(target.id),
    );
    model.faces = model.faces.filter(
      (face) => !face.points.includes(target.id),
    );
    const faceIds = new Set(model.faces.map((face) => face.id));
    model.solids = model.solids.filter((solid) =>
      solid.faces.every((faceId) => faceIds.has(faceId)),
    );
    return;
  }

  if (target.kind === "edge") {
    model.edges = model.edges.filter((edge) => edge.id !== target.id);
    return;
  }

  if (target.kind === "face") {
    model.faces = model.faces.filter((face) => face.id !== target.id);
    model.solids = model.solids.filter(
      (solid) => !solid.faces.includes(target.id),
    );
    return;
  }

  const solid = getSolidById(model, target.id);
  if (!solid) {
    return;
  }

  const faceIds = new Set(solid.faces);
  model.faces = model.faces.filter((face) => !faceIds.has(face.id));
  const remainingFaceIds = new Set(model.faces.map((face) => face.id));
  model.solids = model.solids.filter(
    (item) =>
      item.id !== target.id &&
      item.faces.every((faceId) => remainingFaceIds.has(faceId)),
  );
};

export const snapToGrid = (value: number, gridSize = 0.25) =>
  Math.round(value / gridSize) * gridSize;

export const formatTuple = (position: Vec3Tuple) =>
  position.map((value) => value.toFixed(2)).join(", ");
