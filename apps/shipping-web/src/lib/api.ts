'use client';

import { AiVisionApi, AuthApi, AuthenticityApi, InboundApi, OnsectiveClient, PickListApi, RepairNetworkApi, ReturnsDispositionApi, ShippingApi, TradeInApi, WarehousesApi } from '@onsective/api-client';
import { PUBLIC_API_URL } from './env';

let accessToken: string | null = null;
export function setAccessToken(t: string | null) { accessToken = t; }
export function getAccessToken() { return accessToken; }

let refreshing: Promise<string | null> | null = null;
async function attemptRefresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetch(`${PUBLIC_API_URL}/auth/refresh`, {
        method: 'POST', credentials: 'include', headers: { 'X-Refresh': '1' },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return accessToken;
    } catch { return null; }
    finally { refreshing = null; }
  })();
  return refreshing;
}

const client = new OnsectiveClient({
  baseUrl: PUBLIC_API_URL,
  credentials: 'include',
  getAccessToken: () => accessToken,
  onUnauthorized: () => attemptRefresh(),
});

export const api = {
  auth: new AuthApi(client),
  shipping: new ShippingApi(client),
  warehouses: new WarehousesApi(client),
  inbound: new InboundApi(client),
  pickList: new PickListApi(client),
  authenticity: new AuthenticityApi(client),
  tradeIn: new TradeInApi(client),
  aiVision: new AiVisionApi(client),
  returnsDisposition: new ReturnsDispositionApi(client),
  repairNetwork: new RepairNetworkApi(client),
};
