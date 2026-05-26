import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';
import type { WatchedDateDoc, UserDoc } from './types';

let db: Firestore;

export function getDb(): Firestore {
  if (!db) {
    if (!getApps().length) {
      initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!.replace(/^'|'$/g, ''))),
      });
    }
    db = getFirestore();
  }
  return db;
}

export async function registerDate(userId: string, date: string): Promise<void> {
  const firestore = getDb();
  const dateRef = firestore.collection('watchedDates').doc(date);
  const userRef = firestore.collection('users').doc(userId);

  await firestore.runTransaction(async (tx) => {
    const [dateSnap, userSnap] = await Promise.all([tx.get(dateRef), tx.get(userRef)]);

    if (!dateSnap.exists) {
      tx.set(dateRef, { date, users: [userId], lastStatus: null } satisfies WatchedDateDoc);
    } else {
      tx.update(dateRef, { users: FieldValue.arrayUnion(userId) });
    }

    if (!userSnap.exists) {
      tx.set(userRef, { dates: [date] } satisfies UserDoc);
    } else {
      tx.update(userRef, { dates: FieldValue.arrayUnion(date) });
    }
  });
}

export async function unregisterDate(userId: string, date: string): Promise<void> {
  const firestore = getDb();
  const dateRef = firestore.collection('watchedDates').doc(date);
  const userRef = firestore.collection('users').doc(userId);

  await firestore.runTransaction(async (tx) => {
    tx.update(dateRef, { users: FieldValue.arrayRemove(userId) });
    tx.update(userRef, { dates: FieldValue.arrayRemove(date) });
  });
}

export async function listDatesForUser(userId: string): Promise<string[]> {
  const snap = await getDb().collection('users').doc(userId).get();
  if (!snap.exists) return [];
  return ((snap.data() as UserDoc).dates ?? []).sort();
}

export async function getAllWatchedDates(): Promise<WatchedDateDoc[]> {
  const snap = await getDb()
    .collection('watchedDates')
    .where('users', '!=', [])
    .get();
  return snap.docs.map((d) => d.data() as WatchedDateDoc);
}

export async function getActiveWatchCount(): Promise<number> {
  const snap = await getDb()
    .collection('watchedDates')
    .where('users', '!=', [])
    .count()
    .get();
  return snap.data().count;
}

export async function updateLastStatus(date: string, status: string): Promise<void> {
  await getDb().collection('watchedDates').doc(date).update({ lastStatus: status });
}
