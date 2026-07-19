/**
 * Google Drive export via a service account. Requires
 * GOOGLE_SERVICE_ACCOUNT_JSON (path to the key file) and DRIVE_FOLDER_ID.
 */
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';
import type { MediaType } from '@pothole/shared';
import { config } from '../config';
import { collectAcceptedExportItems } from './exporter';

export function driveConfigured(): boolean {
  return Boolean(config.googleServiceAccountJson && config.driveFolderId && fs.existsSync(config.googleServiceAccountJson));
}

function driveClient(): drive_v3.Drive {
  const auth = new google.auth.GoogleAuth({
    keyFile: config.googleServiceAccountJson,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

async function createFolder(drive: drive_v3.Drive, name: string, parentId: string): Promise<string> {
  const res = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
    supportsAllDrives: true,
  });
  return res.data.id as string;
}

async function uploadFile(
  drive: drive_v3.Drive,
  parentId: string,
  name: string,
  body: NodeJS.ReadableStream,
  mimeType: string,
): Promise<void> {
  await drive.files.create({
    requestBody: { name, parents: [parentId] },
    media: { mimeType, body },
    fields: 'id',
    supportsAllDrives: true,
  });
}

export async function exportAcceptedToDrive(
  mediaType: MediaType | 'all',
): Promise<{ folderId: string; folderLink: string; samples: number }> {
  const drive = driveClient();
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const rootId = await createFolder(drive, `pothole-export-${stamp}`, config.driveFolderId);

  const subfolderIds = new Map<string, string>(); // "photos/<id>" -> folderId
  const typeFolderIds = new Map<string, string>(); // "photos" | "videos" -> folderId

  const items = await collectAcceptedExportItems(mediaType);
  for (const item of items) {
    const [typeDir, sampleId] = item.dir.replace(/\/$/, '').split('/');
    let typeFolderId = typeFolderIds.get(typeDir);
    if (!typeFolderId) {
      typeFolderId = await createFolder(drive, typeDir, rootId);
      typeFolderIds.set(typeDir, typeFolderId);
    }
    let sampleFolderId = subfolderIds.get(item.dir);
    if (!sampleFolderId) {
      sampleFolderId = await createFolder(drive, sampleId, typeFolderId);
      subfolderIds.set(item.dir, sampleFolderId);
    }
    if (item.mediaAbsPath) {
      await uploadFile(
        drive,
        sampleFolderId,
        item.mediaFileName,
        fs.createReadStream(item.mediaAbsPath),
        'application/octet-stream',
      );
    }
    for (const jf of item.jsonFiles) {
      await uploadFile(drive, sampleFolderId, jf.name, Readable.from([jf.content]), 'application/json');
    }
  }

  return {
    folderId: rootId,
    folderLink: `https://drive.google.com/drive/folders/${rootId}`,
    samples: items.length,
  };
}
