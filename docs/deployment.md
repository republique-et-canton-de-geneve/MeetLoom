# GitHub Release → Docker Hub → OpenShift

Deployment is performed by the operator. GitHub workflows build and publish an image; they have no OpenShift credentials and do not modify the cluster.

**First-release delivery order:** complete functional coverage and manual QA, obtain user acceptance, add the nominal E2E suite, and only then trigger the release and installations. The commands below document that later step; their presence in this repository does not trigger publication or installation.

These files are generic and can be used on your own cluster. The names below are examples with no connection to a particular organization.

| Environment | Default namespace | Manifests                  |
| ----------- | ----------------- | -------------------------- |
| Development | `meetloom-dev`    | `k8s/overlays/development` |
| Production  | `meetloom-prod`   | `k8s/overlays/production`  |

Objects are named `meetloom` or `meetloom-*`. Each namespace keeps its own secrets, configuration, and PostgreSQL volume, even when both run the same image. Manifests impose no namespace: use `-Project` in PowerShell or the `MEETLOOM_NAMESPACE` environment variable to choose yours.

## 1. Configure GitHub and Docker Hub once

Create or choose the Docker Hub repository that will receive images. The workflow requires an explicit name; it assumes neither an existing repository nor a particular account's permissions.

In **GitHub → Settings → Secrets and variables → Actions**:

| Type     | Name                   | Value                                                          |
| -------- | ---------------------- | -------------------------------------------------------------- |
| Variable | `DOCKERHUB_REPOSITORY` | `your-account/meetloom`, without a tag                         |
| Secret   | `DOCKERHUB_USERNAME`   | Account authorized to publish to that repository               |
| Secret   | `DOCKERHUB_TOKEN`      | Docker Hub token with permission to publish to that repository |

For compatibility with RetroGemini, `DOCKERHUB_REPOSITORY` may also be a Secret when the variable is absent. Do not use the Docker Hub account password or store the token in Git. GitHub needs no OpenShift token, kubeconfig, or secret.

If the Docker Hub repository is private, prepare a pull secret in each namespace and associate it with the `default` ServiceAccount using your cluster's procedure. PostgreSQL uses the public `quay.io/sclorg/postgresql-16-c9s` image, designed for OpenShift. An overlay can substitute `registry.redhat.io/rhel9/postgresql-16` with the required Red Hat permissions, or an internal mirror. See [SCLorg PostgreSQL images](https://github.com/sclorg/postgresql-container).

### Branch protection and auto-merge

In **GitHub → Settings → Branches**, protect `main`: require a pull request and the **CI Success** status check (it includes the end-to-end journeys). In **Settings → General**, enable **Allow auto-merge**. Dependabot patch and development minor updates then merge by themselves once CI Success passes; everything else waits for review.

## 2. Publish a version

The version source is `package.json`, currently `0.1.0`. For the next version, update `package.json` and its lockfile in a PR (for example, `npm version 0.1.1 --no-git-tag-version`), then merge the validated changes.

Choose one trigger:

- **GitHub → Releases → Draft a new release**: publish tag `v0.1.0` on the intended commit, whose `package.json` contains `0.1.0`.
- **GitHub → Actions → Release GitHub and Docker Hub → Run workflow**, branch `main`: the version from `package.json` is published and the GitHub Release is created after successful checks.

The workflow verifies the tag, tests that exact commit on SQLite and PostgreSQL, checks dependencies, and builds and scans the image. It then publishes:

```text
docker.io/your-account/meetloom:0.1.0
docker.io/your-account/meetloom:sha-FULL_COMMIT
```

It attaches the SBOM, a manifests/guides archive, and `meetloom-image.json` containing the image reference, digest, and commit to the Release. Wait for a successful workflow before using the image: a Release created through the GitHub interface does not mean the build is finished. The `latest` tag is published only upon manual request; use version tags or a digest for OpenShift.

Do not reuse a version for another commit. To reproduce an installation exactly, retain the digest from `meetloom-image.json`. The workflow does not deploy to OpenShift.

## 3. Install for the first time

Requirements: `oc`, PowerShell 7 (or Bash + Python 3), access to the selected namespace, an available storage class for the 5 GiB PVC, and access to the images. Use your OpenShift console's login command to run `oc login`. Check the server and your identity before installation:

```bash
oc whoami
oc whoami --show-server
```

