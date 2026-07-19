/**
 * Google Drive export via a service account. Requires
 * GOOGLE_SERVICE_ACCOUNT_JSON (path to the key file) and DRIVE_FOLDER_ID.
 * Uploads a bundle ('training' | 'raw') built by the exporter into a dated
 * subfolder, preserving the bundle's folder structure. Media is read through
 * the storage driver (local or S3).
 */
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';
import { config } from '../config';
import { buildBundle, type BundleName } from './exporter';
import { openMediaStream } from './storage';

export function driveConfigured(): boolean {
  return Boolean(
    config.googleServiceAccountJson &&
      config.driveFolderId &&
      fs.existsSync(config.googleServiceAccountJson),
  );
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

export async function exportBundleToDrive(
  bundle: BundleName,
): Promise<{ folderId: string; folderLink: string; files: number; skipped: number }> {
  const drive = driveClient();
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const rootId = await createFolder(drive, `pothole-${bundle}-${stamp}`, config.driveFolderId);

  // path ("images", "labels/coco", ...) -> folder id; '' = root
  const folderIds = new Map<string, string>([['', rootId]]);
  const ensureFolder = async (dirPath: string): Promise<string> => {
    const existing = folderIds.get(dirPath);
    if (existing) return existing;
    const parts = dirPath.split('/');
    const parentId = await ensureFolder(parts.slice(0, -1).join('/'));
    const id = await createFolder(drive, parts[parts.length - 1], parentId);
    folderIds.set(dirPath, id);
    return id;
  };

  const files = await buildBundle(bundle);
  let uploaded = 0;
  let skipped = 0;
  for (const file of files) {
    const slash = file.name.lastIndexOf('/');
    const dirPath = slash === -1 ? '' : file.name.slice(0, slash);
    const baseName = slash === -1 ? file.name : file.name.slice(slash + 1);
    const parentId = await ensureFolder(dirPath);

    if (file.kind === 'text') {
      const mime = baseName.endsWith('.json') ? 'application/json' : 'text/plain';
      await uploadFile(drive, parentId, baseName, Readable.from([file.content]), mime);
      uploaded += 1;
    } else {
      const media = await openMediaStream(file.relPath, file.storedOn);
      if (!media?.stream) {
        skipped += 1;
        continue;
      }
      await uploadFile(drive, parentId, baseName, media.stream, 'application/octet-stream');
      uploaded += 1;
    }
  }

  return {
    folderId: rootId,
    folderLink: `https://drive.google.com/drive/folders/${rootId}`,
    files: uploaded,
    skipped,
  };
}
