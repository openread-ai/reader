import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/hooks/useSync';
import { BookNote } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { SYNC_NOTES_INTERVAL_SEC } from '@/services/constants';
import { throttle } from '@/utils/throttle';
import { enqueueBatchAndSync } from '@/services/sync/helpers';
import { syncWorker, SYNC_EVENTS } from '@/services/sync/syncWorker';

export const useNotesSync = (bookKey: string) => {
  const { user } = useAuth();
  const { syncedNotes, syncNotes, lastSyncedAtNotes } = useSync(bookKey);
  const { getConfig, setConfig, getBookData } = useBookDataStore();

  const config = getConfig(bookKey);

  const getNewNotes = useCallback(() => {
    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config?.location || !book || !user) return {};

    const bookNotes = config.booknotes ?? [];
    const newNotes = bookNotes.filter(
      (note) => lastSyncedAtNotes < note.updatedAt || lastSyncedAtNotes < (note.deletedAt ?? 0),
    );
    newNotes.forEach((note) => {
      note.bookHash = book.hash;
      note.metaHash = book.metaHash;
    });
    return {
      notes: newNotes,
      lastSyncedAt: lastSyncedAtNotes,
    };
  }, [user, bookKey, lastSyncedAtNotes, getConfig, getBookData]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAutoSync = useCallback(
    throttle(
      async () => {
        const book = getBookData(bookKey)?.book;
        const newNotes = getNewNotes();
        if (!newNotes.notes?.length) return;
        await syncNotes(newNotes.notes, book?.hash, book?.metaHash, 'both');
        syncWorker.broadcast(SYNC_EVENTS.NOTES);
      },
      SYNC_NOTES_INTERVAL_SEC * 1000,
      { emitLast: true },
    ),
    [syncNotes],
  );

  // Pull notes once when the book opens (fills local state from server on fresh install)
  const hasPulledNotesOnce = useRef(false);
  useEffect(() => {
    if (!config?.location || !user || hasPulledNotesOnce.current) return;
    hasPulledNotesOnce.current = true;
    const book = getBookData(bookKey)?.book;
    syncNotes([], book?.hash, book?.metaHash, 'pull');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.location, user]);

  useEffect(() => {
    if (!config?.location || !user) return;
    handleAutoSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.booknotes, handleAutoSync]);

  // Flush unsent notes to offline queue on unmount so changes
  // aren't lost if the user closes the reader before the throttle fires.
  useEffect(() => {
    return () => {
      const { notes } = getNewNotes();
      if (!notes?.length || !user) return;
      enqueueBatchAndSync(
        notes.map((note) => ({
          type: 'note' as const,
          action: 'upsert' as const,
          payload: note as unknown as Record<string, unknown>,
        })),
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  useEffect(() => {
    const processNewNote = (note: BookNote) => {
      const config = getConfig(bookKey);
      const oldNotes = config?.booknotes ?? [];
      const existingNote = oldNotes.find((oldNote) => oldNote.id === note.id);
      if (existingNote) {
        const remoteTime = Math.max(note.updatedAt ?? 0, note.deletedAt ?? 0);
        const localTime = Math.max(existingNote.updatedAt ?? 0, existingNote.deletedAt ?? 0);
        if (remoteTime > localTime) {
          return { ...existingNote, ...note };
        } else {
          return { ...note, ...existingNote };
        }
      }
      return note;
    };
    if (syncedNotes?.length && config) {
      const book = getBookData(bookKey)?.book;
      const newNotes = syncedNotes.filter(
        (note) => note.bookHash === book?.hash || note.metaHash === book?.metaHash,
      );
      if (!newNotes.length) return;
      const oldNotes = config.booknotes ?? [];
      const mergedNotes = [
        ...oldNotes.filter((oldNote) => !newNotes.some((newNote) => newNote.id === oldNote.id)),
        ...newNotes.map(processNewNote),
      ];
      setConfig(bookKey, { booknotes: mergedNotes });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedNotes]);
};
