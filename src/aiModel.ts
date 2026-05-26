import {
  addPolygonFace,
  createEdgeIfMissing,
  polygonArea,
  SceneModel,
  Vec3Tuple,
} from "./model";
import {
  AiGeneratedEdge,
  AiGeneratedFace,
  AiGeneratedModel,
  AiGeneratedPoint,
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
): AiGeneratedEdge | null => {
  if (!isRecord(value) || !Array.isArray(value.points)) {
    return null;
  }

  const [a, b] = value.points.map(normalizeId);
  if (!a || !b || a === b || !pointIds.has(a) || !pointIds.has(b)) {
    return null;
  }

  return { points: [a, b] };
};

const normalizeFace = (
  value: unknown,
  pointIds: Set<string>,
): AiGeneratedFace | null => {
  if (!isRecord(value) || !Array.isArray(value.points)) {
    return null;
  }

  const points = value.points.map(normalizeId).filter(Boolean);
  const uniquePoints = [...new Set(points)];
  const color =
    typeof value.color === "string" && HEX_COLOR_PATTERN.test(value.color)
      ? value.color
      : DEFAULT_FACE_COLOR;

  if (uniquePoints.length < 3 || uniquePoints.some((id) => !pointIds.has(id))) {
    return null;
  }

  return {
    color,
    points: uniquePoints.slice(0, AI_MODEL_SCHEMA_LIMITS.facePoints),
  };
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
  const edgeKeys = new Set<string>();

  for (const rawEdge of rawEdges) {
    const edge = normalizeEdge(rawEdge, pointIds);
    if (!edge) {
      continue;
    }

    const key = [...edge.points].sort().join("|");
    if (edgeKeys.has(key)) {
      continue;
    }

    edgeKeys.add(key);
    edges.push(edge);
  }

  const rawFaces = Array.isArray(value.faces) ? value.faces : [];
  const faces: AiGeneratedFace[] = [];
  const faceKeys = new Set<string>();

  for (const rawFace of rawFaces.slice(0, AI_MODEL_SCHEMA_LIMITS.faces)) {
    const face = normalizeFace(rawFace, pointIds);
    if (!face) {
      continue;
    }

    const key = [...face.points].sort().join("|");
    if (faceKeys.has(key)) {
      continue;
    }

    faceKeys.add(key);
    faces.push(face);
  }

  return {
    edges,
    faces,
    name: name || "AI 模型",
    points,
    summary: summary || "已生成模型",
  };
};

export const mergeAiModelIntoScene = (
  scene: SceneModel,
  aiModel: AiGeneratedModel,
): AiMergeResult => {
  const idMap = new Map<string, string>();
  const result: AiMergeResult = {
    edges: 0,
    faces: 0,
    points: 0,
    solids: 0,
  };

  for (const point of aiModel.points) {
    const nextId = `p${scene.nextPointId}`;
    scene.points.push({
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
    const added = addPolygonFace(scene, ids, face.color);

    if (added) {
      result.edges += scene.edges.length - beforeEdges;
      result.faces += scene.faces.length - beforeFaces;
    }
  }

  return result;
};
