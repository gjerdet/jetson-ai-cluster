#!/usr/bin/env bash
# Felles apt/dpkg-hjelpere for Jarvis-installatørene.
# Formålet er at en skadet nedlastet .deb-fil ikke skal stoppe en installasjon:
# vi tømmer arkivet, reparerer dpkg og laster pakkene ned på nytt i samme kjøring.

APT_OPTS=(-o DPkg::Lock::Timeout=600 -o Acquire::Retries=3)

_af_si() { echo -e "\033[36m▸ $*\033[0m"; }
_af_adv() { echo -e "\033[33m! $*\033[0m"; }

# Venter til ingen annen prosess holder apt/dpkg-låsene.
vent_paa_dpkg() {
  local ventet=0
  while fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/cache/apt/archives/lock >/dev/null 2>&1; do
    if [ "$ventet" -ge 600 ]; then
      echo "apt/dpkg er fortsatt opptatt etter 10 minutter. Kontroller: ps aux | grep -E '[a]pt|[d]pkg'" >&2
      return 1
    fi
    [ $((ventet % 30)) -eq 0 ] && _af_adv "apt/dpkg brukes av en annen prosess – venter (${ventet}s)"
    sleep 5
    ventet=$((ventet + 5))
  done
}

# Tømmer nedlastingscachen og setter dpkg tilbake i en konsistent tilstand.
reparer_pakkesystem() {
  vent_paa_dpkg || true
  _af_si "Reparerer pakkesystemet (tømmer skadde nedlastinger)"
  rm -f /var/cache/apt/archives/*.deb /var/cache/apt/archives/partial/*.deb 2>/dev/null || true
  apt-get clean || true
  rm -rf /var/lib/apt/lists/* 2>/dev/null || true

  # Halvinstallerte pakker (status ikke "ii") blokkerer alle videre apt-kall.
  local pakke status
  while read -r pakke status; do
    [ -n "$pakke" ] || continue
    case "$status" in
      ii) ;;
      *)
        _af_adv "Fjerner halvinstallert pakke: $pakke ($status)"
        dpkg --remove --force-remove-reinstreq "$pakke" 2>/dev/null || \
          dpkg --purge --force-all "$pakke" 2>/dev/null || true
        ;;
    esac
  done < <(dpkg-query -W -f='${Package} ${db:Status-Abbrev}\n' 2>/dev/null | awk '{print $1, $2}' | grep -v ' ii$' || true)

  dpkg --configure -a || true
  apt-get "${APT_OPTS[@]}" update --fix-missing || true
  apt-get "${APT_OPTS[@]}" -f install -y || true
  dpkg --audit || true
}

# apt-get install med automatisk reparasjon og nytt forsøk (opptil 3 ganger).
apt_installer_robust() {
  local forsok=1
  while [ "$forsok" -le 3 ]; do
    vent_paa_dpkg || true
    if apt-get "${APT_OPTS[@]}" update && \
       apt-get "${APT_OPTS[@]}" install -y --no-install-recommends "$@"; then
      return 0
    fi
    _af_adv "apt-forsøk $forsok feilet – reparerer og laster pakkene ned på nytt"
    reparer_pakkesystem
    # Andre forsøk: tving ny nedlasting av nøyaktig disse pakkene.
    if [ "$forsok" -eq 2 ]; then
      apt-get "${APT_OPTS[@]}" install -y --reinstall --fix-broken --no-install-recommends "$@" && return 0
    fi
    forsok=$((forsok + 1))
  done
  return 1
}
