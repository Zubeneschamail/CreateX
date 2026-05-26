import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Brush,
  Circle,
  Eraser,
  Eye,
  Magnet,
  Minus,
  Orbit,
  Plus,
  Radius,
  RotateCcw,
  Settings,
  WandSparkles,
  Trash2,
  Triangle,
} from "lucide-react";
import Workspace3D from "./Workspace3D";
import AiModelDialog, { type AiSelectionContext } from "./AiModelDialog";
import SettingsDialog, { AiSettings } from "./SettingsDialog";
import { AiGeneratedModel } from "./aiSchema";
import { ApplyAiMode, mergeAiModelIntoScene } from "./aiModel";
import {
  DEFAULT_AI_PROVIDER,
  DEFAULT_MODEL_BY_PROVIDER,
  isAiProvider,
  isKnownModelForProvider,
} from "./aiModels";
import {
  addSolid,
  addPolygonFace,
  cloneModel,
  ConstructionPlane,
  createEdgeIfMissing,
  createPolygonFace,
  deleteTarget,
  emptyModel,
  formatTuple,
  getEdgeById,
  getFaceById,
  getPointById,
  getSolidById,
  hasEdgeBetween,
  hasFaceWithPoints,
  polygonArea,
  SceneModel,
  ShapeDraft,
  ShapeTool,
  SelectionTarget,
  snapToGrid,
  targetEquals,
  Vec3Tuple,
} from "./model";

const FACE_COLORS = [
  "#f97316",
  "#14b8a6",
  "#eab308",
  "#ef4444",
  "#22c55e",
  "#3b82f6",
  "#ec4899",
  "#f8fafc",
];

const POINT_SNAP_RADIUS = 0.18;
const PLANE_OFFSET_STEP = 0.25;
const PLANE_OFFSET_LIMIT = 5;
const SHAPE_SEGMENTS = 48;
const SHAPE_MIN_RADIUS = 0.08;
const SPHERE_LAT_SEGMENTS = 8;
const SPHERE_LONG_SEGMENTS = 16;

const SHAPE_TOOL_LABEL: Record<Exclude<ShapeTool, "none">, string> = {
  circle: "圆",
  ellipse: "椭圆",
  sphere: "球体",
};

const CONSTRUCTION_PLANES: Array<{
  id: ConstructionPlane;
  label: string;
  title: string;
}> = [
  { id: "xz", label: "XZ", title: "地面平面" },
  { id: "xy", label: "XY", title: "正面平面" },
  { id: "yz", label: "YZ", title: "侧面平面" },
];

const PLANE_OFFSET_AXIS: Record<ConstructionPlane, string> = {
  xz: "Y",
  xy: "Z",
  yz: "X",
};

const DEFAULT_PLANE_OFFSETS: Record<ConstructionPlane, number> = {
  xz: 0,
  xy: 0,
  yz: 0,
};

const AI_SETTINGS_STORAGE_KEY = "creatorx.aiSettings";
const DEFAULT_AI_SETTINGS: AiSettings = {
  apiKey: "",
  model: DEFAULT_MODEL_BY_PROVIDER[DEFAULT_AI_PROVIDER],
  provider: DEFAULT_AI_PROVIDER,
};

