const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

/**
 * Single Storage Boundary (§7)
 * Centralizes all file writes, deletes, MIME validation, and URL construction.
 * Storing relative paths (uploads/<user_id>/<entity>/<uuid>.<ext>) enables instant future cloud migrations.
 */

// Supported MIME types and extensions
const ALLOWED_MIME_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/**
 * Configure Multer middleware for a specific entity type (e.g. 'receipts', 'avatars')
 * Uses per-user subdirectory: uploads/<userId>/<entityType>/
 */
const getUploadMiddleware = (entityType = 'receipts', maxMb = 5) => {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const userId = req.user?.id ? String(req.user.id) : 'common';
      const dirPath = path.join(process.cwd(), 'uploads', userId, entityType);
      
      try {
        fs.mkdirSync(dirPath, { recursive: true });
        cb(null, dirPath);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const ext = ALLOWED_MIME_TYPES[file.mimetype] || path.extname(file.originalname).toLowerCase() || '.jpg';
      const uniqueName = `${crypto.randomUUID()}${ext}`;
      cb(null, uniqueName);
    },
  });

  return multer({
    storage,
    limits: {
      fileSize: maxMb * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
      if (ALLOWED_MIME_TYPES[file.mimetype]) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and PDF files are allowed.'));
      }
    },
  });
};

/**
 * Compute the relative key to store in the DB (never store absolute URLs)
 * e.g., "uploads/12/receipts/550e8400-e29b-41d4-a716-446655440000.jpg"
 */
const getRelativeKey = (req, file, entityType = 'receipts') => {
  if (!file) return null;
  const userId = req.user?.id ? String(req.user.id) : 'common';
  return `uploads/${userId}/${entityType}/${file.filename}`;
};

/**
 * Safely delete a file from disk given its relative DB key or relative URL
 */
const deleteFile = (relativeKeyOrUrl) => {
  if (!relativeKeyOrUrl) return;

  try {
    // Extract everything starting from 'uploads/'
    let relativePath = relativeKeyOrUrl;
    if (relativePath.includes('/uploads/')) {
      relativePath = 'uploads/' + relativePath.split('/uploads/')[1];
    } else if (relativePath.startsWith('/uploads/')) {
      relativePath = relativePath.slice(1);
    }

    const fullPath = path.resolve(process.cwd(), relativePath);

    // Guard against path traversal outside the uploads directory
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    if (!fullPath.startsWith(uploadsDir)) {
      console.warn(`[Storage] Blocked attempted path traversal: ${relativePath}`);
      return;
    }

    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (err) {
    // Log without throwing, preserving database transaction outcome
    console.error(`[Storage] Failed to delete file: ${relativeKeyOrUrl}`, err);
  }
};

/**
 * Build absolute public URL dynamically at response time
 */
const buildPublicUrl = (req, relativeKey) => {
  if (!relativeKey) return null;
  if (relativeKey.startsWith('http://') || relativeKey.startsWith('https://')) {
    return relativeKey;
  }
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const cleanKey = relativeKey.startsWith('/') ? relativeKey.slice(1) : relativeKey;
  return `${baseUrl}/${cleanKey}`;
};

module.exports = {
  getUploadMiddleware,
  getRelativeKey,
  deleteFile,
  buildPublicUrl,
};
