/** Same-tab pointer only. Never persist request bodies, results, credentials or URLs. */
export const EDITORIAL_RECOVERY_KEY = "tsp:editorial-recovery:v1";
export interface EditorialRecoveryScope { tenantId: string; userId: string }
export interface EditorialRecovery extends EditorialRecoveryScope { jobId: string; requestIntent: string }
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function read(): EditorialRecovery | undefined {
  try {
    const raw = sessionStorage.getItem(EDITORIAL_RECOVERY_KEY);
    if (!raw) return;
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).sort().join() !== "jobId,requestIntent,tenantId,userId" ||
      !uuid(value.jobId) || !uuid(value.requestIntent) ||
      ![value.tenantId, value.userId].every(id => typeof id === "string" && id.length > 0 && id.length <= 128)) {
      clearEditorialRecovery(); return;
    }
    return value;
  } catch { clearEditorialRecovery(); }
}

export function clearEditorialRecovery(jobId?: string) {
  try {
    if (!jobId || JSON.parse(sessionStorage.getItem(EDITORIAL_RECOVERY_KEY) ?? "null")?.jobId === jobId) {
      sessionStorage.removeItem(EDITORIAL_RECOVERY_KEY);
    }
  } catch { /* Storage may be disabled; never fall back to localStorage. */ }
}

export function retainEditorialRecoveryForAccount(userId: string | null) {
  if (!userId || read()?.userId !== userId) clearEditorialRecovery();
}

export function readEditorialRecovery(scope: EditorialRecoveryScope): EditorialRecovery | undefined {
  const value = read();
  if (value?.userId === scope.userId && value.tenantId === scope.tenantId) return value;
  clearEditorialRecovery();
}

export function saveEditorialRecovery(scope: EditorialRecoveryScope, jobId: string, requestIntent: string) {
  if (!uuid(jobId) || !uuid(requestIntent)) return;
  try {
    sessionStorage.setItem(EDITORIAL_RECOVERY_KEY, JSON.stringify({ tenantId: scope.tenantId, userId: scope.userId, jobId, requestIntent }));
  } catch { /* In-memory generation still works when storage is denied/full. */ }
}