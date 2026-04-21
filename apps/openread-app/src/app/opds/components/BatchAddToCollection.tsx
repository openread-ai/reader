'use client';

import { useState } from 'react';
import { IoFolderOpen, IoAdd } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { useOPDSCollections } from '../hooks/useOPDSCollections';

interface BatchAddToCollectionProps {
  count: number;
  onAdd: (collectionId: string) => void;
}

/**
 * Compact batch-add control shown when publications are selected.
 *
 * Displays a dropdown to pick or create a collection, then fires
 * onAdd with the chosen collection ID.
 */
export function BatchAddToCollection({ count, onAdd }: BatchAddToCollectionProps) {
  const _ = useTranslation();
  const { collections, createCollection } = useOPDSCollections();
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const handleSelect = (collectionId: string) => {
    onAdd(collectionId);
    setIsOpen(false);
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    const col = createCollection(newName.trim());
    if (col) {
      onAdd(col.id);
    }
    setIsCreating(false);
    setNewName('');
    setIsOpen(false);
  };

  return (
    <div className='dropdown dropdown-bottom'>
      <button className='btn btn-primary btn-sm gap-1' onClick={() => setIsOpen(!isOpen)}>
        <IoFolderOpen className='h-4 w-4' />
        {_('Add')} {count} {_('to Collection')}
      </button>

      {isOpen && (
        <div className='dropdown-content bg-base-200 border-base-300 z-20 mt-1 w-64 rounded-lg border p-2 shadow-lg'>
          {collections.length > 0 && (
            <ul className='menu menu-sm max-h-48 overflow-auto'>
              {collections.map((collection) => (
                <li key={collection.id}>
                  <button onClick={() => handleSelect(collection.id)}>
                    <IoFolderOpen className='h-4 w-4' />
                    {collection.name}
                    <span className='text-base-content/60 ml-auto text-xs'>
                      {collection.bookHashes.length}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className='border-base-300 mt-1 border-t pt-1'>
            {isCreating ? (
              <div className='flex gap-1 p-1'>
                <input
                  type='text'
                  placeholder={_('Collection name')}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  className='input input-bordered input-xs flex-1'
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
                <button className='btn btn-primary btn-xs' onClick={handleCreate}>
                  {_('OK')}
                </button>
              </div>
            ) : (
              <button
                className='btn btn-ghost btn-sm w-full justify-start gap-1'
                onClick={() => setIsCreating(true)}
              >
                <IoAdd className='h-4 w-4' />
                {_('New Collection')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
