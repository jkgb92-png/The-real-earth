import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Force static generation so this works with both `output: 'export'` and standalone.
export const dynamic = 'force-static';

// Read once at module initialisation (build time when force-static).
let globeHtml: string | null = null;
try {
  globeHtml = fs.readFileSync(
    path.join(process.cwd(), 'public', 'globe.html'),
    'utf-8',
  );
} catch {
  globeHtml = null;
}

export function GET() {
  if (globeHtml === null) {
    return new NextResponse('Globe page not found', { status: 404 });
  }
  return new NextResponse(globeHtml, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
