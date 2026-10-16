import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
p.on('pageerror', e => console.log('ERR', e.message)); p.on('console', m => m.type()==='error' && console.log('CE', m.text().slice(0,300)));
await p.goto('http://localhost:5173/?static', { waitUntil: 'networkidle' }); await p.waitForTimeout(9000);
await p.getByText('40 E 19th St, Apt PH').click(); await p.waitForTimeout(3000);
await p.waitForTimeout(10000); await p.screenshot({ path: 'screenshot-selected.png', timeout: 120000 });
await b.close();
