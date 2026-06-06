/**
 * Feature flag for the Labor scheduling module. Lets the module ship dark:
 * the route, API, and nav item are all gated on this. Off by default until the
 * `labor` schema migration is applied and the team is ready.
 *
 * Enable by setting `LABOR_MODULE_ENABLED=true` (or `1`) in the environment.
 */
export function isLaborModuleEnabled(): boolean {
  const v = process.env.LABOR_MODULE_ENABLED?.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}
