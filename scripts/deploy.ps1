# ColdStart Deployment Script (PowerShell)
# Automates common deployment tasks for Windows

param(
    [Parameter(Position=0)]
    [string]$Command = "help",

    [Parameter(Position=1)]
    [string]$Argument = ""
)

# Helper functions
function Log-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Log-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Log-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Log-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

# Check if Docker is running
function Check-Docker {
    try {
        docker info 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw
        }
        Log-Success "Docker is running"
    }
    catch {
        Log-Error "Docker is not running. Please start Docker Desktop."
        exit 1
    }
}

# Check if .env file exists
function Check-Env {
    if (-not (Test-Path .env)) {
        Log-Warning ".env file not found. Creating from .env.example..."
        if (Test-Path .env.example) {
            Copy-Item .env.example .env
            Log-Warning "Please edit .env and add your GEMINI_API_KEY"
            exit 1
        }
        else {
            Log-Error ".env.example not found"
            exit 1
        }
    }

    # Check if GEMINI_API_KEY is set
    $envContent = Get-Content .env -Raw
    if ($envContent -notmatch 'GEMINI_API_KEY=\S+') {
        Log-Error "GEMINI_API_KEY not set in .env file"
        exit 1
    }

    Log-Success ".env file configured"
}

# Build Docker images
function Build-Images {
    Log-Info "Building Docker images..."
    docker-compose build --no-cache
    if ($LASTEXITCODE -eq 0) {
        Log-Success "Docker images built"
    }
    else {
        Log-Error "Build failed"
        exit 1
    }
}

# Start services
function Start-Services {
    Log-Info "Starting services..."
    docker-compose up -d

    Log-Info "Waiting for services to be healthy..."
    Start-Sleep -Seconds 10

    # Check if services are running
    $status = docker-compose ps
    if ($status -match "Up") {
        Log-Success "Services started successfully"
        Log-Info "Web app: http://localhost:3000"
        Log-Info "Helix DB: http://localhost:6969"
    }
    else {
        Log-Error "Services failed to start. Check logs with: docker-compose logs"
        exit 1
    }
}

# Stop services
function Stop-Services {
    Log-Info "Stopping services..."
    docker-compose down
    Log-Success "Services stopped"
}

# Restart services
function Restart-Services {
    Log-Info "Restarting services..."
    docker-compose restart
    Log-Success "Services restarted"
}

# View logs
function View-Logs {
    param([string]$Service = "")

    if ($Service) {
        docker-compose logs -f $Service
    }
    else {
        docker-compose logs -f
    }
}

# Run CSV ingestion
function Run-Ingest {
    Log-Info "Running CSV ingestion..."
    docker exec -it coldstart-web npm run ingest
    if ($LASTEXITCODE -eq 0) {
        Log-Success "Ingestion complete"
    }
}

# Deploy (full update)
function Deploy {
    Log-Info "Starting deployment..."

    # Pull latest code if Git is available
    if (Test-Path .git) {
        Log-Info "Pulling latest code from Git..."
        git pull origin main
    }

    # Build and restart
    Log-Info "Building and restarting services..."
    docker-compose up -d --build

    # Wait for health check
    Log-Info "Waiting for services to be healthy..."
    Start-Sleep -Seconds 15

    Log-Success "Deployment complete!"
}

# Backup Helix data
function Backup-Data {
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupFile = "helix-backup-$timestamp.tar.gz"

    Log-Info "Creating backup: $backupFile"

    docker run --rm `
        -v coldstart-helix-data:/data `
        -v ${PWD}:/backup `
        alpine tar czf /backup/$backupFile -C /data .

    if ($LASTEXITCODE -eq 0) {
        Log-Success "Backup created: $backupFile"
    }
    else {
        Log-Error "Backup failed"
    }
}

# Restore Helix data
function Restore-Data {
    param([string]$BackupFile)

    if (-not $BackupFile) {
        Log-Error "Usage: .\deploy.ps1 restore <backup-file.tar.gz>"
        exit 1
    }

    if (-not (Test-Path $BackupFile)) {
        Log-Error "Backup file not found: $BackupFile"
        exit 1
    }

    Log-Warning "This will overwrite all current Helix data!"
    $confirm = Read-Host "Are you sure? (yes/no)"

    if ($confirm -ne "yes") {
        Log-Info "Restore cancelled"
        exit 0
    }

    Log-Info "Restoring from: $BackupFile"

    # Stop Helix to avoid data corruption
    docker-compose stop helix

    # Restore data
    docker run --rm `
        -v coldstart-helix-data:/data `
        -v ${PWD}:/backup `
        alpine sh -c "cd /data && tar xzf /backup/$BackupFile"

    # Restart Helix
    docker-compose start helix

    Log-Success "Restore complete"
}

# Clean up
function Clean-All {
    Log-Warning "This will remove all containers and data!"
    $confirm = Read-Host "Are you sure? (yes/no)"

    if ($confirm -ne "yes") {
        Log-Info "Clean cancelled"
        exit 0
    }

    Log-Info "Removing containers and volumes..."
    docker-compose down -v
    Log-Success "Cleanup complete"
}

# Show status
function Show-Status {
    Log-Info "Service Status:"
    docker-compose ps

    Write-Host ""
    Log-Info "Resource Usage:"
    docker stats coldstart-web coldstart-helix --no-stream
}

# Show help
function Show-Help {
    Write-Host @"
ColdStart Deployment Script

Usage: .\deploy.ps1 <command> [options]

Commands:
    start           Start all services
    stop            Stop all services
    restart         Restart all services
    build           Build Docker images
    deploy          Full deployment (pull, build, restart)
    logs [service]  View logs (optional: specify web or helix)
    ingest          Run CSV ingestion script
    backup          Backup Helix database
    restore <file>  Restore Helix database from backup
    status          Show service status and resource usage
    clean           Remove all containers and volumes (CAUTION)
    help            Show this help message

Examples:
    .\deploy.ps1 start                      # Start all services
    .\deploy.ps1 logs                       # View all logs
    .\deploy.ps1 logs web                   # View only web service logs
    .\deploy.ps1 deploy                     # Deploy updates from Git
    .\deploy.ps1 backup                     # Create a backup
    .\deploy.ps1 restore backup.tar.gz      # Restore from backup

"@
}

# Main script
Check-Docker

switch ($Command.ToLower()) {
    "start" {
        Check-Env
        Start-Services
    }
    "stop" {
        Stop-Services
    }
    "restart" {
        Restart-Services
    }
    "build" {
        Check-Env
        Build-Images
    }
    "deploy" {
        Check-Env
        Deploy
    }
    "logs" {
        View-Logs -Service $Argument
    }
    "ingest" {
        Run-Ingest
    }
    "backup" {
        Backup-Data
    }
    "restore" {
        Restore-Data -BackupFile $Argument
    }
    "status" {
        Show-Status
    }
    "clean" {
        Clean-All
    }
    default {
        Show-Help
    }
}
