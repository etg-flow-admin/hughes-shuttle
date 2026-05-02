// api/shared/logger.js
// Wraps Azure Function handlers with logging and request context for sandbox detection
const { requestContext } = require('./msLists');

function wrapHandler(name, fn) {
  return async function (context, req) {
    context.log.info(`[${name}] ${req.method} ${req.url}`);
    // Store request in AsyncLocalStorage so msLists can detect sandbox origin
    // without needing req passed through every function call
    return requestContext.run(req, () => fn(context, req));
  };
}

module.exports = { wrapHandler };
