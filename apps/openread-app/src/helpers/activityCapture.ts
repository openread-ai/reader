const ACTIVITY_CAPTURE_HOST = 'activity-capture';

export type ActivityCaptureTarget = {
  route: string;
  screen: string | null;
  state: string | null;
  book: string | null;
};

export function isActivityCaptureUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'openread:' && url.host === ACTIVITY_CAPTURE_HOST;
  } catch {
    return false;
  }
}

export function parseActivityCaptureRoute(value: string): string | null {
  return parseActivityCaptureTarget(value)?.route ?? null;
}

export function parseActivityCaptureTarget(value: string): ActivityCaptureTarget | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'openread:' || url.host !== ACTIVITY_CAPTURE_HOST) return null;

    const route = url.searchParams.get('route') || '/';
    const safeRoute = !route.startsWith('/') || route.startsWith('//') ? '/' : route;

    return {
      route: safeRoute,
      screen: url.searchParams.get('screen'),
      state: url.searchParams.get('state'),
      book: url.searchParams.get('book'),
    };
  } catch {
    return null;
  }
}
