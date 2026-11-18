/** The server supplies this path from its trusted external URL configuration. */
function basePath() {
  return typeof document === "undefined"
    ? ""
    : (document.querySelector<HTMLMetaElement>('meta[name="meetloom-base"]')
        ?.content ?? "");
}

export function appUrl(path: string) {
  const base = basePath();
  if (
    !base ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path === base ||
    path.startsWith(`${base}/`) ||
    path.startsWith(`${base}?`) ||
    path.startsWith(`${base}#`)
  )
    return path;
  return `${base}${path}`;
}

export function appPathname(path: string) {
  const base = basePath();
  if (base && path === base) return "/";
  return base && path.startsWith(`${base}/`) ? path.slice(base.length) : path;
}

export const appHref = (path: string) => `${location.origin}${appUrl(path)}`;
