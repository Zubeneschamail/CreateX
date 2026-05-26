export const AI_MODEL_SCHEMA_LIMITS = {
  coordinate: 5,
  faces: 48,
  facePoints: 16,
  points: 80,
} as const;

export const AI_MODEL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "summary", "points", "edges", "faces"],
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
      maxItems: 120,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["points"],
        properties: {
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
        required: ["points", "color"],
        properties: {
          points: {
            type: "array",
            minItems: 3,
            maxItems: AI_MODEL_SCHEMA_LIMITS.facePoints,
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
  },
} as const;

export type AiGeneratedPoint = {
  id: string;
  position: [number, number, number];
};

export type AiGeneratedEdge = {
  points: [string, string];
};

export type AiGeneratedFace = {
  points: string[];
  color: string;
};

export type AiGeneratedModel = {
  name: string;
  summary: string;
  points: AiGeneratedPoint[];
  edges: AiGeneratedEdge[];
  faces: AiGeneratedFace[];
};
