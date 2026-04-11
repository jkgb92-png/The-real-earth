// Ambient declarations for React Native / Expo packages that are aliased to
// empty stubs by next.config.js on web.  TypeScript needs these declarations
// to compile packages/tile-cache/src/TileCache.ts, which is imported
// transitively but never executed on web.

declare module 'expo-sqlite' {
  interface SQLiteDatabase {
    execAsync(sql: string): Promise<void>;
    getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
    runAsync(sql: string, params?: unknown[]): Promise<void>;
  }
  function openDatabaseAsync(name: string): Promise<SQLiteDatabase>;
}

declare module 'expo-file-system' {
  const cacheDirectory: string | null;
  const EncodingType: { Base64: string };
  function downloadAsync(
    url: string,
    fileUri: string,
    options?: { headers?: Record<string, string> },
  ): Promise<{ status: number; headers: Record<string, string> }>;
  function readAsStringAsync(
    fileUri: string,
    options?: { encoding?: string },
  ): Promise<string>;
  function deleteAsync(fileUri: string, options?: { idempotent?: boolean }): Promise<void>;
}

declare module 'react-native' {
  // Minimal stub — react-native is pulled in transitively on web but never used.
}
