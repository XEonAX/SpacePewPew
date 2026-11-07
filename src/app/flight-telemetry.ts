import type { FlightState, FlightTuning } from './ship-flight';
import { forwardTerminalSpeed, reverseTerminalSpeed, yawTerminalSpeed } from './ship-flight';
import type { ShipGeometry } from './ship-engines';

const PANEL_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  top: '12px',
  right: '12px',
  zIndex: '10',
  width: '232px',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid rgba(90, 160, 200, 0.35)',
  background: 'rgba(5, 9, 18, 0.86)',
  color: '#9fb7c9',
  font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
  backdropFilter: 'blur(6px)',
  userSelect: 'none',
};

export interface FlightTelemetry {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}

function clampZero(value: number): number {
  return Math.abs(value) < 0.005 ? 0 : value;
}

function fixed(value: number, digits = 2): string {
  return clampZero(value).toFixed(digits);
}

/** Read-only overlay showing the flight model's current limits and state. */
export function createFlightTelemetry(
  flight: FlightState,
  tuning: FlightTuning,
  geometry: () => ShipGeometry,
): FlightTelemetry {
  const root = document.createElement('div');
  Object.assign(root.style, PANEL_STYLE);

  const title = document.createElement('div');
  title.textContent = 'FLIGHT TELEMETRY';
  title.style.cssText = 'margin-bottom:8px;color:#d8f3ff;letter-spacing:0.12em;font-size:10px;';
  root.append(title);

  const values = new Map<string, HTMLElement>();
  const addRow = (label: string): void => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;margin:4px 0;';

    const name = document.createElement('span');
    name.textContent = label;

    const value = document.createElement('span');
    value.textContent = '—';
    value.style.cssText = 'color:#7fdfff;font-variant-numeric:tabular-nums;';

    row.append(name, value);
    root.append(row);
    values.set(label, value);
  };

  addRow('Mass');
  addRow('Terminal W');
  addRow('Terminal S');
  addRow('Terminal yaw');
  addRow('Velocity');
  addRow('Angular velocity');
  addRow('Linear input');
  addRow('Angular input');

  const set = (label: string, text: string): void => {
    const value = values.get(label);
    if (value) value.textContent = text;
  };

  const update = (): void => {
    const shipGeometry = geometry();
    set('Mass', `${fixed(tuning.massKg / 1_000, 1)} t`);
    set('Terminal W', `${fixed(forwardTerminalSpeed(tuning, shipGeometry))} m/s`);
    set('Terminal S', `${fixed(reverseTerminalSpeed(tuning, shipGeometry))} m/s`);
    set('Terminal yaw', `${fixed(yawTerminalSpeed(tuning, shipGeometry))} rad/s`);
    set('Velocity', `${fixed(Math.hypot(flight.vx, flight.vy))} m/s`);
    set('Angular velocity', `${fixed(flight.angularVelocity)} rad/s`);
    set('Linear input', fixed(flight.linearInput));
    set('Angular input', fixed(flight.angularInput));
  };

  return {
    element: root,
    update,
    destroy(): void {
      root.remove();
    },
  };
}
