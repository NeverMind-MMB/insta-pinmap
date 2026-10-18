/**
 * pinwheel.js — the add-pin animation (index.html #pinwheel, app.css): the
 * oPin pinwheel over the map turns the new pin's source logo (or shows its
 * name below the wheel) from the top-right pin to the top, pops that pin,
 * and turns on to the top left. With reduced motion it only fades in and out.
 * What it shows comes from sources.js (pinLook) or ui.js (importLook).
 */

/** Plays the animation once: `logo` is an image URL; without one, `caption` shows under the wheel. */
export function playPinwheel({ logo = '', caption = '' } = {}) {
  const box = document.getElementById('pinwheel');
  if (!box) return;
  const image = box.querySelector('.pinwheel__logo');
  if (logo) image.setAttribute('href', logo);
  else image.removeAttribute('href');
  image.style.display = logo ? '' : 'none';
  box.querySelector('.pinwheel__caption').textContent = logo ? '' : caption;
  box.onanimationend = (e) => {
    if (e.target !== box) return;
    box.onanimationend = null;
    box.classList.remove('is-playing');
    box.hidden = true;
  };
  box.classList.remove('is-playing');
  box.hidden = false;
  void box.getBoundingClientRect(); // a fresh start when it plays again
  box.classList.add('is-playing');
}
