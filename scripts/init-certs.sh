#!/bin/bash
# Initialize CA and server certificates for mTLS
# Run once to set up HTTPS + client certificate authentication
#
# Usage: ./scripts/init-certs.sh [hostname]
# Example: ./scripts/init-certs.sh home.myapp.duckdns.org

set -e

HOSTNAME="${1:-localhost}"
CERT_DIR="$HOME/.claude-session-manager/certs"

mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/ca.crt" ]; then
    echo "CA already exists at $CERT_DIR/ca.crt"
    echo "Delete $CERT_DIR to reinitialize."
    exit 1
fi

echo "=== Generating CA ==="
openssl genrsa -out "$CERT_DIR/ca.key" 4096
openssl req -new -x509 -days 3650 -key "$CERT_DIR/ca.key" -out "$CERT_DIR/ca.crt" \
    -subj "/CN=ClaudeSessionManagerCA"

echo "=== Generating Server Certificate ==="
openssl genrsa -out "$CERT_DIR/server.key" 2048
openssl req -new -key "$CERT_DIR/server.key" -out "$CERT_DIR/server.csr" \
    -subj "/CN=$HOSTNAME"

# Create SAN extension for the server cert
cat > "$CERT_DIR/server_ext.cnf" <<EOF
[v3_req]
subjectAltName = DNS:$HOSTNAME, DNS:localhost, IP:127.0.0.1
EOF

openssl x509 -req -in "$CERT_DIR/server.csr" \
    -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
    -days 3650 -out "$CERT_DIR/server.crt" \
    -extfile "$CERT_DIR/server_ext.cnf" -extensions v3_req

# Cleanup temp files
rm -f "$CERT_DIR/server.csr" "$CERT_DIR/server_ext.cnf" "$CERT_DIR/ca.srl"

# Create empty revoked list
touch "$CERT_DIR/revoked.txt"

echo ""
echo "=== Done ==="
echo "CA:     $CERT_DIR/ca.crt"
echo "Server: $CERT_DIR/server.crt"
echo "Key:    $CERT_DIR/server.key"
echo ""
echo "Next: run ./scripts/new-device.sh <device-name> to create client certificates"
