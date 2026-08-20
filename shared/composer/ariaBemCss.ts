/**
 * Default look for Aria BEM primitives. Emitted into the Design managed block
 * (`/* aria:primitives *\/`). No inline styles on the HTML.
 */

export const ARIA_BEM_PRIMITIVES_CSS = `.aria-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.25rem;
  color: CanvasText;
  background: Canvas;
  border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
  border-radius: 0.75rem;
  box-sizing: border-box;
}

.aria-card__media {
  overflow: hidden;
  border-radius: 0.5rem;
}

.aria-card__media img,
.aria-card__media video {
  display: block;
  width: 100%;
  height: auto;
}

.aria-card__header {
  display: grid;
  gap: 0.25rem;
}

.aria-card__header > * {
  margin: 0;
}

.aria-card__body {
  display: grid;
  gap: 0.5rem;
}

.aria-card__body > * {
  margin: 0;
}

.aria-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.aria-alert {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 0.75rem;
  row-gap: 0.15rem;
  align-items: start;
  padding: 0.75rem 0;
  color: CanvasText;
  background: color-mix(in srgb, CanvasText 4%, Canvas);
  border: none;
  border-left: none;
  border-radius: 0;
  box-sizing: border-box;
}

.aria-alert:not(:has(.aria-alert__icon)) {
  grid-template-columns: 1fr;
}

.aria-alert__icon {
  grid-column: 1;
  grid-row: 1 / span 2;
  display: block;
  width: 1.15rem;
  height: 1.15rem;
  max-width: 1.15rem;
  max-height: 1.15rem;
  min-width: 0;
  min-height: 0;
  margin-top: 0.15rem;
  overflow: hidden;
  justify-self: start;
  color: inherit;
}

svg.aria-alert__icon {
  width: 1.15rem;
  height: 1.15rem;
}

.aria-alert__title,
.aria-alert__body {
  grid-column: 2;
  margin: 0;
}

.aria-alert:not(:has(.aria-alert__icon)) .aria-alert__title,
.aria-alert:not(:has(.aria-alert__icon)) .aria-alert__body {
  grid-column: 1;
}

.aria-alert__title {
  font-weight: 600;
}

.aria-alert--info .aria-alert__title,
.aria-alert--info .aria-alert__icon {
  color: color-mix(in srgb, CanvasText 20%, dodgerblue);
}

.aria-alert--success .aria-alert__title,
.aria-alert--success .aria-alert__icon {
  color: color-mix(in srgb, CanvasText 18%, seagreen);
}

.aria-alert--warning .aria-alert__title,
.aria-alert--warning .aria-alert__icon {
  color: color-mix(in srgb, CanvasText 12%, goldenrod);
}

.aria-alert--danger .aria-alert__title,
.aria-alert--danger .aria-alert__icon {
  color: color-mix(in srgb, CanvasText 8%, crimson);
}

.aria-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.55rem;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.4;
  color: CanvasText;
  background: color-mix(in srgb, CanvasText 8%, Canvas);
  border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
  border-radius: 999px;
  box-sizing: border-box;
}

.aria-badge--muted {
  color: color-mix(in srgb, CanvasText 72%, Canvas);
  background: color-mix(in srgb, CanvasText 6%, Canvas);
}

.aria-badge--primary {
  color: Canvas;
  background: CanvasText;
  border-color: CanvasText;
}

.aria-field {
  display: grid;
  gap: 0.35rem;
}

.aria-field__label {
  font-size: 0.875rem;
  font-weight: 600;
}

.aria-field__hint {
  margin: 0;
  font-size: 0.8125rem;
  color: color-mix(in srgb, CanvasText 62%, Canvas);
}

.aria-field--check {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
}

.aria-field--check .aria-field__label {
  font-weight: 500;
}

.aria-avatar {
  display: inline-grid;
  width: 2.5rem;
  height: 2.5rem;
  overflow: hidden;
  vertical-align: middle;
  border-radius: 999px;
  background: color-mix(in srgb, CanvasText 10%, Canvas);
  color: CanvasText;
}

.aria-avatar > * {
  grid-area: 1 / 1;
}

.aria-avatar__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 1;
}

.aria-avatar__fallback {
  display: grid;
  place-items: center;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  pointer-events: none;
}

.aria-avatar:has(.aria-avatar__image[src]:not([src=""])) .aria-avatar__fallback {
  visibility: hidden;
}
`.trim();
