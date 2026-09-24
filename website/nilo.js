import { t, niloLabel } from './i18n.js';

const character = document.querySelector('.nilo-character');
if (character) {
  const section = document.querySelector('#nilo');
  const stage = section.querySelector('.nilo-stage');
  const svg = character.querySelector('svg');
  const control = section.querySelector('.nilo-motion');
  const controlLabel = control.querySelector('[data-playback-label]');
  const controlIcon = control.querySelector('[data-playback-icon]');
  const status = section.querySelector('.nilo-status');
  const progress = section.querySelector('.nilo-progress span');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const colors = {B:'body', W:'eye', P:'pupil', K:'beak', R:'rim', L:'screen', M:'desk', G:'code', Z:'eye'};
  const scenes = [
    {state:'waiting', start:0, end:1600, scale:1.18, y:-10, label:t('greeting')},
    {state:'thinking', start:1600, end:3400, scale:1.18, y:-10, label:t('thinking')},
    {state:'working', start:3400, end:6200, scale:1.07, y:-2, label:t('working')},
    {state:'waiting', start:6200, end:8000, scale:1, y:0, label:t('ready')},
  ];
  const duration = scenes.at(-1).end;
  let poses;
  let loading = false;
  let visible = false;
  let mode = 'ready';
  let elapsed = 0;
  let frameRequest;
  let lastTime;
  let drawnPose;
  let stillIndex = 0;

  function draw(rows, key) {
    if (key === drawnPose) return;
    drawnPose = key;
    const paths = {};
    rows.forEach((row, y) => [...row].forEach((cell, x) => {
      if (cell !== '.') (paths[cell] ||= []).push(`M${x} ${y}h1v1h-1z`);
    }));
    svg.replaceChildren(...Object.entries(paths).map(([cell, parts]) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', `var(--nilo-${colors[cell]})`);
      path.setAttribute('d', parts.join(''));
      return path;
    }));
  }

  function render() {
    if (!poses) return;
    const index = reducedMotion.matches ? stillIndex : mode === 'finished' ? scenes.length - 1 : Math.max(0, scenes.findIndex(scene => elapsed < scene.end));
    const scene = scenes[index];
    const localTime = Math.max(0, elapsed - scene.start);
    const frames = poses.states[scene.state];
    const frame = Math.floor(localTime / 110) % frames.frames.length;
    const still = reducedMotion.matches || mode === 'finished';
    draw(still ? frames.still : frames.frames[frame], `${scene.state}:${still ? 'still' : frame}`);

    // One clock drives the sprite, camera and progress, so pause freezes all three.
    const previous = scenes[index - 1] || {scale:1, y:0};
    const ease = 1 - (1 - Math.min(localTime / 1300, 1)) ** 3;
    const scale = reducedMotion.matches ? 1 : previous.scale + (scene.scale - previous.scale) * ease;
    const y = reducedMotion.matches ? 0 : previous.y + (scene.y - previous.y) * ease;
    character.style.transform = `translateY(${y.toFixed(3)}px) scale(${scale.toFixed(4)})`;
    progress.style.transform = `scaleX(${reducedMotion.matches ? 0 : (elapsed / duration).toFixed(4)})`;
    stage.style.setProperty('--light-opacity', reducedMotion.matches ? '1' : Math.min(elapsed / 1300, 1).toFixed(3));
    stage.dataset.playback = mode;
    stage.dataset.state = scene.state;

    const label = t(reducedMotion.matches ? 'next' : mode === 'playing' ? 'pause' : mode === 'paused' ? 'resume' : 'replay');
    if (controlLabel.textContent !== label) controlLabel.textContent = label;
    character.setAttribute('aria-label', niloLabel(label));
    controlIcon.setAttribute('d', mode === 'playing' && !reducedMotion.matches ? 'M8 5v14M16 5v14' : 'm8 5 11 7-11 7Z');
    const description = reducedMotion.matches ? `${scene.label} ${t('reduced')}` : mode === 'paused' ? t('paused') : mode === 'finished' ? t('finished') : scene.label;
    if (status.textContent !== description) status.textContent = description;
  }

  const canPlay = () => poses && mode === 'playing' && visible && !document.hidden && !reducedMotion.matches;

  function tick(now) {
    if (!canPlay()) { lastTime = undefined; return; }
    if (lastTime !== undefined) elapsed = Math.min(duration, elapsed + now - lastTime);
    lastTime = now;
    if (elapsed === duration) mode = 'finished';
    render();
    if (canPlay()) frameRequest = requestAnimationFrame(tick);
  }

  function synchronize() {
    cancelAnimationFrame(frameRequest);
    lastTime = undefined;
    render();
    if (canPlay()) frameRequest = requestAnimationFrame(tick);
  }

  function togglePlayback() {
    if (!poses) { void loadPoses(); return; }
    if (reducedMotion.matches) stillIndex = (stillIndex + 1) % (scenes.length - 1); // The last scene repeats the greeting.
    else if (mode === 'playing') mode = 'paused';
    else {
      if (mode === 'finished') elapsed = 0;
      mode = 'playing';
    }
    synchronize();
  }

  async function loadPoses() {
    if (loading || poses) return;
    loading = true;
    try {
      const response = await fetch(new URL('./assets/nilo-poses.json', import.meta.url));
      if (!response.ok) throw new Error('Pose data unavailable');
      const candidate = await response.json();
      const validRows = rows => Array.isArray(rows) && rows.length === 17 && rows.every(row =>
        typeof row === 'string' && row.length === 18 && /^[.BWPKRLMGZ]+$/.test(row));
      const valid = ['waiting', 'thinking', 'working'].every(state => {
        const value = candidate?.states?.[state];
        return validRows(value?.still) && Array.isArray(value?.frames) &&
          value.frames.length > 0 && value.frames.length <= 120 && value.frames.every(validRows);
      });
      if (!valid) throw new Error('Invalid pose data');
      poses = candidate;
      mode = reducedMotion.matches ? 'paused' : 'playing';
      synchronize();
      character.querySelector('img').hidden = true;
      svg.removeAttribute('hidden');
      character.disabled = false;
      control.hidden = false;
    } catch {
      cancelAnimationFrame(frameRequest);
      poses = undefined;
      drawnPose = undefined;
      lastTime = undefined;
      elapsed = 0;
      mode = 'ready';
      character.querySelector('img').hidden = false;
      svg.setAttribute('hidden', '');
      character.disabled = true;
      status.textContent = t('loadError');
      controlLabel.textContent = t('retry');
      control.hidden = false;
    } finally { loading = false; }
  }

  control.addEventListener('click', togglePlayback);
  character.addEventListener('click', togglePlayback);
  // Observe the stable section, not the character whose camera framing moves.
  new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    if (visible && !poses) void loadPoses();
    else synchronize();
  }).observe(section);
  reducedMotion.addEventListener('change', () => {
    if (mode === 'playing') mode = 'paused';
    synchronize();
  });
  document.addEventListener('visibilitychange', synchronize);
}
