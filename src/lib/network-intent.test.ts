import { describe, expect, it } from "vitest";
import { answerNetworkQuestion, classifyNetworkQuestion } from "./network-intent";

const STATUS = `== 1. GRENSESNITT OG ADRESSER ==
eth0 192.168.12.5/26
Subnett: 192.168.12.0/26
Standard gateway: 192.168.12.1`;

describe("nettverksintensjon", () => {
  it("skiller egen IP fra nabo og full adresseliste", () => {
    expect(classifyNetworkQuestion("hva er din ip?")) .toBe("own-ip");
    expect(classifyNetworkQuestion("hva er nærmeste ip til deg?")) .toBe("neighboring-ips");
    expect(classifyNetworkQuestion("kan eg få en liste over alle ip adr i ditt subnett?")) .toBe("subnet-addresses");
  });

  it("svarer med begge nærmeste brukbare adresser", () => {
    expect(answerNetworkQuestion("hva er nærmeste ip til deg?", STATUS)).toContain("192.168.12.4** og **192.168.12.6");
  });

  it("lister korrekt adresseområde for /26", () => {
    const answer = answerNetworkQuestion("list alle ip adresser i ditt subnett", STATUS) ?? "";
    expect(answer).toContain("disse 62 adressene");
    expect(answer).toContain("`192.168.12.1`");
    expect(answer).toContain("`192.168.12.62`");
    expect(answer).not.toContain("`192.168.12.63`");
  });
});