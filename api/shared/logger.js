// api/shared/logger.js
// Wraps Azure Function handlers with structured error logging
// Surfaces the actual error message in Application Insights instead of generic 500s

function wrapHandler(name, handler) {
  return async function(context, req) {
    const start = Date.now();
    try {
      await handler(context, req);
    } catch (err) {
      const duration = Date.now() - start;
      const details = {
        function:    name,
        method:      req.method,
        url:         req.url,
        duration_ms: duration,
        error:       err.message,
        stack:       err.stack,
        env_check: {
          KEY_VAULT_URL:         process.env.KEY_VAULT_URL        ? 'SET' : 'MISSING',
          SHAREPOINT_SITE_URL:   process.env.SHAREPOINT_SITE_URL  ? 'SET' : 'MISSING',
          SHAREPOINT_TENANT_ID:  process.env.SHAREPOINT_TENANT_ID ? 'SET' : 'MISSING',
          SHAREPOINT_CLIENT_ID:  process.env.SHAREPOINT_CLIENT_ID ? 'SET' : 'MISSING',
        }
      };
      context.log.error(`[${name}] UNHANDLED ERROR:`, JSON.stringify(details, null, 2));
      context.res = {
        status: 500,
        body: {
          error:    'An internal error occurred.',
          function: name,
          message:  err.message,   // visible in browser devtools for debugging
        }
      };
    }
  };
}

module.exports = { wrapHandler };
