export type DashAccessInput = {
  sessionExists: boolean;
  isDemo: boolean;
  hasUser: boolean;
  isMember: boolean;
  isInternal: boolean;
};

export type DashAccess = "not-found" | "demo" | "login" | "member" | "internal" | "forbidden";

/** The Command Center route is a founder draft until explicitly released. */
export function canViewCommandCenter(access: DashAccess): boolean {
  return access === 'internal';
}

export function resolveDashAccess(i: DashAccessInput): DashAccess {
  if (!i.sessionExists) return "not-found";
  if (i.isDemo) return "demo";
  if (!i.hasUser) return "login";
  if (i.isMember) return "member";
  if (i.isInternal) return "internal";
  return "forbidden";
}
