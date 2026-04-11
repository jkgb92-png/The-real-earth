// Stub for expo-sqlite and expo-file-system on web.
// These packages are React Native / Expo only and are never used in the web
// build – only WorkerTileCache (which has no Expo deps) is used on web.
// Exporting an empty object satisfies the import without pulling in any
// React Native source that webpack cannot parse.
module.exports = {};
