import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { GripHorizontal, Loader2, Maximize2, Minus, Send, X } from "lucide-react";
import { AiGeneratedModel } from "./aiSchema";
import { ApplyAiMode, normalizeAiModel } from "./aiModel";
import { AiSettings } from "./SettingsDialog";
import { AI_PROVIDER_OPTIONS, MODEL_OPTIONS_BY_PROVIDER } from "./aiModels";
import type {
  EdgeNode,
  FaceNode,
  PointNode,
  SelectionTarget,
  SolidNode,
} from "./model";

const PANEL_MARGIN = 12;
const PANEL_WIDTH = 420;
const PANEL_DEFAULT_Y = 78;

export type AiDetailLevel = "standard" | "high" | "ultra";

const DETAIL_LEVEL_OPTIONS: Array<{
  description: string;
  label: string;
  value: AiDetailLevel;
}> = [
  {
    description: "更多分段和结构线，默认推荐",
    label: "高",
    value: "high",
  },
  {
    description: "控制点面数量，适合快速草图",
    label: "标准",
    value: "standard",
  },
  {
    description: "尽量表达轮廓、倒角和局部细节",
    label: "极高",
    value: "ultra",
  },
];

type PanelPosition = {
  x: number;
  y: number;
};

export type AiSelectionContext = {
  edges: Array<Pick<EdgeNode, "id" | "points">>;
  faces: Array<Pick<FaceNode, "color" | "id" | "points">>;
  points: Array<Pick<PointNode, "id" | "position">>;
  selectedTarget: SelectionTarget | null;
  solids: Array<Pick<SolidNode, "faces" | "id">>;
};

const getPanelWidth = () => {
  if (typeof window === "undefined") {
    return PANEL_WIDTH;
  }

  return Math.min(PANEL_WIDTH, window.innerWidth - PANEL_MARGIN * 2);
};

const getDefaultPanelPosition = (): PanelPosition => {
  if (typeof window === "undefined") {
    return { x: 0, y: PANEL_DEFAULT_Y };
  }

  const width = getPanelWidth();

  return {
    x: Math.max(PANEL_MARGIN, window.innerWidth - width - 16),
    y: window.innerWidth <= 720 ? 96 : PANEL_DEFAULT_Y,
  };
};

const clampPanelPosition = (
  position: PanelPosition,
  panelElement: HTMLElement | null,
): PanelPosition => {
  if (typeof window === "undefined") {
    return position;
  }

  const width = panelElement?.offsetWidth || getPanelWidth();
  const height = panelElement?.offsetHeight || 160;
  const maxX = Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN);
  const maxY = Math.max(
    PANEL_MARGIN,
    window.innerHeight - height - PANEL_MARGIN,
  );

  return {
    x: Math.min(maxX, Math.max(PANEL_MARGIN, position.x)),
    y: Math.min(maxY, Math.max(PANEL_MARGIN, position.y)),
  };
};

type AiModelDialogProps = {
  currentScene: {
    edges: number;
    faces: number;
    points: number;
    solids: number;
  };
  isOpen: boolean;
  settings: AiSettings;
  selectionContext: AiSelectionContext;
  onApply: (model: AiGeneratedModel, mode: ApplyAiMode) => void;
  onClose: () => void;
  onModelChange: (model: string) => void;
};

