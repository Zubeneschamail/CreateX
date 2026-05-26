export const AI_MODEL_SCHEMA_LIMITS = {
  coordinate: 5,
  edges: 1600,
  faces: 768,
  facePoints: 48,
  points: 800,
  solids: 48,
  solidFaces: 768,
} as const;

export const DEFAULT_AI_FACE_LIMIT = 512;
export const MIN_AI_FACE_LIMIT = 32;

export const clampAiFaceLimit = (value: unknown) => {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_AI_FACE_LIMIT;
  }

  return Math.min(
    AI_MODEL_SCHEMA_LIMITS.faces,
    Math.max(MIN_AI_FACE_LIMIT, Math.round(numericValue)),
  );
};

export const AI_MODEL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "summary", "points", "edges", "faces", "solids"],
  properties: {
    name: {
      type: "string",
      description: "A short model name.",
    },
    summary: {
      type: "string",
      description: "One concise Chinese sentence describing the generated model.",
    },
    points: {
      type: "array",
      minItems: 1,
      maxItems: AI_MODEL_SCHEMA_LIMITS.points,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "position"],
        properties: {
          id: {
            type: "string",
            description: "Unique point id such as p1.",
          },
          position: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: {
              type: "number",
              minimum: -AI_MODEL_SCHEMA_LIMITS.coordinate,
              maximum: AI_MODEL_SCHEMA_LIMITS.coordinate,
            },
          },
        },
      },
    },
    edges: {
      type: "array",
      maxItems: AI_MODEL_SCHEMA_LIMITS.edges,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "points"],
        properties: {
          id: {
            type: "string",
            description: "Unique edge id such as e1.",
          },
          points: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: {
              type: "string",
            },
          },
        },
      },
    },
    faces: {
      type: "array",
      minItems: 0,
      maxItems: AI_MODEL_SCHEMA_LIMITS.faces,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "edges", "color"],
        properties: {
          id: {
            type: "string",
            description: "Unique face id such as f1.",
          },
          edges: {
            type: "array",
            minItems: 3,
            maxItems: AI_MODEL_SCHEMA_LIMITS.facePoints,
            description:
              "Ordered edge ids forming one closed boundary loop for this face.",
            items: {
              type: "string",
            },
          },
          color: {
            type: "string",
            pattern: "^#[0-9a-fA-F]{6}$",
          },
        },
      },
    },
    solids: {
      type: "array",
      minItems: 0,
      maxItems: AI_MODEL_SCHEMA_LIMITS.solids,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["faces"],
        properties: {
          faces: {
            type: "array",
            minItems: 4,
            maxItems: AI_MODEL_SCHEMA_LIMITS.solidFaces,
            items: {
              type: "string",
            },
          },
        },
      },
    },
  },
} as const;

export const createAiModelJsonSchema = (faceLimit: unknown) => {
  const maxFaces = clampAiFaceLimit(faceLimit);

  return {
    ...AI_MODEL_JSON_SCHEMA,
    properties: {
      ...AI_MODEL_JSON_SCHEMA.properties,
      faces: {
        ...AI_MODEL_JSON_SCHEMA.properties.faces,
        maxItems: maxFaces,
      },
      solids: {
        ...AI_MODEL_JSON_SCHEMA.properties.solids,
        items: {
          ...AI_MODEL_JSON_SCHEMA.properties.solids.items,
          properties: {
            ...AI_MODEL_JSON_SCHEMA.properties.solids.items.properties,
            faces: {
              ...AI_MODEL_JSON_SCHEMA.properties.solids.items.properties.faces,
              maxItems: maxFaces,
            },
          },
        },
      },
    },
  };
};

export type AiGeneratedPoint = {
  id: string;
  position: [number, number, number];
};

export type AiGeneratedEdge = {
  id: string;
  points: [string, string];
};

export type AiGeneratedFace = {
  id: string;
  edges: string[];
  points: string[];
  color: string;
};

export type AiGeneratedSolid = {
  faces: string[];
};

export type AiGeneratedModel = {
  name: string;
  summary: string;
  points: AiGeneratedPoint[];
  edges: AiGeneratedEdge[];
  faces: AiGeneratedFace[];
  solids: AiGeneratedSolid[];
};
