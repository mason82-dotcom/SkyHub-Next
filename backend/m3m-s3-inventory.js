'use strict';

const path = require('node:path');
const {
  inventoryMediaNames,
  MAX_ENTRIES
} = require('./m3m-media-inventory');

const PAGE_SIZE = 200;
const MAX_PAGES = 101;

function validatePrefix(prefix) {
  if (
    typeof prefix !== 'string' ||
    prefix.length < 2 ||
    prefix.length > 512 ||
    !prefix.endsWith('/') ||
    prefix.startsWith('/') ||
    prefix.includes('\\') ||
    /[\x00-\x1f\x7f]/.test(prefix)
  ) {
    const error = new Error('Invalid inventory prefix');
    error.status = 400;
    throw error;
  }

  const segments = prefix.slice(0, -1).split('/');
  if (segments.some(segment =>
    !segment ||
    segment === '.' ||
    segment === '..'
  )) {
    const error = new Error('Invalid inventory prefix');
    error.status = 400;
    throw error;
  }
}

async function inventoryM3MFromS3(storage, prefix) {
  validatePrefix(prefix);

  const names = [];
  const seenCursors = new Set();
  const seenKeys = new Set();
  let cursor;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await storage.objects('dji-cloud', {
      prefix,
      limit: PAGE_SIZE,
      ...(cursor ? { cursor } : {})
    });

    if (
      !result ||
      !Array.isArray(result.objects) ||
      result.objects.length > PAGE_SIZE ||
      typeof result.truncated !== 'boolean'
    ) {
      throw new Error('Invalid S3 inventory response');
    }

    for (const object of result.objects) {
      const key = object && object.key;

      if (
        typeof key !== 'string' ||
        key.length > 1024 ||
        !key.startsWith(prefix) ||
        /[\x00-\x1f\x7f]/.test(key)
      ) {
        throw new Error('Invalid S3 inventory object');
      }
      // Pagination can repeat keys if the source changes during a scan.
      // Reject the entire report rather than counting a capture twice.
      if (seenKeys.has(key)) {
        throw new Error('Duplicate S3 inventory object key');
      }
      seenKeys.add(key);

      // Only direct children of the requested directory.
      const relative = key.slice(prefix.length);

      if (!relative || relative.includes('/')) {
        continue;
      }

      names.push(path.posix.basename(relative));

      if (names.length > MAX_ENTRIES) {
        const error = new Error('Inventory entry limit exceeded');
        error.status = 413;
        throw error;
      }
    }

    if (!result.truncated) {
      return inventoryMediaNames(names);
    }

    const next = result.nextCursor;

    if (
      typeof next !== 'string' ||
      !next ||
      next.length > 4096 ||
      next === cursor ||
      seenCursors.has(next)
    ) {
      throw new Error('Invalid S3 inventory pagination');
    }

    seenCursors.add(next);
    cursor = next;
  }

  const error = new Error('Inventory page limit exceeded');
  error.status = 413;
  throw error;
}

module.exports = {
  inventoryM3MFromS3,
  validatePrefix
};
