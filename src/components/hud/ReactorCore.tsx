import { useEffect, useRef } from "react";

type Node3 = { x: number; y: number; z: number; s: number; len: number; phase: number };

/**
 * Holografisk gyllen sfære – roterende punktnett med radielle lysstreker,
 * inspirert av et Jarvis-aktig datahologram.
 */
export function ReactorCore({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let raf = 0;
    let t = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Fibonacci-sfære
    const N = 520;
    const nodes: Node3[] = Array.from({ length: N }, (_, i) => {
      const k = i + 0.5;
      const phi = Math.acos(1 - (2 * k) / N);
      const theta = Math.PI * (1 + Math.sqrt(5)) * k;
      return {
        x: Math.cos(theta) * Math.sin(phi),
        y: Math.sin(theta) * Math.sin(phi),
        z: Math.cos(phi),
        s: Math.random() * 0.8 + 0.4,
        len: Math.random() * 0.22 + 0.04,
        phase: Math.random() * Math.PI * 2,
      };
    });

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      t += reduce ? 0 : 0.0035;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.42;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      const ca = Math.cos(t);
      const sa = Math.sin(t);
      const cb = Math.cos(t * 0.45);
      const sb = Math.sin(t * 0.45);
      const boost = activeRef.current ? 1 : 0.65;

      for (const n of nodes) {
        // rotasjon rundt Y, deretter litt rundt X
        let x = n.x * ca - n.z * sa;
        let z = n.x * sa + n.z * ca;
        let y = n.y * cb - z * sb;
        z = n.y * sb + z * cb;

        const depth = (z + 1) / 2; // 0 bak, 1 foran
        const persp = 0.72 + depth * 0.4;
        const px = cx + x * R * persp;
        const py = cy + y * R * persp;

        const flick = 0.55 + 0.45 * Math.sin(t * 9 + n.phase);
        const alpha = (0.08 + depth * 0.55) * flick * boost;

        // radiell lysstrek utover fra sentrum
        const ex = cx + x * R * persp * (1 + n.len);
        const ey = cy + y * R * persp * (1 + n.len);
        ctx.strokeStyle = `oklch(0.82 0.16 78 / ${(alpha * 0.55).toFixed(3)})`;
        ctx.lineWidth = n.s * 0.9;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        ctx.fillStyle = `oklch(0.9 0.15 85 / ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(px, py, n.s * (0.6 + depth), 0, Math.PI * 2);
        ctx.fill();
      }

      // roterende ringer
      for (let i = 0; i < 3; i++) {
        const tilt = t * (0.6 + i * 0.25) + i;
        ctx.strokeStyle = `oklch(0.85 0.15 80 / ${(0.16 * boost).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, R * (0.95 - i * 0.13), R * Math.abs(Math.cos(tilt)) * 0.95, i * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // kjerne
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.45);
      const pulse = 0.25 + 0.12 * Math.sin(t * 6);
      g.addColorStop(0, `oklch(0.95 0.14 88 / ${(pulse * boost).toFixed(3)})`);
      g.addColorStop(1, "oklch(0.95 0.14 88 / 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.45, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <canvas ref={ref} className="size-[min(86vmin,860px)]" />
    </div>
  );
}
