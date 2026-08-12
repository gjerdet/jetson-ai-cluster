/**
 * Nettverksskanning fra den lokale agenten på Jetson.
 *
 * Bygger et bash-skript som:
 *  1. finner nodens eget subnett (eller bruker et oppgitt),
 *  2. gjør en rask ping-sveip parallelt,
 *  3. leser ARP-tabellen for MAC-adresser,
 *  4. slår opp vertsnavn der det er mulig.
 *
 * Skriptet bruker kun verktøy som finnes på et standard Jetson/Ubuntu-oppsett
 * (ip, ping, arp/ip neigh, getent) og krever ikke root eller nmap.
 */

export const CIDR_RE = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;

/** Bygger skanneskriptet. Tomt subnett = automatisk gjenkjenning. */
export function scanScript(subnet = "", portScan = false): string {
  const cidr = CIDR_RE.test(subnet.trim()) ? subnet.trim() : "";
  return `#!/usr/bin/env bash
set -u
CIDR="${cidr}"
if [ -z "$CIDR" ]; then
  DEV=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')
  CIDR=$(ip -4 -o route show scope link dev "$DEV" 2>/dev/null | awk '$1 ~ /\\// && $1 !~ /^169\\.254/ {print $1; exit}')
fi
if [ -z "$CIDR" ]; then
  echo "Fant ikke noe subnett automatisk. Oppgi f.eks. 192.168.1.0/24."
  exit 1
fi
PREFIX=\${CIDR#*/}
BASE=\${CIDR%/*}
IFS=. read -r A B C D <<< "$BASE"
BASE_NUM=$(( (A << 24) + (B << 16) + (C << 8) + D ))
HOSTS=$(( (1 << (32-PREFIX)) - 2 ))
if [ "$PREFIX" -ge 31 ]; then HOSTS=0; fi
LIMIT=$HOSTS
if [ "$LIMIT" -gt 1024 ]; then LIMIT=1024; fi
num_til_ip() { local N="$1"; printf '%d.%d.%d.%d' $(( (N >> 24) & 255 )) $(( (N >> 16) & 255 )) $(( (N >> 8) & 255 )) $(( N & 255 )); }
if [ "$LIMIT" -le 0 ]; then echo "SKANNEFEIL: Subnettet har ingen brukbare vertsadresser."; exit 2; fi
FIRST_IP=$(num_til_ip $((BASE_NUM+1)))
ROUTE=$(ip -4 route get "$FIRST_IP" 2>&1) || { echo "SKANNEFEIL: Ingen rute til $CIDR: $ROUTE"; exit 2; }
PING_HITS=$(mktemp)
trap 'rm -f "$PING_HITS"' EXIT
echo "Subnett: $CIDR"
echo "Rute til mål: $ROUTE"
[ "$HOSTS" -le "$LIMIT" ] || echo "Merk: skanner de første $LIMIT av $HOSTS brukbare adressene i $CIDR."
for i in $(seq 1 "$LIMIT"); do
  IP=$(num_til_ip $((BASE_NUM+i)))
  (ping -c1 -W1 "$IP" >/dev/null 2>&1 && printf '%s\n' "$IP" >> "$PING_HITS") &
done
wait
sleep 1
FOUND=0
PING_COUNT=$(wc -l < "$PING_HITS" | tr -d ' ')
NEIGH_COUNT=0
printf '%-16s %-19s %s\\n' "IP" "MAC" "VERTSNAVN"
for i in $(seq 1 "$LIMIT"); do
  IP=$(num_til_ip $((BASE_NUM+i)))
  LINE=$(ip neigh show "$IP" 2>/dev/null | head -n1)
  MAC=$(echo "$LINE" | grep -oE '([0-9a-f]{2}:){5}[0-9a-f]{2}' | head -n1)
  PING_OK=0
  grep -Fqx "$IP" "$PING_HITS" && PING_OK=1
  [ -n "$MAC" ] && NEIGH_COUNT=$((NEIGH_COUNT+1))
  if [ "$PING_OK" -ne 1 ] && [ -z "$MAC" ]; then continue; fi
  NAME=$(getent hosts "$IP" 2>/dev/null | awk '{print $2}' | head -n1)
  [ -z "$NAME" ] && NAME="-"
  [ -z "$MAC" ] && MAC="-"
  printf '%-16s %-19s %s\\n' "$IP" "$MAC" "$NAME"
  FOUND=$((FOUND+1))
done
echo "Skannestatus: FULLFØRT"
echo "Svarte på ping: $PING_COUNT"
echo "Nabooppføringer med MAC: $NEIGH_COUNT"
echo "Antall enheter funnet: $FOUND"
${
  portScan
    ? `echo "Åpne porter (vanlige tjenester):"
for i in $(seq 1 "$LIMIT"); do
  IP=$(num_til_ip $((BASE_NUM+i)))
  ip neigh show "$IP" 2>/dev/null | grep -qE '([0-9a-f]{2}:){5}' || continue
  OPEN=""
  for P in 22 80 443 1883 8080 8443 8787 11434; do
    (echo >/dev/tcp/$IP/$P) >/dev/null 2>&1 && OPEN="$OPEN $P"
  done
  [ -n "$OPEN" ] && echo "$IP:$OPEN"
done`
    : `echo "(kjør med porter=true for enkel portsjekk)"`
}
`;
}

/**
 * Standard sjekkplan for nettverksoppgaver.
 *
 * Kjøres som ett skript i sandkassen og går trinnvis gjennom:
 *  1. grensesnitt, IP og subnett
 *  2. standard gateway + ping mot gateway
 *  3. DNS-servere + navneoppslag
 *  4. internett-sjekk
 *  5. ARP-/naboliste (enheter noden allerede kjenner)
 *  6. lyttende porter på noden selv
 *
 * Selve enhetslisten hentes etterpå med nett_skann.
 */
export function checkScript(subnet = ""): string {
  const cidr = CIDR_RE.test(subnet.trim()) ? subnet.trim() : "";
  return `#!/usr/bin/env bash
set -u
echo "== 1. GRENSESNITT OG ADRESSER =="
ip -4 -o addr show scope global 2>/dev/null | awk '{print $2, $4}'
CIDR="${cidr}"
DEV=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')
EGEN_CIDR=$(ip -4 -o addr show dev "$DEV" scope global 2>/dev/null | awk '{print $4; exit}')
if [ -z "$CIDR" ]; then
  CIDR=$(ip -4 -o route show scope link dev "$DEV" 2>/dev/null | awk '$1 ~ /\\// && $1 !~ /^169\\.254/ {print $1; exit}')
fi
echo "Aktivt LAN: \${DEV:-ukjent} \${EGEN_CIDR:-ukjent}"
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
