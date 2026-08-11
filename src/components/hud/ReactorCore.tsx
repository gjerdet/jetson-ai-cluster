export function ReactorCore({ active }: { active: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="relative size-[min(70vmin,620px)] opacity-70">
        <div className="absolute inset-0 animate-spin-slow rounded-full border border-primary/25" />
        <div className="absolute inset-[8%] animate-spin-reverse rounded-full border border-dashed border-primary/20" />
        <div className="absolute inset-[18%] animate-spin-slow rounded-full border border-primary/15" />
        <div className="absolute inset-[30%] rounded-full border border-primary/25" />
        <div
          className="absolute inset-[38%] rounded-full bg-primary/10 blur-2xl"
          style={{ animation: active ? "pulse 2.4s ease-in-out infinite" : undefined }}
        />
        <div className="absolute inset-[44%] rounded-full border border-primary/40" />
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="absolute left-1/2 top-1/2 h-[2px] w-[46%] origin-left bg-gradient-to-r from-primary/40 to-transparent"
            style={{ transform: `rotate(${i * 30}deg)` }}
          />
        ))}
      </div>
    </div>
  );
}
