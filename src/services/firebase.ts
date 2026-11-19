import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  ChatMessage,
  ConversationThread,
  MediaTrack,
  ProjectVersion,
  ProviderId,
  StudioFile,
  StudioProject,
} from '../types/studio';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned && SAFE_ID_REGEX.test(cleaned) ? cleaned : `id_${Date.now()}`;
}

export async function upsertUserProfile(
  user: User,
  prefs?: { preferredVoice?: string; defaultProvider?: ProviderId; defaultModel?: string }
): Promise<void> {
  const uid = sanitizeId(user.uid);
  const ref = doc(db, 'users', uid);
  try {
    const existing = await getDoc(ref);
    const displayName = (user.displayName || user.email || 'Creator').slice(0, 120);
    const email = (user.email || 'user@scope-x.local').slice(0, 200);
    const photoURL = (user.photoURL || '').slice(0, 500);
    const defaultProvider = prefs?.defaultProvider || 'auto';
    const defaultModel = (prefs?.defaultModel || 'gemini-3.1-flash-lite').slice(0, 120);
    const preferredVoice = (prefs?.preferredVoice || 'studio-butler').slice(0, 120);

    if (!existing.exists()) {
      await setDoc(ref, {
        uid,
        displayName,
        email,
        photoURL,
        preferredVoice,
        defaultProvider,
        defaultModel,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName,
        email,
        photoURL,
        ...(prefs?.preferredVoice ? { preferredVoice } : {}),
        ...(prefs?.defaultProvider ? { defaultProvider } : {}),
        ...(prefs?.defaultModel ? { defaultModel } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

export async function saveProjectToFirestore(
  uid: string,
  project: StudioProject
): Promise<void> {
  const projectId = sanitizeId(project.id);
  const ownerId = sanitizeId(uid);
  const projectRef = doc(db, 'projects', projectId);

  try {
    const existing = await getDoc(projectRef);
    if (!existing.exists()) {
      await setDoc(projectRef, {
        id: projectId,
        ownerId,
        title: project.title.slice(0, 160) || 'Untitled Project',
        description: project.description.slice(0, 1000),
        type: project.type,
        fileCount: Math.min(500, project.files.length),
        activeVersion: Math.max(1, project.activeVersion),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(projectRef, {
        title: project.title.slice(0, 160) || 'Untitled Project',
        description: project.description.slice(0, 1000),
        type: project.type,
        fileCount: Math.min(500, project.files.length),
        activeVersion: Math.max(1, project.activeVersion),
        updatedAt: serverTimestamp(),
      });
    }

    for (const file of project.files) {
      const fileId = sanitizeId(file.id || file.path);
      const fileRef = doc(db, 'projects', projectId, 'files', fileId);
      await setDoc(fileRef, {
        projectId,
        ownerId,
        path: file.path.slice(0, 256),
        language: (file.language || 'text').slice(0, 40),
        content: file.content.slice(0, 300000),
        updatedAt: serverTimestamp(),
      });
    }

    const latestVersion = project.versions[project.versions.length - 1];
    if (latestVersion) {
      const versionId = sanitizeId(latestVersion.id || `v_${latestVersion.versionNumber}`);
      const verRef = doc(db, 'projects', projectId, 'versions', versionId);
      const verSnap = await getDoc(verRef);
      if (!verSnap.exists()) {
        const snapshotJson = JSON.stringify(latestVersion.files).slice(0, 599000);
        await setDoc(verRef, {
          projectId,
          ownerId,
          versionNumber: Math.max(1, latestVersion.versionNumber),
          summary: latestVersion.summary.slice(0, 300) || 'Snapshot',
          snapshotJson,
          createdAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `projects/${projectId}`);
  }
}

export async function loadProjectDetailsFromFirestore(
  projectId: string
): Promise<{ files: StudioFile[]; versions: ProjectVersion[] }> {
  const safeId = sanitizeId(projectId);
  try {
    const filesSnap = await getDocs(
      query(
        collection(db, 'projects', safeId, 'files'),
        where('ownerId', '==', auth.currentUser?.uid || '')
      )
    );
    const files: StudioFile[] = filesSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        path: String(data.path || 'file.txt'),
        language: String(data.language || 'text'),
        content: String(data.content || ''),
        updatedAt: Date.now(),
      };
    });

    const versionsSnap = await getDocs(
      query(
        collection(db, 'projects', safeId, 'versions'),
        where('ownerId', '==', auth.currentUser?.uid || '')
      )
    );
    const versions: ProjectVersion[] = versionsSnap.docs
      .map((d) => {
        const data = d.data();
        let parsedFiles: StudioFile[] = [];
        try {
          parsedFiles = JSON.parse(String(data.snapshotJson || '[]')) as StudioFile[];
        } catch {
          parsedFiles = [];
        }
        return {
          id: d.id,
          versionNumber: Number(data.versionNumber || 1),
          summary: String(data.summary || 'Snapshot'),
          files: parsedFiles,
          createdAt: Date.now(),
        };
      })
      .sort((a, b) => a.versionNumber - b.versionNumber);

    return { files, versions };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `projects/${safeId}`);
  }
}

export async function deleteProjectFromFirestore(projectId: string): Promise<void> {
  const safeId = sanitizeId(projectId);
  try {
    const uid = auth.currentUser?.uid || '';
    const filesSnap = await getDocs(
      query(collection(db, 'projects', safeId, 'files'), where('ownerId', '==', uid))
    );
    for (const d of filesSnap.docs) {
      await deleteDoc(d.ref);
    }
    const verSnap = await getDocs(
      query(collection(db, 'projects', safeId, 'versions'), where('ownerId', '==', uid))
    );
    for (const d of verSnap.docs) {
      await deleteDoc(d.ref);
    }
    await deleteDoc(doc(db, 'projects', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `projects/${safeId}`);
  }
}

export async function saveConversationMetaToFirestore(
  uid: string,
  conv: ConversationThread
): Promise<void> {
  const conversationId = sanitizeId(conv.id);
  const ownerId = sanitizeId(uid);
  const ref = doc(db, 'conversations', conversationId);
  try {
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        id: conversationId,
        ownerId,
        title: conv.title.slice(0, 160) || 'New Session',
        projectId: (conv.projectId || '').slice(0, 128),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        title: conv.title.slice(0, 160) || 'New Session',
        projectId: (conv.projectId || '').slice(0, 128),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `conversations/${conversationId}`);
  }
}

export async function appendMessageToFirestore(
  uid: string,
  conversationId: string,
  msg: ChatMessage
): Promise<void> {
  const safeConvId = sanitizeId(conversationId);
  const safeMsgId = sanitizeId(msg.id);
  const ownerId = sanitizeId(uid);
  const ref = doc(db, 'conversations', safeConvId, 'messages', safeMsgId);
  try {
    await setDoc(ref, {
      conversationId: safeConvId,
      ownerId,
      role: msg.role,
      content: msg.content.slice(0, 100000),
      provider: (msg.provider || '').slice(0, 60),
      model: (msg.model || '').slice(0, 120),
      toolActions: JSON.stringify(msg.toolActions || []).slice(0, 50000),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `conversations/${safeConvId}/messages/${safeMsgId}`
    );
  }
}

export async function loadConversationMessagesFromFirestore(
  conversationId: string
): Promise<ChatMessage[]> {
  const safeConvId = sanitizeId(conversationId);
  try {
    const snap = await getDocs(
      query(
        collection(db, 'conversations', safeConvId, 'messages'),
        where('ownerId', '==', auth.currentUser?.uid || ''),
        orderBy('createdAt', 'asc')
      )
    );
    return snap.docs.map((d) => {
      const data = d.data();
      let toolActions = [];
      try {
        toolActions = JSON.parse(String(data.toolActions || '[]'));
      } catch {
        toolActions = [];
      }
      return {
        id: d.id,
        role: (data.role || 'assistant') as ChatMessage['role'],
        content: String(data.content || ''),
        provider: String(data.provider || ''),
        model: String(data.model || ''),
        toolActions,
        createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
      };
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.LIST,
      `conversations/${safeConvId}/messages`
    );
  }
}

export async function savePlaylistTrackToFirestore(
  uid: string,
  track: MediaTrack
): Promise<void> {
  const trackId = sanitizeId(track.id);
  const ownerId = sanitizeId(uid);
  try {
    await setDoc(doc(db, 'playlists', trackId), {
      id: trackId,
      ownerId,
      title: track.title.slice(0, 160),
      artist: track.artist.slice(0, 160),
      album: (track.album || '').slice(0, 160),
      artworkUrl: (track.artworkUrl || '').slice(0, 600),
      previewUrl: (track.previewUrl || '').slice(0, 600),
      externalUrl: (track.externalUrl || '').slice(0, 600),
      durationSec: Math.max(0, Math.min(36000, track.durationSec || 30)),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `playlists/${trackId}`);
  }
}

export async function deletePlaylistTrackFromFirestore(trackId: string): Promise<void> {
  const safeId = sanitizeId(trackId);
  try {
    await deleteDoc(doc(db, 'playlists', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `playlists/${safeId}`);
  }
}

export function subscribeUserCollections(
  uid: string,
  callbacks: {
    onProjects: (projects: StudioProject[]) => void;
    onConversations: (conversations: ConversationThread[]) => void;
    onPlaylists: (tracks: MediaTrack[]) => void;
  }
): Unsubscribe {
  const qProjects = query(
    collection(db, 'projects'),
    where('ownerId', '==', uid),
    orderBy('updatedAt', 'desc')
  );
  const unsubProjects = onSnapshot(
    qProjects,
    (snapshot) => {
      const items: StudioProject[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: String(data.title || 'Untitled'),
          description: String(data.description || ''),
          type: (data.type || 'app') as StudioProject['type'],
          files: [],
          versions: [],
          activeVersion: Number(data.activeVersion || 1),
          createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
          updatedAt: data.updatedAt?.toMillis?.() ?? Date.now(),
        };
      });
      callbacks.onProjects(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'projects');
    }
  );

  const qConversations = query(
    collection(db, 'conversations'),
    where('ownerId', '==', uid),
    orderBy('updatedAt', 'desc')
  );
  const unsubConvs = onSnapshot(
    qConversations,
    (snapshot) => {
      const items: ConversationThread[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: String(data.title || 'Conversation'),
          projectId: String(data.projectId || ''),
          messages: [],
          createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
          updatedAt: data.updatedAt?.toMillis?.() ?? Date.now(),
        };
      });
      callbacks.onConversations(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'conversations');
    }
  );

  const qPlaylists = query(
    collection(db, 'playlists'),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'desc')
  );
  const unsubPlaylists = onSnapshot(
    qPlaylists,
    (snapshot) => {
      const items: MediaTrack[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: String(data.title || 'Track'),
          artist: String(data.artist || 'Artist'),
          album: String(data.album || ''),
          artworkUrl: String(data.artworkUrl || ''),
          previewUrl: String(data.previewUrl || ''),
          externalUrl: String(data.externalUrl || ''),
          durationSec: Number(data.durationSec || 30),
          sourceLabel: data.previewUrl ? 'Saved Preview' : 'External Link',
        };
      });
      callbacks.onPlaylists(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'playlists');
    }
  );

  return () => {
    unsubProjects();
    unsubConvs();
    unsubPlaylists();
  };
}