From the repository or the extracted release archive, install only the desired environment:

```powershell
pwsh ./scripts/deploy-openshift.ps1 -Environment development -Project meetloom-dev -Image docker.io/your-account/meetloom:0.1.0
# When you are ready to install production:
pwsh ./scripts/deploy-openshift.ps1 -Environment production -Project meetloom-prod -Image docker.io/your-account/meetloom:0.1.0
```

Or with Bash:

```bash
bash scripts/deploy-openshift.sh development docker.io/your-account/meetloom:0.1.0
MEETLOOM_NAMESPACE=my-project bash scripts/deploy-openshift.sh production docker.io/your-account/meetloom:0.1.0
```

### Windows and an internal registry mirror

On Windows, install [PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows) (`winget install Microsoft.PowerShell`): the built-in Windows PowerShell 5.1 cannot run the installer. Put `oc.exe` on the `PATH`, then run the commands above from `pwsh`, in the repository or the extracted release archive.

When the cluster pulls images through an internal mirror such as a Nexus Docker proxy, keep publishing to Docker Hub and give the installer the mirrored reference instead. `-DatabaseImage` (or `MEETLOOM_DATABASE_IMAGE` with Bash) does the same for PostgreSQL when the cluster cannot reach `quay.io`:

```powershell
oc login --token=... --server=https://api.cluster.example:6443
pwsh ./scripts/deploy-openshift.ps1 -Environment development -Project meetloom-dev `
  -Image docker-all.devops.etat-ge.ch/jpfroud/meetloom:0.1.0 `
  -DatabaseImage mirror.example/sclorg/postgresql-16-c9s:latest
```

Omit `-DatabaseImage` when `quay.io` is reachable. If the mirror requires credentials, add its pull secret to the namespace and link it to the `default` ServiceAccount (`oc secrets link default <secret> --for=pull`). Use the same mirrored reference in `oc set image` for later updates.

Create the project first if it does not exist, using `oc new-project meetloom-dev`, or ask the cluster administrator to create it. The installer neither adds nor deletes namespaces. It generates missing secrets, creates the Route to determine the HTTPS URL, applies manifests, waits for deployments, and checks readiness. It does not change your current project. Each namespace's secrets and configuration remain outside Kustomization and are preserved on subsequent runs.

The PostgreSQL password and bootstrap token each contain **32 independently generated random bytes**, encoded as hexadecimal. Their values are never printed in logs. If a PVC exists but its secret is missing, the script stops: restore the existing credentials instead of generating replacements.

### First account

`BOOTSTRAP_TOKEN` protects creation of the first administrator. Read it in a private terminal and enter it on the initial setup screen:

```powershell
$encoded = oc -n meetloom-dev get secret meetloom-auth -o 'jsonpath={.data.BOOTSTRAP_TOKEN}'
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
```

For production, replace the namespace with `meetloom-prod`. Keep this token in your secrets manager; it does not reset an existing account. The application asks for the first account's name, email address, and password, without a preinstalled demo account.

## 4. Update after a new release

After `0.1.1` has been published successfully, change **only the `app` container image in the `meetloom` Deployment** through the OpenShift console. CLI alternative, starting with development:

```bash
oc -n meetloom-dev set image deployment/meetloom app=docker.io/your-account/meetloom:0.1.1
oc -n meetloom-dev rollout status deployment/meetloom
```

After validation, promote that exact image to production:

```bash
oc -n meetloom-prod set image deployment/meetloom app=docker.io/your-account/meetloom:0.1.1
oc -n meetloom-prod rollout status deployment/meetloom
```

An image update changes neither secrets, the PVC, nor the ConfigMap. A simple application update does not require restarting PostgreSQL. V1 uses one pod and the `Recreate` strategy, so allow for a short interruption. If a release changes manifests, read its notes and rerun its installer with the new image.

A later raw `oc apply -k` would restore the image declared in the manifests. Use the installer with `-Image` or keep the chosen version in your operational overlay. The base value `docker.io/your-account/meetloom:0.1.0` is a placeholder, not a published image.

## 5. Roll back

Keep the previous image reference and a backup before updating. If the new version causes problems, restore the previous image using the same `oc set image` command, then wait for rollout. A schema migration may require a compatible restore; reverting an image does not restore data. See [backups and operations](operations.md).

