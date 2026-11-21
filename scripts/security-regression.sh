#!/usr/bin/env bash
# Pentest regression — all assertions must hold unauthenticated.
# Usage: scripts/security-regression.sh [base-url]
set -u
BASE="${1:-https://hindsight.intra.dreadster3.com}"
fail=0

chk() { # chk <desc> <expected-substring> <curl-args...>
  local desc="$1" want="$2"
  shift 2
  local out
  out=$(curl -sk -m 15 "$@" 2>&1)
  if grep -q "$want" <<<"$out"; then
    echo "PASS: $desc"
  else
    echo "FAIL: $desc -> $out"
    fail=1
  fi
}

# The matcher regressions (F-06): an asset suffix must not skip the auth gate.
chk "banks.json gated"          'Unauthorized' "$BASE/api/banks.json"
chk "memories .json gated"      'Unauthorized' -X PATCH "$BASE/api/memories/test.json" \
  -H 'Content-Type: application/json' -d '{"content":"x"}'
chk "stats .json gated"         'Unauthorized' "$BASE/api/stats/default.json"
chk "knowledge catchall gated"  'Unauthorized' "$BASE/api/knowledge-banks/x.json"
chk "banks .js gated"           'Unauthorized' "$BASE/api/banks/x.js"

# Health must not leak the dataplane hostname/port to anonymous callers (F-02).
chk "health needs a session"    'auth-required' "$BASE/api/health"
if curl -sk -m 15 "$BASE/api/health" | grep -q 'hindsight-api'; then
  echo "FAIL: health leaks the internal dataplane URL"
  fail=1
else
  echo "PASS: health clean"
fi

# The dataplane's own auth still refuses anonymous and unsigned tokens.
chk "DP still auth-walled"      'Authentication failed' "$BASE/v1/default/banks"
# header {"alg":"none","typ":"JWT"} / payload {"sub":"pt-probe"} / empty signature
none_token="$(printf '%s.%s.' 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0' 'eyJzdWIiOiJwdC1wcm9iZSJ9')"
chk "alg=none rejected"         'Authentication failed' "$BASE/v1/default/banks" \
  -H "Authorization: Bearer $none_token"
chk "traversal normalized"      'login' --path-as-is "$BASE/v1/../metrics"

chk "CSP present"               'content-security-policy' -D - -o /dev/null "$BASE/login"

exit "$fail"
