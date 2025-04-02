#!/bin/bash

# Check if lame is installed
if ! command -v lame &> /dev/null; then
    echo "Error: lame is not installed."
    echo "Please install it with: brew install lame (macOS) or apt-get install lame (Linux)"
    exit 1
fi

# Check if NPM_SCRIPT_RUNNER_PATH is set, use Node directly otherwise
RUNNER="node"
if [ -n "$NPM_SCRIPT_RUNNER_PATH" ]; then
    # For environments that need a specific runner path
    RUNNER="$NPM_SCRIPT_RUNNER_PATH"
fi

# Check if a file was provided
if [ -z "$1" ]; then
    echo "Please provide a path to an MP3 file"
    echo "Usage: ./run-test.sh path/to/audio.mp3"
    exit 1
fi

# Check if the MP3 file exists
if [ ! -f "$1" ]; then
    echo "MP3 file not found: $1"
    exit 1
fi

# Run the test
echo "Running MP3 VAD test with file: $1"
$RUNNER --experimental-modules test/mp3.js "$1" 