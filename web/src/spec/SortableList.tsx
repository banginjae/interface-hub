import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";

type Drop = { index: number; after: boolean } | null;

export function SortableList<T>({
  items,
  itemKey,
  itemLabel,
  onMove,
  disabled = false,
  children,
}: {
  items: T[];
  itemKey: (item: T) => string;
  itemLabel: (item: T) => string;
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
  children: (item: T, index: number) => ReactNode;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (focusKey) {
      handles.current.get(focusKey)?.focus();
      setFocusKey(null);
    }
  }, [focusKey, items]);

  function reset() {
    setDragIndex(null);
    setDrop(null);
  }

  function onDragStart(event: DragEvent<HTMLLIElement>, index: number) {
    if (disabled) {
      event.preventDefault();
      return;
    }
    setDragIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", itemKey(items[index]));
  }

  function onDragOver(event: DragEvent<HTMLLIElement>, index: number) {
    if (dragIndex === null) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const box = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    if (!drop || drop.index !== index || drop.after !== after) {
      setDrop({ index, after });
    }
  }

  function onDrop(event: DragEvent<HTMLLIElement>) {
    event.preventDefault();
    if (dragIndex !== null && drop) {
      let to = drop.after ? drop.index + 1 : drop.index;
      if (to > dragIndex) {
        to -= 1;
      }
      if (to !== dragIndex) {
        onMove(dragIndex, to);
      }
    }
    reset();
  }

  function onHandleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!step || disabled) {
      return;
    }
    event.preventDefault();
    const to = index + step;
    if (to < 0 || to >= items.length) {
      return;
    }
    onMove(index, to);
    setFocusKey(itemKey(items[index]));
  }

  return (
    <ol className={dragIndex === null ? "ep-list is-ordering" : "ep-list is-ordering is-dragging"}>
      {items.map((item, index) => {
        const key = itemKey(item);
        const classes = [
          "ep-order-row is-sortable",
          dragIndex === index ? "is-dragged" : "",
          drop && drop.index === index && dragIndex !== index ? (drop.after ? "drop-after" : "drop-before") : "",
        ].filter(Boolean).join(" ");
        return (
          <li
            key={key}
            className={classes}
            draggable={!disabled}
            onDragStart={(event) => onDragStart(event, index)}
            onDragOver={(event) => onDragOver(event, index)}
            onDrop={onDrop}
            onDragEnd={reset}
          >
            <button
              type="button"
              className="drag-handle"
              aria-label={`${itemLabel(item)} 순서 이동. 위·아래 화살표 키로도 옮길 수 있습니다.`}
              title="끌어서 순서를 바꿉니다"
              disabled={disabled}
              ref={(element) => {
                if (element) handles.current.set(key, element);
                else handles.current.delete(key);
              }}
              onKeyDown={(event) => onHandleKey(event, index)}
            >
              <span aria-hidden="true">⋮⋮</span>
            </button>
            <span className="ep-order-index">{index + 1}</span>
            {children(item, index)}
          </li>
        );
      })}
    </ol>
  );
}
