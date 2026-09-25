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

To try a version in OpenShift before merging it, publish a **release candidate**: in **Releases → Draft a new release**, create tag `v0.1.0-rc.1` (the `package.json` version plus `-rc.N`) targeting the pull request branch, check **Set as a pre-release**, and publish. The same checks run on that commit and the image is published as `your-account/meetloom:0.1.0-rc.1`. Increment `N` for each new candidate; the final `v0.1.0` is released from `main` after the merge.

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

### From Windows

Install [PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows) (`winget install Microsoft.PowerShell`): the built-in Windows PowerShell 5.1 cannot run the installer. Put `oc.exe` on the `PATH`, then run the PowerShell commands above from `pwsh`, in the repository or the extracted release archive.

### Behind a registry mirror (Nexus, Artifactory, Harbor…)

Some clusters cannot pull from Docker Hub or `quay.io` directly and go through an internal registry proxy instead. The release is still published to Docker Hub; only the image name given to the installer changes. Prefix it with your mirror's address, using the path your mirror administrators document:

```powershell
pwsh ./scripts/deploy-openshift.ps1 -Environment development -Project meetloom-dev `
  -Image <mirror-host>/your-account/meetloom:0.1.0 `
  -DatabaseImage <mirror-host>/sclorg/postgresql-16-c9s:latest
```

`-DatabaseImage` (or `MEETLOOM_DATABASE_IMAGE` with Bash) does the same for the bundled PostgreSQL image; omit it when `quay.io` is reachable. If the mirror requires credentials, add its pull secret to the namespace and link it to the `default` ServiceAccount (`oc secrets link default <secret> --for=pull`). Use the same mirrored name in `oc set image` for later updates.

Create the project first if it does not exist, using `oc new-project meetloom-dev`, or ask the cluster administrator to create it. The installer neither adds nor deletes namespaces. It generates missing secrets, creates the Route to determine the HTTPS URL, applies manifests, waits for deployments, and checks readiness. It does not change your current project. Each namespace's secrets and configuration remain outside Kustomization and are preserved on subsequent runs.

The PostgreSQL password and bootstrap token each contain **32 independently generated random bytes**, encoded as hexadecimal. Their values are never printed in logs. If a PVC exists but its secret is missing, the script stops: restore the existing credentials instead of generating replacements.

### First account

`BOOTSTRAP_TOKEN` protects creation of the first administrator. Read it in a private terminal and enter it on the initial setup screen:

```powershell
$encoded = oc -n meetloom-dev get secret meetloom-auth -o 'jsonpath={.data.BOOTSTRAP_TOKEN}'
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
```

For production, replace the namespace with `meetloom-prod`. Keep this token in your secrets manager; it does not reset an existing account. The application asks for the first account's name, email address, and password, without a preinstalled demo account.

Without the CLI, the OpenShift console shows it under **Workloads → Secrets → `meetloom-auth` → Reveal values**. Open the URL printed by the installer, enter the token in **Installation key** with your name, email address and password: that first account is the administrator. The key is never asked again; other people use normal sign-up.

### If the installation waits or fails

The installer waits up to five minutes for each Deployment, then stops with an error. It is idempotent: fix the cause and run the same command again. To see why a rollout waits, in another terminal:

```powershell
oc -n meetloom-dev get pods
oc -n meetloom-dev get pvc
oc -n meetloom-dev describe pod -l app.kubernetes.io/name=meetloom-postgresql
oc -n meetloom-dev get events --sort-by=.lastTimestamp
```

| Symptom                                                              | Cause and fix                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pod `ErrImagePull` / `ImagePullBackOff`                              | The cluster cannot reach the registry. Rerun with the mirrored names: `-Image <mirror-host>/…` and, for PostgreSQL, `-DatabaseImage <mirror-host>/sclorg/postgresql-16-c9s:latest`.                                                                        |
| Pod `Pending`, PVC `Pending`                                         | No default storage class or quota. Ask for a storage class, or add `storageClassName` to the PVC in your overlay, delete the empty PVC (`oc delete pvc meetloom-postgresql`), and rerun.                                                                   |
| Event `exceeded quota: … requests.cpu`                               | The project quota allows only a few millicores of CPU requests. The manifests request `1m` per pod without a CPU limit (like other applications on such clusters); if your quota is lower still or also limits memory, adjust `resources` in your overlay. |
| Pod `CrashLoopBackOff`                                               | Read `oc logs deployment/meetloom` (or `meetloom-postgresql`). A missing or wrong `APP_ORIGIN` or database secret is reported explicitly.                                                                                                                  |
| Pod created but events mention `SecurityContextConstraints` or quota | Your project's policy rejects the pod. The manifests run without root and without fixed UID; send the event text to your cluster administrators.                                                                                                           |

