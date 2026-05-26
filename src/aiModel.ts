import {
  addSolid,
  createEdgeIfMissing,
  createPolygonFace,
  DEFAULT_GEOMETRY_COLOR,
  polygonArea,
  SceneModel,
  Vec3Tuple,
} from "./model";
import {
  AiGeneratedEdge,
  AiGeneratedFace,
  AiGeneratedModel,
  AiGeneratedPoint,
  AiGeneratedSolid,
  AI_MODEL_SCHEMA_LIMITS,
} from "./aiSchema";

const DEFAULT_FACE_COLOR = "#f97316";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export type ApplyAiMode = "add" | "replace";

export type AiMergeResult = {
  points: number;
  edges: number;
  faces: number;
  solids: number;
};

const clampCoordinate = (value: number) =>
  Math.min(
    AI_MODEL_SCHEMA_LIMITS.coordinate,
    Math.max(-AI_MODEL_SCHEMA_LIMITS.coordinate, value),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeId = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const normalizePoint = (value: unknown): AiGeneratedPoint | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeId(value.id);
  const position = Array.isArray(value.position) ? value.position : [];

  if (!id || position.length !== 3) {
    return null;
  }

  const coordinates = position.map((coordinate) =>
    typeof coordinate === "number" && Number.isFinite(coordinate)
      ? clampCoordinate(coordinate)
      : null,
  );

  if (coordinates.some((coordinate) => coordinate === null)) {
    return null;
  }

  return {
    id,
    position: coordinates as Vec3Tuple,
  };
};

const normalizeEdge = (
  value: unknown,
  pointIds: Set<string>,
  fallbackIndex: number,
): AiGeneratedEdge | null => {
  if (!isRecord(value) || !Array.isArray(value.points)) {
    return null;
  }

  const id = normalizeId(value.id) || `e${fallbackIndex + 1}`;
  const [a, b] = value.points.map(normalizeId);
  if (!id || !a || !b || a === b || !pointIds.has(a) || !pointIds.has(b)) {
    return null;
  }

  return { id, points: [a, b] };
};

const edgePointKey = (a: string, b: string) => [a, b].sort().join("|");

const finishFacePointLoop = (points: string[]) => {
  if (points.length < 4 || points[0] !== points[points.length - 1]) {
    return null;
  }

  const loop = points.slice(0, -1);
  if (new Set(loop).size !== loop.length || loop.length < 3) {
    return null;
  }

  return loop;
};

const getOtherEdgePoint = (edge: AiGeneratedEdge, pointId: string) => {
  if (edge.points[0] === pointId) {
    return edge.points[1];
  }

  if (edge.points[1] === pointId) {
    return edge.points[0];
  }

  return null;
};

const walkOrderedEdges = (edges: AiGeneratedEdge[]) => {
  const [firstA, firstB] = edges[0].points;

  for (const [start, next] of [
    [firstA, firstB],
    [firstB, firstA],
  ] as Array<[string, string]>) {
    const points = [start, next];
    let failed = false;

    for (const edge of edges.slice(1)) {
      const otherPoint = getOtherEdgePoint(edge, points[points.length - 1]);
      if (!otherPoint) {
        failed = true;
        break;
      }

      points.push(otherPoint);
    }

    if (!failed) {
      const loop = finishFacePointLoop(points);
      if (loop) {
        return loop;
      }
    }
  }

  return null;
};

const walkUnorderedEdges = (edges: AiGeneratedEdge[]) => {
  const pointToEdgeIndexes = new Map<string, number[]>();

  edges.forEach((edge, index) => {
    for (const pointId of edge.points) {
      pointToEdgeIndexes.set(pointId, [
        ...(pointToEdgeIndexes.get(pointId) || []),
        index,
      ]);
    }
  });

  if ([...pointToEdgeIndexes.values()].some((items) => items.length !== 2)) {
    return null;
  }

  const [firstA, firstB] = edges[0].points;

  for (const [start, next] of [
    [firstA, firstB],
    [firstB, firstA],
  ] as Array<[string, string]>) {
    const usedEdges = new Set([0]);
    const points = [start, next];

    while (usedEdges.size < edges.length) {
      const lastPoint = points[points.length - 1];
      const candidates = (pointToEdgeIndexes.get(lastPoint) || []).filter(
        (index) => !usedEdges.has(index),
      );

      if (candidates.length !== 1) {
        break;
      }

      const nextEdgeIndex = candidates[0];
      const otherPoint = getOtherEdgePoint(edges[nextEdgeIndex], lastPoint);
      if (!otherPoint) {
        break;
      }

      usedEdges.add(nextEdgeIndex);
      points.push(otherPoint);
    }

    if (usedEdges.size === edges.length) {
      const loop = finishFacePointLoop(points);
      if (loop) {
        return loop;
      }
    }
  }

  return null;
};

