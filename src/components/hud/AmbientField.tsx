import { useEffect, useRef } from "react";

type P = { x: number; y: number; vx: number; vy: number; r: number };

export function AmbientField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let points: P[] = [];

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(28, Math.min(90, Math.round((w * h) / 26000)));
      points = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.4 + 0.4,
      }));
    };

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // musepeker påvirker feltet
    const m = { x: -9999, y: -9999 };
    const onMouse = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      m.x = e.clientX - r.left;
      m.y = e.clientY - r.top;
    };
    if (!reduce) window.addEventListener("pointermove", onMouse);

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of points) {
        if (!reduce) {
          p.x += p.vx;
          p.y += p.vy;
          // svak dragning mot musa
          const dx = m.x - p.x;
          const dy = m.y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 260 * 260 && d2 > 1) {
            const f = 0.035 / Math.sqrt(d2);
            p.vx += dx * f;
            p.vy += dy * f;
          }
          const sp = Math.hypot(p.vx, p.vy);
          if (sp > 0.6) {
            p.vx = (p.vx / sp) * 0.6;
            p.vy = (p.vy / sp) * 0.6;
          }
        }
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;
      }
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        for (let j = i + 1; j < points.length; j++) {
          const b = points[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 150 * 150) {
            const o = (1 - Math.sqrt(d2) / 150) * 0.18;
            ctx.strokeStyle = `oklch(0.78 0.13 200 / ${o.toFixed(3)})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        // tråd til musepekeren
        const mdx = a.x - m.x;
        const mdy = a.y - m.y;
        const md2 = mdx * mdx + mdy * mdy;
        if (md2 < 200 * 200) {
          const o = (1 - Math.sqrt(md2) / 200) * 0.28;
          ctx.strokeStyle = `oklch(0.85 0.14 190 / ${o.toFixed(3)})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(m.x, m.y);
          ctx.stroke();
        }
        ctx.fillStyle = "oklch(0.78 0.13 200 / 0.45)";
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMouse);
    };
  }, []);


  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="hud-aurora hud-aurora-1" />
      <div className="hud-aurora hud-aurora-2" />
      <div className="hud-aurora hud-aurora-3" />
      <canvas ref={ref} className="absolute inset-0 size-full opacity-70" />
      <div className="hud-sweep" />
    </div>
  );
}
