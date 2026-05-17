#!/usr/bin/env sh
set -eu

log() {
  printf '%s\n' "$*" >&2
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

load_wrapper_config() {
  if [ -n "${WP_SBX_CONFIG_FILE:-}" ]; then
    [ -f "$WP_SBX_CONFIG_FILE" ] || fail "WP_SBX_CONFIG_FILE is set but not readable: $WP_SBX_CONFIG_FILE"
    # shellcheck disable=SC1090
    . "$WP_SBX_CONFIG_FILE"
    return 0
  fi

  selected_config=""
  config_count=0
  for candidate in \
    "$HOME/.cache/wedding-planner/sbx-config/sandbox.env" \
    /Users/*/.cache/wedding-planner/sbx-config/sandbox.env \
    /home/*/.cache/wedding-planner/sbx-config/sandbox.env; do
    [ -f "$candidate" ] || continue
    if [ -n "$selected_config" ] && [ "$candidate" = "$selected_config" ]; then
      continue
    fi
    selected_config="$candidate"
    config_count=$((config_count + 1))
  done

  if [ "$config_count" -gt 1 ]; then
    fail "Multiple sandbox.env files found; set WP_SBX_CONFIG_FILE to choose one explicitly."
  fi

  if [ "$config_count" -eq 1 ]; then
    # shellcheck disable=SC1090
    . "$selected_config"
  fi
}

read_json_field() {
  json_file="$1"
  field_name="$2"
  JSON_FILE="$json_file" FIELD_NAME="$field_name" node <<'NODE'
const fs = require('fs');
const file = process.env.JSON_FILE;
const field = process.env.FIELD_NAME;
const json = JSON.parse(fs.readFileSync(file, 'utf8'));
const value = json[field];
if (typeof value === 'string') process.stdout.write(value);
NODE
}

require_placeholder_env() {
  name="$1"
  expected="$2"
  eval "actual=\${$name:-}"

  if [ -z "$actual" ]; then
    fail "$name is not set. Configure the Docker custom secret and recreate the sandbox."
  fi

  if [ "$actual" != "$expected" ]; then
    fail "$name is not the expected proxy placeholder. Refusing to continue because a real token may be exposed inside the sandbox."
  fi
}

configure_pi_auth_cache() {
  pi_agent_home="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
  mkdir -p "$pi_agent_home"

  if [ -z "${WP_PI_AUTH_CACHE:-}" ]; then
    log "No shared Pi OAuth cache configured; Pi auth will use sandbox-local state."
    return 0
  fi

  if [ ! -d "$WP_PI_AUTH_CACHE" ]; then
    log "Shared Pi OAuth cache is not mounted at $WP_PI_AUTH_CACHE; Pi auth will use sandbox-local state."
    return 0
  fi

  auth_file="$WP_PI_AUTH_CACHE/auth.json"
  if [ ! -e "$auth_file" ]; then
    printf '{}\n' > "$auth_file" || fail "Could not create shared Pi OAuth cache file at $auth_file"
    log "Created empty shared Pi OAuth cache at $auth_file. Run /login once in Pi to populate it."
  fi

  if [ -e "$pi_agent_home/auth.json" ] || [ -L "$pi_agent_home/auth.json" ]; then
    current_target="$(readlink "$pi_agent_home/auth.json" 2>/dev/null || true)"
    if [ "$current_target" != "$auth_file" ]; then
      backup="$pi_agent_home/auth.json.sbx-backup-$(date +%Y%m%d%H%M%S)"
      mv "$pi_agent_home/auth.json" "$backup" 2>/dev/null || rm -f "$pi_agent_home/auth.json"
      log "Moved existing sandbox Pi auth.json aside before linking shared cache."
    fi
  fi

  ln -sf "$auth_file" "$pi_agent_home/auth.json" || fail "Could not link shared Pi OAuth cache into $pi_agent_home/auth.json"
  log "Using shared Pi OAuth cache at $auth_file. Sandbox processes can read this main-account OAuth state."
}

write_vercel_sentinel_auth() {
  vercel_config_dir="${XDG_DATA_HOME:-$HOME/.local/share}/com.vercel.cli"
  vercel_auth_file="$vercel_config_dir/auth.json"
  mkdir -p "$vercel_config_dir"

  VERCEL_AUTH_FILE="$vercel_auth_file" node <<'NODE'
const fs = require('fs');
const file = process.env.VERCEL_AUTH_FILE;
const token = process.env.VERCEL_TOKEN;
if (!file || !token) process.exit(1);
fs.writeFileSync(file, JSON.stringify({
  '// Note': 'Docker Sandbox proxy-managed sentinel. The real Vercel token stays on the host.',
  token,
  tokenSource: 'env',
}, null, 2) + '\n', { mode: 0o600 });
NODE
  chmod 600 "$vercel_auth_file" 2>/dev/null || true
}

configure_supabase_sentinel_auth() {
  mkdir -p "$HOME/.supabase"
  supabase login --token "$SUPABASE_ACCESS_TOKEN" --yes >/dev/null
}

verify_cloud_auth() {
  log "Verifying Vercel auth through Docker custom secret proxy..."
  vercel whoami >/dev/null || fail "Vercel auth check failed. Recreate the sandbox after setting the VERCEL_TOKEN custom secret."

  log "Verifying Supabase auth through Docker custom secret proxy..."
  supabase projects list -o json >/dev/null || fail "Supabase auth check failed. Recreate the sandbox after setting the SUPABASE_ACCESS_TOKEN custom secret."
}

ensure_vercel_link() {
  [ -n "${WP_VERCEL_SCOPE:-}" ] || fail "WP_VERCEL_SCOPE is empty"
  [ -n "${WP_VERCEL_PROJECT:-}" ] || fail "WP_VERCEL_PROJECT is empty"

  vercel_dir="$WORKSPACE_DIR/.vercel"
  project_json="$vercel_dir/project.json"
  marker="$vercel_dir/sbx-target"

  if [ -f "$project_json" ]; then
    actual_project="$(read_json_field "$project_json" projectName)"
    actual_project_id="$(read_json_field "$project_json" projectId)"
    actual_org_id="$(read_json_field "$project_json" orgId)"

    [ "$actual_project" = "$WP_VERCEL_PROJECT" ] \
      || fail "Existing Vercel link targets project '$actual_project', expected '$WP_VERCEL_PROJECT'. Remove .vercel or relink explicitly."

    if [ -f "$marker" ] \
      && grep -Fx "scope=$WP_VERCEL_SCOPE" "$marker" >/dev/null \
      && grep -Fx "project=$WP_VERCEL_PROJECT" "$marker" >/dev/null \
      && grep -Fx "project_id=$actual_project_id" "$marker" >/dev/null \
      && grep -Fx "org_id=$actual_org_id" "$marker" >/dev/null; then
      log "Vercel link already targets $WP_VERCEL_SCOPE/$WP_VERCEL_PROJECT."
      return 0
    fi

    fail "Existing .vercel/project.json target lacks matching sbx marker metadata for $WP_VERCEL_SCOPE/$WP_VERCEL_PROJECT. Remove .vercel or relink explicitly."
  fi

  log "Linking Vercel project $WP_VERCEL_SCOPE/$WP_VERCEL_PROJECT..."
  (cd "$WORKSPACE_DIR" && vercel link --yes --team "$WP_VERCEL_SCOPE" --project "$WP_VERCEL_PROJECT" >/dev/null) \
    || fail "Vercel auto-link failed"

  mkdir -p "$vercel_dir"
  actual_project_id="$(read_json_field "$project_json" projectId)"
  actual_org_id="$(read_json_field "$project_json" orgId)"
  {
    printf 'scope=%s\n' "$WP_VERCEL_SCOPE"
    printf 'project=%s\n' "$WP_VERCEL_PROJECT"
    printf 'project_id=%s\n' "$actual_project_id"
    printf 'org_id=%s\n' "$actual_org_id"
  } > "$marker"
}

ensure_supabase_link() {
  [ -n "${WP_SUPABASE_PROJECT_REF:-}" ] || fail "WP_SUPABASE_PROJECT_REF is empty"

  temp_dir="$WORKSPACE_DIR/supabase/.temp"
  project_ref_file="$temp_dir/project-ref"

  if [ -f "$project_ref_file" ]; then
    current_ref="$(tr -d '[:space:]' < "$project_ref_file")"
    if [ "$current_ref" = "$WP_SUPABASE_PROJECT_REF" ]; then
      log "Supabase link already targets $WP_SUPABASE_PROJECT_REF."
      return 0
    fi

    fail "Existing Supabase link targets $current_ref, expected $WP_SUPABASE_PROJECT_REF. Remove supabase/.temp or relink explicitly."
  fi

  log "Linking Supabase project $WP_SUPABASE_PROJECT_REF..."
  (cd "$WORKSPACE_DIR" && supabase link --project-ref "$WP_SUPABASE_PROJECT_REF" --yes >/dev/null) \
    || fail "Supabase auto-link failed"

  if [ ! -f "$project_ref_file" ]; then
    fail "Supabase link succeeded but did not create $project_ref_file"
  fi
}

load_wrapper_config

: "${WORKSPACE_DIR:=$(pwd)}"
: "${WP_VERCEL_SCOPE:=mjaox-wedding-planner}"
: "${WP_VERCEL_PROJECT:=wedding-planner}"
: "${WP_SUPABASE_PROJECT_REF:=wakdmxadoruqsstbokan}"
: "${WP_VERCEL_PLACEHOLDER:=vercel_proxy_managed_00000000000000000000000000000000}"
: "${WP_SUPABASE_PLACEHOLDER_PREFIX:=sbp_0123456789abcdef01234567}"
: "${WP_SUPABASE_PLACEHOLDER_SUFFIX:=89abcdef01234567}"
if [ -z "${WP_SUPABASE_PLACEHOLDER:-}" ]; then
  WP_SUPABASE_PLACEHOLDER="${WP_SUPABASE_PLACEHOLDER_PREFIX}${WP_SUPABASE_PLACEHOLDER_SUFFIX}"
fi

configure_pi_auth_cache

require_placeholder_env VERCEL_TOKEN "$WP_VERCEL_PLACEHOLDER"
require_placeholder_env SUPABASE_ACCESS_TOKEN "$WP_SUPABASE_PLACEHOLDER"
write_vercel_sentinel_auth
configure_supabase_sentinel_auth
verify_cloud_auth
ensure_vercel_link
ensure_supabase_link
