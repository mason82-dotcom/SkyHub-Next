'use strict';

// Strict read-side ListObjectsV2 contract. No AWS SDK, HTTP routes, IAM
// credential loading, uploads, writes or network calls are created here.
// An independently authorized caller must inject the listOnly function.
// Object keys remain private to the local aggregator, never the CLI/report.
const BUCKET = 'dji-cloud';
const PAGE_SIZE = 200;
const MAX_CURSOR_LENGTH = 4096;
const MAX_KEY_LENGTH = 1024;
const MAX_PREFIX_LENGTH = 512;

// Deliberately conservative literal prefix syntax. Explicitly rules out dot
// segments, Unicode confusables, percent escapes and URL-like names.
function validatePrefix(prefix) {
  if (typeof prefix !== 'string' ||
    prefix.length < 4 || prefix.length > MAX_PREFIX_LENGTH ||
    !/^(?:[A-Za-z0-9_-]+\/){2,}$/.test(prefix)) {
    throw new TypeError('Invalid scoped S3 prefix');
  }
  return prefix;
}

function createScopedListOnlyStorage({listOnly, allowedPrefix}={}) {
  if(typeof listOnly!=='function')throw new TypeError('List-only injection required');
  const scope=validatePrefix(allowedPrefix);
  async function objects(bucket,{prefix,limit=PAGE_SIZE,cursor}={}) {
    if(bucket!==BUCKET)throw new TypeError('Bucket not allowed');
    validatePrefix(prefix);
    if(!prefix.startsWith(scope))throw new TypeError('Prefix outside approved scope');
    if(!Number.isInteger(limit)||limit<1||limit>PAGE_SIZE ||
       (cursor!==undefined && (typeof cursor!=='string'||
         cursor.length===0||cursor.length>MAX_CURSOR_LENGTH ||
         /[\x00-\x1f\x7f]/.test(cursor)))) {
      throw new TypeError('Invalid S3 listing request');
    }

    // Only ListObjectsV2 is exposed. Force delimiter to constrain immediate
    // children; no GetObject, PutObject, DeleteObject or STS dependency.
    const raw=await listOnly({
      Bucket:BUCKET, Prefix:prefix, Delimiter:'/', MaxKeys:limit,
      ...(cursor!==undefined?{ContinuationToken:cursor}:{})
    });
    if(!raw || !Array.isArray(raw.Contents||[]) ||
        raw.Contents?.length>limit ||
        typeof raw.IsTruncated!=='boolean' ||
        (raw.IsTruncated && (typeof raw.NextContinuationToken!=='string' ||
          raw.NextContinuationToken.length===0 ||
          raw.NextContinuationToken.length>MAX_CURSOR_LENGTH))) {
      throw new Error('Invalid S3 list response');
    }
    // Whitelist only key identity for the *in-memory* inventory. Never pass
    // S3 object metadata (ETag, timestamps, signed URLs) into the report.
    const objects=(raw.Contents||[]).map(item=>{
      const key=item?.Key;
      if(typeof key!=='string'||key.length>MAX_KEY_LENGTH||
         !key.startsWith(prefix)||/[\x00-\x1f\x7f]/.test(key)) {
        throw new Error('Invalid scoped S3 object');
      }
      return {key};
    });
    return {
      objects,truncated:raw.IsTruncated,
      nextCursor:raw.IsTruncated?raw.NextContinuationToken:null
    };
  }
  return Object.freeze({objects});
}
module.exports={BUCKET,PAGE_SIZE,validatePrefix,createScopedListOnlyStorage};
