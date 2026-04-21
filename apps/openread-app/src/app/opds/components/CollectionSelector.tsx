'use client';

import { useState, useMemo } from 'react';
import { IoAdd } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import type { OPDSPublication } from '../types';
import { useOPDSCollections } from '../hooks/useOPDSCollections';

interface CollectionSelectorProps {
  publication: OPDSPublication;
  onSelect: (collectionId: string | null) => void;
  selectedId?: string | null;
}

/**
 * Collection picker for the OPDS download flow.
 *
 * Shows existing collections, indicates which ones already contain
 * the publication, and allows creating new collections inline.
 */
export function CollectionSelector({ publication, onSelect, selectedId }: CollectionSelectorProps) {
  const _ = useTranslation();
  const { collections, getCollectionsFor, findExistingBook, createCollection } =
    useOPDSCollections();
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const existingBook = useMemo(
    () => findExistingBook(publication),
    [findExistingBook, publication],
  );

  const inCollections = useMemo(
    () => (existingBook ? getCollectionsFor(existingBook.hash) : []),
    [existingBook, getCollectionsFor],
  );

  const handleCreate = () => {
    if (!newName.trim()) return;
    const col = createCollection(newName.trim());
    if (col) {
      onSelect(col.id);
    }
    setIsCreating(false);
    setNewName('');
  };

  return (
    <div className='space-y-3'>
      <label className='text-base-content/70 text-sm font-medium'>
        {_('Add to Collection')} ({_('optional')})
      </label>

      {/* Existing book indicator */}
      {inCollections.length > 0 && (
        <div className='flex flex-wrap gap-1'>
          <span className='text-base-content/60 text-xs'>{_('Already in')}:</span>
          {inCollections.map((c) => (
            <span key={c.id} className='badge badge-sm badge-outline'>
              {c.name}
            </span>
          ))}
        </div>
      )}

      {/* Collection select */}
      <select
        className='select select-bordered select-sm w-full'
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value || null)}
      >
        <option value=''>{_('No collection (library only)')}</option>
        {collections.map((collection) => {
          const alreadyIn = inCollections.some((c) => c.id === collection.id);
          return (
            <option key={collection.id} value={collection.id} disabled={alreadyIn}>
              {collection.name}
              {alreadyIn ? ` (${_('already added')})` : ''}
            </option>
          );
        })}
      </select>

      {/* New collection button/input */}
      {isCreating ? (
        <div className='flex gap-2'>
          <input
            type='text'
            placeholder={_('Collection name')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className='input input-bordered input-sm flex-1'
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <button className='btn btn-primary btn-sm' onClick={handleCreate}>
            {_('Create')}
          </button>
          <button
            className='btn btn-ghost btn-sm'
            onClick={() => {
              setIsCreating(false);
              setNewName('');
            }}
          >
            {_('Cancel')}
          </button>
        </div>
      ) : (
        <button className='btn btn-ghost btn-sm gap-1' onClick={() => setIsCreating(true)}>
          <IoAdd className='h-4 w-4' />
          {_('New Collection')}
        </button>
      )}
    </div>
  );
}
