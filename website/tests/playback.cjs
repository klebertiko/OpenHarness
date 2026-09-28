const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.WEBSITE_URL || 'http://127.0.0.1:4174';
const english = process.env.WEBSITE_LOCALE === 'en-US';
const labels = english ? {pause:'Pause scene',resume:'Resume scene',replay:'Watch again',next:'Next expression'} : {pause:'Pausar cena',resume:'Continuar cena',replay:'Ver novamente',next:'Próxima expressão'};
const snapshot = page => page.locator('.nilo-stage').evaluate(stage => ({
  pose: stage.querySelector('svg').innerHTML,
  camera: stage.querySelector('.nilo-character').getAttribute('style'),
  progress: stage.parentElement.querySelector('.nilo-progress span').style.transform,
}));
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    for (const viewport of [{width:1280,height:720},{width:375,height:812}]) {
      const page = await browser.newPage({viewport, reducedMotion:'no-preference'});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/index.html#nilo');
      const control = page.locator('.nilo-motion');
      await control.waitFor();
      assert.equal(await control.innerText(), labels.pause);
      await page.waitForTimeout(500);
      await control.click();
      assert.equal(await control.innerText(), labels.resume);
      const paused = await snapshot(page);
      await page.waitForTimeout(650);
      assert.deepEqual(await snapshot(page), paused, 'Pause must freeze the sprite, camera and progress');
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(150);
      await control.scrollIntoViewIfNeeded();
      assert.deepEqual(await snapshot(page), paused, 'Scrolling must not reset a paused scene');
      await control.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(350);
      assert.notDeepEqual(await snapshot(page), paused, 'Continue must advance from the paused scene');
      await page.getByRole('button',{name:labels.replay,exact:true}).waitFor({timeout:12000});
      await control.click();
      assert.equal(await control.innerText(), labels.pause);
      await page.locator('.nilo-character').click();
      assert.equal(await control.innerText(), labels.resume, 'The mascot uses the same playback control');
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.getByRole('button',{name:labels.next,exact:true}).waitFor();
      await control.click();
      const reduced = await snapshot(page);
      await page.waitForTimeout(450);
      assert.deepEqual(await snapshot(page), reduced, 'Reduced motion must stay still');
      assert.equal(await page.locator('.nilo-playback button').count(), 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: direct #nilo entry, pause/continue/replay, frozen camera, scroll, keyboard, mobile and reduced motion.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
