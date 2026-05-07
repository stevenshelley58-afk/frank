param(
  [string]$SshTarget = $env:FRANK_VPS_SSH_TARGET,
  [string]$ProjectRoot = "/opt/frank-projects",
  [string[]]$Only = @(),
  [switch]$SkipSynced,
  [switch]$StopOnError,
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

function Quote-RemotePath {
  param([string]$Value)
  return "'" + ($Value -replace "'", "'\''") + "'"
}

function Invoke-Native {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE."
  }
}

function Test-RemoteFile {
  param(
    [string]$SshTarget,
    [string]$Path
  )

  & ssh $SshTarget "test -f $(Quote-RemotePath $Path)"
  return $LASTEXITCODE -eq 0
}

if (-not $SshTarget) {
  throw "Set -SshTarget, for example: -SshTarget root@76.13.209.160"
}

$normalizedRoot = $ProjectRoot.TrimEnd("/")
if ($normalizedRoot -in @("", "/", "/root", "/etc", "/boot", "/var", "/var/lib", "/var/lib/docker", "/var/lib/postgresql")) {
  throw "Refusing unsafe ProjectRoot: $ProjectRoot"
}

$projects = @(
  @{ Slug = "skills"; Path = "C:\Dev\.skills" },
  @{ Slug = "tmp-ecc"; Path = "C:\Dev\_tmp_ecc" },
  @{ Slug = "allvibes"; Path = "C:\Dev\Allvibes" },
  @{ Slug = "asf"; Path = "C:\Dev\ASF" },
  @{ Slug = "audit"; Path = "C:\Dev\audit" },
  @{ Slug = "bhm"; Path = "C:\Dev\BHM" },
  @{ Slug = "bhm-pulse"; Path = "C:\Dev\BHM Pulse" },
  @{ Slug = "bhm-preview-emdwgq"; Path = "C:\Dev\bhm-preview.EMdWGQ" },
  @{ Slug = "bhm-preview-ym5tap"; Path = "C:\Dev\bhm-preview.Ym5Tap" },
  @{ Slug = "bhm-pulse-release-main-jiiugd"; Path = "C:\Dev\bhm-pulse-release-main-jIiuGD" },
  @{ Slug = "bis"; Path = "C:\Dev\BIS" },
  @{ Slug = "blockwise"; Path = "C:\Dev\Blockwise" },
  @{ Slug = "catalog-auditor"; Path = "C:\Dev\catalog-auditor" },
  @{ Slug = "cc-mirror"; Path = "C:\Dev\CC Mirror" },
  @{ Slug = "dashboard"; Path = "C:\Dev\Dashboard" },
  @{ Slug = "devo"; Path = "C:\Dev\Devo" },
  @{ Slug = "dream-crusher-9000"; Path = "C:\Dev\Dream Crusher 9000" },
  @{ Slug = "ecc-reference"; Path = "C:\Dev\ecc-reference" },
  @{ Slug = "em-box"; Path = "C:\Dev\Em Box" },
  @{ Slug = "everything-claude-code"; Path = "C:\Dev\everything-claude-code" },
  @{ Slug = "frank"; Path = "C:\Dev\Frank" },
  @{ Slug = "frank-stage3-task-execution-foundation"; Path = "C:\Dev\Frank-stage3-task-execution-foundation" },
  @{ Slug = "hunter"; Path = "C:\Dev\hunter" },
  @{ Slug = "hyperframes"; Path = "C:\Dev\HyperFrames" },
  @{ Slug = "jenny"; Path = "C:\Dev\Jenny" },
  @{ Slug = "labcast-audit"; Path = "C:\Dev\Labcast Audit" },
  @{ Slug = "lcaudit"; Path = "C:\Dev\lcaudit" },
  @{ Slug = "lcbuilder"; Path = "C:\Dev\lcbuilder" },
  @{ Slug = "liss"; Path = "C:\Dev\Liss" },
  @{ Slug = "marketingskills"; Path = "C:\Dev\marketingskills" },
  @{ Slug = "master"; Path = "C:\Dev\Master" },
  @{ Slug = "mirror"; Path = "C:\Dev\Mirror" },
  @{ Slug = "planner"; Path = "C:\Dev\Planner" },
  @{ Slug = "render-vault-gemini"; Path = "C:\Dev\Render Vault Gemini" },
  @{ Slug = "review"; Path = "C:\Dev\Review" },
  @{ Slug = "see-it"; Path = "C:\Dev\See It" },
  @{ Slug = "see-it-copy"; Path = "C:\Dev\See It - Copy" },
  @{ Slug = "see-it-2"; Path = "C:\Dev\See-It" },
  @{ Slug = "see-it-old"; Path = "C:\Dev\See-It Old" },
  @{ Slug = "snappa"; Path = "C:\Dev\snappa" },
  @{ Slug = "stack-calculator"; Path = "C:\Dev\Stack Calculator" },
  @{ Slug = "storeworks"; Path = "C:\Dev\Storeworks" },
  @{ Slug = "storeworks-catalog"; Path = "C:\Dev\Storeworks Catalog" },
  @{ Slug = "temp"; Path = "C:\Dev\temp" },
  @{ Slug = "theme"; Path = "C:\Dev\Theme" },
  @{ Slug = "wetblob"; Path = "C:\Dev\wetblob" }
)

