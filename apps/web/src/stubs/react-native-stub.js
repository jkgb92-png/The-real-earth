// Stub for react-native on web.
// react-native is pulled in transitively via expo-file-system / expo-sqlite.
// The web build only uses WorkerTileCache which has no react-native dependency,
// so this stub satisfies the import without webpack having to parse RN source.
module.exports = {};
