const CIDR_RE = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;

const safeCidr = (value) => {
  const cidr = String(value || "").trim();
  if (!cidr) return "";
  if (!CIDR_RE.test(cidr)) throw new Error(`Ugyldig subnett «${cidr}». Bruk formen 192.168.1.0/24.`);
  return cidr;
};

const activeLanDiscovery = `
velg_aktivt_lan() {
  local RUTE DEV SRC ADDR
  RUTE=$(ip -4 route get 1.1.1.1 2>/dev/null | head -n1 || true)
  DEV=$(echo "$RUTE" | awk '{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')
  SRC=$(echo "$RUTE" | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')
  if [ -z "$DEV" ]; then
    DEV=$(ip -4 route show default 2>/dev/null | awk '$1=="default" && $5 !~ /^(docker|br-|veth|virbr|lo)/ {print $5; exit}')
  fi
  if [ -z "$DEV" ]; then
    DEV=$(ip -4 -o addr show scope global 2>/dev/null | awk '$2 !~ /^(docker|br-|veth|virbr|lo)/ {print $2; exit}')
  fi
  ADDR=$(ip -4 -o addr show dev "$DEV" scope global 2>/dev/null | awk '{print $4; exit}')
  [ -n "$SRC" ] || SRC=${ADDR%/*}
  if [ -z "$DEV" ] || [ -z "$ADDR" ]; then return 1; fi
  AKTIVT_GRENSESNITT="$DEV"
  EGEN_IP="$SRC"
  EGEN_CIDR="$ADDR"
}

nettverk_fra_cidr() {
  local CIDR_IN="$1" IP PREFIX A B C D IPNUM MASK NETNUM
  IP=${CIDR_IN%/*}; PREFIX=${CIDR_IN#*/}
  IFS=. read -r A B C D <<< "$IP"
  IPNUM=$(( (A << 24) + (B << 16) + (C << 8) + D ))
  if [ "$PREFIX" -eq 0 ]; then MASK=0; else MASK=$(( (0xFFFFFFFF << (32-PREFIX)) & 0xFFFFFFFF )); fi
  NETNUM=$(( IPNUM & MASK ))
  printf '%d.%d.%d.%d/%d' $(( (NETNUM >> 24) & 255 )) $(( (NETNUM >> 16) & 255 )) $(( (NETNUM >> 8) & 255 )) $(( NETNUM & 255 )) "$PREFIX"
}
`;

export function networkCheckScript(subnet = "") {
  const cidr = safeCidr(subnet);
  return `#!/usr/bin/env bash
set -u
${activeLanDiscovery}
velg_aktivt_lan || { echo "Fant ikke et aktivt fysisk LAN-grensesnitt."; exit 1; }
echo "== 1. GRENSESNITT OG ADRESSER =="
ip -4 -o addr show scope global 2>/dev/null | awk '{print $2, $4}'
CIDR="${cidr}"
if [ -z "$CIDR" ]; then
  CIDR=$(nettverk_fra_cidr "$EGEN_CIDR")
fi
echo "Aktivt LAN: $AKTIVT_GRENSESNITT $EGEN_CIDR"
echo "Subnett: ${CIDR:-ukjent}"
echo
echo "== 2. GATEWAY =="
GW=$(ip -4 route show default 2>/dev/null | awk '{print $3; exit}')
echo "Standard gateway: ${GW:-ingen}"
if [ -n "${GW:-}" ]; then
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
echo "Neste steg: kjør nett_skann for full enhetsliste i ${CIDR:-subnettet}."
`;
}

export function networkScanScript(subnet = "", ports = false) {
  const cidr = safeCidr(subnet);
  return `#!/usr/bin/env bash
set -u
${activeLanDiscovery}
velg_aktivt_lan || { echo "Fant ikke et aktivt fysisk LAN-grensesnitt."; exit 1; }
CIDR="${cidr}"
if [ -z "$CIDR" ]; then
  CIDR=$(nettverk_fra_cidr "$EGEN_CIDR")
fi
if [ -z "$CIDR" ]; then echo "Fant ikke subnett automatisk."; exit 1; fi
PREFIX=${CIDR#*/}
BASE=${CIDR%/*}
IFS=. read -r A B C D <<< "$BASE"
BASE_NUM=$(( (A << 24) + (B << 16) + (C << 8) + D ))
HOSTS=$(( (1 << (32-PREFIX)) - 2 ))
if [ "$PREFIX" -ge 31 ]; then HOSTS=0; fi
LIMIT=$HOSTS
if [ "$LIMIT" -gt 1024 ]; then LIMIT=1024; fi
num_til_ip() { local N="$1"; printf '%d.%d.%d.%d' $(( (N >> 24) & 255 )) $(( (N >> 16) & 255 )) $(( (N >> 8) & 255 )) $(( N & 255 )); }
if [ "$LIMIT" -le 0 ]; then echo "SKANNEFEIL: Subnettet har ingen brukbare vertsadresser."; exit 2; fi
HITS=$(mktemp)
trap 'rm -f "$HITS"' EXIT
echo "Subnett: $CIDR"
echo "Aktivt LAN: $AKTIVT_GRENSESNITT $EGEN_CIDR"
[ "$HOSTS" -le "$LIMIT" ] || echo "Merk: skanner de første $LIMIT av $HOSTS brukbare adressene i $CIDR."
for i in $(seq 1 "$LIMIT"); do
  IP=$(num_til_ip $((BASE_NUM+i)))
  (ping -c1 -W1 "$IP" >/dev/null 2>&1 && echo "$IP" >> "$HITS") &
done
wait
sleep 1
FOUND=0
printf '%-16s %-19s %s\n' "IP" "MAC" "VERTSNAVN"
for i in $(seq 1 "$LIMIT"); do
  IP=$(num_til_ip $((BASE_NUM+i)))
  LINE=$(ip neigh show "$IP" 2>/dev/null | head -n1)
  MAC=$(echo "$LINE" | grep -oE '([0-9a-f]{2}:){5}[0-9a-f]{2}' | head -n1)
  PING_OK=0
  grep -Fqx "$IP" "$HITS" && PING_OK=1
  if [ "$PING_OK" -ne 1 ] && [ -z "$MAC" ]; then continue; fi
  NAME=$(getent hosts "$IP" 2>/dev/null | awk '{print $2}' | head -n1)
  printf '%-16s %-19s %s\n' "$IP" "${MAC:--}" "${NAME:--}"
  FOUND=$((FOUND+1))
done
echo "Antall enheter funnet: $FOUND"
${ports ? `echo "Åpne porter (vanlige tjenester):"
for i in $(seq 1 "$LIMIT"); do
  IP=$(num_til_ip $((BASE_NUM+i)))
  # Bruk både ping-treff og ARP for å vurdere om vi skal sjekke porter
  PING_OK=0; grep -Fqx "$IP" "$HITS" && PING_OK=1
  HAS_MAC=0; ip neigh show "$IP" 2>/dev/null | grep -qE '([0-9a-f]{2}:){5}' && HAS_MAC=1
  if [ "$PING_OK" -ne 1 ] && [ "$HAS_MAC" -ne 1 ]; then continue; fi
  OPEN=""
  for P in 22 80 443 1883 8080 8443 8787 11434; do
    (echo >/dev/tcp/$IP/$P) >/dev/null 2>&1 && OPEN="$OPEN $P"
  done
  [ -n "$OPEN" ] && echo "$IP:$OPEN"
done` : `echo "(kjør med porter=true for enkel portsjekk)"`}
`;
}
