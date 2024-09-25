// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as express from "express";
import multer = require("multer");

const UPLOAD_SIZE_LIMIT_MB: number = parseInt(process.env.UPLOAD_SIZE_LIMIT_MB) || 200;

function getAttachUploadFileFunction(maxFileSizeMb: number): express.RequestHandler {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxFileSizeMb * 1048576,
    },
  }).any();
}

export function fileUploadMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const maxFileSizeMb = UPLOAD_SIZE_LIMIT_MB;
  const attachUploadFile: express.RequestHandler = getAttachUploadFileFunction(maxFileSizeMb);

  attachUploadFile(req, res, (err: any): void => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).send(`The uploaded file is larger than the size limit of ${maxFileSizeMb} megabytes.`);
      } else {
        next(err);
      }
    } else {
      next();
    }
  });
}

export function getFileWithField(req: Express.Request, field: string): Express.Multer.File {
  for (const i in req.files) {
    if (req.files[i].fieldname === field) {
      return req.files[i];
    }
  }

  return null;
}

export function createTempFileFromBuffer(buffer: Buffer): string {
  const tmpPath = require("os").tmpdir();
  const tmpFilePath = require("path").join(tmpPath, "tempfile");
  require("fs").writeFileSync(tmpFilePath, buffer);
  return tmpFilePath;
}
