const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const targets = [...document.querySelectorAll('.hero-copy > *, .harness-map, .section-heading, .model-intro, .model-artifact, .manifesto-statement, .ecosystem-section > div, .nilo-portrait, .nilo-copy, .start-section > div')];
// Content stays visible without JavaScript or observer support.
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      if (!reducedMotion.matches) entry.target.classList.add('scene-enter');
      observer.unobserve(entry.target);
    });
  }, {threshold: .12});
  targets.forEach((target, index) => {
    if (target.parentElement.classList.contains('hero-copy')) {
      target.style.setProperty('--entrance-delay', `${index * 70}ms`);
    }
    observer.observe(target);
  });
  reducedMotion.addEventListener('change', event => {
    if (event.matches) targets.forEach(target => target.classList.remove('scene-enter'));
  });
}
