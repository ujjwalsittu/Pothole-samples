/** Filesystem locations for the OTA-delivered detection model. */
import * as FileSystem from 'expo-file-system';

export const MODELS_DIR = `${FileSystem.documentDirectory ?? ''}models/`;

/** The active model binary — TfliteAdvisor loads from here. */
export const TFLITE_MODEL_PATH = `${MODELS_DIR}road-detector.tflite`;

/** Download staging path; atomically renamed over TFLITE_MODEL_PATH. */
export const TFLITE_MODEL_TMP_PATH = `${MODELS_DIR}road-detector.tflite.tmp`;

/** Installed-model metadata: {version, sha256}. */
export const MODEL_META_PATH = `${MODELS_DIR}model-meta.json`;
