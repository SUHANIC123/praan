/* eslint-disable no-unused-vars */
(function (global) {
  var api = 'http://localhost:3001';
  var socket = 'http://localhost:3001';
  global.PORTAL_API_ORIGIN = api;
  global.PORTAL_SOCKET_ORIGIN = socket;
})(typeof window !== 'undefined' ? window : this);
