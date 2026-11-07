'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  inventoryM3MFromS3,
  validatePrefix
} = require('../m3m-s3-inventory');

const PREFIX = 'missions/flight-001/';
const CAPTURE = 'DJI_20261021190530_0001';

const FILES = [
  `${CAPTURE}_D.JPG`,
  ...['G', 'R', 'RE', 'NIR'].map(
    band => `${CAPTURE}_MS_${band}.TIF`
  )
];

function page(names, truncated = false, nextCursor = null) {
  return {
    objects: names.map(name => ({
      key: PREFIX + name
    })),
    truncated,
    nextCursor
  };
}

test('complete M3M set across two S3 pages', async () => {
  const calls = [];

  const storage = {
    async objects(bucket, options) {
      calls.push({ bucket, options });

      if (!options.cursor) {
        return page(FILES.slice(0, 2), true, 'next');
      }

      return page(FILES.slice(2));
    }
  };

  const report = await inventoryM3MFromS3(storage, PREFIX);

  assert.equal(report.totalEntries, 5);
  assert.equal(report.fiveChannelSets, 1);
  assert.equal(report.spectralSets, 1);
  assert.equal(report.ndviReady, false);
  assert.equal(calls.length, 2);

  for (const call of calls) {
    assert.equal(call.bucket, 'dji-cloud');
    assert.equal(call.options.prefix, PREFIX);
    assert.equal(call.options.limit, 200);
  }

  assert.doesNotMatch(
    JSON.stringify(report),
    /missions|flight-001|20261021190530/
  );
});

test('nested directory objects are not classified', async () => {
  const storage = {
    async objects() {
      return page([
        FILES[0],
        `nested/${FILES[1]}`,
        FILES[2]
      ]);
    }
  };

  const report = await inventoryM3MFromS3(storage, PREFIX);

  assert.equal(report.totalEntries, 2);
  assert.equal(report.fiveChannelSets, 0);
});

test('invalid prefixes fail before S3 access', async () => {
  const storage = {
    async objects() {
      throw new Error('S3 must not be called');
    }
  };

  for (const prefix of [
    '',
    '/',
    '../secret/',
    'missions/../secret/',
    'missions//flight/',
    '/missions/flight/',
    'missions\\flight/',
    'missions/flight',
    'missions/\nsecret/'
  ]) {
    assert.throws(() => validatePrefix(prefix), {
      status: 400
    });

    await assert.rejects(
      inventoryM3MFromS3(storage, prefix),
      { status: 400 }
    );
  }
});

test('repeated continuation tokens fail closed with distinct page keys', async () => {
  let calls = 0;
  const storage = {
    async objects() {
      calls++;
      return page([FILES[calls - 1]], true, 'same-token');
    }
  };

  await assert.rejects(
    inventoryM3MFromS3(storage, PREFIX),
    /Invalid S3 inventory pagination/
  );
  assert.equal(calls, 2);
});

test('repeated S3 object keys across pages fail closed', async () => {
  let calls = 0;
  const storage = {
    async objects() {
      calls++;
      return calls === 1 ?
        page([FILES[0]], true, 'next-page') :
        page([FILES[0], FILES[1]]);
    }
  };

  await assert.rejects(
    inventoryM3MFromS3(storage, PREFIX),
    /Duplicate S3 inventory object key/
  );
  assert.equal(calls, 2);
});

test('repeated nested S3 object keys also fail closed', async () => {
  let calls = 0;
  const storage = {
    async objects() {
      calls++;
      return calls === 1 ?
        page(['nested/repeated.jpg'], true, 'next-page') :
        page(['nested/repeated.jpg']);
    }
  };

  await assert.rejects(
    inventoryM3MFromS3(storage, PREFIX),
    /Duplicate S3 inventory object key/
  );
});

test('control-character and oversized S3 keys fail closed', async () => {
  for (const name of ['bad\\nkey.jpg'.replace('\\n','\n'), 'x'.repeat(1025)]) {
    await assert.rejects(
      inventoryM3MFromS3({
        objects: async () => page([name])
      }, PREFIX),
      /Invalid S3 inventory object/
    );
  }
});

test('malformed S3 results fail closed', async () => {
  for (const result of [
    null,
    {},
    { objects: [], truncated: 'false' },
    {
      objects: [{ key: 'other-bucket/private.jpg' }],
      truncated: false
    }
  ]) {
    await assert.rejects(
      inventoryM3MFromS3({
        objects: async () => result
      }, PREFIX)
    );
  }
});

test('inventory does not expose S3 object keys', async () => {
  const storage = {
    async objects() {
      return page([
        FILES[0],
        'SECRET_DEVICE_SERIAL.txt',
        'PRIVATE_COORDINATES.json'
      ]);
    }
  };

  const report = await inventoryM3MFromS3(storage, PREFIX);
  const serialized = JSON.stringify(report);

  assert.equal(report.totalEntries, 3);
  assert.doesNotMatch(
    serialized,
    /SECRET|PRIVATE|missions|flight-001/
  );
});

test('more than 20000 direct entries are rejected', async () => {
  let calls = 0;

  const storage = {
    async objects() {
      calls++;
      return {
        objects: Array.from({ length: 200 }, (_, index) => ({
          key: `${PREFIX}unknown-${calls}-${index}.jpg`
        })),
        truncated: true,
        nextCursor: `page-${calls}`
      };
    }
  };

  await assert.rejects(
    inventoryM3MFromS3(storage, PREFIX),
    { status: 413 }
  );

  assert.equal(calls, 101);
});

test('pagination cannot silently finish without a valid response', async () => {
  const storage = {
    async objects() {
      return {
        objects: [],
        truncated: true,
        nextCursor: null
      };
    }
  };

  await assert.rejects(
    inventoryM3MFromS3(storage, PREFIX),
    /Invalid S3 inventory pagination/
  );
});

test('S3 failures propagate without generating partial reports', async () => {
  let calls = 0;

  const storage = {
    async objects() {
      calls++;

      if (calls === 1) {
        return page([FILES[0]], true, 'second');
      }

      throw new Error('Simulated S3 failure');
    }
  };

  await assert.rejects(
    inventoryM3MFromS3(storage, PREFIX),
    /Simulated S3 failure/
  );

  assert.equal(calls, 2);
});

test('empty S3 inventory produces zero counts', async () => {
  const report = await inventoryM3MFromS3({
    objects: async () => ({
      objects: [],
      truncated: false,
      nextCursor: null
    })
  }, PREFIX);

  assert.equal(report.totalEntries, 0);
  assert.equal(report.captureGroups, 0);
  assert.equal(report.fiveChannelSets, 0);
  assert.equal(report.ndviReady, false);
});

test('nested objects do not count as direct entries', async () => {
  const storage = {
    objects: async () => ({
      objects: Array.from({ length: 200 }, (_, i) => ({
        key: `${PREFIX}nested/file-${i}.jpg`
      })),
      truncated: false,
      nextCursor: null
    })
  };

  const report = await inventoryM3MFromS3(storage, PREFIX);

  assert.equal(report.totalEntries, 0);
  assert.equal(report.classified, 0);
});

test('truncated S3 response requires continuation token', async () => {
  const storage = {
    objects: async () => ({
      objects: [{
        key: PREFIX + FILES[0]
      }],
      truncated: true,
      nextCursor: ''
    })
  };

  await assert.rejects(
    inventoryM3MFromS3(storage, PREFIX),
    /Invalid S3 inventory pagination/
  );
});