const resolveFacePointLoop = (
  edgeIds: string[],
  edgeMap: Map<string, AiGeneratedEdge>,
) => {
  const uniqueEdgeIds = [...new Set(edgeIds)];
  if (uniqueEdgeIds.length < 3) {
    return null;
  }

  const edges = uniqueEdgeIds
    .map((edgeId) => edgeMap.get(edgeId))
    .filter((edge): edge is AiGeneratedEdge => Boolean(edge));

  if (edges.length !== uniqueEdgeIds.length) {
    return null;
  }

  return walkOrderedEdges(edges) || walkUnorderedEdges(edges);
};

const normalizeFace = (
  value: unknown,
  pointIds: Set<string>,
  edgeMap: Map<string, AiGeneratedEdge>,
  edgeIdByPointKey: Map<string, string>,
  fallbackIndex: number,
): AiGeneratedFace | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeId(value.id) || `f${fallbackIndex + 1}`;
  const edgeRefs = Array.isArray(value.edges)
    ? value.edges.map(normalizeId).filter(Boolean)
    : [];
  const edgeLoopPoints =
    edgeRefs.length > 0 ? resolveFacePointLoop(edgeRefs, edgeMap) : null;
  const fallbackPoints = Array.isArray(value.points)
    ? [...new Set(value.points.map(normalizeId).filter(Boolean))]
    : [];
  const points = edgeLoopPoints || fallbackPoints;
  const resolvedEdges =
    edgeLoopPoints || fallbackPoints.length < 3
      ? edgeRefs
      : fallbackPoints
          .map((pointId, index) =>
            edgeIdByPointKey.get(
              edgePointKey(
                pointId,
                fallbackPoints[(index + 1) % fallbackPoints.length],
              ),
            ),
          )
          .filter((edgeId): edgeId is string => Boolean(edgeId));
  const color =
    typeof value.color === "string" && HEX_COLOR_PATTERN.test(value.color)
      ? value.color
      : DEFAULT_FACE_COLOR;

  if (
    !id ||
    points.length < 3 ||
    points.some((pointId) => !pointIds.has(pointId))
  ) {
    return null;
  }

  return {
    color,
    edges: resolvedEdges.slice(0, AI_MODEL_SCHEMA_LIMITS.facePoints),
    id,
    points: points.slice(0, AI_MODEL_SCHEMA_LIMITS.facePoints),
  };
};

const normalizeSolid = (
  value: unknown,
  faceIds: Set<string>,
): AiGeneratedSolid | null => {
  if (!isRecord(value) || !Array.isArray(value.faces)) {
    return null;
  }

  const faces = [...new Set(value.faces.map(normalizeId).filter(Boolean))]
    .filter((faceId) => faceIds.has(faceId))
    .slice(0, AI_MODEL_SCHEMA_LIMITS.solidFaces);

  if (faces.length < 4) {
    return null;
  }

  return { faces };
};

