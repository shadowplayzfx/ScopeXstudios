// Security specification verification harness for SCOPE-X Firestore Rules
// Documents the Dirty Dozen payloads tested against firestore.rules.

export const DIRTY_DOZEN_CASES = [
  { id: 1, name: 'Unauthenticated project create', path: 'projects/p1', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Unverified email user profile write', path: 'users/u1', expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'Owner spoofing on project create', path: 'projects/p2', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'Shadow field injection (isAdmin)', path: 'projects/p3', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'Cross-user PII read on /users/victim', path: 'users/victim', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Unfiltered list query on /projects', path: 'projects', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Orphaned project file create', path: 'projects/missing/files/f1', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Cross-tenant file read', path: 'projects/victimProj/files/f1', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Oversized / invalid projectId', path: 'projects/' + 'a'.repeat(200), expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Immutable ownerId/createdAt update', path: 'projects/p1', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Client-forged createdAt timestamp', path: 'conversations/c1', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Invalid enum or oversized title update', path: 'projects/p1', expected: 'PERMISSION_DENIED' },
] as const;
