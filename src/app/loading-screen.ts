import { formatPercent, loadFraction } from './loading-model';

export interface LoadingScreen {
  element: HTMLElement;
  /** Sub-label under the bar ("Loading art…", "Waking audio…"). */
  setStatus(text: string): void;
  setProgress(loaded: number, total: number): void;
  setIndeterminate(active: boolean): void;
  finish(): void;
  fail(message: string): void;
  destroy(): void;
}

const FINISH_FALLBACK_MS = 600;

/**
 * Full-screen boot overlay shown while Pixi initialises, textures load and the
 * audio manager spins up. Fades itself out when the scene is ready.
 */
export function createLoadingScreen(): LoadingScreen {
  const element = document.createElement('div');
  element.id = 'boot';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');

  const panel = document.createElement('div');
  panel.className = 'boot__panel';

  const mark = document.createElement('div');
  mark.className = 'boot__mark';
  mark.textContent = 'COLD ROCK';

  const subtitle = document.createElement('div');
  subtitle.className = 'boot__subtitle';
  subtitle.textContent = 'PROSPECT';

  const tagline = document.createElement('p');
  tagline.className = 'boot__tagline';
  tagline.textContent = 'A hand-lit asteroid mining sandbox';

  const bar = document.createElement('div');
  bar.className = 'boot__bar';
  const fill = document.createElement('div');
  fill.className = 'boot__fill';
  bar.append(fill);

  const readout = document.createElement('div');
  readout.className = 'boot__readout';
  const status = document.createElement('span');
  status.className = 'boot__status';
  status.textContent = 'Booting…';
  const percent = document.createElement('span');
  percent.className = 'boot__percent';
  percent.textContent = '0%';
  readout.append(status, percent);

  panel.append(mark, subtitle, tagline, bar, readout);
  element.append(panel);

  let finished = false;
  let removed = false;
  let finishTimer: ReturnType<typeof setTimeout> | null = null;

  const setProgress = (loaded: number, total: number): void => {
    const fraction = loadFraction(loaded, total);
    fill.style.width = `${fraction * 100}%`;
    percent.textContent = formatPercent(fraction);
  };

  const finish = (): void => {
    if (finished) return;
    finished = true;
    setProgress(1, 1);
    element.classList.add('boot--done');
    finishTimer = setTimeout(() => {
      removed = true;
      element.remove();
    }, FINISH_FALLBACK_MS);
  };

  const destroy = (): void => {
    if (finishTimer) clearTimeout(finishTimer);
    if (!removed) element.remove();
    removed = true;
  };

  return {
    element,
    setStatus(text: string): void {
      status.textContent = text;
    },
    setProgress,
    setIndeterminate(active: boolean): void {
      element.classList.toggle('boot--indeterminate', active);
      if (active) {
        percent.textContent = '';
        status.textContent = status.textContent || 'Loading…';
      }
    },
    finish,
    fail(message: string): void {
      element.classList.add('boot--error');
      element.classList.remove('boot--indeterminate');
      status.textContent = message;
      percent.textContent = '';
      fill.style.width = '100%';
    },
    destroy,
  };
}
