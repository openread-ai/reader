import type { NextApiRequest, NextApiResponse } from 'next';
import { NextRequest, NextResponse } from 'next/server';
import { PostgrestError } from '@supabase/supabase-js';
import { createSupabaseClient, createSupabaseAdminClient } from '@/utils/supabase';
import { upsertPlatformBook } from '@/utils/platformBooks';
import { BookDataRecord } from '@/types/book';
import { transformBookConfigToDB } from '@/utils/transform';
import { transformBookNoteToDB } from '@/utils/transform';
import { transformBookToDB } from '@/utils/transform';
import { runMiddleware, corsAllMethods } from '@/utils/cors';
import { SyncData, SyncRecord, SyncType } from '@/libs/sync';
import { validateUserAndToken } from '@/utils/access';
import {
  validateProtocolVersion,
  SYNC_PROTOCOL_MIN_SUPPORTED,
  SYNC_PROTOCOL_MAX_SUPPORTED,
} from '@/libs/sync-protocol';

const transformsToDB = {
  books: transformBookToDB,
  book_notes: transformBookNoteToDB,
  book_configs: transformBookConfigToDB,
};

const DBSyncTypeMap = {
  books: 'books',
  book_notes: 'notes',
  book_configs: 'configs',
};

type TableName = keyof typeof transformsToDB;

type DBError = { table: TableName; error: PostgrestError };

/** Return a 426 response if the client's sync protocol version is unsupported, or null if OK. */
function protocolVersionResponse(req: NextRequest): NextResponse | null {
  const protocolError = validateProtocolVersion(req.headers.get('x-sync-protocol'));
  if (!protocolError) return null;
  const response = NextResponse.json(protocolError, { status: 426 });
  response.headers.set('X-Sync-Protocol-Min', String(SYNC_PROTOCOL_MIN_SUPPORTED));
  response.headers.set('X-Sync-Protocol-Max', String(SYNC_PROTOCOL_MAX_SUPPORTED));
  return response;
}

