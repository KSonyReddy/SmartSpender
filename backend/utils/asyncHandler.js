/**
 * Async handler to wrap API routes, allowing for async/await syntax without try/catch blocks
 * Errors are automatically passed to the express error handling middleware
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
