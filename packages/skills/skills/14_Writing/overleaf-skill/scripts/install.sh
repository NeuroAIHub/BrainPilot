#!/bin/bash
# Quick setup script for olcli

set -e

# Check if olcli is installed
if command -v olcli &> /dev/null; then
    echo "✓ olcli is already installed ($(olcli --version))"
    exit 0
fi

# Try Homebrew first
if command -v brew &> /dev/null; then
    echo "Installing olcli via Homebrew..."
    brew tap aloth/tap
    brew install olcli
    echo "✓ Installed olcli $(olcli --version)"
    exit 0
fi

# Fall back to npm
if command -v npm &> /dev/null; then
    echo "Installing olcli via npm..."
    npm install -g @aloth/olcli
    echo "✓ Installed olcli $(olcli --version)"
    exit 0
fi

echo "Error: Neither Homebrew nor npm found. Please install one of them first."
exit 1