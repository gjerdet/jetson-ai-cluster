import { useRef, useState, type ReactNode } from "react";
import { Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  subtitle?: string;
  initial: { x: number; y: number; w: number; h: number };
  onClose: () => void;
  onFocus: () => void;
  z: number;
  fullscreen?: boolean;
  children: ReactNode;
  className?: string;
};

const MIN_W = 280;
const MIN_H = 200;

export function HudWindow({
  title,
  subtitle,
  initial,
  onClose,
  onFocus,
  z,
  fullscreen,
  children,
  className,
}: Props) {
  const [pos, setPos] = useState({ x: initial.x, y: initial.y });
  const [size, setSize] = useState({ w: initial.w, h: initial.h });
  const [min, setMin] = useState(false);
  // på mobil legger vi vinduene i fullskjerm slik at de faktisk er brukbare
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const locked = fullscreen || narrow;
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const resize = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    onFocus();
    if (locked) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPos({
      x: Math.max(0, e.clientX - drag.current.dx),
      y: Math.max(0, e.clientY - drag.current.dy),
    });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (locked) return;
    onFocus();
    resize.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const r = resize.current;
    if (!r) return;
    setSize({
      w: Math.max(MIN_W, r.w + (e.clientX - r.x)),
      h: Math.max(MIN_H, r.h + (e.clientY - r.y)),
    });
  };
  const onResizeUp = () => {
    resize.current = null;
  };

  return (
    <div
      onMouseDown={onFocus}
      style={
        narrow
          ? { zIndex: z }
          : min
            ? {
                left: Math.max(pos.x, 24),
                top: Math.max(pos.y, 72),
                width: fullscreen ? 320 : size.w,
                zIndex: z,
              }
            : fullscreen
              ? { zIndex: z }
              : { left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: z }
      }
      className={cn(
        "hud-panel flex flex-col overflow-hidden rounded-lg animate-hud-in",
        narrow
          ? min
            ? "fixed inset-x-2 top-16"
            : "fixed inset-x-2 top-16 bottom-2"
          : !min && fullscreen
            ? "fixed inset-3 md:inset-8"
            : "absolute",
        className,
      )}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          "flex items-center justify-between gap-3 border-b border-primary/25 bg-primary/5 px-3 py-2",
          locked && !min ? "" : "cursor-grab active:cursor-grabbing",
        )}
      >
        <div className="min-w-0">
          <p className="hud-title truncate text-[11px] text-primary">{title}</p>
          {subtitle && !min ? (
            <p className="truncate text-[10px] text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMin((v) => !v)}
            aria-label={min ? `Gjenopprett ${title}` : `Minimer ${title}`}
            className="hud-btn hud-btn-hoverable size-7 !p-0"
          >
            {min ? <Square className="size-3" /> : <Minus className="size-3.5" />}
          </button>
          <button
            onClick={onClose}
            aria-label={`Lukk ${title}`}
            className="hud-btn hud-btn-hoverable size-7 !p-0 hover:!border-destructive/60 hover:!text-destructive"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      {min ? null : <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>}
      {!fullscreen && !min ? (
        <div
          role="separator"
          aria-label={`Endre størrelse på ${title}`}
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          className="hud-resize"
        />
      ) : null}
    </div>
  );
}
