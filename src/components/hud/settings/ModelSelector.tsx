import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { backend } from "@/lib/backend";

type ModelSelectorProps = {
  config: { nodes: { id: string; baseUrl: string; model?: string }[]; aiNodeId?: string };
  update: (c: any) => void;
};

export function ModelSelector({ config, update }: ModelSelectorProps) {
  const [modeller, setModeller] = useState<string[]>([]);
  const [baseUrl, setBaseUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const hentModeller = async () => {
    setLoading(true);
    try {
      const data = await backend.hentModeller();
      setModeller(data.modeller ?? []);
      setBaseUrl(data.baseUrl ?? "");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    hentModeller();
  }, []);

  const velg = async (model: string) => {
    await backend.velgModell(model);
    // Update the selected AI node's model
    const aiId = config.aiNodeId;
    if (aiId) {
      update({
        ...config,
        nodes: config.nodes.map((n: any) => (n.id === aiId ? { ...n, model } : n)),
      });
    }
  };

  return (
    <div className="mt-2 rounded border border-primary/15 bg-background/20 p-2">
      <div className="flex items-center justify-between">
        <span className="hud-title text-[9px] text-primary">Modeller</span>
        <button
          onClick={hentModeller}
          disabled={loading}
          className="hud-btn flex items-center gap-1 text-[9px]"
        >
          {loading ? <Loader2 className="size-3 animate-spin" /> : null}
          Oppdater
        </button>
      </div>
      <p className="mt-1 text-[9px] text-muted-foreground">
        {baseUrl ? `Kilde: ${baseUrl}` : "Ingen modellkilde konfigurert."}
      </p>
      <div className="mt-1 flex max-h-32 flex-wrap gap-1 overflow-auto">
        {modeller.length === 0 && !loading && (
          <p className="text-[10px] text-muted-foreground">Ingen modeller funnet.</p>
        )}
        {modeller.map((m) => (
          <button
            key={m}
            onClick={() => velg(m)}
            className="rounded border border-primary/20 px-1.5 py-0.5 text-[9px] hover:border-primary hover:text-primary"
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}
