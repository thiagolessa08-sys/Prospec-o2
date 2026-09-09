function firstHeaderValue(value: string | null) {
  return value?.split(',')[0]?.trim().toLowerCase() || '';
}

export function isSameOriginRequest(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;

  const rawOrigin = request.headers.get('origin');
  if (!rawOrigin) return false;

  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    return false;
  }

  if (!['http:', 'https:'].includes(origin.protocol)) return false;

  const requestUrl = new URL(request.url);
  const publicHost =
    firstHeaderValue(request.headers.get('x-forwarded-host')) ||
    firstHeaderValue(request.headers.get('host')) ||
    requestUrl.host.toLowerCase();
  const publicProtocol =
    firstHeaderValue(request.headers.get('x-forwarded-proto')) ||
    requestUrl.protocol.replace(':', '').toLowerCase();

  return (
    origin.host.toLowerCase() === publicHost &&
    origin.protocol === `${publicProtocol}:`
  );
}