### Try a branch before merging

**The simple way: Actions → Publish test image → Run workflow.** Choose the branch, optionally type a tag (for example `0.1.0-rc.4`; left empty, the tag is `<package.json version>-dev.<run number>`), and run. The workflow checks that CI passed on that exact commit (open a pull request for the branch and wait for green first), builds the image, verifies it with an arbitrary UID and a read-only root, scans it with Trivy and pushes it to Docker Hub. Its summary shows the command to switch development to it:

```powershell
oc -n meetloom-dev set image deployment/meetloom app=<mirror-host>/your-account/meetloom:0.1.0-rc.4
oc -n meetloom-dev rollout status deployment/meetloom
```

Test tags always end in `-rc.N` or `-dev.N`, never take the name of a real version or `latest`, and an existing tag is never overwritten: after a fix, run it again with the next number. No GitHub release is created. GitHub shows this button only once the workflow exists on `main`; before that, publish a pre-release instead: **Releases → Draft a new release**, tag `v0.1.0-rc.4` created on the branch, **Set as a pre-release** checked (see [Publish a version](#2-publish-a-version)).

A test image works like any version: rerun the installer with it if the branch changes the manifests, otherwise `oc set image` is enough. Once validated, merge the pull request and publish the final `v0.1.0` from `main`.

## 4. Update after a new release

**Before updating, check who is using the application.** Signed in as an administrator, open **Mon compte & équipe → Activité en cours**. It shows the installed version and the sessions an update could disturb: timers running or paused, people in the editor, visitor links followed in the last three minutes. An update replaces pods one at a time, so nobody loses work, but a timer or a visitor page can freeze for a few seconds: prefer a moment when the list is empty. After the update, the same panel (and the bottom of **Mon compte & équipe**, for every account) shows the new version.

**The simplest and always safe way: rerun the installer with the new image.** It is the same command as the first installation, only the image tag changes:

```powershell
pwsh ./scripts/deploy-openshift.ps1 -Environment development -Project meetloom-dev -Image docker.io/your-account/meetloom:0.1.1
```

Run it from the files of that version (`git pull` on its tag, or the `meetloom-<version>-openshift.tar.gz` archive attached to its release), so that manifest changes of the release are applied too. Rerunning the installer **never touches your data or settings**:

| Resource                                                    | What the installer does when it already exists                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| PostgreSQL volume (PVC `meetloom-postgresql`)               | Kept as is: the data stays.                                                       |
| Secrets `meetloom-database`, `meetloom-auth`, `meetloom-ai` | Kept: passwords and the installation key are never regenerated.                   |
| ConfigMap `meetloom-settings`, optional `meetloom-services` | Kept: your URL, LLM, OIDC and SMTP settings stay.                                 |
| Deployments, Services, Route, PodDisruptionBudget           | Updated to the manifests of the version you run it from, with the image you pass. |

The installer refuses to continue if the volume exists but its database secret is missing, rather than generating a new password. Keep environment-specific settings in the ConfigMaps and Secrets above, not by editing the Deployments in the console: those edits are replaced when the manifests are applied again.

**Without interruption.** The application runs **two pods** with a rolling update: OpenShift starts a pod of the new version, waits until `/api/ready` answers, then stops an old one, and repeats. Users keep working during the update; a request in flight on a stopping pod is allowed a few seconds to finish. PostgreSQL stays a **single pod** (with `Recreate`, as a database with one volume must): an application update does not restart it. Only a release that changes the PostgreSQL manifest restarts the database, with a short interruption; its release notes say so.

**Image only (quicker).** When a release does not change the manifests, you can also change the image alone, in the console (**Deployment `meetloom` → Actions → Edit** the `app` container image) or with:

```bash
oc -n meetloom-dev set image deployment/meetloom app=docker.io/your-account/meetloom:0.1.1
oc -n meetloom-dev rollout status deployment/meetloom
```

After validation, promote that exact image to production the same way (`-Project meetloom-prod`, or `oc -n meetloom-prod set image …`).

A later raw `oc apply -k` would restore the placeholder image declared in the manifests. Use the installer with `-Image`, or keep the chosen version in your own overlay. The base value `docker.io/your-account/meetloom:0.1.0` is a placeholder, not a published image.

## 5. Roll back

Keep the previous image reference and a backup before updating. If the new version causes problems, restore the previous image using the same `oc set image` command, then wait for rollout. A schema migration may require a compatible restore; reverting an image does not restore data. See [backups and operations](operations.md).

## Secrets and configuration

| Resource created in each namespace     | Contents                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Secret `meetloom-database`             | `POSTGRESQL_USER`, `POSTGRESQL_PASSWORD`, `POSTGRESQL_DATABASE`, `DATABASE_URL`; external mode: `DATABASE_URL` only |
| Secret `meetloom-auth`                 | `BOOTSTRAP_TOKEN`                                                                                                   |
| ConfigMap `meetloom-settings`          | `APP_ORIGIN` derived from the Route; optional `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_VISION_MODEL`                   |
| Optional Secret `meetloom-ai`          | `LLM_API_KEY`                                                                                                       |
| Optional ConfigMap `meetloom-services` | Non-secret OIDC and SMTP settings; example in `k8s/optional/services-config.example.yaml`                           |
| Optional Secret `meetloom-services`    | `OIDC_CLIENT_SECRET`, `SMTP_USER`, and `SMTP_PASSWORD` according to enabled services                                |

Environment-specific resources are not rewritten by `oc apply -k`. An initialized PostgreSQL password cannot be changed by editing the Secret alone: update the database and `DATABASE_URL` together. Changing a Secret/ConfigMap injected into the application requires restarting its Deployment.

### Connect an LLM

AI assistance is optional: without `LLM_BASE_URL` the AI features do not appear. Any server exposing the OpenAI-compatible Chat Completions API works; the base URL ends in `/v1` (the application adds `/chat/completions`) and the model is the exact identifier that server expects.

At the first installation, set `LLM_BASE_URL`, `LLM_MODEL` and optionally `LLM_API_KEY` in the environment before running the installer. The installer never changes these resources once they exist, so on an installation already running, edit them and restart:

```powershell
oc -n meetloom-dev set data configmap/meetloom-settings LLM_BASE_URL=https://llm.example.org/v1 LLM_MODEL=exact-model-id
oc -n meetloom-dev create secret generic meetloom-ai --from-literal=LLM_API_KEY=your-key --dry-run=client -o yaml | oc -n meetloom-dev apply -f -
oc -n meetloom-dev rollout restart deployment/meetloom
oc -n meetloom-dev rollout status deployment/meetloom
```

Run the `meetloom-ai` line only if the server needs a key. It creates the Secret, or updates it when it already exists (the installer creates it when `LLM_API_KEY` was set at the first installation); a plain `oc create` would stop with `already exists`. Rerun it to change the key, then restart. To import scanned documents (OCR), also set `LLM_VISION_MODEL` to a vision model of the same server; the text model is enough to build agendas. The restart replaces pods one at a time, so it causes no interruption, and a pod that fails to start never replaces a running one (`oc -n meetloom-dev logs deployment/meetloom` shows why).

To check: **Mon compte & équipe → Paramètres de l'installation** shows the AI as configured with its model names, and **Assistant IA** appears in the editor. If a network policy restricts egress, allow the LLM host.

### Internal certificate authority

If the LLM, the SMTP relay or the OIDC provider uses a certificate signed by an internal authority, calls fail with a certificate error. Give Node.js that authority; never disable TLS verification. With the authority in a PEM file:

```powershell
oc -n meetloom-dev create configmap meetloom-ca --from-file=ca.crt=internal-ca.pem --dry-run=client -o yaml | oc -n meetloom-dev apply -f -
oc -n meetloom-dev set volume deployment/meetloom --add --name=meetloom-ca --type=configmap --configmap-name=meetloom-ca --mount-path=/etc/meetloom-ca --read-only
oc -n meetloom-dev set data configmap/meetloom-settings NODE_EXTRA_CA_CERTS=/etc/meetloom-ca/ca.crt
oc -n meetloom-dev rollout restart deployment/meetloom
```

On OpenShift, a ConfigMap labelled `config.openshift.io/inject-trusted-cabundle=true` receives the cluster's trusted bundle under the key `ca-bundle.crt` instead: create it empty with that label, mount it the same way, and point `NODE_EXTRA_CA_CERTS` to `/etc/meetloom-ca/ca-bundle.crt`. Rerunning the installer keeps a volume added this way; check it after an update with `oc -n meetloom-dev set volume deployment/meetloom`.

### Organizational sign-in and email

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

Manifests and scripts have been checked locally. Admission, pull secrets, storage, Routes, and your LLM endpoint still need operator verification in the target environments. Access to those environments is not required to prepare these files.

For a hosted demonstration launched from a button, see [Render](render.md). The free plan uses ephemeral storage; prefer your own infrastructure for retaining private agendas.
