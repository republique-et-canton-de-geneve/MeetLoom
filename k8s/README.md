# OpenShift installation

The workflow is **GitHub Release → Docker Hub image → operator-managed OpenShift update**. No GitHub workflow has cluster access, and no remote deployment is triggered automatically.

Manifests are independent of any organization. The namespaces below are configurable examples, not values imposed by the overlays.

| Environment | Namespace       | Overlay                    |
| ----------- | --------------- | -------------------------- |
| Development | `meetloom-dev`  | `k8s/overlays/development` |
| Production  | `meetloom-prod` | `k8s/overlays/production`  |

All application resources are named `meetloom` or prefixed with `meetloom-`, with their own selectors, secrets, and PVC. They can coexist with RetroGemini. The installer neither creates nor deletes namespaces.

After configuring Docker Hub and publishing a first release, an operator signed in through `oc login` can install:

```powershell
pwsh ./scripts/deploy-openshift.ps1 -Environment development -Project meetloom-dev -Image docker.io/your-account/meetloom:0.1.0
pwsh ./scripts/deploy-openshift.ps1 -Environment production -Project meetloom-prod -Image docker.io/your-account/meetloom:0.1.0
```

Or with Bash:

```bash
bash scripts/deploy-openshift.sh development docker.io/your-account/meetloom:0.1.0
MEETLOOM_NAMESPACE=my-project bash scripts/deploy-openshift.sh production docker.io/your-account/meetloom:0.1.0
```

Create the project first with `oc new-project` if needed. Commands are run by the operator, only in the intended environment. Replace `your-account/meetloom` with the project's configured GitHub variable `DOCKERHUB_REPOSITORY`. The base image `your-account/meetloom` is a placeholder, not evidence that a published image exists.

Environment Secrets and the ConfigMap are created only when absent, outside Kustomization, and then preserved during updates. An existing PVC without its database Secret causes installation to fail: no new password is generated for existing data.

For an ordinary update, change only the `app` container image in the `meetloom` Deployment through the console, or run:

```bash
oc -n meetloom-dev set image deployment/meetloom app=docker.io/your-account/meetloom:0.1.1
oc -n meetloom-dev rollout status deployment/meetloom
```

After validation in development, repeat with `-n meetloom-prod`. This changes neither secrets nor data. Rollback uses the same command with the previous version, subject to schema compatibility.

The [complete guide](../docs/deployment.md) covers GitHub secrets, the first account, publication, upgrades, PostgreSQL/LLM variants, and internal registries. The [operations guide](../docs/operations.md) covers backups and diagnostics.
