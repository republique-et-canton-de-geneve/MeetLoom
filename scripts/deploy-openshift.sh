#!/usr/bin/env bash
# Requires bash, oc, and a logged-in OpenShift context. No secrets in log output.
set -euo pipefail
target=${1:-}
case "$target" in
  development) project=${MEETLOOM_NAMESPACE:-meetloom-dev}; overlay=development ;;
  production) project=${MEETLOOM_NAMESPACE:-meetloom-prod}; overlay=production ;;
  *) project=$target; overlay=openshift ;;
esac
image=${2:-}
mode=${3:-bundled}
# Optional: pull PostgreSQL through an internal registry (for example a Nexus proxy) instead of quay.io.
database_image=${MEETLOOM_DATABASE_IMAGE:-quay.io/sclorg/postgresql-16-c9s:latest}
if [[ ! "$project" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || [[ ! "$image" =~ ^[a-zA-Z0-9][a-zA-Z0-9._:/@-]+$ ]] || [[ ! "$database_image" =~ ^[a-zA-Z0-9][a-zA-Z0-9._:/@-]+$ ]] || [[ "$mode" != bundled && "$mode" != external ]]; then
  printf '%s\n' 'Usage: bash scripts/deploy-openshift.sh development|production|PROJECT IMAGE [bundled|external]' >&2
  exit 1
fi
command -v oc >/dev/null
command -v python3 >/dev/null || { echo 'Python 3 is required to encode Kubernetes objects without exposing secrets in arguments.' >&2; exit 1; }
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
oc whoami >/dev/null
project_resource=$(oc get project "$project" --ignore-not-found -o name) || { echo 'Could not query the project; installation stopped.' >&2; exit 1; }
if [[ -z "$project_resource" ]]; then echo "Project $project is missing. Create it with oc new-project or ask your cluster administrator." >&2; exit 1; fi
printf 'Target namespace: %s\n' "$project"
random_secret() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
resource_exists() {
  local resource
  if ! resource=$(oc -n "$project" get "$1" "$2" --ignore-not-found -o name); then
    echo "Could not query $1/$2; installation stopped." >&2
    exit 1
  fi
  [[ -n "$resource" ]]
}

if resource_exists secret meetloom-database; then
  existing_mode=$(oc -n "$project" get secret meetloom-database -o 'jsonpath={.metadata.annotations.meetloom\.io/database-mode}')
  if [[ "$existing_mode" != "$mode" ]]; then echo 'Database mode differs from the existing Secret. Migrate explicitly before changing modes.' >&2; exit 1; fi
else
  if [[ "$mode" == bundled ]] && resource_exists pvc meetloom-postgresql; then
    echo 'The database PVC exists but its Secret is missing. Restore its credentials; refusing to generate a new password for existing data.' >&2
    exit 1
  fi
  export MEETLOOM_INSTALL_MODE="$mode"
  if [[ "$mode" == external ]]; then
    : "${MEETLOOM_DATABASE_URL:?Set MEETLOOM_DATABASE_URL for external PostgreSQL}"
  else
    export MEETLOOM_INSTALL_DB_PASSWORD
    MEETLOOM_INSTALL_DB_PASSWORD=$(random_secret)
  fi
  python3 - <<'PY' | oc -n "$project" create -f - >/dev/null
import json, os
mode = os.environ['MEETLOOM_INSTALL_MODE']
if mode == 'external':
    data = {'DATABASE_URL': os.environ['MEETLOOM_DATABASE_URL']}
else:
    password = os.environ['MEETLOOM_INSTALL_DB_PASSWORD']
    data = {'POSTGRESQL_USER': 'meetloom', 'POSTGRESQL_PASSWORD': password, 'POSTGRESQL_DATABASE': 'meetloom', 'DATABASE_URL': f'postgresql://meetloom:{password}@meetloom-postgresql:5432/meetloom'}
print(json.dumps({'apiVersion':'v1','kind':'Secret','type':'Opaque','metadata':{'name':'meetloom-database','annotations':{'meetloom.io/database-mode':mode}},'stringData':data}))
PY
  unset MEETLOOM_INSTALL_DB_PASSWORD MEETLOOM_INSTALL_MODE
fi

if ! resource_exists secret meetloom-auth; then
  export MEETLOOM_INSTALL_TOKEN
  MEETLOOM_INSTALL_TOKEN=$(random_secret)
  python3 - <<'PY' | oc -n "$project" create -f - >/dev/null
import json, os
data = {'BOOTSTRAP_TOKEN': os.environ['MEETLOOM_INSTALL_TOKEN']}
print(json.dumps({'apiVersion':'v1','kind':'Secret','type':'Opaque','metadata':{'name':'meetloom-auth'},'stringData':data}))
PY
  unset MEETLOOM_INSTALL_TOKEN
fi

oc -n "$project" apply -f "$repo_root/k8s/base/service.yaml" >/dev/null
oc -n "$project" apply -k "$repo_root/k8s/route" >/dev/null
route_host=$(oc -n "$project" get route meetloom -o 'jsonpath={.spec.host}')
[[ -n "$route_host" ]] || { echo 'The Route has no hostname; check router admission.' >&2; exit 1; }
export MEETLOOM_INSTALL_ORIGIN="https://$route_host"
if ! resource_exists configmap meetloom-settings; then
  python3 - <<'PY' | oc -n "$project" create -f - >/dev/null
import json, os
data = {'APP_ORIGIN':os.environ['MEETLOOM_INSTALL_ORIGIN']}
for key in ['LLM_BASE_URL','LLM_MODEL','LLM_VISION_MODEL']:
    if os.environ.get(key): data[key] = os.environ[key]
print(json.dumps({'apiVersion':'v1','kind':'ConfigMap','metadata':{'name':'meetloom-settings'},'data':data}))
PY
fi
if [[ -n ${LLM_API_KEY:-} ]] && ! resource_exists secret meetloom-ai; then
  python3 - <<'PY' | oc -n "$project" create -f - >/dev/null
import json, os
print(json.dumps({'apiVersion':'v1','kind':'Secret','type':'Opaque','metadata':{'name':'meetloom-ai'},'stringData':{'LLM_API_KEY':os.environ['LLM_API_KEY']}}))
PY
fi

[[ "$mode" == external ]] && overlay=openshift-external-db
rendered=$(oc kustomize "$repo_root/k8s/overlays/$overlay")
[[ "$rendered" == *'docker.io/your-account/meetloom:0.1.0'* ]] || { echo 'Application image marker missing from the manifests.' >&2; exit 1; }
printf '%s\n' "$rendered" |
  sed -e "s|docker\\.io/your-account/meetloom:0\\.1\\.0|$image|g" \
    -e "s|quay\\.io/sclorg/postgresql-16-c9s:latest|$database_image|g" |
  oc -n "$project" apply -f -
if [[ "$mode" == bundled ]]; then oc -n "$project" rollout status deployment/meetloom-postgresql --timeout=300s; fi
oc -n "$project" rollout status deployment/meetloom --timeout=300s
oc -n "$project" exec deployment/meetloom -- node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
printf 'MeetLoom: %s\n' "$MEETLOOM_INSTALL_ORIGIN"
printf '%s\n' 'Existing secrets and environment configuration were preserved.'
printf '%s\n' 'To create the first administrator in the application, retrieve the bootstrap token privately:'
printf "oc -n %s get secret meetloom-auth -o 'jsonpath={.data.BOOTSTRAP_TOKEN}' | base64 --decode; echo\n" "$project"
