// TODO(FIX-20-23): Migrate this Pages Router handler to App Router (app/api/user/delete/route.ts)
import type { NextApiRequest, NextApiResponse } from 'next';
import { corsAllMethods, runMiddleware } from '@/utils/cors';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { deleteObject } from '@/utils/object';
import { createLogger } from '@/utils/logger';
import { getErrorMessage } from '@/utils/error';
import { getStripe } from '@/libs/payment/stripe/server';

const logger = createLogger('user');

/** Timeout for Stripe API calls during account deletion */
const STRIPE_TIMEOUT_MS = 10_000;
/** Timeout for R2 object deletions during account deletion */
const R2_TIMEOUT_MS = 30_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await runMiddleware(req, res, corsAllMethods);

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user, token } = await validateUserAndToken(req.headers['authorization']);
    if (!user || !token) {
      return res.status(403).json({ error: 'Not authenticated' });
    }

    const supabaseAdmin = createSupabaseAdminClient();

    // Cancel active Stripe subscriptions before deletion
    try {
      const { data: subscriptions, error: subsError } = await supabaseAdmin
        .from('subscriptions')
        .select('stripe_subscription_id, status')
        .eq('user_id', user.id)
        .in('status', ['active', 'trialing']);

      if (subsError) {
        logger.error('Failed to query subscriptions for Stripe cancellation', {
          userId: user.id,
          error: subsError.message,
        });
        // Continue — don't block deletion; Stripe webhooks will eventually reconcile
      }

      if (subscriptions?.length) {
        const stripe = getStripe();
        const stripeTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Stripe cancellation timed out')), STRIPE_TIMEOUT_MS),
        );
        const results = await Promise.race([
          Promise.allSettled(
            subscriptions.map((sub) => stripe.subscriptions.cancel(sub.stripe_subscription_id)),
          ),
          stripeTimeout,
        ]);
        const failures = results.filter((r) => r.status === 'rejected');
        if (failures.length > 0) {
          logger.error('Some Stripe subscription cancellations failed', {
            userId: user.id,
            total: subscriptions.length,
            failedCount: failures.length,
            errors: failures.map((r) =>
              r.status === 'rejected' ? ((r.reason as Error)?.message ?? 'Unknown') : '',
            ),
          });
        }
      }
    } catch (error) {
      logger.error('Failed to cancel Stripe subscriptions', { userId: user.id, error });
      // Don't block deletion — Stripe webhooks will eventually reconcile
    }

    // Revoke IAP entitlements (can't cancel server-side, only revoke in DB)
    try {
      await Promise.all([
        supabaseAdmin
          .from('apple_iap_subscriptions')
          .update({ status: 'canceled' })
          .eq('user_id', user.id)
          .in('status', ['active', 'trialing']),
        supabaseAdmin
          .from('google_iap_subscriptions')
          .update({ status: 'canceled' })
          .eq('user_id', user.id)
          .in('status', ['active', 'trialing']),
      ]);
    } catch (error) {
      logger.error('Failed to revoke IAP entitlements', { userId: user.id, error });
      // Don't block deletion — IAP status is reconciled via store server notifications
    }

    // P12.2: Clean up R2 storage BEFORE deleteUser() because cascade removes the DB rows we need
    try {
      const { data: fileRecords, error: filesError } = await supabaseAdmin
        .from('files')
        .select('file_key')
        .eq('user_id', user.id);

      if (filesError) {
        logger.error('Failed to query user files for R2 cleanup', {
          userId: user.id,
          error: filesError.message,
        });
      }

      const fileKeys = (fileRecords || [])
        .map((r) => r.file_key)
        .filter((key): key is string => typeof key === 'string' && key.length > 0);

      if (fileKeys.length > 0) {
        logger.info('Deleting R2 objects for user', {
          userId: user.id,
          fileCount: fileKeys.length,
        });

        const r2Timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('R2 deletion timed out')), R2_TIMEOUT_MS),
        );
        const r2Results = await Promise.race([
          Promise.allSettled(fileKeys.map((key) => deleteObject(key))),
          r2Timeout,
        ]);

        const r2Failures = r2Results.filter((r) => r.status === 'rejected');
        if (r2Failures.length > 0) {
          logger.error('Some R2 deletions failed during account deletion', {
            userId: user.id,
            totalFiles: fileKeys.length,
            failedCount: r2Failures.length,
            errors: r2Failures.map((r) =>
              r.status === 'rejected' ? ((r.reason as Error)?.message ?? 'Unknown error') : '',
            ),
          });
        } else {
          logger.info('All R2 objects deleted successfully', {
            userId: user.id,
            deletedCount: fileKeys.length,
          });
        }
      }
    } catch (error) {
      logger.error('R2 cleanup failed during account deletion', { userId: user.id, error });
      // Non-blocking: proceed with account deletion even if R2 cleanup fails
    }

    // Delete user (cascades to all related tables via ON DELETE CASCADE constraints)
    const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Verify cascade deletion completed successfully
    // Check a sampling of tables to ensure data was deleted
    const verificationChecks = await Promise.all([
      // Core content tables
      supabaseAdmin
        .from('books')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabaseAdmin
        .from('book_configs')
        .select('user_id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabaseAdmin
        .from('book_notes')
        .select('user_id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabaseAdmin
        .from('files')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabaseAdmin
        .from('platform_tokens')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),

      // E10 AI/usage tables
      supabaseAdmin
        .from('usage_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabaseAdmin
        .from('user_provider_keys')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabaseAdmin
        .from('ai_conversations')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabaseAdmin
        .from('ai_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),

      // E18 billing tables
      supabaseAdmin
        .from('storage_addons')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabaseAdmin
        .from('boost_purchases')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
    ]);

    // Check if any tables still have data for this user
    const TABLE_NAMES = [
      'books',
      'book_configs',
      'book_notes',
      'files',
      'platform_tokens',
      'usage_logs',
      'user_provider_keys',
      'ai_conversations',
      'ai_messages',
      'storage_addons',
      'boost_purchases',
    ] as const;

    // FIX-20-07: Check for query-level errors in verification results
    const verificationErrors = verificationChecks
      .map((result, i) => ({ table: TABLE_NAMES[i], error: result.error }))
      .filter((entry) => entry.error != null);

    if (verificationErrors.length > 0) {
      logger.warn('Cascade verification inconclusive — some queries failed', {
        userId: user.id,
        failedTables: verificationErrors.map((e) => ({
          table: e.table,
          error: e.error?.message ?? 'Unknown',
        })),
      });
      // Don't return 500 — the user was already deleted successfully.
      // Log the warning and return success.
      return res.status(200).json({ message: 'User deleted successfully' });
    }

    // Map table names BEFORE filtering so indices stay aligned
    const orphanedTables = verificationChecks
      .map((result, i) => ({ table: TABLE_NAMES[i], count: result.count ?? 0 }))
      .filter((entry) => entry.count > 0);

    if (orphanedTables.length > 0) {
      logger.error('Cascade deletion incomplete', {
        userId: user.id,
        orphanedTables,
      });
      return res.status(500).json({
        error: 'User deletion completed but cascade cleanup verification failed',
      });
    }

    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    logger.error('Account deletion failed', {
      error: getErrorMessage(error),
      // userId may not be available if the error occurred during auth validation
      context: 'DELETE /api/user/delete',
    });
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
