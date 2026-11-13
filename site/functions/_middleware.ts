/**
 * Cloudflare Pages root middleware — canonical host redirect.
 *
 * www.valleycityview.id was serving 200 with identical content instead of
 * redirecting to the apex, so search engines saw two hosts for one site. This
 * 301s any www request to the apex (path + query preserved) and passes every
 * other request through untouched — static assets and /api/booking included.
 */

interface MiddlewareContext {
  request: Request;
  next: () => Promise<Response>;
}

const APEX = 'valleycityview.id';

export const onRequest = async ({ request, next }: MiddlewareContext): Promise<Response> => {
  const url = new URL(request.url);
  if (url.hostname === `www.${APEX}`) {
    url.hostname = APEX;
    return Response.redirect(url.toString(), 301);
  }
  return next();
};