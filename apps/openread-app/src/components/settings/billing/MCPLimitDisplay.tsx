'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/card';
import { Button } from '@/components/primitives/button';
import { useTranslation } from '@/hooks/useTranslation';
import { Terminal, ExternalLink } from 'lucide-react';

interface MCPLimitDisplayProps {
  /** Current requests used in the rate window. */
  used?: number;
  /** Max requests per minute. */
  limitPerMinute?: number;
}

const DEFAULT_MCP_LIMIT = 60;

export function MCPLimitDisplay({ used = 0, limitPerMinute }: MCPLimitDisplayProps) {
  const _ = useTranslation();
  const limit = limitPerMinute ?? DEFAULT_MCP_LIMIT;

  return (
    <Card>
      <CardHeader className='pb-3'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Terminal className='text-primary h-4 w-4' aria-hidden='true' />
            <CardTitle className='text-sm'>{_('MCP')}</CardTitle>
          </div>
          <Button variant='ghost' size='sm' className='h-7 text-xs' asChild>
            <a href='/settings/api-keys' aria-label={_('View MCP documentation')}>
              {_('View docs')}
              <ExternalLink className='ml-1 h-3 w-3' aria-hidden='true' />
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className='text-base-content text-sm font-medium'>
          {_('{{used}} / {{limit}} req/min', { used, limit })}
        </p>
        <p className='text-base-content/60 mt-1 text-xs'>{_('Rate limit for MCP tool calls')}</p>
      </CardContent>
    </Card>
  );
}
