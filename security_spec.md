# SCOPE-X Firestore Security Specification

## 1. Data Invariants
1. User profiles (`/users/{userId}`) contain PII (`email`, `displayName`, `photoURL`) and may only be read, created, or updated by the verified owner (`request.auth.uid == userId && request.auth.token.email_verified == true`).
2. Projects (`/projects/{projectId}`), Conversations (`/conversations/{conversationId}`), and Playlist tracks (`/playlists/{trackId}`) are strictly owned by `ownerId == request.auth.uid`, immutable after creation.
3. Subcollections (`/projects/{projectId}/files/{fileId}`, `/projects/{projectId}/versions/{versionId}`, `/conversations/{conversationId}/messages/{messageId}`) verify parent ownership via `get()` (Master Gate) on single-document operations and verify `resource.data.ownerId == request.auth.uid` on `list` queries (zero `get()` inside `allow list`).
4. All document IDs (`userId`, `projectId`, `fileId`, `versionId`, `conversationId`, `messageId`, `trackId`) must satisfy `isValidId(id)` (`^[a-zA-Z0-9_-]+$`, max 128 chars) on single-document operations.
5. All `createdAt` and `updatedAt` timestamps must equal `request.time`; `createdAt` and `ownerId` are immutable on updates.
6. Every document write enforces strict key allowlists (`hasAll` + `hasOnly` on create, `affectedKeys().hasOnly(...)` on update) and explicit size limits on all string fields.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Create on `/projects/p1`**: Missing `request.auth` -> `PERMISSION_DENIED`.
2. **Unverified Email Write on `/users/u1`**: `email_verified: false` -> `PERMISSION_DENIED`.
3. **Owner Spoofing on `/projects/p2`**: `ownerId: "victim-uid"` when caller is `"attacker-uid"` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection on `/projects/p3`**: Extra field `isAdmin: true` -> `PERMISSION_DENIED`.
5. **Cross-User PII Read on `/users/victim`**: Caller `"attacker"` reads `/users/victim` -> `PERMISSION_DENIED`.
6. **Blanket List Query on `/projects`**: Listing without `where('ownerId', '==', uid)` -> `PERMISSION_DENIED`.
7. **Orphaned Subcollection Write on `/projects/nonexistent/files/f1`**: Parent project does not exist -> `PERMISSION_DENIED`.
8. **Cross-Tenant Subcollection Read on `/projects/victimProj/files/f1`**: Parent `ownerId != request.auth.uid` -> `PERMISSION_DENIED`.
9. **ID Poisoning on `/projects/../../etc/passwd` or 500-char ID**: Fails `isValidId()` -> `PERMISSION_DENIED`.
10. **Immutable Field Tampering on `/projects/p1` update**: Attempting to change `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
11. **Timestamp Forgery on `/conversations/c1` create**: `createdAt` set to past client timestamp instead of `request.time` -> `PERMISSION_DENIED`.
12. **Value Poisoning on `/projects/p1` update**: Setting `title` to 500-char string or invalid `type: "malware"` -> `PERMISSION_DENIED`.
