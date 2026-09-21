#!/usr/bin/env bash
# Snap Apps — external health check. Run from OUTSIDE the box (a second
# machine, a free uptime service's script runner, or any cron that is not on
# delphi): the whole point is that nothing on the box watches itself.
#
# Checks every snap-apps endpoint; exits non-zero and prints FAILED lines on
# any miss. Pair with alert.sh, which de-duplicates and notifies.
#
#   ./uptime.sh            # exit 0 = all healthy
set -u
fail=0

for url in \
  https://snap-apps.gaiada.com \
  https://snap-apps-api.gaiada.com/v1/ready \
  https://snap-apps-app.gaiada.com; do
  body=$(curl -fsS --max-time 15 "$url" 2>&1) || { echo "FAILED unreachable: $url"; fail=1; continue; }
  case "$url" in
    *"/v1/ready"*)
      echo "$body" | grep -q '"rlsEnforced": *true' || { echo "FAILED rlsEnforced not true: $url"; fail=1; } ;;
  esac
done

# TLS expiry: refuse a certificate inside two weeks of dying (1209600 s).
if ! openssl s_client -connect snap-apps.gaiada.com:443 -servername snap-apps.gaiada.com </dev/null 2>/dev/null \
  | openssl x509 -checkend 1209600 >/dev/null 2>&1; then
  echo "FAILED TLS certificate for snap-apps.gaiada.com expires within 14 days"
  fail=1
fi

exit $fail
