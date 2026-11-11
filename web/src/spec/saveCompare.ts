// Compares what a save request would actually persist, so that UI-only state, whitespace the
// server trims, key order and the order of linked error codes do not count as changes.

export type ItemSaveBody = {
  name: string;
  summary: string;
  status: string;
  payload: unknown;
  errorCodeIds: number[];
};

type ItemDraftLike = {
  name: string;
  summary: string;
  status: string;
  errorCodeIds?: number[];
};

export function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left === "number" && typeof right === "number") {
    return Number.isNaN(left) && Number.isNaN(right);
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => sameValue(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = definedKeys(left);
  const rightKeys = definedKeys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]));
}

// Returns null when the draft cannot be converted yet; callers treat that as "changed".
export function itemSaveBody<T extends ItemDraftLike>(draft: T | null, toPayload: (draft: T) => unknown, nameOf?: (draft: T) => string): ItemSaveBody | null {
  if (!draft) {
    return null;
  }
  try {
    return {
      name: (nameOf ? nameOf(draft) : draft.name).trim(),
      summary: draft.summary.trim(),
      status: draft.status,
      payload: toPayload(draft),
      errorCodeIds: [...new Set(draft.errorCodeIds ?? [])].sort((a, b) => a - b),
    };
  } catch {
    return null;
  }
}

export function itemChanged(isNew: boolean, baseline: ItemSaveBody | null, current: ItemSaveBody | null) {
  return isNew || !baseline || !current || !sameValue(baseline, current);
}

export const noChangeMessage = "변경 사항이 없어 저장하지 않았습니다.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function definedKeys(value: Record<string, unknown>) {
  return Object.keys(value).filter((key) => value[key] !== undefined);
}
