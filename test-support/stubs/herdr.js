// Fake "herdr" module for tests (aliased in vitest.config.js), driven by ../herdr-mock.js.
import { herdrMock } from "../herdr-mock.js";

export const exec = (cmd, args, opts) => herdrMock.exec(cmd, args ?? [], opts);
export const theme = () => herdrMock.theme;
export const settings = () => herdrMock.settings;
export const props = () => herdrMock.props;

export function openOverlay(spec) {
  herdrMock.overlays.push(spec);
  return `ov${herdrMock.overlays.length}`;
}

export function closeOverlay(id) {
  herdrMock.closed.push(id);
  return null;
}

export function notify(n) {
  herdrMock.notifications.push(n);
  return `n${herdrMock.notifications.length}`;
}
