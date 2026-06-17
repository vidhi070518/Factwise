module.exports = (req, res) => {
  res.json({ ping: 'pong', time: new Date().toISOString() });
};