export const normalizeAiModel = (value: unknown): AiGeneratedModel => {
  if (!isRecord(value)) {
    throw new Error("AI 返回的数据不是有效对象");
  }

  const name = typeof value.name === "string" ? value.name.trim() : "AI 模型";
  const summary =
    typeof value.summary === "string" ? value.summary.trim() : "已生成模型";
  const rawPoints = Array.isArray(value.points) ? value.points : [];
  const points: AiGeneratedPoint[] = [];
  const pointIds = new Set<string>();

  for (const rawPoint of rawPoints.slice(0, AI_MODEL_SCHEMA_LIMITS.points)) {
    const point = normalizePoint(rawPoint);
    if (!point || pointIds.has(point.id)) {
      continue;
    }

    pointIds.add(point.id);
    points.push(point);
  }

  if (points.length === 0) {
    throw new Error("AI 没有生成可用节点");
  }

  const rawEdges = Array.isArray(value.edges) ? value.edges : [];
  const edges: AiGeneratedEdge[] = [];
  const edgeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const edgeMap = new Map<string, AiGeneratedEdge>();
  const edgeIdByPointKey = new Map<string, string>();

  for (const [index, rawEdge] of rawEdges
    .slice(0, AI_MODEL_SCHEMA_LIMITS.edges)
    .entries()) {
    const edge = normalizeEdge(rawEdge, pointIds, index);
    if (!edge || edgeIds.has(edge.id)) {
      continue;
    }

    const key = edgePointKey(edge.points[0], edge.points[1]);
    if (edgeKeys.has(key)) {
      continue;
    }

    edgeIds.add(edge.id);
    edgeKeys.add(key);
    edgeMap.set(edge.id, edge);
    edgeIdByPointKey.set(key, edge.id);
    edges.push(edge);
  }

  const rawFaces = Array.isArray(value.faces) ? value.faces : [];
  const faces: AiGeneratedFace[] = [];
  const faceIds = new Set<string>();
  const faceKeys = new Set<string>();

  for (const [index, rawFace] of rawFaces
    .slice(0, AI_MODEL_SCHEMA_LIMITS.faces)
    .entries()) {
    const face = normalizeFace(
      rawFace,
      pointIds,
      edgeMap,
      edgeIdByPointKey,
      index,
    );
    if (!face || faceIds.has(face.id)) {
      continue;
    }

    const key = [...face.points].sort().join("|");
    if (faceKeys.has(key)) {
      continue;
    }

    faceIds.add(face.id);
    faceKeys.add(key);
    faces.push(face);
  }

  const rawSolids = Array.isArray(value.solids) ? value.solids : [];
  const solids: AiGeneratedSolid[] = [];
  const solidKeys = new Set<string>();

  for (const rawSolid of rawSolids.slice(0, AI_MODEL_SCHEMA_LIMITS.solids)) {
    const solid = normalizeSolid(rawSolid, faceIds);
    if (!solid) {
      continue;
    }

    const key = [...solid.faces].sort().join("|");
    if (solidKeys.has(key)) {
      continue;
    }

    solidKeys.add(key);
    solids.push(solid);
  }

  return {
    edges,
    faces,
    name: name || "AI 模型",
    points,
    solids,
    summary: summary || "已生成模型",
  };
};

export const mergeAiModelIntoScene = (
  scene: SceneModel,
  aiModel: AiGeneratedModel,
): AiMergeResult => {
  const idMap = new Map<string, string>();
  const faceMap = new Map<string, string>();
  const result: AiMergeResult = {
    edges: 0,
    faces: 0,
    points: 0,
    solids: 0,
  };

  for (const point of aiModel.points) {
    const nextId = `p${scene.nextPointId}`;
    scene.points.push({
      color: DEFAULT_GEOMETRY_COLOR,
      id: nextId,
      position: [...point.position],
    });
    scene.nextPointId += 1;
    idMap.set(point.id, nextId);
    result.points += 1;
  }

  for (const edge of aiModel.edges) {
    const a = idMap.get(edge.points[0]);
    const b = idMap.get(edge.points[1]);
    if (!a || !b) {
      continue;
    }

    const before = scene.edges.length;
    createEdgeIfMissing(scene, a, b);
    if (scene.edges.length > before) {
      result.edges += 1;
    }
  }

  for (const face of aiModel.faces) {
    const ids = face.points
      .map((id) => idMap.get(id))
      .filter((id): id is string => Boolean(id));

    if (ids.length < 3 || polygonArea(scene, ids) < 0.0001) {
      continue;
    }

    const beforeEdges = scene.edges.length;
    const beforeFaces = scene.faces.length;
    const faceId = createPolygonFace(scene, ids, face.color);

    if (faceId) {
      faceMap.set(face.id, faceId);
      result.edges += scene.edges.length - beforeEdges;
      result.faces += scene.faces.length - beforeFaces;
    }
  }

  for (const solid of aiModel.solids) {
    const faceIds = solid.faces
      .map((id) => faceMap.get(id))
      .filter((id): id is string => Boolean(id));

    if (faceIds.length < 4) {
      continue;
    }

    const solidId = addSolid(scene, faceIds);
    if (solidId) {
      result.solids += 1;
    }
  }

  return result;
};
