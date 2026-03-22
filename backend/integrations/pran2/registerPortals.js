/**
 * One-line integration for server.js:
 *   require('./integrations/pran2/registerPortals')(app);
 */
module.exports = function registerPran2Portals(app) {
  app.use('/api/portal', require('./portalRoutes'));
};
