# Install Dependencies Script for Vortex Web Browser
# This script installs Node.js (if not present) and project dependencies

# Check if Node.js is installed
$nodeVersion = & node --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Node.js not found. Installing Node.js LTS..."
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    # Refresh environment variables
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Host "Node.js is already installed: $nodeVersion"
}

# Navigate to the project directory
Set-Location "E:\repos\Nodewebbrowser"

# Install npm dependencies
Write-Host "Installing project dependencies..."
npm install

Write-Host "Dependencies installed successfully!"