import { NextResponse } from 'next/server';

/**
 * Phase 28: robots.txt with the right disallows for the surfaces that
 * shouldn't show up in search results, plus a Sitemap: pointer at
 * /sitemap.xml.
 *
 * We don't disallow /search itself — only query-string search variants
 * to avoid faceted-search index bloat — but the search page renders
 * results dynamically and isn't terribly useful as a static entry
 * anyway.
 */
export const revalidate = 86400;

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const body =
`User-agent: *
Disallow: /account/
Disallow: /admin/
Disallow: /checkout
Disallow: /track
Disallow: /verify
Disallow: /search?
Allow: /

Sitemap: ${origin}/sitemap.xml
`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
