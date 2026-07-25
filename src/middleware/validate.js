const { ZodError } = require('zod');

const validate = (schema) => (req, res, next) => {
  try {
    schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    next();
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.errors || error.issues || [];
      return res.status(400).json({
        error: 'Validation failed',
        details: issues.map(e => ({
          path: e.path ? e.path.join('.') : '',
          message: e.message
        }))
      });
    }
    next(error);
  }
};

module.exports = validate;
