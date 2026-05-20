import { NextResponse } from 'next/server';
import { PUBLIC_API_URL } from '@/lib/env';

/**
 * Phase 28: thin proxy to the API's sitemap-index.xml. We don't
 * generate the sitemap in Next because the API has direct DB access and
 * the catalog can grow past what an edge function should fetch.
 *
 * The API embeds the buyer-web origin in the child URLs via
 * BUYER_WEB_URL, so the response we get back is already pointed at the
 * right host.
 */
export const revalidate = 3600;

export async function GET() {
  try {
    const res = await fetch(`${PUBLIC_API_URL}/seo/sitemap-index.xml`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return new NextResponse('Sitemap unavailable', { status: 502 });
    }
    const body = await res.text();
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new NextResponse('Sitemap fetch failed', { status: 502 });
  }
}
