import { useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
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
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    onFocus();
    if (fullscreen) return;
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

  return (
    <div
      onMouseDown={onFocus}
      style={
        fullscreen
          ? { zIndex: z }
          : { left: pos.x, top: pos.y, width: initial.w, height: initial.h, zIndex: z }
      }
      className={cn(
        "hud-panel flex flex-col overflow-hidden rounded-lg animate-hud-in",
        fullscreen ? "fixed inset-3 md:inset-8" : "absolute",
        className,
      )}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          "flex items-center justify-between gap-3 border-b border-primary/25 bg-primary/5 px-3 py-2",
          fullscreen ? "" : "cursor-grab active:cursor-grabbing",
        )}
      >
        <div className="min-w-0">
          <p className="hud-title truncate text-[11px] text-primary">{title}</p>
          {subtitle ? (
            <p className="truncate text-[10px] text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <button
          onClick={onClose}
          aria-label={`Lukk ${title}`}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </div>
  );
}
