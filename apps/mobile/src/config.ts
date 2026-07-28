import Constants from 'expo-constants';

interface Extra {
  apiUrl?: string;
  auth0Domain?: string;
  auth0ClientId?: string;
  auth0Audience?: string;
  auth0Scheme?: string;
  devAuthBypass?: boolean;
  devSub?: string;
  devEmail?: string;
}

const extra: Extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const CONFIG = {
  /** Base API URL including the server's mount prefix, e.g. https://api.example.com/api/v1 */
  apiUrl: extra.apiUrl ?? 'http://localhost:4000/api/v1',
  auth0Domain: extra.auth0Domain ?? 'YOUR_TENANT.auth0.com',
  auth0ClientId: extra.auth0ClientId ?? 'YOUR_AUTH0_CLIENT_ID',
  auth0Audience: extra.auth0Audience ?? 'https://api.potholecollect.com',
  /** Custom URL scheme for the Auth0 callback. Must match the `customScheme`
   * given to the react-native-auth0 config plugin, which is what lands in the
   * native RedirectActivity intent-filter. Without passing this explicitly to
   * authorize()/clearSession(), the SDK defaults to `<applicationId>.auth0`,
   * which no intent-filter listens for and which Auth0 rejects as a callback
   * URL mismatch. */
  auth0Scheme: extra.auth0Scheme ?? 'potholecollect',
  /** Local dev only: skip Auth0 and send x-dev-sub/x-dev-email headers,
   * matching the API's DEV_AUTH_BYPASS mode. */
  devAuthBypass: extra.devAuthBypass ?? false,
  devSub: extra.devSub ?? 'dev|mobile',
  devEmail: extra.devEmail ?? 'collector@dev.local',
} as const;
