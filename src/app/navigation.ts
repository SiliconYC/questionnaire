let guard: (() => Promise<boolean>) | null = null;
export function registerLeaveGuard(next: () => Promise<boolean>) {
  guard = next;
  return () => {
    if (guard === next) guard = null;
  };
}
export async function leaveCurrentPage() {
  return guard ? guard() : true;
}
