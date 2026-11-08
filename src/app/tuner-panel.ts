/**
 * Shared collapsible header for the dev tuner overlays.
 *
 * Returns the header, the title node (so a panel can swap its label between
 * flight/mining modes) and the body container that should hold the controls.
 */
export interface CollapsibleTunerPanel {
  header: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  setTitle(text: string): void;
}

export function createCollapsibleTunerPanel(titleText: string): CollapsibleTunerPanel {
  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;';

  const title = document.createElement('div');
  title.textContent = titleText;
  title.style.cssText = 'color:#d8f3ff;letter-spacing:0.12em;font-size:10px;';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = '▾';
  toggle.setAttribute('aria-label', `Collapse ${titleText.toLowerCase()}`);
  toggle.setAttribute('aria-expanded', 'true');
  toggle.style.cssText =
    'display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;' +
    'background:rgba(30,60,90,0.35);border:1px solid rgba(127,223,255,0.35);border-radius:4px;' +
    'color:#9fe8ff;font:inherit;font-size:17px;line-height:1;cursor:pointer;padding:0 2px;';
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const collapsed = body.style.display !== 'none';
    body.style.display = collapsed ? 'none' : 'block';
    toggle.textContent = collapsed ? '▸' : '▾';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute(
      'aria-label',
      `${collapsed ? 'Expand' : 'Collapse'} ${title.textContent.toLowerCase()}`,
    );
  });

  const body = document.createElement('div');
  header.append(title, toggle);

  return {
    header,
    title,
    body,
    setTitle(text: string): void {
      title.textContent = text;
      toggle.setAttribute(
        'aria-label',
        `${body.style.display === 'none' ? 'Expand' : 'Collapse'} ${text.toLowerCase()}`,
      );
    },
  };
}
