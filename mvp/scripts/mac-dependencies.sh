#!/bin/bash
# Sourced by the macOS launchers. No service is registered with launchd/Homebrew.
compass_require_dependencies() {
  if [ "$(uname -s)" != Darwin ]; then
    echo 'Этот пакет подготовлен для macOS.' >&2; return 1
  fi
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  COMPASS_NODE="$(command -v node || true)"
  if [ -n "$COMPASS_NODE" ] && [ "$("$COMPASS_NODE" -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]; then COMPASS_NODE=''; fi
  local compass_candidate compass_brew
  if [ -z "$COMPASS_NODE" ]; then
    for compass_candidate in /opt/homebrew/opt/node@24/bin/node /usr/local/opt/node@24/bin/node /opt/homebrew/opt/node/bin/node /usr/local/opt/node/bin/node; do
      if [ -x "$compass_candidate" ] && [ "$("$compass_candidate" -p 'Number(process.versions.node.split(".")[0])')" -ge 22 ]; then COMPASS_NODE="$compass_candidate"; break; fi
    done
  fi
  if [ -z "${PG_BIN:-}" ]; then
    for compass_candidate in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /Applications/Postgres.app/Contents/Versions/17/bin; do
      if [ -x "$compass_candidate/pg_ctl" ] && [ -x "$compass_candidate/initdb" ]; then PG_BIN="$compass_candidate"; break; fi
    done
  fi
  if [ -n "${PG_BIN:-}" ] && ! "$PG_BIN/psql" --version | /usr/bin/grep -Eq 'PostgreSQL\) 17\.'; then
    echo 'PG_BIN должен указывать на PostgreSQL 17.' >&2; return 1
  fi
  if [ -z "$COMPASS_NODE" ] || [ -z "${PG_BIN:-}" ]; then
    if [ "${COMPASS_NO_INSTALL:-0}" = 1 ]; then echo 'Не найдены Node.js 22+ или PostgreSQL 17; установка отключена для этой проверки.' >&2; return 1; fi
    compass_brew="$(command -v brew || true)"
    if [ -z "$compass_brew" ]; then
      echo 'Для первой установки нужен Homebrew: https://brew.sh' >&2
      echo 'Установите его, затем снова откройте START.command. Либо установите Node.js 22+ и PostgreSQL 17 самостоятельно.' >&2
      return 1
    fi
    if [ -z "$COMPASS_NODE" ]; then
      echo 'Устанавливаем Node.js через Homebrew…'
      HOMEBREW_NO_AUTO_UPDATE=1 "$compass_brew" install node@24
      COMPASS_NODE="$("$compass_brew" --prefix node@24)/bin/node"
    fi
    if [ -z "${PG_BIN:-}" ]; then
      echo 'Устанавливаем PostgreSQL 17 через Homebrew…'
      HOMEBREW_NO_AUTO_UPDATE=1 "$compass_brew" install postgresql@17
      PG_BIN="$("$compass_brew" --prefix postgresql@17)/bin"
    fi
  fi
  for compass_candidate in initdb pg_ctl psql pg_dump pg_restore; do
    if [ ! -x "$PG_BIN/$compass_candidate" ]; then echo "Нет $PG_BIN/$compass_candidate" >&2; return 1; fi
  done
  export PG_BIN
  export PATH="$(dirname "$COMPASS_NODE"):$PG_BIN:$PATH"
}
