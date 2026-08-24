#!/usr/bin/env bash
#
# Relance l'app installée sur l'iPhone en la pointant vers le Metro local.
#
# L'IP du Mac change à chaque changement de réseau (Wi-Fi, partage de connexion…).
# Le dev client garde l'ancienne URL en mémoire et reste alors sur un écran noir,
# sans le moindre log JS. On redétecte donc l'IP à chaque lancement.
#
# Usage : npm run ios:launch
# Variables : PORT (8081), PETITMO_IOS_DEVICE (UDID), PETITMO_BUNDLE_ID
set -euo pipefail

PORT="${PORT:-8081}"
BUNDLE_ID="${PETITMO_BUNDLE_ID:-com.petitmo.app}"

# Interface de la route par défaut : la seule qui soit joignable depuis le téléphone.
iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
ip="$(ipconfig getifaddr "${iface:-en0}" 2>/dev/null || true)"
if [ -z "$ip" ]; then
  for candidate in en0 en1 en2; do
    ip="$(ipconfig getifaddr "$candidate" 2>/dev/null || true)"
    [ -n "$ip" ] && break
  done
fi

if [ -z "$ip" ]; then
  echo "✗ Aucune adresse IP locale trouvée. Le Mac est-il connecté à un réseau ?" >&2
  exit 1
fi

if ! curl -s -m 5 "http://$ip:$PORT/status" | grep -q "packager-status:running"; then
  echo "✗ Metro ne répond pas sur http://$ip:$PORT" >&2
  echo "  Lance 'npm run dev' dans un autre terminal, puis réessaie." >&2
  exit 1
fi

device="${PETITMO_IOS_DEVICE:-}"
if [ -z "$device" ]; then
  device="$(xcrun devicectl list devices --json-output - 2>/dev/null | node -e "
    let raw = '';
    process.stdin.on('data', chunk => { raw += chunk; });
    process.stdin.on('end', () => {
      const devices = JSON.parse(raw).result.devices.filter(
        d => d.hardwareProperties?.platform === 'iOS' &&
             d.connectionProperties?.pairingState === 'paired'
      );
      if (devices.length) process.stdout.write(devices[0].identifier);
    });
  ")"
fi

if [ -z "$device" ]; then
  echo "✗ Aucun iPhone appairé détecté. Branche le téléphone et déverrouille-le." >&2
  exit 1
fi

echo "→ Metro   http://$ip:$PORT"
echo "→ iPhone  $device"

xcrun devicectl device process launch \
  --device "$device" \
  --activate \
  --terminate-existing \
  --payload-url "petitmo://expo-development-client/?url=http%3A%2F%2F$ip%3A$PORT" \
  "$BUNDLE_ID"
