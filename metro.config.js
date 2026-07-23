const { getDefaultConfig } = require('expo/metro-config');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

/** Sentry Metro (source maps) si dispo ; sinon config Expo standard. */
let config;
try {
  config = getSentryExpoConfig(__dirname);
} catch {
  config = getDefaultConfig(__dirname);
}

module.exports = config;