function AiModelDialog({
  currentScene,
  isOpen,
  settings,
  selectionContext,
  onApply,
  onClose,
  onModelChange,
}: AiModelDialogProps) {
  const [prompt, setPrompt] = useState(
    "生成一个白色小房子，包含墙体、屋顶、门、窗户和烟囱",
  );
  const [mode, setMode] = useState<ApplyAiMode>("add");
  const [detailLevel, setDetailLevel] = useState<AiDetailLevel>("high");
  const [isLoading, setIsLoading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState("描述一个几何模型，我会把它生成到场景里。");
  const [error, setError] = useState("");
  const [panelPosition, setPanelPosition] = useState<PanelPosition>(
    getDefaultPanelPosition,
  );
  const panelRef = useRef<HTMLElement | null>(null);
  const dragOffsetRef = useRef<PanelPosition>({ x: 0, y: 0 });

  useEffect(() => {
    const keepPanelInViewport = () => {
      setPanelPosition((current) =>
        clampPanelPosition(current, panelRef.current),
      );
    };

    window.addEventListener("resize", keepPanelInViewport);
    return () => window.removeEventListener("resize", keepPanelInViewport);
  }, []);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const movePanel = (event: PointerEvent) => {
      setPanelPosition(
        clampPanelPosition(
          {
            x: event.clientX - dragOffsetRef.current.x,
            y: event.clientY - dragOffsetRef.current.y,
          },
          panelRef.current,
        ),
      );
    };
    const stopDragging = () => setIsDragging(false);

    window.addEventListener("pointermove", movePanel);
    window.addEventListener("pointerup", stopDragging);
    return () => {
      window.removeEventListener("pointermove", movePanel);
      window.removeEventListener("pointerup", stopDragging);
    };
  }, [isDragging]);

  if (!isOpen) {
    return null;
  }

  const activeProvider = AI_PROVIDER_OPTIONS.find(
    (option) => option.value === settings.provider,
  );
  const modelOptions = MODEL_OPTIONS_BY_PROVIDER[settings.provider];
  const activeModel =
    modelOptions.find((option) => option.value === settings.model) ||
    modelOptions[0];
  const activeDetailLevel =
    DETAIL_LEVEL_OPTIONS.find((option) => option.value === detailLevel) ||
    DETAIL_LEVEL_OPTIONS[0];
  const selectionContextSummary =
    selectionContext.points.length > 0 ||
    selectionContext.edges.length > 0 ||
    selectionContext.faces.length > 0 ||
    selectionContext.solids.length > 0
      ? `上下文：${selectionContext.points.length} 点 / ${selectionContext.edges.length} 线 / ${selectionContext.faces.length} 面 / ${selectionContext.solids.length} 体`
      : "上下文：未选中元素";

  const startDragging = (event: ReactPointerEvent<HTMLElement>) => {
    if (
      event.button !== 0 ||
      (event.target instanceof HTMLElement &&
        event.target.closest("button, input, select, textarea"))
    ) {
      return;
    }

    const panelBounds = panelRef.current?.getBoundingClientRect();

    if (!panelBounds) {
      return;
    }

    dragOffsetRef.current = {
      x: event.clientX - panelBounds.left,
      y: event.clientY - panelBounds.top,
    };
    setIsDragging(true);
  };

  const changeModel = (nextModel: string) => {
    onModelChange(nextModel);
    setMessage(`已选择 ${activeProvider?.label || "AI"} 模型。`);
  };

  const generateModel = async (event: FormEvent) => {
    event.preventDefault();

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || isLoading) {
      return;
    }

    setIsLoading(true);
    setError("");
    setMessage("正在生成高精度模型...");

    try {
      const response = await fetch("/api/ai-model", {
        body: JSON.stringify({
          apiKey: settings.apiKey,
          currentScene,
          detailLevel,
          faceLimit: settings.faceLimit,
          model: settings.model,
          prompt: trimmedPrompt,
          provider: settings.provider,
          selectionContext,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "AI 生成失败");
      }

      const model = normalizeAiModel(payload.model);
      onApply(model, mode);
      setMessage(
        `${model.summary}（${model.points.length} 点 / ${model.edges.length} 线 / ${model.faces.length} 面 / ${model.solids.length} 体）`,
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "AI 生成失败",
      );
      setMessage("生成没有成功，可以调整描述后再试。");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <aside
      aria-label="AI 生成模型"
      className={`ai-chat-panel ${isCollapsed ? "is-collapsed" : ""} ${
        isDragging ? "is-dragging" : ""
      }`}
      ref={panelRef}
      style={{
        left: panelPosition.x,
        top: panelPosition.y,
      }}
    >
      <header
        className="ai-dialog-header ai-chat-header"
        onPointerDown={startDragging}
      >
        <div className="ai-header-copy">
          <div className="ai-title-row">
            <GripHorizontal size={16} />
            <h2>AI 生成模型</h2>
          </div>
          <p>{message}</p>
        </div>
        <div className="ai-header-actions">
          <button
            aria-label={isCollapsed ? "展开 AI 对话框" : "收起 AI 对话框"}
            className="compact-icon-button"
            onClick={() => setIsCollapsed((current) => !current)}
            type="button"
          >
            {isCollapsed ? <Maximize2 size={16} /> : <Minus size={16} />}
          </button>
          <button
            aria-label="关闭 AI 对话框"
            className="compact-icon-button"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {!isCollapsed && (
        <form className="ai-dialog-body" onSubmit={generateModel}>
          <label className="settings-field ai-model-field">
            <span>模型</span>
            <select
              aria-label="AI 模型"
              onChange={(event) => changeModel(event.target.value)}
              value={activeModel.value}
            >
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>
              {activeProvider?.label} · {activeModel.description}
            </small>
          </label>

          <label className="settings-field">
            <span>精细度</span>
            <select
              aria-label="AI 生成精细度"
              onChange={(event) =>
                setDetailLevel(event.target.value as AiDetailLevel)
              }
              value={activeDetailLevel.value}
            >
              {DETAIL_LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>{activeDetailLevel.description}</small>
          </label>

          <p className="ai-context-note">{selectionContextSummary}</p>

          <textarea
            aria-label="模型描述"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：生成一个蓝色立方体，顶部有红色三角屋顶"
            value={prompt}
          />

          <div className="ai-dialog-actions">
            <div className="mode-toggle" role="group" aria-label="应用方式">
              <button
                className={mode === "add" ? "is-active" : ""}
                onClick={() => setMode("add")}
                type="button"
              >
                添加
              </button>
              <button
                className={mode === "replace" ? "is-active" : ""}
                onClick={() => setMode("replace")}
                type="button"
              >
                替换
              </button>
            </div>

            <button className="primary-button" disabled={isLoading} type="submit">
              {isLoading ? (
                <Loader2 className="is-spinning" size={16} />
              ) : (
                <Send size={16} />
              )}
              <span>生成模型</span>
            </button>
          </div>

          {error && <p className="ai-error">{error}</p>}
        </form>
      )}
    </aside>
  );
}

export default AiModelDialog;
