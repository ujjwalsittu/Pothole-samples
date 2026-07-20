import Constants from 'expo-constants';

interface Extra {
  apiUrl?: string;
  auth0Domain?: string;
  auth0ClientId?: string;
  auth0Audience?: string;
}

const extra: Extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const CONFIG = {
  /** Base API URL including the server's mount prefix, e.g. https://api.example.com/api/v1 */
  apiUrl: extra.apiUrl ?? 'http://localhost:4000/api/v1',
  auth0Domain: extra.auth0Domain ?? 'YOUR_TENANT.auth0.com',
  auth0ClientId: extra.auth0ClientId ?? 'YOUR_AUTH0_CLIENT_ID',
  auth0Audience: extra.auth0Audience ?? 'https://api.potholecollect.com',
} as const;