const loadAiSettings = (): AiSettings => {
  if (typeof window === "undefined") {
    return DEFAULT_AI_SETTINGS;
  }

  try {
    const rawValue = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    const parsedValue = (rawValue ? JSON.parse(rawValue) : {}) as Record<
      string,
      unknown
    >;
    const provider = isAiProvider(parsedValue.provider)
      ? parsedValue.provider
      : DEFAULT_AI_SETTINGS.provider;
    const fallbackModel = DEFAULT_MODEL_BY_PROVIDER[provider];

    const model =
      typeof parsedValue.model === "string" &&
      isKnownModelForProvider(provider, parsedValue.model)
        ? parsedValue.model
        : fallbackModel;

    return {
      apiKey: typeof parsedValue.apiKey === "string" ? parsedValue.apiKey : "",
      model,
      provider,
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
};

const distance = (a: Vec3Tuple, b: Vec3Tuple) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const clampPlaneOffset = (value: number) =>
  Math.min(PLANE_OFFSET_LIMIT, Math.max(-PLANE_OFFSET_LIMIT, value));

const describeTarget = (target: SelectionTarget | null) => {
  if (!target) {
    return "未选中";
  }

  if (target.kind === "point") {
    return `点 ${target.id.toUpperCase()}`;
  }

  if (target.kind === "edge") {
    return `线 ${target.id.toUpperCase()}`;
  }

  if (target.kind === "face") {
    return `面 ${target.id.toUpperCase()}`;
  }

  return `体 ${target.id.toUpperCase()}`;
};

const isEditableKeyboardTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
};

const getFaceIdByPointSet = (model: SceneModel, ids: string[]) => {
  const key = [...ids].sort().join("|");
  return model.faces.find((face) => [...face.points].sort().join("|") === key)
    ?.id;
};

const ensurePolygonFace = (
  model: SceneModel,
  ids: string[],
  color: string,
) => createPolygonFace(model, ids, color) || getFaceIdByPointSet(model, ids);

const addTriangleFromEdgeAndPoint = (
  model: SceneModel,
  edgeId: string,
  pointId: string,
  color: string,
) => {
  const edge = getEdgeById(model, edgeId);

  if (!edge || edge.points.includes(pointId)) {
    return false;
  }

  return addPolygonFace(model, [edge.points[0], edge.points[1], pointId], color);
};

const addQuadFromOppositeEdges = (
  model: SceneModel,
  edgeIds: [string, string],
  color: string,
) => {
  const firstEdge = getEdgeById(model, edgeIds[0]);
  const secondEdge = getEdgeById(model, edgeIds[1]);

  if (!firstEdge || !secondEdge) {
    return false;
  }

  const uniquePoints = new Set([...firstEdge.points, ...secondEdge.points]);
  if (uniquePoints.size !== 4) {
    return false;
  }

  return addPolygonFace(
    model,
    [
      firstEdge.points[0],
      firstEdge.points[1],
      secondEdge.points[1],
      secondEdge.points[0],
    ],
    color,
  );
};

const addPyramidFromFaceAndPoint = (
  model: SceneModel,
  faceId: string,
  pointId: string,
  color: string,
) => {
  const baseFace = getFaceById(model, faceId);

  if (!baseFace || baseFace.points.includes(pointId)) {
    return null;
  }

  const sideFaceIds: string[] = [];
  for (let index = 0; index < baseFace.points.length; index += 1) {
    const a = baseFace.points[index];
    const b = baseFace.points[(index + 1) % baseFace.points.length];
    const sideFaceId = ensurePolygonFace(model, [a, b, pointId], color);

    if (!sideFaceId) {
      return null;
    }

    sideFaceIds.push(sideFaceId);
  }

  return addSolid(model, [baseFace.id, ...sideFaceIds]);
};

const addLoftFromFaces = (
  model: SceneModel,
  faceIds: [string, string],
  color: string,
) => {
  const firstFace = getFaceById(model, faceIds[0]);
  const secondFace = getFaceById(model, faceIds[1]);

  if (
    !firstFace ||
    !secondFace ||
    firstFace.id === secondFace.id ||
    firstFace.points.length !== secondFace.points.length
  ) {
    return null;
  }

  const sideFaceIds: string[] = [];
  for (let index = 0; index < firstFace.points.length; index += 1) {
    const nextIndex = (index + 1) % firstFace.points.length;
    const sideFaceId = ensurePolygonFace(
      model,
      [
        firstFace.points[index],
        firstFace.points[nextIndex],
        secondFace.points[nextIndex],
        secondFace.points[index],
      ],
      color,
    );

    if (!sideFaceId) {
      return null;
    }

    sideFaceIds.push(sideFaceId);
  }

  return addSolid(model, [firstFace.id, secondFace.id, ...sideFaceIds]);
};

const getShapePointPositions = (shape: ShapeDraft) => {
  const [centerX, centerY, centerZ] = shape.center;
  const positions: Vec3Tuple[] = [];

  for (let index = 0; index < SHAPE_SEGMENTS; index += 1) {
    const angle = (index / SHAPE_SEGMENTS) * Math.PI * 2;
    const axisA = Math.cos(angle) * shape.radiusA;
    const axisB = Math.sin(angle) * shape.radiusB;

    if (shape.plane === "xy") {
      positions.push([centerX + axisA, centerY + axisB, centerZ]);
    } else if (shape.plane === "yz") {
      positions.push([centerX, centerY + axisA, centerZ + axisB]);
    } else {
      positions.push([centerX + axisA, centerY, centerZ + axisB]);
    }
  }

  return positions;
};

const addSphereFromShape = (
  model: SceneModel,
  shape: ShapeDraft,
  color: string,
) => {
  const [centerX, centerY, centerZ] = shape.center;
  const radius = shape.radiusA;

  const addPoint = (position: Vec3Tuple) => {
    const pointId = `p${model.nextPointId}`;
    model.points.push({
      id: pointId,
      position,
    });
    model.nextPointId += 1;
    return pointId;
  };

  const topPointId = addPoint([centerX, centerY + radius, centerZ]);
  const rings: string[][] = [];

  for (let latitude = 1; latitude < SPHERE_LAT_SEGMENTS; latitude += 1) {
    const theta = (latitude / SPHERE_LAT_SEGMENTS) * Math.PI;
    const y = centerY + Math.cos(theta) * radius;
    const ringRadius = Math.sin(theta) * radius;
    const ring: string[] = [];

    for (let longitude = 0; longitude < SPHERE_LONG_SEGMENTS; longitude += 1) {
      const phi = (longitude / SPHERE_LONG_SEGMENTS) * Math.PI * 2;
      ring.push(
        addPoint([
          centerX + Math.cos(phi) * ringRadius,
          y,
          centerZ + Math.sin(phi) * ringRadius,
        ]),
      );
    }

    rings.push(ring);
  }

  const bottomPointId = addPoint([centerX, centerY - radius, centerZ]);
  const faceIds: string[] = [];
  const appendFace = (ids: string[]) => {
    const faceId = createPolygonFace(model, ids, color);

    if (!faceId) {
      return false;
    }

    faceIds.push(faceId);
    return true;
  };

  for (let longitude = 0; longitude < SPHERE_LONG_SEGMENTS; longitude += 1) {
    const nextLongitude = (longitude + 1) % SPHERE_LONG_SEGMENTS;

    if (!appendFace([topPointId, rings[0][longitude], rings[0][nextLongitude]])) {
      return null;
    }
  }

  for (let latitude = 0; latitude < rings.length - 1; latitude += 1) {
    const upperRing = rings[latitude];
    const lowerRing = rings[latitude + 1];

    for (let longitude = 0; longitude < SPHERE_LONG_SEGMENTS; longitude += 1) {
      const nextLongitude = (longitude + 1) % SPHERE_LONG_SEGMENTS;

      if (
        !appendFace([
          upperRing[longitude],
          upperRing[nextLongitude],
          lowerRing[nextLongitude],
          lowerRing[longitude],
        ])
      ) {
        return null;
      }
    }
  }

  const lastRing = rings[rings.length - 1];
  for (let longitude = 0; longitude < SPHERE_LONG_SEGMENTS; longitude += 1) {
    const nextLongitude = (longitude + 1) % SPHERE_LONG_SEGMENTS;

    if (
      !appendFace([
        bottomPointId,
        lastRing[nextLongitude],
        lastRing[longitude],
      ])
    ) {
      return null;
    }
  }

  return addSolid(model, faceIds);
};

function App() {
  const [model, setModel] = useState<SceneModel>(() => emptyModel());
  const [selectedTarget, setSelectedTarget] =
    useState<SelectionTarget | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<SelectionTarget | null>(
    null,
  );
  const [selectedPointIds, setSelectedPointIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [selectedFaceIds, setSelectedFaceIds] = useState<string[]>([]);
  const [activeColor, setActiveColor] = useState(FACE_COLORS[0]);
  const [aiSettings, setAiSettings] = useState<AiSettings>(() =>
    loadAiSettings(),
  );
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [facesOnly, setFacesOnly] = useState(false);
  const [shapeTool, setShapeTool] = useState<ShapeTool>("none");
  const [constructionPlane, setConstructionPlane] =
    useState<ConstructionPlane>("xz");
  const [planeOffsets, setPlaneOffsets] = useState(DEFAULT_PLANE_OFFSETS);
  const [historySize, setHistorySize] = useState(0);
  const [notice, setNotice] = useState("就绪");
  const modelRef = useRef<SceneModel>(model);
  const historyRef = useRef<SceneModel[]>([]);
  const noticeTimerRef = useRef<number | null>(null);

  const flashNotice = useCallback((message: string) => {
    setNotice(message);

    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }

    noticeTimerRef.current = window.setTimeout(() => {
      setNotice("就绪");
      noticeTimerRef.current = null;
    }, 1800);
  }, []);

  const commitModel = useCallback(
    (mutate: (draft: SceneModel) => boolean | void) => {
      const current = modelRef.current;
      const draft = cloneModel(current);
      const changed = mutate(draft) !== false;

      if (!changed) {
        return false;
      }

      historyRef.current = [...historyRef.current.slice(-49), cloneModel(current)];
      modelRef.current = draft;
      setHistorySize(historyRef.current.length);
      setModel(draft);
      return true;
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setSelectedTarget(null);
    setSelectedPointIds([]);
    setSelectedEdgeIds([]);
    setSelectedFaceIds([]);
  }, []);

  const toggleFacesOnly = useCallback(() => {
    const nextEnabled = !facesOnly;

    if (
      nextEnabled &&
      selectedTarget?.kind !== "face" &&
      selectedTarget?.kind !== "solid"
    ) {
      clearSelection();
    }

    setFacesOnly(nextEnabled);
    flashNotice(nextEnabled ? "只显示面" : "显示点线");
  }, [clearSelection, facesOnly, flashNotice, selectedTarget]);

  const chooseShapeTool = useCallback(
    (tool: Exclude<ShapeTool, "none">) => {
      const nextTool = shapeTool === tool ? "none" : tool;

      setShapeTool(nextTool);
      clearSelection();
      flashNotice(
        nextTool === "none"
          ? "已退出绘制"
          : `拖拽生成${SHAPE_TOOL_LABEL[nextTool]}`,
      );
    },
    [clearSelection, flashNotice, shapeTool],
  );

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();

    if (!previous) {
      return;
    }

    modelRef.current = previous;
    setModel(previous);
    setSelectedTarget(null);
    setSelectedPointIds([]);
    setSelectedEdgeIds([]);
    setSelectedFaceIds([]);
    setHistorySize(historyRef.current.length);
    flashNotice("已撤销");
  }, [flashNotice]);

  const removeSelected = useCallback(() => {
    const targets: SelectionTarget[] = [
      ...selectedPointIds.map((id) => ({ id, kind: "point" as const })),
      ...selectedEdgeIds.map((id) => ({ id, kind: "edge" as const })),
      ...selectedFaceIds.map((id) => ({ id, kind: "face" as const })),
    ];

    if (
      selectedTarget &&
      !targets.some((target) => targetEquals(target, selectedTarget))
    ) {
      targets.push(selectedTarget);
    }

    if (targets.length === 0) {
      return;
    }

    commitModel((draft) => {
      const orderedTargets = [
        ...targets.filter((target) => target.kind === "solid"),
        ...targets.filter((target) => target.kind === "point"),
        ...targets.filter((target) => target.kind === "face"),
        ...targets.filter((target) => target.kind === "edge"),
      ];

      for (const target of orderedTargets) {
        deleteTarget(draft, target);
      }
    });
    clearSelection();
    flashNotice("已删除");
  }, [
    clearSelection,
    commitModel,
    flashNotice,
    selectedEdgeIds,
    selectedFaceIds,
    selectedPointIds,
    selectedTarget,
  ]);

  const clearScene = useCallback(() => {
    if (
      model.points.length === 0 &&
      model.edges.length === 0 &&
      model.faces.length === 0 &&
      model.solids.length === 0
    ) {
      return;
    }

    commitModel((draft) => {
      draft.points = [];
      draft.edges = [];
      draft.faces = [];
      draft.solids = [];
    });
    clearSelection();
    flashNotice("已清空");
  }, [clearSelection, commitModel, flashNotice, model]);

  const saveAiSettings = useCallback(
    (settings: AiSettings) => {
      setAiSettings(settings);
      window.localStorage.setItem(
        AI_SETTINGS_STORAGE_KEY,
        JSON.stringify(settings),
      );
      flashNotice("设置已保存");
    },
    [flashNotice],
  );

  const changeAiModel = useCallback(
    (modelId: string) => {
      const nextSettings = {
        ...aiSettings,
        model: modelId,
      };

      setAiSettings(nextSettings);
      window.localStorage.setItem(
        AI_SETTINGS_STORAGE_KEY,
        JSON.stringify(nextSettings),
      );
      flashNotice("模型已切换");
    },
    [aiSettings, flashNotice],
  );

  const applyAiGeneratedModel = useCallback(
    (aiModel: AiGeneratedModel, mode: ApplyAiMode) => {
      let mergeResult = {
        edges: 0,
        faces: 0,
        points: 0,
        solids: 0,
      };

      const changed = commitModel((draft) => {
        if (mode === "replace") {
          draft.points = [];
          draft.edges = [];
          draft.faces = [];
          draft.solids = [];
        }

        mergeResult = mergeAiModelIntoScene(draft, aiModel);

        return (
          mergeResult.points > 0 ||
          mergeResult.edges > 0 ||
          mergeResult.faces > 0 ||
          mergeResult.solids > 0 ||
          mode === "replace"
        );
      });

      if (!changed) {
        flashNotice("AI 没有生成可用模型");
        return;
      }

      clearSelection();
      flashNotice(
        `AI 已生成 ${mergeResult.points} 点 / ${mergeResult.edges} 线 / ${mergeResult.faces} 面`,
      );
    },
    [clearSelection, commitModel, flashNotice],
  );

  const selectPoint = useCallback(
    (pointId: string) => {
      setSelectedTarget({ kind: "point", id: pointId });

      const nextIds = selectedPointIds.includes(pointId)
        ? selectedPointIds
        : [...selectedPointIds, pointId];

      setSelectedPointIds(nextIds);

      if (selectedPointIds.includes(pointId)) {
        flashNotice(`已选择 ${nextIds.length} 个点`);
        return;
      }

      flashNotice(`已选择 ${nextIds.length} 个点`);
    },
    [flashNotice, selectedPointIds],
  );

  const selectEdge = useCallback(
    (edgeId: string) => {
      setSelectedEdgeIds((current) => {
        const isSelected = current.includes(edgeId);
        const nextIds = isSelected
          ? current.filter((id) => id !== edgeId)
          : [...current, edgeId];

        setSelectedTarget(isSelected ? null : { kind: "edge", id: edgeId });
        flashNotice(`已选择 ${nextIds.length} 条线`);
        return nextIds;
      });
    },
    [flashNotice],
  );

  const selectFace = useCallback(
    (faceId: string) => {
      setSelectedFaceIds((current) => {
        const isSelected = current.includes(faceId);
        const nextIds = isSelected
          ? current.filter((id) => id !== faceId)
          : [...current, faceId];

        setSelectedTarget(isSelected ? null : { kind: "face", id: faceId });
        flashNotice(`已选择 ${nextIds.length} 个面`);
        return nextIds;
      });
    },
    [flashNotice],
  );

  const boxSelectPoints = useCallback(
    (pointIds: string[]) => {
      if (pointIds.length === 0) {
        setSelectedTarget(null);
        setSelectedPointIds([]);
        setSelectedEdgeIds([]);
        setSelectedFaceIds([]);
        flashNotice("框选未命中节点");
        return;
      }

      setSelectedPointIds(pointIds);
      setSelectedEdgeIds([]);
      setSelectedFaceIds([]);
      setSelectedTarget({ kind: "point", id: pointIds[pointIds.length - 1] });
      flashNotice(`已框选 ${pointIds.length} 个节点`);
    },
    [flashNotice],
  );

  const confirmPointSelection = useCallback(() => {
    if (
      selectedFaceIds.length === 1 &&
      selectedPointIds.length === 1 &&
      selectedEdgeIds.length === 0
    ) {
      let solidId: string | null = null;
      const changed = commitModel((draft) => {
        solidId = addPyramidFromFaceAndPoint(
          draft,
          selectedFaceIds[0],
          selectedPointIds[0],
          activeColor,
        );
        return Boolean(solidId);
      });

      if (!changed || !solidId) {
        flashNotice("面和点无法生成体");
        return;
      }

      clearSelection();
      setSelectedTarget({ kind: "solid", id: solidId });
      flashNotice("已生成体");
      return;
    }

    if (
      selectedFaceIds.length === 2 &&
      selectedPointIds.length === 0 &&
      selectedEdgeIds.length === 0
    ) {
      let solidId: string | null = null;
      const changed = commitModel((draft) => {
        solidId = addLoftFromFaces(
          draft,
          [selectedFaceIds[0], selectedFaceIds[1]],
          activeColor,
        );
        return Boolean(solidId);
      });

      if (!changed || !solidId) {
        flashNotice("两个面无法生成体");
        return;
      }

      clearSelection();
      setSelectedTarget({ kind: "solid", id: solidId });
      flashNotice("已生成体");
      return;
    }

    if (
      selectedEdgeIds.length === 1 &&
      selectedPointIds.length === 1 &&
      selectedFaceIds.length === 0
    ) {
      const changed = commitModel((draft) =>
        addTriangleFromEdgeAndPoint(
          draft,
          selectedEdgeIds[0],
          selectedPointIds[0],
          activeColor,
        ),
      );

      if (!changed) {
        flashNotice("点和线无法生成面");
        return;
      }

      clearSelection();
      flashNotice("已生成面");
      return;
    }

    if (
      selectedEdgeIds.length === 2 &&
      selectedPointIds.length === 0 &&
      selectedFaceIds.length === 0
    ) {
      const changed = commitModel((draft) =>
        addQuadFromOppositeEdges(
          draft,
          [selectedEdgeIds[0], selectedEdgeIds[1]],
          activeColor,
        ),
      );

      if (!changed) {
        flashNotice("两条线无法生成面");
        return;
      }

      clearSelection();
      flashNotice("已生成面");
      return;
    }

    if (selectedEdgeIds.length > 0 || selectedFaceIds.length > 0) {
      flashNotice("当前组合无法生成几何");
      return;
    }

    if (selectedPointIds.length < 2) {
      flashNotice("至少选择 2 个点");
      return;
    }

    if (selectedPointIds.length === 2) {
      const [a, b] = selectedPointIds as [string, string];

      if (hasEdgeBetween(model, a, b)) {
        flashNotice("线已存在");
        return;
      }

      commitModel((draft) => {
        createEdgeIfMissing(draft, a, b);
      });
      clearSelection();
      flashNotice("已生成线");
      return;
    }

    if (polygonArea(model, selectedPointIds) < 0.0001) {
      flashNotice("选中的点无法成面");
      return;
    }

    if (hasFaceWithPoints(model, selectedPointIds)) {
      flashNotice("面已存在");
      return;
    }

    commitModel((draft) => {
      return addPolygonFace(draft, selectedPointIds, activeColor);
    });
    clearSelection();
    flashNotice("已生成面");
  }, [
    activeColor,
    clearSelection,
    commitModel,
    flashNotice,
    model,
    selectedEdgeIds,
    selectedFaceIds,
    selectedPointIds,
  ]);

  const selectTarget = useCallback(
    (target: SelectionTarget) => {
      if (target.kind === "point") {
        selectPoint(target.id);
        return;
      }

      if (target.kind === "edge") {
        selectEdge(target.id);
        return;
      }

      if (target.kind === "face") {
        selectFace(target.id);
        return;
      }

      setSelectedTarget(target);
      flashNotice("已选择体");
    },
    [flashNotice, selectEdge, selectFace, selectPoint],
  );

  const chooseConstructionPlane = useCallback(
    (plane: ConstructionPlane) => {
      setConstructionPlane(plane);
      flashNotice(`构建平面 ${plane.toUpperCase()}`);
    },
    [flashNotice],
  );

  const setActivePlaneOffset = useCallback(
    (nextOffset: number) => {
      const offset = clampPlaneOffset(nextOffset);
      setPlaneOffsets((current) => ({
        ...current,
        [constructionPlane]: offset,
      }));
      flashNotice(`${PLANE_OFFSET_AXIS[constructionPlane]} ${offset.toFixed(2)}`);
    },
    [constructionPlane, flashNotice],
  );

  const handlePlaneOffsetInput = useCallback(
    (event: FormEvent<HTMLInputElement>) => {
      setActivePlaneOffset(Number(event.currentTarget.value));
    },
    [setActivePlaneOffset],
  );

  const createPoint = useCallback(
    (position: Vec3Tuple) => {
      const snappedPosition: Vec3Tuple = snapEnabled
        ? [
            snapToGrid(position[0]),
            snapToGrid(position[1]),
            snapToGrid(position[2]),
          ]
        : position;

      const nearbyPoint = model.points.find(
        (point) => distance(point.position, snappedPosition) < POINT_SNAP_RADIUS,
      );

      if (nearbyPoint) {
        selectPoint(nearbyPoint.id);
        return;
      }

      const pointId = `p${model.nextPointId}`;
      commitModel((draft) => {
        draft.points.push({
          id: `p${draft.nextPointId}`,
          position: snappedPosition,
        });
        draft.nextPointId += 1;
      });
      setSelectedTarget({ kind: "point", id: pointId });
      setSelectedPointIds([]);
      flashNotice(`已创建点 ${pointId.toUpperCase()}`);
    },
    [commitModel, flashNotice, model, selectPoint, snapEnabled],
  );

  const createShape = useCallback(
    (shape: ShapeDraft) => {
      if (
        shape.radiusA < SHAPE_MIN_RADIUS ||
        shape.radiusB < SHAPE_MIN_RADIUS
      ) {
        flashNotice("拖拽范围太小");
        return;
      }

      if (shape.tool === "sphere") {
        let solidId: string | null = null;
        const changed = commitModel((draft) => {
          solidId = addSphereFromShape(draft, shape, activeColor);
          return Boolean(solidId);
        });

        if (!changed || !solidId) {
          flashNotice("无法生成球体");
          return;
        }

        clearSelection();
        setSelectedTarget({ kind: "solid", id: solidId });
        setShapeTool("none");
        flashNotice("已生成球体");
        return;
      }

      const positions = getShapePointPositions(shape);
      let faceId: string | null = null;
      const changed = commitModel((draft) => {
        const pointIds: string[] = [];

        for (const position of positions) {
          const pointId = `p${draft.nextPointId}`;
          draft.points.push({
            id: pointId,
            position,
          });
          draft.nextPointId += 1;
          pointIds.push(pointId);
        }

        faceId = createPolygonFace(draft, pointIds, activeColor);
        return Boolean(faceId);
      });

      if (!changed || !faceId) {
        flashNotice("无法生成形状");
        return;
      }

      clearSelection();
      setSelectedTarget({ kind: "face", id: faceId });
      setShapeTool("none");
      flashNotice(`已生成${SHAPE_TOOL_LABEL[shape.tool]}`);
    },
    [activeColor, clearSelection, commitModel, flashNotice],
  );

  const chooseColor = useCallback(
    (color: string) => {
      setActiveColor(color);

      if (selectedTarget?.kind !== "face") {
        return;
      }

      commitModel((draft) => {
        const face = draft.faces.find((item) => item.id === selectedTarget.id);

        if (!face || face.color === color) {
          return false;
        }

        face.color = color;
      });
      flashNotice("已着色");
    },
    [commitModel, flashNotice, selectedTarget],
  );

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelected();
        return;
      }

      if (event.key === "Escape") {
        if (shapeTool !== "none") {
          setShapeTool("none");
          flashNotice("已退出绘制");
        }
        clearSelection();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        confirmPointSelection();
        return;
      }

      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === "1") {
          chooseConstructionPlane("xz");
        }

        if (event.key === "2") {
          chooseConstructionPlane("xy");
        }

        if (event.key === "3") {
          chooseConstructionPlane("yz");
        }

        if (event.key === "[") {
          setActivePlaneOffset(
            planeOffsets[constructionPlane] - PLANE_OFFSET_STEP,
          );
        }

        if (event.key === "]") {
          setActivePlaneOffset(
            planeOffsets[constructionPlane] + PLANE_OFFSET_STEP,
          );
        }

        if (event.key.toLowerCase() === "f") {
          toggleFacesOnly();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    chooseConstructionPlane,
    clearSelection,
    confirmPointSelection,
    constructionPlane,
    flashNotice,
    planeOffsets,
    removeSelected,
    setActivePlaneOffset,
    shapeTool,
    toggleFacesOnly,
    undo,
  ]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const selectedPointPositions = useMemo(
    () => {
      const pointDetails = selectedPointIds
        .map((id) => getPointById(model, id))
        .filter(Boolean)
        .map((point) => `${point!.id.toUpperCase()} (${formatTuple(point!.position)})`);

      if (pointDetails.length > 0 || selectedTarget?.kind !== "point") {
        return pointDetails;
      }

      const point = getPointById(model, selectedTarget.id);
      return point ? [`${point.id.toUpperCase()} (${formatTuple(point.position)})`] : [];
    },
    [model, selectedPointIds, selectedTarget],
  );

  const aiSelectionContext = useMemo<AiSelectionContext>(() => {
    const pointIds = new Set(selectedPointIds);
    const edgeIds = new Set(selectedEdgeIds);
    const faceIds = new Set(selectedFaceIds);
    const solidIds = new Set<string>();

    if (selectedTarget?.kind === "point") {
      pointIds.add(selectedTarget.id);
    }

    if (selectedTarget?.kind === "edge") {
      const edge = model.edges.find((item) => item.id === selectedTarget.id);

      if (edge) {
        edgeIds.add(edge.id);
        edge.points.forEach((id) => pointIds.add(id));
      }
    }

    if (selectedTarget?.kind === "face") {
      const face = model.faces.find((item) => item.id === selectedTarget.id);

      if (face) {
        faceIds.add(face.id);
        face.points.forEach((id) => pointIds.add(id));
      }
    }

    if (selectedTarget?.kind === "solid") {
      const solid = getSolidById(model, selectedTarget.id);

      if (solid) {
        solidIds.add(solid.id);
        solid.faces.forEach((faceId) => faceIds.add(faceId));
      }
    }

    for (const edgeId of edgeIds) {
      const edge = getEdgeById(model, edgeId);

      if (edge) {
        edge.points.forEach((id) => pointIds.add(id));
      }
    }

    for (const faceId of faceIds) {
      const face = getFaceById(model, faceId);

      if (face) {
        face.points.forEach((id) => pointIds.add(id));
      }
    }

    for (const edge of model.edges) {
      if (
        pointIds.size >= 2 &&
        pointIds.has(edge.points[0]) &&
        pointIds.has(edge.points[1])
      ) {
        edgeIds.add(edge.id);
      }
    }

    for (const face of model.faces) {
      if (
        pointIds.size >= 3 &&
        face.points.every((pointId) => pointIds.has(pointId))
      ) {
        faceIds.add(face.id);
      }
    }

    return {
      edges: model.edges
        .filter((edge) => edgeIds.has(edge.id))
        .map((edge) => ({ id: edge.id, points: edge.points })),
      faces: model.faces
        .filter((face) => faceIds.has(face.id))
        .map((face) => ({
          color: face.color,
          id: face.id,
          points: face.points,
        })),
      points: model.points
        .filter((point) => pointIds.has(point.id))
        .map((point) => ({ id: point.id, position: point.position })),
      selectedTarget,
      solids: model.solids
        .filter((solid) => solidIds.has(solid.id))
        .map((solid) => ({ faces: solid.faces, id: solid.id })),
    };
  }, [model, selectedEdgeIds, selectedFaceIds, selectedPointIds, selectedTarget]);

  const selectionLabel =
    selectedPointIds.length > 0 ||
    selectedEdgeIds.length > 0 ||
    selectedFaceIds.length > 0
      ? `已选 点 ${selectedPointIds.length} / 线 ${selectedEdgeIds.length} / 面 ${selectedFaceIds.length}`
      : describeTarget(selectedTarget);
  const activePlaneOffset = planeOffsets[constructionPlane];
  const activePlaneAxis = PLANE_OFFSET_AXIS[constructionPlane];
  const hasGeometry =
    model.points.length > 0 ||
    model.edges.length > 0 ||
    model.faces.length > 0 ||
    model.solids.length > 0;

  return (
    <div className="app-shell">
      <Workspace3D
        constructionPlane={constructionPlane}
        constructionPlaneOffset={activePlaneOffset}
        facesOnly={facesOnly}
        hoveredTarget={hoveredTarget}
        model={model}
        onBoxSelectPoints={boxSelectPoints}
        onCreatePoint={createPoint}
        onCreateShape={createShape}
        onHoverTarget={(target) => {
          if (!targetEquals(hoveredTarget, target)) {
            setHoveredTarget(target);
          }
        }}
        onSelectTarget={selectTarget}
        selectedEdgeIds={selectedEdgeIds}
        selectedFaceIds={selectedFaceIds}
        selectedPointIds={selectedPointIds}
        selectedTarget={selectedTarget}
        shapeTool={shapeTool}
      />

      <AiModelDialog
        currentScene={{
          edges: model.edges.length,
          faces: model.faces.length,
          points: model.points.length,
          solids: model.solids.length,
        }}
        isOpen={aiDialogOpen}
        selectionContext={aiSelectionContext}
        settings={aiSettings}
        onApply={applyAiGeneratedModel}
        onClose={() => setAiDialogOpen(false)}
        onModelChange={changeAiModel}
      />

      <SettingsDialog
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={saveAiSettings}
        settings={aiSettings}
      />

      <header className="top-bar">
        <div className="brand-mark">
          <Triangle size={17} strokeWidth={2.4} />
          <span>CreatorX</span>
        </div>
        <div className="metrics">
          <span>点 {model.points.length}</span>
          <span>线 {model.edges.length}</span>
          <span>面 {model.faces.length}</span>
          <span>体 {model.solids.length}</span>
        </div>
        <div className="status-line">{notice}</div>
      </header>

      <nav className="tool-rail" aria-label="编辑工具">
        <button
          aria-label="撤销"
          className="icon-button"
          disabled={historySize === 0}
          onClick={undo}
          title="撤销"
          type="button"
        >
          <RotateCcw size={20} />
        </button>
        <button
          aria-label="删除"
          className="icon-button"
          disabled={
            !selectedTarget &&
            selectedPointIds.length === 0 &&
            selectedEdgeIds.length === 0 &&
            selectedFaceIds.length === 0
          }
          onClick={removeSelected}
          title="删除"
          type="button"
        >
          <Trash2 size={20} />
        </button>
        <button
          aria-label="清空"
          className="icon-button"
          disabled={!hasGeometry}
          onClick={clearScene}
          title="清空"
          type="button"
        >
          <Eraser size={20} />
        </button>
        <button
          aria-label="网格吸附"
          className={`icon-button ${snapEnabled ? "is-active" : ""}`}
          onClick={() => setSnapEnabled((enabled) => !enabled)}
          title="网格吸附"
          type="button"
        >
          <Magnet size={20} />
        </button>
        <button
          aria-label="绘制圆"
          className={`icon-button ${shapeTool === "circle" ? "is-active" : ""}`}
          onClick={() => chooseShapeTool("circle")}
          title="绘制圆"
          type="button"
        >
          <Circle size={20} />
        </button>
        <button
          aria-label="绘制椭圆"
          className={`icon-button ${shapeTool === "ellipse" ? "is-active" : ""}`}
          onClick={() => chooseShapeTool("ellipse")}
          title="绘制椭圆"
          type="button"
        >
          <Radius size={20} />
        </button>
        <button
          aria-label="生成球体"
          className={`icon-button ${shapeTool === "sphere" ? "is-active" : ""}`}
          onClick={() => chooseShapeTool("sphere")}
          title="生成球体"
          type="button"
        >
          <Orbit size={20} />
        </button>
        <button
          aria-label="AI 生成模型"
          className="icon-button"
          onClick={() => setAiDialogOpen(true)}
          title="AI 生成模型"
          type="button"
        >
          <WandSparkles size={20} />
        </button>
        <button
          aria-label="设置"
          className="icon-button"
          onClick={() => setSettingsOpen(true)}
          title="设置"
          type="button"
        >
          <Settings size={20} />
        </button>
        <button
          aria-label="只显示面"
          className={`icon-button ${facesOnly ? "is-active" : ""}`}
          onClick={toggleFacesOnly}
          title="只显示面"
          type="button"
        >
          <Eye size={20} />
        </button>
      </nav>

      <section className="plane-switcher" aria-label="构建平面">
        {CONSTRUCTION_PLANES.map((plane) => (
          <button
            className={constructionPlane === plane.id ? "is-active" : ""}
            key={plane.id}
            onClick={() => chooseConstructionPlane(plane.id)}
            title={plane.title}
            type="button"
          >
            {plane.label}
          </button>
        ))}
      </section>

      <section className="plane-offset" aria-label="构建平面偏移">
        <button
          aria-label="降低构建平面"
          className="compact-icon-button"
          disabled={activePlaneOffset <= -PLANE_OFFSET_LIMIT}
          onClick={() =>
            setActivePlaneOffset(activePlaneOffset - PLANE_OFFSET_STEP)
          }
          title="降低构建平面"
          type="button"
        >
          <Minus size={16} />
        </button>
        <output>
          {activePlaneAxis} {activePlaneOffset.toFixed(2)}
        </output>
        <input
          aria-label="构建平面偏移滑块"
          max={PLANE_OFFSET_LIMIT}
          min={-PLANE_OFFSET_LIMIT}
          onInput={handlePlaneOffsetInput}
          step={PLANE_OFFSET_STEP}
          type="range"
          value={activePlaneOffset}
        />
        <button
          aria-label="抬高构建平面"
          className="compact-icon-button"
          disabled={activePlaneOffset >= PLANE_OFFSET_LIMIT}
          onClick={() =>
            setActivePlaneOffset(activePlaneOffset + PLANE_OFFSET_STEP)
          }
          title="抬高构建平面"
          type="button"
        >
          <Plus size={16} />
        </button>
      </section>

      <aside className="palette-panel" aria-label="颜色">
        <Brush size={18} />
        <div className="swatches">
          {FACE_COLORS.map((color) => (
            <button
              aria-label={`颜色 ${color}`}
              className={`swatch ${activeColor === color ? "is-active" : ""}`}
              key={color}
              onClick={() => chooseColor(color)}
              style={{ backgroundColor: color }}
              title={color}
              type="button"
            />
          ))}
        </div>
      </aside>

      <footer className="selection-strip">
        <span>{selectionLabel}</span>
        <span className="plane-label">
          平面 {constructionPlane.toUpperCase()} · {activePlaneAxis}{" "}
          {activePlaneOffset.toFixed(2)}
        </span>
        {shapeTool !== "none" && (
          <span className="view-label">{SHAPE_TOOL_LABEL[shapeTool]}工具</span>
        )}
        {facesOnly && <span className="view-label">只显示面</span>}
        {selectedPointPositions.length > 0 && (
          <span className="point-chain">{selectedPointPositions.join("  /  ")}</span>
        )}
      </footer>
    </div>
  );
}

export default App;