export async function GET(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }

  // P9.33: Validate sync protocol version (after auth to avoid info leakage)
  const protoResp = protocolVersionResponse(req);
  if (protoResp) return protoResp;

  const supabase = createSupabaseClient(token);

  const { searchParams } = new URL(req.url);
  const sinceParam = searchParams.get('since');
  const validSyncTypes: SyncType[] = ['books', 'configs', 'notes', 'settings'];
  const rawType = searchParams.get('type');
  const typeParam: SyncType | undefined =
    rawType && validSyncTypes.includes(rawType as SyncType) ? (rawType as SyncType) : undefined;
  const bookParam = searchParams.get('book');
  const metaHashParam = searchParams.get('meta_hash');

  if (!sinceParam) {
    return NextResponse.json({ error: '"since" query parameter is required' }, { status: 400 });
  }

  const since = new Date(Number(sinceParam));
  if (isNaN(since.getTime())) {
    return NextResponse.json({ error: 'Invalid "since" timestamp' }, { status: 400 });
  }

  // P9.4: Validate hash parameters against regex (defense in depth against injection)
  const HASH_REGEX = /^[0-9a-f]{32}$/i;
  if (bookParam && !HASH_REGEX.test(bookParam)) {
    return NextResponse.json({ error: 'Invalid book_hash format' }, { status: 400 });
  }
  if (metaHashParam && !HASH_REGEX.test(metaHashParam)) {
    return NextResponse.json({ error: 'Invalid meta_hash format' }, { status: 400 });
  }

  const sinceIso = since.toISOString();

  try {
    const results: Record<string, unknown> = { books: [], configs: [], notes: [] };
    const errors: Record<TableName, DBError | null> = {
      books: null,
      book_notes: null,
      book_configs: null,
    };

    const queryTables = async (table: TableName, dedupeKeys?: (keyof BookDataRecord)[]) => {
      const PAGE_SIZE = 1000;
      // P9.4: Removed MAX_RECORDS cap — atomic RPC returns all non-deleted records
      let allRecords: SyncRecord[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        let query = supabase
          .from(table)
          .select('*')
          .eq('user_id', user.id)
          .range(offset, offset + PAGE_SIZE - 1);

        if (bookParam && metaHashParam) {
          query = query.or(`book_hash.eq.${bookParam},meta_hash.eq.${metaHashParam}`);
        } else if (bookParam) {
          query = query.eq('book_hash', bookParam);
        } else if (metaHashParam) {
          query = query.eq('meta_hash', metaHashParam);
        }

        query = query.or(`updated_at.gt.${sinceIso},deleted_at.gt.${sinceIso}`);
        query = query.order('updated_at', { ascending: false });

        console.log('Querying table:', table, 'since:', sinceIso, 'offset:', offset);

        const { data, error } = await query;
        if (error) throw { table, error } as DBError;

        if (data && data.length > 0) {
          allRecords = allRecords.concat(data);
          offset += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      let records = allRecords;
      if (dedupeKeys && dedupeKeys.length > 0) {
        const seen = new Set<string>();
        records = records.filter((rec) => {
          const key = dedupeKeys
            .map((k) => rec[k])
            .filter(Boolean)
            .join('|');
          if (key && seen.has(key)) {
            return false;
          } else {
            seen.add(key);
            return true;
          }
        });
      }
      results[DBSyncTypeMap[table] as SyncType] = records || [];
    };

    if (!typeParam || typeParam === 'books') {
      // P9.4: Removed dummy book hotfix — atomic RPC eliminates the root cause
      await queryTables('books').catch((err) => (errors['books'] = err));
    }
    if (!typeParam || typeParam === 'configs') {
      await queryTables('book_configs').catch((err) => (errors['book_configs'] = err));
    }
    if (!typeParam || typeParam === 'notes') {
      await queryTables('book_notes', ['book_hash', 'id']).catch(
        (err) => (errors['book_notes'] = err),
      );
    }

    // Settings sync: pull from user_settings table
    if (typeParam === 'settings') {
      try {
        const { data: settingsRow, error: settingsError } = await supabase
          .from('user_settings')
          .select('settings, updated_at')
          .eq('user_id', user.id)
          .single();
        if (settingsError && settingsError.code !== 'PGRST116') {
          console.error('[sync] settings pull error:', settingsError.message);
        }
        if (settingsRow && new Date(settingsRow.updated_at).getTime() > since.getTime()) {
          (results as Record<string, unknown>).settings = settingsRow.settings;
        }
      } catch (err) {
        console.error('[sync] settings pull failed:', err);
      }
    }

    const dbErrors = Object.values(errors).filter((err) => err !== null);
    if (dbErrors.length > 0) {
      console.error('Errors occurred:', dbErrors);
      const errorMsg = dbErrors.map((err) => `${err.table}: ${err.error.message}`).join('; ');
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    const response = NextResponse.json(results, { status: 200 });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Pragma', 'no-cache');
    response.headers.delete('ETag');
    response.headers.set('X-Sync-Protocol-Min', String(SYNC_PROTOCOL_MIN_SUPPORTED));
    response.headers.set('X-Sync-Protocol-Max', String(SYNC_PROTOCOL_MAX_SUPPORTED));
    return response;
  } catch (error: unknown) {
    console.error(error);
    const errorMessage = (error as PostgrestError).message || 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }

  // P9.33: Validate sync protocol version (after auth to avoid info leakage)
  const protoResp = protocolVersionResponse(req);
  if (protoResp) return protoResp;

  const supabase = createSupabaseClient(token);
  const bodyText = await req.text();

  // P9.4: Reject payloads > 5MB (use actual byte length, not string length)
  const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
  const bodyBytes = new TextEncoder().encode(bodyText).byteLength;
  if (bodyBytes > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `Payload too large: ${bodyBytes} bytes exceeds ${MAX_PAYLOAD_BYTES} byte limit`,
      },
      { status: 413 },
    );
  }

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { books = [], configs = [], notes = [], settings: incomingSettings } = body as SyncData;
  const requestId = (body as Record<string, unknown>).requestId as string | undefined;
  const deviceId = (body as Record<string, unknown>).deviceId as string | undefined;

  // Idempotency: check for duplicate request (graceful degradation if table missing)
  if (requestId) {
    let existing = null;
    try {
      const { data, error: lookupError } = await supabase
        .from('processed_requests')
        .select('request_id')
        .eq('request_id', requestId)
        .single();
      if (lookupError) {
        // 42P01 = table does not exist — skip idempotency check gracefully
        if (lookupError.code !== '42P01') {
          // PGRST116 = "not found" from .single() when no row matches — expected, not an error
          if (lookupError.code !== 'PGRST116') {
            console.error(
              `[sync] requestId=${requestId} idempotency lookup error:`,
              lookupError.message,
            );
          }
        }
      } else {
        existing = data;
      }
    } catch (err: unknown) {
      if ((err as Record<string, unknown>)?.code === '42P01') {
        // Table may not exist yet — skip idempotency check
      } else {
        throw err;
      }
    }

    if (existing) {
      // Already processed - return current state
      const currentBooks = await supabase.from('books').select('*').eq('user_id', user.id);
      if (currentBooks.error)
        console.error('[sync] dedup books fetch error:', currentBooks.error.message);
      const currentConfigs = await supabase.from('book_configs').select('*').eq('user_id', user.id);
      if (currentConfigs.error)
        console.error('[sync] dedup configs fetch error:', currentConfigs.error.message);
      const currentNotes = await supabase.from('book_notes').select('*').eq('user_id', user.id);
      if (currentNotes.error)
        console.error('[sync] dedup notes fetch error:', currentNotes.error.message);
      if (currentBooks.error || currentConfigs.error || currentNotes.error) {
        return NextResponse.json(
          { error: 'Failed to fetch current data for dedup' },
          { status: 500 },
        );
      }
      return NextResponse.json(
        {
          books: currentBooks.data || [],
          configs: currentConfigs.data || [],
          notes: currentNotes.data || [],
          deduplicated: true,
        },
        { status: 200 },
      );
    }
  }

  // Transform records to DB format for the RPC call
  const transformRecords = (table: TableName, records: BookDataRecord[]) =>
    records.map((rec) => {
      const dbRec = transformsToDB[table](rec, user.id);
      // P9.9: Attach device_id for conflict diagnostics
      if (deviceId) {
        (dbRec as unknown as Record<string, unknown>).device_id = deviceId;
      }
      return dbRec;
    });

  try {
    // P9.4: Atomic sync via PostgreSQL RPC function.
    // Notes use set-union merge (P9.8): per-note upsert keyed on (book_hash, id).
    // - New notes from client → INSERT
    // - Matching notes → LWW on updated_at / deleted_at (tombstone wins)
    // - Server-only notes not in client payload → KEPT (never deleted)
    const dbBooks = transformRecords('books', books as BookDataRecord[]);
    const dbConfigs = transformRecords('book_configs', configs as BookDataRecord[]);
    const dbNotes = transformRecords('book_notes', notes as BookDataRecord[]);

    const { data: syncResult, error: syncError } = await supabase.rpc('sync_books_atomic', {
      p_user_id: user.id,
      p_books: dbBooks,
      p_configs: dbConfigs,
      p_notes: dbNotes,
      p_device_id: deviceId || null,
    });

    if (syncError) {
      throw syncError;
    }

    const resultBooks = syncResult?.books || [];
    const resultConfigs = syncResult?.configs || [];
    const resultNotes = syncResult?.notes || [];

    // Populate platform_books for synced books (supplementary, don't fail on errors)
    // Skip soft-deleted books — tombstones must survive for cross-device sync propagation
    if (resultBooks.length > 0) {
      const adminSupabase = createSupabaseAdminClient();

      for (const book of resultBooks) {
        if (!book.book_hash || book.deleted_at) continue;

        // P9.3: Use file_type column instead of ILIKE pattern matching
        const { data: fileRecord, error: fileError } = await adminSupabase
          .from('files')
          .select('*')
          .eq('user_id', user.id)
          .eq('book_hash', book.book_hash)
          .eq('file_type', 'book')
          .is('deleted_at', null)
          .limit(1)
          .single();

        if (fileError) {
          console.error(
            `[sync] requestId=${requestId || 'none'} file lookup failed for book_hash=${book.book_hash}:`,
            fileError.message,
          );
        }

        if (fileRecord) {
          const result = await upsertPlatformBook({
            hash: book.book_hash,
            metaHash: book.meta_hash || book.book_hash,
            title: book.title || 'Untitled',
            author: book.author || '',
            format: book.format || 'epub',
            sizeBytes: fileRecord.file_size,
            storagePath: fileRecord.file_key,
            userId: user.id,
          });
          if (!result.success) {
            console.error(
              `[sync] requestId=${requestId || 'none'} books upsert failed for book_hash=${book.book_hash}:`,
              result.error,
            );
          }
        }
      }
    }

    // Record that we processed this request for idempotency (graceful degradation)
    if (requestId) {
      try {
        const { error: insertError } = await supabase.from('processed_requests').insert({
          request_id: requestId,
          user_id: user.id,
          endpoint: '/api/sync',
        });
        if (insertError) {
          if (insertError.code === '42P01') {
            // Table may not exist yet -- skip idempotency recording
            console.error(
              `[sync] requestId=${requestId} processed_requests table unavailable, skipping idempotency recording`,
            );
          } else {
            console.error(
              `[sync] requestId=${requestId} failed to record processed request:`,
              insertError.message,
            );
          }
        }
      } catch (err: unknown) {
        if ((err as Record<string, unknown>)?.code === '42P01') {
          // Table may not exist yet — skip idempotency recording
          console.error(
            `[sync] requestId=${requestId} processed_requests table unavailable, skipping idempotency recording`,
          );
        } else {
          throw err;
        }
      }
    }

    // Settings sync: upsert roaming settings with LWW
    let resultSettings: Record<string, unknown> | null = null;
    if (incomingSettings && Object.keys(incomingSettings).length > 0) {
      try {
        // LWW: check existing updated_at before overwriting
        const { data: existing } = await supabase
          .from('user_settings')
          .select('settings, updated_at')
          .eq('user_id', user.id)
          .single();

        const incomingTime = (incomingSettings as Record<string, unknown>)._updatedAt as
          | string
          | undefined;
        const shouldUpdate =
          !existing ||
          !incomingTime ||
          new Date(incomingTime).getTime() > new Date(existing.updated_at).getTime();

        if (shouldUpdate) {
          // Merge incoming keys into existing settings (don't overwrite unrelated keys)
          const mergedSettings = {
            ...((existing?.settings as Record<string, unknown>) ?? {}),
            ...incomingSettings,
          };
          const { error: settingsError } = await supabase.from('user_settings').upsert({
            user_id: user.id,
            settings: mergedSettings,
            updated_at: incomingTime
              ? new Date(incomingTime).toISOString()
              : new Date().toISOString(),
            device_id: deviceId || null,
          });
          if (settingsError) {
            console.error('[sync] settings upsert failed:', settingsError.message);
          }
          resultSettings = mergedSettings;
        } else {
          // Existing settings are newer, return those from the first read
          resultSettings = existing.settings as Record<string, unknown>;
        }
      } catch (err) {
        console.error('[sync] settings sync failed:', err);
      }
    }

    // Hash-based book reconciliation: compare client inventory against server
    let reconcileResult: { upsert: typeof resultBooks; remove: string[] } | undefined;
    if (
      body.reconcile?.books &&
      typeof body.reconcile.books === 'object' &&
      !Array.isArray(body.reconcile.books)
    ) {
      const clientHashes = body.reconcile.books as Record<string, number>;

      const { data: serverBooks, error: serverErr } = await supabase
        .from('books')
        .select('*')
        .eq('user_id', user.id)
        .is('deleted_at', null);

      if (!serverErr && serverBooks) {
        const serverMap = new Map(serverBooks.map((b) => [b.book_hash, b]));
        const reconcileUpsert: typeof serverBooks = [];
        const reconcileRemove: string[] = [];

        // Server has but client doesn't, or server is newer
        for (const [hash, book] of serverMap) {
          const clientTime = clientHashes[hash];
          if (clientTime === undefined || new Date(book.updated_at).getTime() > clientTime) {
            reconcileUpsert.push(book);
          }
        }

        // Client has but server doesn't
        for (const hash of Object.keys(clientHashes)) {
          if (!serverMap.has(hash)) {
            reconcileRemove.push(hash);
          }
        }

        reconcileResult = { upsert: reconcileUpsert, remove: reconcileRemove };
      }
    }

    return NextResponse.json(
      {
        books: resultBooks,
        configs: resultConfigs,
        notes: resultNotes,
        ...(resultSettings ? { settings: resultSettings } : {}),
        ...(reconcileResult ? { reconcile: reconcileResult } : {}),
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error(`[sync] requestId=${requestId || 'none'} sync failed:`, error);
    // P9.2: Handle FK violations with clear error message
    const pgError = error as PostgrestError & { code?: string };
    if (pgError.code === '23503') {
      return NextResponse.json({ error: 'Invalid user reference' }, { status: 400 });
    }
    const errorMessage = pgError.message || 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

/**
 * DELETE /api/sync?book_hash=X
 * Hard-delete ALL server-side data including the books row: configs, notes, AI conversations, files metadata.
 * No tombstone needed — hash-based reconciliation handles cross-device propagation.
 */
export async function DELETE(req: NextRequest) {
  const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const bookHash = searchParams.get('book_hash');
  if (!bookHash) {
    return NextResponse.json({ error: 'Missing book_hash parameter' }, { status: 400 });
  }

  const supabase = createSupabaseClient(token);
  const errors: string[] = [];

  // Run independent deletions in parallel — hard-delete everything including the books row
  const [configResult, notesResult, filesResult, aiResult, bookResult] = await Promise.all([
    supabase.from('book_configs').delete().eq('user_id', user.id).eq('book_hash', bookHash),
    supabase.from('book_notes').delete().eq('user_id', user.id).eq('book_hash', bookHash),
    supabase.from('files').delete().eq('user_id', user.id).eq('book_hash', bookHash),
    // AI cleanup: fetch conversation IDs, then delete messages, then conversations (sequential)
    (async () => {
      const { data: conversations } = await supabase
        .from('ai_conversations')
        .select('id')
        .eq('user_id', user.id)
        .eq('book_hash', bookHash);
      if (!conversations?.length) return { error: null };
      const convIds = conversations.map((c) => c.id);
      const { error: msgErr } = await supabase
        .from('ai_messages')
        .delete()
        .eq('user_id', user.id)
        .in('conversation_id', convIds);
      if (msgErr) return { error: msgErr };
      return supabase
        .from('ai_conversations')
        .delete()
        .eq('user_id', user.id)
        .eq('book_hash', bookHash);
    })(),
    supabase.from('books').delete().eq('user_id', user.id).eq('book_hash', bookHash),
  ]);

  if (configResult.error) errors.push(`book_configs: ${configResult.error.message}`);
  if (notesResult.error) errors.push(`book_notes: ${notesResult.error.message}`);
  if (filesResult.error) errors.push(`files: ${filesResult.error.message}`);
  if (aiResult.error) errors.push(`ai: ${aiResult.error.message}`);
  if (bookResult.error) errors.push(`books: ${bookResult.error.message}`);

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join('; '), partial: true }, { status: 207 });
  }

  return NextResponse.json({ ok: true });
}

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!req.url) {
    return res.status(400).json({ error: 'Invalid request URL' });
  }

  const protocol = process.env['PROTOCOL'] || 'http';
  const host = process.env['HOST'] || 'localhost:3000';
  const url = new URL(req.url, `${protocol}://${host}`);

  await runMiddleware(req, res, corsAllMethods);

  try {
    let response: Response;

    if (req.method === 'GET') {
      const nextReq = new NextRequest(url.toString(), {
        headers: new Headers(req.headers as Record<string, string>),
        method: 'GET',
      });
      response = await GET(nextReq);
    } else if (req.method === 'POST') {
      const nextReq = new NextRequest(url.toString(), {
        headers: new Headers(req.headers as Record<string, string>),
        method: 'POST',
        body: JSON.stringify(req.body), // Ensure the body is a string
      });
      response = await POST(nextReq);
    } else if (req.method === 'DELETE') {
      const nextReq = new NextRequest(url.toString(), {
        headers: new Headers(req.headers as Record<string, string>),
        method: 'DELETE',
      });
      response = await DELETE(nextReq);
    } else {
      res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    res.status(response.status);

    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.send(buffer);
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export default handler;
