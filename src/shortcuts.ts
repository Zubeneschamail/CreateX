type ShortcutEvent = Pick<
  KeyboardEvent | PointerEvent,
  "ctrlKey" | "metaKey"
>;

export const isMacLikePlatform = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

export const isPrimaryModifier = (event: ShortcutEvent) =>
  isMacLikePlatform() ? event.metaKey : event.ctrlKey;

export const getPrimaryShortcutLabel = (key: string) =>
  `${isMacLikePlatform() ? "⌘" : "Ctrl+"}${key}`;

export const getPrimaryDragLabel = (action: string) =>
  `${isMacLikePlatform() ? "⌘" : "Ctrl"} ${action}`;
