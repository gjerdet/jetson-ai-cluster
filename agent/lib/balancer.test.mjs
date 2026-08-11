import { describe, expect, it, beforeEach } from "vitest";
import { kjorBalansert, poolFor, poolStatus, resetBalancer, rutingsRekkefolge } from "./balancer.mjs";

const node = (id, extra = {}) => ({
  id,
  navn: id,
  baseUrl: `http://${id}:11434/v1`,
  oppgaver: ["chat"],
  aktiv: true,
  vekt: 1,
  ...extra,
});

describe("lastbalansering", () => {
  beforeEach(() => resetBalancer());

  it("tar bare med aktive noder med riktig oppgave", () => {
    const liste = [node("a"), node("b", { aktiv: false }), node("c", { oppgaver: ["evaluator"] })];
    expect(poolFor(liste, "chat").map((n) => n.id)).toEqual(["a"]);
  });

  it("fordeler videre til neste node når en node feiler", async () => {
    const liste = [node("a"), node("b")];
    const brukt = [];
    const r = await kjorBalansert(liste, async (n) => {
      brukt.push(n.id);
      if (brukt.length === 1) throw new Error("nede");
      return "ok";
    });
    expect(r.resultat).toBe("ok");
    expect(brukt).toHaveLength(2);
    // Den feilende noden settes i karantene og havner bakerst.
    expect(rutingsRekkefolge(liste)[0].id).toBe(brukt[1]);
  });

  it("rapporterer poolstatus med karantene", async () => {
    const liste = [node("a")];
    await expect(
      kjorBalansert(liste, async () => {
        throw new Error("nede");
      }),
    ).rejects.toThrow();
    const status = poolStatus(liste);
    expect(status.antall).toBe(1);
    expect(status.noder[0].karantene).toBe(true);
    expect(status.noder[0].sisteFeil).toBe("nede");
  });
});
