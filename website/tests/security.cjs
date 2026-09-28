const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = (process.env.WEBSITE_URL || 'http://127.0.0.1:4174').replace(/\/$/, '') + '/';

(async () => {
  const browser = await chromium.launch({channel: process.env.BROWSER_CHANNEL || 'msedge', headless:true});
  try {
    for (const locale of ['', 'en/']) {
      for (const file of ['index.html', 'model.html', 'manifesto.html']) {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
          window.violations = [];
          document.addEventListener('securitypolicyviolation', e => window.violations.push(e.effectiveDirective));
        });
        await page.goto(base + locale + file);
        await page.locator('h1').waitFor();
        assert.deepEqual(await page.evaluate(() => window.violations), []);
        let externalRequested = false;
        await page.route('https://untrusted.invalid/**', route => {
          externalRequested = true;
          return route.fulfill({contentType:'text/javascript',body:'window.externalExecuted = true'});
        });
        await page.evaluate(() => {
          const inline = document.createElement('script');
          inline.textContent = 'window.inlineExecuted = true';
          document.head.append(inline);
          const external = document.createElement('script');
          external.src = 'https://untrusted.invalid/probe.js';
          document.head.append(external);
          const style = document.createElement('style');
          style.textContent = 'body { display: none }';
          document.head.append(style);
          void fetch('https://untrusted.invalid/collect').catch(() => {});
        });
        await page.waitForFunction(() => window.violations.length >= 4);
        assert.equal(externalRequested, false);
        assert.equal(await page.evaluate(() => Boolean(window.inlineExecuted || window.externalExecuted)), false);
        assert.deepEqual(errors, []);
        await page.close();
      }
      // A malformed successful response must retain the fallback and permit a fresh retry.
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let requests = 0;
      await page.route('**/assets/nilo-poses.json', async route => {
        requests++;
        if (requests === 1) await route.fulfill({status:200,contentType:'application/json',body:'{}'});
        else await route.continue();
      });
      await page.goto(base + locale + 'index.html');
      await page.locator('#nilo').scrollIntoViewIfNeeded();
      const label = page.locator('[data-playback-label]');
      await label.filter({hasText:locale ? 'Try again' : 'Tentar novamente'}).waitFor();
      assert.equal(await page.locator('.nilo-character img').isVisible(), true);
      await page.locator('.nilo-motion').click();
      await page.waitForFunction(() => document.querySelector('.nilo-character img').hidden);
      assert.equal(requests, 2);
      assert.ok(await page.locator('.nilo-character svg path').count() > 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: CSP enforcement on all six pages; malformed Nilo data fallback and retry in both languages.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
