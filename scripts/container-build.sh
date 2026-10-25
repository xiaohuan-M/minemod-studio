#!/usr/bin/env bash
set -euo pipefail
# Fixed entry point. Project input cannot select shell commands or Gradle tasks.
mode="${1:-offline}"
if [[ "$mode" != offline && "$mode" != online ]]; then exit 64; fi
phase="${2:-build}"
loader="${3:-fabric}"
case "$phase" in
  build) task=build ;;
  prepare-game) task=prepareGameTestRuntime ;;
  game)
    if [[ "$mode" != offline ]]; then exit 64; fi
    case "$loader" in fabric) task=runGametest ;; forge|neoforge) task=runGameTestServer ;; *) exit 64 ;; esac
    ;;
  *) exit 64 ;;
esac
jvm_options=('-XX:ActiveProcessorCount=2')
if [[ "$phase" != build ]]; then jvm_options+=('-Xmx1536m'); fi
if [[ -f /run/minemod-proxy-ca.pem ]]; then
  cp "$JAVA_HOME/lib/security/cacerts" /tmp/minemod-cacerts
  keytool -importcert -noprompt -trustcacerts -alias minemod-session-proxy -file /run/minemod-proxy-ca.pem -keystore /tmp/minemod-cacerts -storepass changeit >/dev/null 2>&1
  jvm_options+=('-Djavax.net.ssl.trustStore=/tmp/minemod-cacerts' '-Djavax.net.ssl.trustStorePassword=changeit')
fi
if [[ "$mode" == online ]]; then
  minemod_proxy="${HTTPS_PROXY:-${https_proxy:-}}"
  if [[ -n "$minemod_proxy" ]]; then
    minemod_proxy="${minemod_proxy#*://}"; minemod_proxy="${minemod_proxy##*@}"; minemod_proxy="${minemod_proxy%%/*}"
    minemod_proxy_host="${minemod_proxy%%:*}"; minemod_proxy_port="${minemod_proxy##*:}"
    if [[ "$minemod_proxy_host" == "$minemod_proxy_port" ]]; then minemod_proxy_port=80; fi
    if [[ ! "$minemod_proxy_host" =~ ^[A-Za-z0-9.-]+$ || ! "$minemod_proxy_port" =~ ^[0-9]{1,5}$ ]]; then echo 'Unsupported proxy address format'; exit 64; fi
    jvm_options+=("-Dhttp.proxyHost=$minemod_proxy_host" "-Dhttp.proxyPort=$minemod_proxy_port" "-Dhttps.proxyHost=$minemod_proxy_host" "-Dhttps.proxyPort=$minemod_proxy_port" '-Dhttp.nonProxyHosts=localhost|127.*|[::1]')
  fi
fi
export JAVA_TOOL_OPTIONS="${jvm_options[*]}"
export GRADLE_USER_HOME=/cache
args=(--no-daemon --max-workers=2 --console=plain)
if [[ "$phase" != build ]]; then args+=('-Dorg.gradle.jvmargs=-Xmx768m'); fi
if [[ "$mode" == offline ]]; then args+=(--offline); fi
exec gradle "${args[@]}" "$task"
