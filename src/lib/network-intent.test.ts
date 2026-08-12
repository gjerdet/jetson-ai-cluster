import { describe, expect, it } from "vitest";
import { answerDeviceScan, answerNetworkQuestion, classifyNetworkQuestion, explicitSubnet, networkContextFromCheck } from "./network-intent";

const STATUS = `== 1. GRENSESNITT OG ADRESSER ==
eth0 192.168.12.5/26
docker0 172.17.0.1/16
Aktivt LAN: eth0 192.168.12.5/26
Subnett: 192.168.12.0/26
Standard gateway: 192.168.12.1`;

describe("nettverksintensjon", () => {
  it("skiller egen IP fra nabo og full adresseliste", () => {
    expect(classifyNetworkQuestion("hva er din ip?")).toBe("own-ip");
    expect(classifyNetworkQuestion("hva er nærmeste ip til deg?")).toBe("neighboring-ips");
    expect(classifyNetworkQuestion("kan eg få en liste over alle ip adr i ditt subnett?")).toBe("subnet-addresses");
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

  it("bruker eksplisitt aktivt LAN og ignorerer Docker-adressen", () => {
    expect(networkContextFromCheck(STATUS)).toEqual({
      interfaceName: "eth0",
      ownCidr: "192.168.12.5/26",
      subnet: "192.168.12.0/26",
    });
  });
});
describe("enhetsskanning", () => {
  it("gjenkjenner spørsmål om enheter i subnettet", () => {
    expect(classifyNetworkQuestion("hvor mange enheter er i ditt subnett?")).toBe("devices");
    expect(classifyNetworkQuestion("kan du skanne nettet mitt?")).toBe("devices");
    expect(classifyNetworkQuestion("hvem er koblet til nettverket?")).toBe("devices");
    expect(classifyNetworkQuestion("hva er din ip?")).toBe("own-ip");
  });

  it("oppsummerer skanneresultatet", () => {
    const ut = [
      "Subnett: 192.168.12.0/26",
      "IP               MAC                 VERTSNAVN",
      "192.168.12.1     aa:bb:cc:dd:ee:ff   gw.lan",
      "192.168.12.5     -                   jetson",
      "Antall enheter funnet: 2",
    ].join("\n");
    const svar = answerDeviceScan("hvor mange enheter er i ditt subnett?", ut);
    expect(svar).toContain("**2**");
    expect(svar).toContain("192.168.12.1");
  });

  it("presenterer ikke null treff som bevis på et tomt subnett", () => {
    const svar = answerDeviceScan("hvor mange enheter?", "Subnett: 192.168.9.0/24\nSkannestatus: FULLFØRT\nAntall enheter funnet: 0");
    expect(svar).toContain("ikke bekrefte noen enheter");
    expect(svar).toContain("betyr ikke at subnettet er tomt");
  });

  it("skiller skannefeil fra et nullresultat", () => {
    const svar = answerDeviceScan("skann nettet", "exit 2\nstdout:\nSKANNEFEIL: Ingen rute til 192.168.9.0/24");
    expect(svar).toContain("Dette er en skannefeil");
    expect(svar).not.toContain("fant **0**");
  });
});

describe("eksplisitt subnett", () => {
  it("gjenkjenner sjekk mot oppgitt subnett", () => {
    const q = "kan du sjekke om du når noen enheter på subnet 192.168.20.0/24";
    expect(classifyNetworkQuestion(q)).toBe("devices");
    expect(explicitSubnet(q)).toBe("192.168.20.0/24");
  });

  it("normaliserer vertsadresse til nettadresse", () => {
    expect(explicitSubnet("skann 10.0.5.37/16")).toBe("10.0.0.0/16");
    expect(explicitSubnet("hva er din ip?")).toBeNull();
  });
});
