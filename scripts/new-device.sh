#!/bin/bash
# Generate a client certificate for a device
# The .p12 file should be transferred to the device and installed
#
# Usage: ./scripts/new-device.sh <device-name>
# Example: ./scripts/new-device.sh my-phone
#
# Revoke: echo "my-phone" >> ~/.claude-session-manager/certs/revoked.txt

set -e

DEVICE="${1:?Usage: $0 <device-name>}"
CERT_DIR="$HOME/.claude-session-manager/certs"

if [ ! -f "$CERT_DIR/ca.crt" ]; then
    echo "Error: CA not found. Run ./scripts/init-certs.sh first."
    exit 1
fi

echo "=== Generating certificate for: $DEVICE ==="

# Generate key + CSR
openssl genrsa -out "$CERT_DIR/${DEVICE}.key" 2048
openssl req -new -key "$CERT_DIR/${DEVICE}.key" -out "$CERT_DIR/${DEVICE}.csr" \
    -subj "/CN=$DEVICE"

# Sign with CA
openssl x509 -req -in "$CERT_DIR/${DEVICE}.csr" \
    -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
    -days 3650 -out "$CERT_DIR/${DEVICE}.crt"

# Create .p12 (PKCS12) for device import
openssl pkcs12 -export -out "$CERT_DIR/${DEVICE}.p12" \
    -inkey "$CERT_DIR/${DEVICE}.key" \
    -in "$CERT_DIR/${DEVICE}.crt" \
    -certfile "$CERT_DIR/ca.crt" \
    -password pass:

# Cleanup intermediate files
rm -f "$CERT_DIR/${DEVICE}.key" "$CERT_DIR/${DEVICE}.csr" "$CERT_DIR/${DEVICE}.crt" "$CERT_DIR/ca.srl"

echo ""
echo "=== Done ==="
echo "File: $CERT_DIR/${DEVICE}.p12"
echo ""
echo "Install on device:"
echo "  iOS: AirDrop or email the .p12 file, open it, install profile"
echo "  Android: Settings > Security > Install certificate"
echo ""
echo "To revoke later:"
echo "  echo '$DEVICE' >> $CERT_DIR/revoked.txt"
