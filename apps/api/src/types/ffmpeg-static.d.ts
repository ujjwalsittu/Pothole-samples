/**
 * ffmpeg-static is an OPTIONAL dependency (its postinstall downloads a
 * per-platform binary and may be skipped on restricted networks), so we keep
 * a local declaration instead of relying on its own types being installed.
 */
declare module 'ffmpeg-static' {
  const ffmpegPath: string | null;
  export default ffmpegPath;
}