## Secrets and configuration

| Resource created in each namespace     | Contents                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Secret `meetloom-database`             | `POSTGRESQL_USER`, `POSTGRESQL_PASSWORD`, `POSTGRESQL_DATABASE`, `DATABASE_URL`; external mode: `DATABASE_URL` only |
| Secret `meetloom-auth`                 | `BOOTSTRAP_TOKEN`                                                                                                   |
| ConfigMap `meetloom-settings`          | `APP_ORIGIN` derived from the Route; optional `QWEN_BASE_URL`, `QWEN_MODEL`, and `QWEN_VISION_MODEL`                |
| Optional Secret `meetloom-ai`          | `QWEN_API_KEY`                                                                                                      |
| Optional ConfigMap `meetloom-services` | Non-secret OIDC and SMTP settings; example in `k8s/optional/services-config.example.yaml`                           |
| Optional Secret `meetloom-services`    | `OIDC_CLIENT_SECRET`, `SMTP_USER`, and `SMTP_PASSWORD` according to enabled services                                |

Environment-specific resources are not rewritten by `oc apply -k`. An initialized PostgreSQL password cannot be changed by editing the Secret alone: update the database and `DATABASE_URL` together. Changing a Secret/ConfigMap injected into the application requires restarting its Deployment.

For Qwen, set `QWEN_BASE_URL`, `QWEN_MODEL`, and optionally `QWEN_API_KEY` in the environment during initial installation, or edit the resources above afterward. Example endpoint: `https://internal-llm.example/v1`. To import documents using a compatible vision model, add `QWEN_VISION_MODEL` to the ConfigMap; the text model is sufficient for agenda construction. Mount the internal CA and use `NODE_EXTRA_CA_CERTS` if needed; retain TLS verification.

OIDC sign-in, email password recovery, and email digests are optional. They require no mandatory public service. Follow the [OIDC and SMTP guide](services-auth-mail.md) to create the two `meetloom-services` resources, register the callback URL with your identity provider, and test SMTP delivery. Installation scripts neither generate nor replace their secrets. Local sign-in and in-app notifications remain available without this configuration.

For externally managed PostgreSQL, prepare `MEETLOOM_DATABASE_URL` and add `-ExternalDatabase` to the PowerShell script, or `external` as the third Bash argument. No PostgreSQL instance or PVC is installed in this mode. Switching an existing installation's mode is intentionally rejected until migration has been prepared.

## Customization and local trials

For Kubernetes without OpenShift, use `k8s/base` and `k8s/postgresql` in your own Kustomization. Supply the same Secrets/ConfigMap described above, replace the image, and add an HTTPS Ingress appropriate to your controller. Set `APP_ORIGIN` to its public URL and `TRUST_PROXY` for your topology. OpenShift Routes do not work on standard Kubernetes; the provided scripts automate the OpenShift variant. On Kubernetes, also configure the PostgreSQL volume access group (for example, `fsGroup: 26` for the SCLorg image) according to your StorageClass; OpenShift assigns the group through its SCC.

Images run without privileges and accept an arbitrary UID. The application uses a read-only root filesystem, `/api/health` and `/api/ready` probes, and no Kubernetes access token. Keep internal registry, storage class, or resource limit adjustments in an operational overlay.

NetworkPolicies are optional: `k8s/optional/database-networkpolicy.yaml` targets only MeetLoom PostgreSQL, never the entire namespace. Check existing platform rules before applying it; a more permissive existing rule can make this restriction ineffective.

For a quick local trial, copy `.env.example` to `.env`, set two distinct random hexadecimal values for `POSTGRES_PASSWORD` and `BOOTSTRAP_TOKEN`, then run:

```bash
docker compose up --build -d
```

Open `http://localhost:3000`. PostgreSQL is not exposed on the host, and the application binds only to `127.0.0.1`. `docker compose down` preserves data; do not add `--volumes` for an update. The local profile uses HTTP; OpenShift manifests use HTTPS. For a trial without Docker, see the [README](../README.md).

Manifests and scripts have been checked locally. Admission, pull secrets, storage, Routes, and your Qwen endpoint still need operator verification in the target environments. Access to those environments is not required to prepare these files.

For a hosted demonstration launched from a button, see [Render](render.md). The free plan uses ephemeral storage; prefer your own infrastructure for retaining private agendas.
