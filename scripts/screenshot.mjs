import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto(process.argv[2] || 'http://localhost:5173', { waitUntil: 'networkidle', timeout: 90000 });
await p.waitForTimeout(12000);
// click first listing marker via the app UI: fly to a listing programmatically by clicking a toolbar-free spot isn't reliable; take overview shot
await p.screenshot({ path: 'screenshot.png', timeout: 180000 });
if (process.argv[3]) { await p.mouse.click(800, 520); await p.waitForTimeout(4000); await p.screenshot({ path: process.argv[3], timeout: 180000 }); }
console.log("errors:", errs.slice(0, 10));
await b.close();
