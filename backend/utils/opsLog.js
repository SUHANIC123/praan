const DispatchLog = require('../models/DispatchLog');
const HospitalActivity = require('../models/HospitalActivity');

async function logDispatch({ incidentId, eventType, message = '', actor = 'system', meta = {} }) {
  try {
    await DispatchLog.create({
      incidentId,
      eventType,
      message,
      actor,
      meta
    });
  } catch (e) {
    console.warn('DispatchLog:', e.message);
  }
}

async function logHospital({ incidentId, hospitalId, eventType, message = '', payload = {} }) {
  try {
    await HospitalActivity.create({
      incidentId,
      hospitalId,
      eventType,
      message,
      payload
    });
  } catch (e) {
    console.warn('HospitalActivity:', e.message);
  }
}

module.exports = { logDispatch, logHospital };
