import { useEffect, useRef } from "react";

type Node3 = { x: number; y: number; z: number; s: number; len: number; phase: number };
type Arc = { a: number; b: number; life: number; speed: number };

/**
 * Holografisk gyllen sfære – roterende punktnett med radielle lysstreker,
 * dataflyt-buer, orbitale satellitter og skannering.
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
    const N = 620;
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

    // dataflyt-buer mellom tilfeldige noder
    const arcs: Arc[] = Array.from({ length: 22 }, () => ({
      a: Math.floor(Math.random() * N),
      b: Math.floor(Math.random() * N),
      life: Math.random(),
      speed: 0.004 + Math.random() * 0.01,
    }));

    // orbitale satellitter
    const sats = Array.from({ length: 5 }, (_, i) => ({
      r: 0.68 + i * 0.11,
      tilt: (i * Math.PI) / 5,
      speed: 0.35 + i * 0.18,
      phase: Math.random() * Math.PI * 2,
    }));

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const project = (n: { x: number; y: number; z: number }, ca: number, sa: number, cb: number, sb: number, cx: number, cy: number, R: number) => {
      const x = n.x * ca - n.z * sa;
      let z = n.x * sa + n.z * ca;
      const y = n.y * cb - z * sb;
      z = n.y * sb + z * cb;
      const depth = (z + 1) / 2;
      const persp = 0.72 + depth * 0.4;
      return { px: cx + x * R * persp, py: cy + y * R * persp, depth, x, y, persp };
    };

    const draw = () => {
      t += reduce ? 0 : 0.0035;
      // myk interpolering mot musepeker
      ease.x += (mouse.x - ease.x) * 0.05;
      ease.y += (mouse.y - ease.y) * 0.05;
      const cx = w / 2 + ease.x * 26;
      const cy = h / 2 + ease.y * 18;
      const R = Math.min(w, h) * 0.42 * (1 + Math.sin(t * 2.2) * 0.012);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      const ta = t + ease.x * 0.5;
      const tb = t * 0.45 + ease.y * 0.4;
      const ca = Math.cos(ta);
      const sa = Math.sin(ta);
      const cb = Math.cos(tb);
      const sb = Math.sin(tb);
      const boost = activeRef.current ? 1 : 0.65;


      // skannering som glir opp og ned gjennom sfæren
      const scanY = Math.sin(t * 1.6) * 0.9;

      for (const n of nodes) {
        const p = project(n, ca, sa, cb, sb, cx, cy, R);
        const flick = 0.55 + 0.45 * Math.sin(t * 9 + n.phase);
        const scanHit = Math.max(0, 1 - Math.abs(p.y - scanY) * 9);
        const alpha = (0.08 + p.depth * 0.55) * flick * boost + scanHit * 0.5 * boost;

        const ex = cx + p.x * R * p.persp * (1 + n.len);
        const ey = cy + p.y * R * p.persp * (1 + n.len);
        ctx.strokeStyle = `oklch(0.82 0.16 78 / ${(alpha * 0.55).toFixed(3)})`;
        ctx.lineWidth = n.s * 0.9;
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        ctx.fillStyle = `oklch(0.9 0.15 85 / ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.px, p.py, n.s * (0.6 + p.depth + scanHit), 0, Math.PI * 2);
        ctx.fill();
      }

      // dataflyt-buer med vandrende lyspunkt
      for (const arc of arcs) {
        if (!reduce) arc.life += arc.speed;
        if (arc.life > 1) {
          arc.life = 0;
          arc.a = Math.floor(Math.random() * N);
          arc.b = Math.floor(Math.random() * N);
        }
        const A = project(nodes[arc.a]!, ca, sa, cb, sb, cx, cy, R);
        const B = project(nodes[arc.b]!, ca, sa, cb, sb, cx, cy, R);
        const mx = (A.px + B.px) / 2 + (cx - (A.px + B.px) / 2) * 0.35;
        const my = (A.py + B.py) / 2 + (cy - (A.py + B.py) / 2) * 0.35;
        const fade = Math.sin(arc.life * Math.PI);
        ctx.strokeStyle = `oklch(0.88 0.14 82 / ${(0.16 * fade * boost).toFixed(3)})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(A.px, A.py);
        ctx.quadraticCurveTo(mx, my, B.px, B.py);
        ctx.stroke();

        const u = arc.life;
        const qx = (1 - u) * (1 - u) * A.px + 2 * (1 - u) * u * mx + u * u * B.px;
        const qy = (1 - u) * (1 - u) * A.py + 2 * (1 - u) * u * my + u * u * B.py;
        ctx.fillStyle = `oklch(0.97 0.12 90 / ${(0.8 * fade * boost).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(qx, qy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // roterende ringer
      for (let i = 0; i < 4; i++) {
        const tilt = t * (0.6 + i * 0.25) + i;
        ctx.strokeStyle = `oklch(0.85 0.15 80 / ${(0.16 * boost).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, R * (0.98 - i * 0.11), R * Math.abs(Math.cos(tilt)) * 0.95, i * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // orbitale satellitter med hale
      for (const s of sats) {
        const ang = t * s.speed * 6 + s.phase;
        for (let k = 0; k < 8; k++) {
          const a2 = ang - k * 0.05;
          const ox = Math.cos(a2) * R * s.r;
          const oy = Math.sin(a2) * R * s.r * Math.cos(s.tilt) * 0.55;
          const px = cx + ox * Math.cos(s.tilt) - oy * Math.sin(s.tilt);
          const py = cy + ox * Math.sin(s.tilt) + oy * Math.cos(s.tilt);
          ctx.fillStyle = `oklch(0.96 0.13 88 / ${((1 - k / 8) * 0.5 * boost).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(px, py, 1.8 - k * 0.15, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ytre gradskala som roterer motsatt vei
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-t * 0.8);
      for (let i = 0; i < 72; i++) {
        const long = i % 6 === 0;
        ctx.strokeStyle = `oklch(0.85 0.14 82 / ${((long ? 0.32 : 0.12) * boost).toFixed(3)})`;
        ctx.lineWidth = long ? 1.2 : 0.6;
        ctx.beginPath();
        ctx.moveTo(R * 1.06, 0);
        ctx.lineTo(R * (long ? 1.14 : 1.1), 0);
        ctx.stroke();
        ctx.rotate((Math.PI * 2) / 72);
      }
      ctx.restore();

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
