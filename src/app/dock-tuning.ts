/** Live placement values for the authored dock, editable from the dev panel. */
export interface DockTuning {
  xM: number;
  yM: number;
  /** Rendered dock height in metres. */
  heightM: number;
}

export const DEFAULT_DOCK_TUNING: DockTuning = {
  xM: 0,
  yM: -2,
  heightM: 33,
};
