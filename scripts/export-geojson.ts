#!/usr/bin/env ts-node
// scripts/export-geojson.ts
// Usage: npx ts-node scripts/export-geojson.ts

import fs from 'fs';
import path from 'path';
import nianticDataModule, { toFeatureCollection } from '../agents/niantic';

const outDir = path.join(process.cwd(), 'agents');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const data = nianticDataModule as any;
const geojson = toFeatureCollection(data);

fs.writeFileSync(path.join(outDir, 'niantic.geojson'), JSON.stringify(geojson, null, 2), 'utf8');
fs.writeFileSync(path.join(outDir, 'niantic.json'), JSON.stringify(data, null, 2), 'utf8');

console.log('Wrote agents/niantic.geojson and agents/niantic.json');
