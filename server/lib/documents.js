import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function removeTemporaryFile(file) {
  if (file?.path) await fs.unlink(file.path).catch(() => {});
}

export async function storeProjectDocument({
  db,
  dataDir,
  documentsDir,
  project,
  type,
  file,
  userId,
}) {
  const projectDir = path.join(documentsDir, String(project.id));
  await fs.mkdir(projectDir, { recursive: true });

  const previousVersion = db.prepare(`
    SELECT COALESCE(MAX(version), 0) AS version
    FROM project_documents
    WHERE project_id = ? AND tipo = ?
  `).get(project.id, type).version;
  const version = previousVersion + 1;
  const destination = path.join(
    projectDir,
    `${type}-v${version}-${crypto.randomUUID()}.pdf`,
  );
  await fs.rename(file.path, destination);
  const relativePath = path.relative(dataDir, destination);

  db.transaction(() => {
    db.prepare(`
      UPDATE project_documents
      SET is_current = 0
      WHERE project_id = ? AND tipo = ?
    `).run(project.id, type);

    db.prepare(`
      INSERT INTO project_documents (
        project_id, tipo, version, original_name, storage_path,
        mime_type, size, uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id,
      type,
      version,
      file.originalname,
      relativePath,
      file.mimetype,
      file.size,
      userId,
    );

    const column = type === 'recurso' ? 'resource_path' : 'planilla_path';
    db.prepare(`
      UPDATE projects
      SET ${column} = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(relativePath, project.id);
  })();

  return {
    type,
    version,
    originalName: file.originalname,
    storagePath: relativePath,
  };
}

export function currentDocument(db, projectId, type) {
  return db.prepare(`
    SELECT *
    FROM project_documents
    WHERE project_id = ? AND tipo = ? AND is_current = 1
    ORDER BY version DESC
    LIMIT 1
  `).get(projectId, type);
}

export function sendPrivateDocument({ response, document, dataDir, download }) {
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(document.original_name)}"`,
  );
  response.sendFile(path.join(dataDir, document.storage_path));
}