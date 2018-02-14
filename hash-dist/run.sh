#!/bin/bash
#

command -v gnuplot >/dev/null 2>&1 || {
  echo >&2 '`gnuplot` command is not installed.'
  echo >&2 'Run `brew install gnuplot` and retry.'
  exit 1
}

# Ensure the script runs in its working directory
pushd "$(dirname "$0")"

# Generate random sample results and save to a file
node generate.js > results.txt

# Create a graph from the random sample data
gnuplot histogram.plt

# Show the resulting graph in QuickLook on OS X
qlmanage -p "results.png" >& /dev/null &

popd
