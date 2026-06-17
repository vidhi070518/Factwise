try {
  const app = require('./server');
  module.exports = app;
} catch (err) {
  module.exports = (req, res) => {
    res.status(500).json({
      error: 'Failed to initialize server',
      message: err.message,
      stack: err.stack
    });
  };
}
