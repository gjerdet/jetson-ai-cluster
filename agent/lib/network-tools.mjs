const CIDR_RE = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;

const safeCidr = (value) => {
  const cidr = String(value || "").trim();
  if (!cidr) return "";
  if (!CIDR_RE.test(cidr)) throw new Error(`Ugyldig subnett «${cidr}». Bruk formen 192.168.1.0/24.`);
  return cidr;
};

export function networkCheckScript(subnet = "") {
  const cidr = safeCidr(subnet);
  return `#!/usr/bin/env bash
set -u
echo "== 1. GRENSESNITT OG ADRESSER =="
ip -4 -o addr show scope global 2>/dev/null | awk '{print $2, $4}'
CIDR="${cidr}"
if [ -z "$CIDR" ]; then
  CIDR=$(ip -4 -o route show scope link 2>/dev/null | awk '$1 ~ /\\// && $1 !~ /^169\\.254/ {print $1; exit}')
fi
echo "Subnett: \${CIDR:-ukjent}"
echo
echo "== 2. GATEWAY =="
GW=$(ip -4 route show default 2>/dev/null | awk '{print $3; exit}')
echo "Standard gateway: \${GW:-ingen}"
if [ -n "\${GW:-}" ]; then
  ping -c2 -W1 "$GW" >/dev/null 2>&1 && echo "Gateway svarer: JA" || echo "Gateway svarer: NEI"
fi
echo
echo "== 3. DNS =="
if command -v resolvectl >/dev/null 2>&1; then
  resolvectl status 2>/dev/null | grep -E 'DNS Servers|Current DNS' | head -n5
else
  grep -E '^nameserver' /etc/resolv.conf 2>/dev/null | head -n5
fi
getent hosts example.com >/dev/null 2>&1 && echo "Navneoppslag: OK" || echo "Navneoppslag: FEILER"
echo
echo "== 4. INTERNETT =="
ping -c2 -W1 1.1.1.1 >/dev/null 2>&1 && echo "IP-tilgang ut: OK" || echo "IP-tilgang ut: NEI"
echo
echo "== 5. KJENTE NABOER (ARP) =="
ip neigh show 2>/dev/null | grep -vE 'FAILED|INCOMPLETE' | head -n 60
echo "Antall naboer: $(ip neigh show 2>/dev/null | grep -cE '([0-9a-f]{2}:){5}')"
echo
echo "== 6. LYTTENDE PORTER PÅ DENNE NODEN =="
(ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null) | head -n 30
echo
echo "Neste steg: kjør nett_skann for full enhetsliste i \${CIDR:-subnettet}."
`;
}

export function networkScanScript(subnet = "", ports = false) {
  const cidr = safeCidr(subnet);
  return `#!/usr/bin/env bash
set -u
CIDR="${cidr}"
if [ -z "$CIDR" ]; then
  CIDR=$(ip -4 -o route show scope link 2>/dev/null | awk '$1 ~ /\\// && $1 !~ /^169\\.254/ {print $1; exit}')
fi
if [ -z "$CIDR" ]; then echo "Fant ikke subnett automatisk."; exit 1; fi
PREFIX=\${CIDR#*/}
BASE=\${CIDR%/*}
NET=$(echo "$BASE" | cut -d. -f1-3)
echo "Subnett: $CIDR"
[ "$PREFIX" = "24" ] || echo "Merk: skanner kun de 254 første adressene i $CIDR."
for i in $(seq 1 254); do ping -c1 -W1 "$NET.$i" >/dev/null 2>&1 & done
wait
sleep 1
FOUND=0
printf '%-16s %-19s %s\\n' "IP" "MAC" "VERTSNAVN"
for i in $(seq 1 254); do
  IP="$NET.$i"
  LINE=$(ip neigh show "$IP" 2>/dev/null | head -n1)
  MAC=$(echo "$LINE" | grep -oE '([0-9a-f]{2}:){5}[0-9a-f]{2}' | head -n1)
  [ -n "$MAC" ] || continue
  NAME=$(getent hosts "$IP" 2>/dev/null | awk '{print $2}' | head -n1)
  printf '%-16s %-19s %s\\n' "$IP" "$MAC" "\${NAME:--}"
  FOUND=$((FOUND+1))
done
echo "Antall enheter funnet: $FOUND"
${ports ? `echo "Åpne porter (vanlige tjenester):"
for i in $(seq 1 254); do
  IP="$NET.$i"
  ip neigh show "$IP" 2>/dev/null | grep -qE '([0-9a-f]{2}:){5}' || continue
  OPEN=""
  for P in 22 80 443 1883 8080 8443 8787 11434; do
    (echo >/dev/tcp/$IP/$P) >/dev/null 2>&1 && OPEN="$OPEN $P"
  done
  [ -n "$OPEN" ] && echo "$IP:$OPEN"
done` : `echo "(kjør med porter=true for enkel portsjekk)"`}
`;
}