import { describe, expect, it } from "vitest";
import { fraBackendRegel, medFallback, tilBackendRegel } from "@/lib/backend-sync";
import { newRule } from "@/lib/hud-store";

describe("backend-sync", () => {
  it("mapper regler tur/retur uten tap", () => {
    const r = { ...newRule("hjem/stue/temp"), actions: [{ id: "a1", kind: "mqtt" as const, topic: "hjem/vifte/set", payload: "ON" }] };
    const tilbake = fraBackendRegel(tilBackendRegel(r));
    expect(tilbake.topic).toBe(r.topic);
    expect(tilbake.kind).toBe("above");
    expect(tilbake.enabled).toBe(true);
    expect(tilbake.actions?.[0]).toMatchObject({ kind: "mqtt", topic: "hjem/vifte/set", payload: "ON" });
  });

  it("faller tilbake til lokal data uten innlogging", async () => {
    const r = await medFallback(
      () => Promise.reject(new Error("nede")),
      () => ["lokal"],
    );
    expect(r.kilde).toBe("lokal");
    expect(r.data).toEqual(["lokal"]);
  });
});
