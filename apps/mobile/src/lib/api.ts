import * as SecureStore from 'expo-secure-store';
import {
  AuthApi,
  CartApi,
  CatalogApi,
  ComplianceApi,
  DigitalApi,
  FxApi,
  NotificationsApi,
  OnsectiveClient,
  OrdersApi,
  PayoutsApi,
  ShippingApi,
  UsersApi,
} from '@onsective/api-client';
import { API_URL } from './env';

const ACCESS_KEY = 'onsective_access_token';
const REFRESH_KEY = 'onsective_refresh_token';

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;

export async function loadStoredTokens() {
  try {
    accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
  } catch {
    accessToken = null;
  }
}

export async function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) await SecureStore.setItemAsync(ACCESS_KEY, token);
  else await SecureStore.deleteItemAsync(ACCESS_KEY);
}

export async function setRefreshToken(token: string | null) {
  if (token) await SecureStore.setItemAsync(REFRESH_KEY, token);
  else await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export function getAccessToken() {
  return accessToken;
}

async function attemptRefresh(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!refresh) return null;
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Refresh': '1' },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { accessToken: string; refreshToken?: string };
      accessToken = body.accessToken;
      await SecureStore.setItemAsync(ACCESS_KEY, body.accessToken);
      if (body.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, body.refreshToken);
      return accessToken;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

const client = new OnsectiveClient({
  baseUrl: API_URL,
  getAccessToken: () => accessToken,
  onUnauthorized: () => attemptRefresh(),
  credentials: 'omit', // mobile carries the refresh token explicitly; no cookies.
  defaultHeaders: { 'X-Client': 'mobile' },
});

export const api = {
  auth: new AuthApi(client),
  catalog: new CatalogApi(client),
  cart: new CartApi(client),
  orders: new OrdersApi(client),
  shipping: new ShippingApi(client),
  payouts: new PayoutsApi(client),
  compliance: new ComplianceApi(client),
  digital: new DigitalApi(client),
  fx: new FxApi(client),
  users: new UsersApi(client),
  notifications: new NotificationsApi(client),
};
