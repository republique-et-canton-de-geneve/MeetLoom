#!/usr/bin/env pwsh
# Requires PowerShell 7 and an authenticated OpenShift CLI. Never rotates secrets.
[CmdletBinding()]
param(
    [ValidateSet('development', 'production')][string]$Environment = 'development',
    [ValidatePattern('^[a-z0-9]([-a-z0-9]*[a-z0-9])?$')][string]$Project = $env:MEETLOOM_NAMESPACE,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._:/@-]+$')][string]$Image,
    [switch]$ExternalDatabase,
    # Pull PostgreSQL through an internal registry (for example a Nexus proxy) instead of quay.io.
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._:/@-]+$')][string]$DatabaseImage = $env:MEETLOOM_DATABASE_IMAGE
)
$ErrorActionPreference = 'Stop'
if (-not $Project) {
    $Project = if ($Environment -eq 'production') { 'meetloom-prod' } else { 'meetloom-dev' }
}
$repoRoot = Split-Path -Parent $PSScriptRoot
function Invoke-Oc {
    & oc @args
    if ($LASTEXITCODE -ne 0) { throw "OpenShift operation failed: $($args[0]) (exit $LASTEXITCODE)." }
}
function New-RandomSecret {
    [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
}
function Get-Resource([string]$Kind, [string]$Name) {
    $raw = Invoke-Oc -n $Project get $Kind $Name --ignore-not-found -o json
    if ($raw) { return ($raw | ConvertFrom-Json) }
    return $null
}
function New-Resource($Object) {
    $Object | ConvertTo-Json -Depth 12 | & oc -n $Project create -f -
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the configuration resource.' }
}

Get-Command oc -ErrorAction Stop | Out-Null
Invoke-Oc whoami | Out-Null
if (-not (Invoke-Oc get project $Project --ignore-not-found -o name)) {
    throw "Project $Project does not exist. Create it with 'oc new-project $Project' or ask your cluster administrator to prepare it."
}
Write-Host "Target namespace: $Project"

$mode = if ($ExternalDatabase) { 'external' } else { 'bundled' }
$databaseSecret = Get-Resource 'secret' 'meetloom-database'
if ($databaseSecret) {
    if ($databaseSecret.metadata.annotations.'meetloom.io/database-mode' -ne $mode) {
        throw 'Database mode differs from the existing Secret. Migrate data explicitly before changing modes.'
    }
} else {
    if (-not $ExternalDatabase -and (Get-Resource 'pvc' 'meetloom-postgresql')) {
        throw 'The database PVC already exists but its Secret is missing. Restore the existing credentials; refusing to generate a new password for existing data.'
    }
    if ($ExternalDatabase) {
        if (-not $env:MEETLOOM_DATABASE_URL) { throw 'Set MEETLOOM_DATABASE_URL for the external PostgreSQL connection.' }
        $databaseData = @{ DATABASE_URL = $env:MEETLOOM_DATABASE_URL }
    } else {
        $databasePassword = New-RandomSecret
        $databaseData = @{
            POSTGRESQL_USER = 'meetloom'; POSTGRESQL_PASSWORD = $databasePassword; POSTGRESQL_DATABASE = 'meetloom'
            DATABASE_URL = "postgresql://meetloom:${databasePassword}@meetloom-postgresql:5432/meetloom"
        }
    }
    New-Resource @{
        apiVersion = 'v1'; kind = 'Secret'; type = 'Opaque'
        metadata = @{ name = 'meetloom-database'; annotations = @{ 'meetloom.io/database-mode' = $mode } }
        stringData = $databaseData
    } | Out-Null
}

if (-not (Get-Resource 'secret' 'meetloom-auth')) {
    $authData = @{ BOOTSTRAP_TOKEN = (New-RandomSecret) }
    New-Resource @{ apiVersion = 'v1'; kind = 'Secret'; type = 'Opaque'; metadata = @{ name = 'meetloom-auth' }; stringData = $authData } | Out-Null
}

# Create the Route first so the canonical origin exists before the app starts.
Invoke-Oc -n $Project apply -f (Join-Path $repoRoot 'k8s/base/service.yaml') | Out-Null
Invoke-Oc -n $Project apply -k (Join-Path $repoRoot 'k8s/route') | Out-Null
$routeHost = (Invoke-Oc -n $Project get route meetloom '-o=jsonpath={.spec.host}').Trim()
if (-not $routeHost) { throw 'The Route has no hostname. Check router admission.' }
$origin = "https://$routeHost"
if (-not (Get-Resource 'configmap' 'meetloom-settings')) {
    $settings = @{ APP_ORIGIN = $origin }
    if ($env:LLM_BASE_URL) { $settings.LLM_BASE_URL = $env:LLM_BASE_URL }
    if ($env:LLM_MODEL) { $settings.LLM_MODEL = $env:LLM_MODEL }
    if ($env:LLM_VISION_MODEL) { $settings.LLM_VISION_MODEL = $env:LLM_VISION_MODEL }
    New-Resource @{ apiVersion = 'v1'; kind = 'ConfigMap'; metadata = @{ name = 'meetloom-settings' }; data = $settings } | Out-Null
}
if ($env:LLM_API_KEY -and -not (Get-Resource 'secret' 'meetloom-ai')) {
    New-Resource @{ apiVersion = 'v1'; kind = 'Secret'; type = 'Opaque'; metadata = @{ name = 'meetloom-ai' }; stringData = @{ LLM_API_KEY = $env:LLM_API_KEY } } | Out-Null
}

$overlay = if ($ExternalDatabase) { 'k8s/overlays/openshift-external-db' }
    else { "k8s/overlays/$Environment" }
$rendered = (Invoke-Oc kustomize (Join-Path $repoRoot $overlay)) -join "`n"
if (-not $rendered.Contains('docker.io/your-account/meetloom:0.1.0')) { throw 'Application image marker missing from the manifests.' }
$rendered = $rendered.Replace('docker.io/your-account/meetloom:0.1.0', $Image)
if ($DatabaseImage) { $rendered = $rendered.Replace('quay.io/sclorg/postgresql-16-c9s:latest', $DatabaseImage) }
$rendered | & oc -n $Project apply -f -
if ($LASTEXITCODE -ne 0) { throw 'Manifest application failed.' }
if (-not $ExternalDatabase) { Invoke-Oc -n $Project rollout status deployment/meetloom-postgresql --timeout=300s }
Invoke-Oc -n $Project rollout status deployment/meetloom --timeout=300s
# PowerShell drops an unquoted -- when calling a function, so quote it for oc exec.
Invoke-Oc -n $Project exec deployment/meetloom '--' node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

Write-Host "MeetLoom: $origin"
Write-Host 'Existing secrets and environment configuration were preserved.'
Write-Host 'To create the first administrator in the application, retrieve the bootstrap token privately:'
Write-Host "`$encoded = oc -n $Project get secret meetloom-auth -o 'jsonpath={.data.BOOTSTRAP_TOKEN}'"
Write-Host '[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))'