if ($Only.Count -gt 0) {
  $selected = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($value in $Only) {
    foreach ($slug in ($value -split ",")) {
      $cleanSlug = $slug.Trim()
      if ($cleanSlug) {
        [void]$selected.Add($cleanSlug)
      }
    }
  }

  $projects = @($projects | Where-Object { $selected.Contains($_.Slug) })
  if ($projects.Count -eq 0) {
    throw "No projects matched -Only: $($Only -join ', ')"
  }
}

$excludeArgs = @(
  "--exclude=.git",
  "--exclude=node_modules",
  "--exclude=.pnpm-store",
  "--exclude=.venv",
  "--exclude=venv",
  "--exclude=env",
  "--exclude=__pycache__",
  "--exclude=.pytest_cache",
  "--exclude=.mypy_cache",
  "--exclude=.ruff_cache",
  "--exclude=.turbo",
  "--exclude=.next",
  "--exclude=dist",
  "--exclude=build",
  "--exclude=coverage",
  "--exclude=.cache",
  "--exclude=.vercel",
  "--exclude=playwright-report",
  "--exclude=test-results",
  "--exclude=.env",
  "--exclude=.env.*",
  "--exclude=*.pem",
  "--exclude=*.key",
  "--exclude=*.pfx",
  "--exclude=*.p12",
  "--exclude=id_rsa",
  "--exclude=id_ed25519",
  "--exclude=*.log",
  "--exclude=Thumbs.db",
  "--exclude=.DS_Store"
)

if (-not $Apply) {
  Write-Host "Dry run only. Re-run with -Apply to copy files."
}

$synced = 0
$missing = 0
$skipped = 0
$failed = 0

foreach ($project in $projects) {
  $slug = $project.Slug
  $sourcePath = $project.Path
  $targetPath = "$normalizedRoot/$slug"
  $markerPath = "$targetPath/.frank-sync-complete"

  if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
    Write-Warning "Missing local folder: $sourcePath"
    $missing += 1
    continue
  }

  if ($Apply -and $SkipSynced -and (Test-RemoteFile -SshTarget $SshTarget -Path $markerPath)) {
    Write-Host "Skipping already synced project: $slug"
    $skipped += 1
    continue
  }

  if (-not $Apply) {
    Write-Host "Would copy $sourcePath -> ${SshTarget}:$targetPath"
    continue
  }

  $archivePath = Join-Path $env:TEMP "frank-$slug-$(Get-Random).tar.gz"
  $remoteArchivePath = "/tmp/frank-$slug.tar.gz"
  try {
    Write-Host "Packing $slug..."
    Invoke-Native "tar.exe" (@("-C", $sourcePath) + $excludeArgs + @("-czf", $archivePath, "."))

    Write-Host "Uploading $slug..."
    Invoke-Native "ssh" @($SshTarget, "mkdir -p $(Quote-RemotePath $targetPath)")
    Invoke-Native "scp" @($archivePath, "${SshTarget}:$remoteArchivePath")

    Write-Host "Extracting $slug..."
    Invoke-Native "ssh" @(
      $SshTarget,
      "tar -xzf $(Quote-RemotePath $remoteArchivePath) -C $(Quote-RemotePath $targetPath) && rm -f $(Quote-RemotePath $remoteArchivePath) && touch $(Quote-RemotePath $markerPath)"
    )
    $synced += 1
  } catch {
    $failed += 1
    Write-Warning "Failed to sync ${slug}: $($_.Exception.Message)"
    if ($StopOnError) {
      throw
    }
  } finally {
    if (Test-Path -LiteralPath $archivePath) {
      Remove-Item -LiteralPath $archivePath -Force
    }
  }
}

Write-Host "C:\Dev sync complete: $synced copied, $skipped skipped, $missing missing, $failed failed."
