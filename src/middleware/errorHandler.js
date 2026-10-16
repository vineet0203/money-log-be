const crypto = require('crypto');
const { ZodError } = require('zod');

/**
 * Global Express Error Handling Middleware (§5.3)
 * Standardizes error shape across the entire API and prevents SQL/internal stack trace leakage.
 */
const errorHandler = (err, req, res, next) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID().slice(0, 8);

  // Log full stack trace server-side with request ID
  console.error(`[Error ${requestId}] ${req.method} ${req.originalUrl}:`, err);

  // 1. Zod Validation Errors
  if (err instanceof ZodError) {
    const issues = err.errors || err.issues || [];
    return res.status(400).json({
      error: 'Validation failed',
      requestId,
      details: issues.map(e => ({
        path: e.path ? e.path.join('.') : '',
        message: e.message
      }))
    });
  }

  // 2. Multer Upload Errors
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large. Maximum allowed size is 5MB.',
        requestId
      });
    }
    return res.status(400).json({
      error: `File upload error: ${err.message}`,
      requestId
    });
  }

  // 3. Body-parser JSON syntax error
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: 'Invalid JSON payload format',
      requestId
    });
  }

  // 4. Custom status-bearing application errors
  const statusCode = err.statusCode || err.status || 500;
  if (statusCode < 500) {
    return res.status(statusCode).json({
      error: err.message || 'Client error',
      requestId,
      details: err.details || undefined
    });
  }

  // 5. Unexpected Internal Server Errors (500)
  // Mask SQL errors, stack traces, and internal database details
  return res.status(500).json({
    error: 'An internal server error occurred. Please try again later.',
    requestId
  });
};

module.exports = errorHandler;
