'use strict';

const express = require('express');
const {readReports} = require('./minio-dr-report');
const {getCompositeStatus} = require('./minio-dr-composite-status');

function createMinioDrRouter(options = {}) {
  const router = express.Router();
  const directory = options.directory;

  if (typeof directory !== 'string' || !directory) {
    throw new Error('DR report directory required');
  }

  if (options.compositeRoot !== undefined) {
    if (typeof options.compositeRoot !== 'string' ||
        !require('node:path').isAbsolute(options.compositeRoot)) {
      throw new Error('Invalid composite root');
    }

    router.get('/composite', (_req, res) => {
      try {
        const status = getCompositeStatus(options.compositeRoot);
        return res.json({
          readOnly: true,
          ...status
        });
      } catch (_) {
        return res.status(503).json({
          status: 'unavailable',
          readOnly: true
        });
      }
    });
  }

  router.get('/status', async (_req, res) => {
    try {
      const reports = await readReports(directory);

      if (reports.length === 0) {
        return res.json({
          status: 'unavailable',
          readOnly: true,
          latest: null
        });
      }

      return res.json({
        status: reports[0].status,
        readOnly: true,
        latest: reports[0]
      });
    } catch (_err) {
      return res.status(503).json({
        status: 'unavailable',
        readOnly: true,
        error: 'DR reports unavailable'
      });
    }
  });

  router.get('/reports', async (_req, res) => {
    try {
      const reports = await readReports(directory);

      return res.json({
        readOnly: true,
        count: reports.length,
        reports
      });
    } catch (_err) {
      return res.status(503).json({
        readOnly: true,
        error: 'DR reports unavailable'
      });
    }
  });

  return router;
}

module.exports = {createMinioDrRouter};
