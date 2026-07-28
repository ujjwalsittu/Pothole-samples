/**
 * Optional native TFLite runtime binding — DISABLED by default.
 *
 * Metro cannot express "require this module only if installed": a
 * variable-specifier require becomes a runtime `Requiring unknown module
 * "undefined"` error on builds without the package. So the binding is an
 * explicit one-line opt-in instead.
 *
 * To ENABLE on-device model inference:
 *   1. npm install react-native-fast-tflite
 *   2. npx expo prebuild --clean && rebuild the dev client
 *   3. Replace the `export const loadTensorflowModel ... = null;` line below
 *      with:
 *        export { loadTensorflowModel } from 'react-native-fast-tflite';
 *
 * Without this, the app runs the sensor-based HeuristicAdvisor (and any
 * OTA-downloaded model stays dormant) — everything else works normally.
 */
import type { TfliteModelLike } from './tflite';

export type LoadTensorflowModel = (source: { url: string }) => Promise<TfliteModelLike>;

export const loadTensorflowModel: LoadTensorflowModel | null = null;
