/**
 * JetPack- og CUDA-deteksjon for Jetson-noder.
 *
 * Piper-treningen trenger en PyTorch-utgave som er bygget for nøyaktig den
 * JetPack/CUDA-versjonen som ligger på maskinen. Her finner vi ut hvilken
 * versjon noden faktisk kjører, hvilken PyTorch-kilde som passer, og om
 * system-Python allerede har en brukbar torch med CUDA.
 */
import fs from "node:fs/promises";
import { execFile } from "node:child_process";

function kjor(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, encoding: "utf8" }, (err, ut) =>
        resolve(err && !ut ? null : String(ut || "").trim()),
      );
    } catch {
      resolve(null);
    }
  });
}

const les = (f) => fs.readFile(f, "utf8").catch(() => "");

/**
 * L4T-utgave → JetPack-serie og pip-indeks med Jetson-hjul for PyTorch.
 * cu-versjonen følger CUDA-en JetPack leverer.
 */
const JETPACK_KART = [
  { l4t: 39, jetpack: "7.2", cuda: "13.2", indeks: "https://download.pytorch.org/whl/cu132" },
  { l4t: 38, jetpack: "7.x", cuda: "13.0", indeks: "https://download.pytorch.org/whl/cu130" },
  { l4t: 36, jetpack: "6.x", cuda: "12.6", indeks: "https://pypi.jetson-ai-lab.io/jp6/cu126" },
  { l4t: 35, jetpack: "5.x", cuda: "11.4", indeks: "https://pypi.jetson-ai-lab.io/jp5/cu114" },
];

/** Leser L4T-versjon fra /etc/nv_tegra_release eller nvidia-l4t-core. */
async function l4tVersjon() {
  const raa = await les("/etc/nv_tegra_release");
  const m = raa.match(/R(\d+).*REVISION:\s*([\d.]+)/i);
  if (m) return { major: Number(m[1]), full: `R${m[1]}.${m[2]}`, kilde: "/etc/nv_tegra_release" };
  const dpkg = await kjor("dpkg-query", ["-W", "-f=${Version}", "nvidia-l4t-core"]);
  const d = String(dpkg || "").match(/^(\d+)\.(\d+)/);
  if (d) return { major: Number(d[1]), full: dpkg, kilde: "nvidia-l4t-core" };
  return { major: 0, full: "", kilde: "" };
}

/** CUDA-versjon fra nvcc eller /usr/local/cuda/version.json. */
async function cudaVersjon() {
  const nvcc = await kjor("bash", ["-lc", "nvcc --version 2>/dev/null | tail -n 2"]);
  const m = String(nvcc || "").match(/release (\d+\.\d+)/i);
  if (m) return m[1];
  const json = await les("/usr/local/cuda/version.json");
  try {
    const v = JSON.parse(json || "{}");
    return String(v?.cuda?.version || "").split(".").slice(0, 2).join(".") || "";
  } catch {
    return "";
  }
}

/** Torch i system-Python: versjon og om CUDA faktisk er tilgjengelig. */
export async function systemTorch(python = "python3") {
  const ut = await kjor(
    python,
    ["-c", "import torch;print(torch.__version__);print('1' if torch.cuda.is_available() else '0')"],
    30000,
  );
  if (!ut) return { finnes: false, versjon: "", cuda: false, major: 0 };
  const [versjon = "", cuda = "0"] = ut.split(/\r?\n/);
  return {
    finnes: Boolean(versjon),
    versjon,
    cuda: cuda.trim() === "1",
    major: Number(String(versjon).split(".")[0]) || 0,
  };
}

/** Alt vi vet om JetPack, CUDA og drivere på denne maskinen. */
export async function jetpackInfo() {
  const [l4t, cuda, jetpackPakke, smi, modell] = await Promise.all([
    l4tVersjon(),
    cudaVersjon(),
    kjor("dpkg-query", ["-W", "-f=${Version}", "nvidia-jetpack"]),
    kjor("bash", ["-lc", "nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>/dev/null | head -n 1"]),
    les("/proc/device-tree/model"),
  ]);
  // Nyere L4T-utgaver enn kartet (f.eks. R39) skal ikke stoppe installasjonen.
  // Vi faller tilbake til nyeste kjente serie som er ≤ maskinens L4T-versjon.
  const treff =
    JETPACK_KART.find((k) => k.l4t === l4t.major) ||
    (l4t.major ? JETPACK_KART.find((k) => l4t.major > k.l4t) : null) ||
    null;
  const jetpack = (jetpackPakke || "").split("-")[0] || treff?.jetpack || "";
  return {
    erJetson: Boolean(l4t.major) || /jetson|tegra/i.test(modell),
    modell: String(modell || "").replace(/\0/g, "").trim(),
    l4t: l4t.full,
    l4tMajor: l4t.major,
    l4tKilde: l4t.kilde,
    jetpack,
    cuda,
    forventetCuda: treff?.cuda || "",
    pipIndeks: treff?.indeks || "",
    gpu: smi || "",
    stottet: Boolean(treff),
  };
}

/**
 * Preflight før Piper installeres/startes: JetPack, CUDA og om det finnes
 * en NVIDIA-PyTorch som passer. Returnerer sjekker GUI-et kan farge på.
 */
export async function pytorchPreflight({ python = "python3" } = {}) {
  const info = await jetpackInfo();
  const torch = await systemTorch(python);
  const sjekker = [];
  const legg = (navn, ok, detalj = "", kritisk = true) =>
    sjekker.push({ navn, ok: Boolean(ok), detalj: String(detalj || ""), kritisk });

  legg("Jetson oppdaget", info.erJetson, info.modell || info.l4t || "Fant ingen Tegra-modell", false);
  legg(
    "JetPack-versjon",
    Boolean(info.jetpack || info.l4tMajor),
    info.jetpack ? `JetPack ${info.jetpack} (L4T ${info.l4t || "?"})` : `L4T ${info.l4t || "ukjent"}`,
  );
  legg(
    "CUDA installert",
    Boolean(info.cuda),
    info.cuda ? `CUDA ${info.cuda}${info.forventetCuda && info.cuda !== info.forventetCuda ? ` (forventet ${info.forventetCuda})` : ""}` : "Fant ikke nvcc eller /usr/local/cuda",
  );
  legg(
    "NVIDIA-hjul tilgjengelig",
    Boolean(info.pipIndeks),
    info.pipIndeks || `Ingen kjent PyTorch-indeks for L4T ${info.l4tMajor || "?"} – installer torch manuelt`,
  );
  legg(
    "PyTorch i system-Python",
    torch.finnes && torch.major >= 2,
    torch.finnes ? `torch ${torch.versjon}` : "torch kan ikke importeres i python3",
  );
  legg(
    "PyTorch ser GPU-en",
    torch.cuda,
    torch.cuda ? "torch.cuda.is_available() = True" : "torch finner ingen CUDA-enhet – feil hjul eller manglende driver",
  );

  const kanInstallere = Boolean(info.pipIndeks);
  const klar = torch.finnes && torch.major >= 2 && torch.cuda;
  return {
    ok: klar,
    tidspunkt: new Date().toISOString(),
    jetpack: info,
    torch,
    sjekker,
    kanInstallere,
    anbefaling: klar
      ? "PyTorch med CUDA er på plass. Piper kan installeres og trenes."
      : kanInstallere
        ? `Installer NVIDIA PyTorch fra ${info.pipIndeks} – trykk INSTALLER PYTORCH.`
        : "Fant ingen kjent NVIDIA PyTorch-kilde for denne JetPack-versjonen. Oppgrader JetPack eller installer torch manuelt.",
  };
}
