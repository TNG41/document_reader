#!/bin/sh
# Generates a throwaway self-signed TLS cert for local HTTPS testing.
# Run this once (`sh certs/generate-dev-cert.sh`) before `docker compose up`.
# The output files are gitignored (certs/*.pem) — never commit a private
# key, even a self-signed dev one, to source control.
#
# Browsers will show a security warning for this cert, since nothing
# signed it but you — that's expected for local dev. For a real
# deployment with a real domain, use Let's Encrypt instead (see the
# HTTPS section in README.md).

set -e
cd "$(dirname "$0")"

openssl req -x509 -nodes -newkey rsa:2048 \
  -days 365 \
  -keyout dev-key.pem \
  -out dev-cert.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "Wrote certs/dev-cert.pem and certs/dev-key.pem (valid 365 days)."
