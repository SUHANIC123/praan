function calculateBilling(ambulanceType, distanceKm) {
  const rates = {
    BLS:      { base: 100, distancePerKm: 6,  emergency: 25, paramedicFee: 0   },
    ALS:      { base: 150, distancePerKm: 8,  emergency: 45, paramedicFee: 120 },
    ICU:      { base: 250, distancePerKm: 12, emergency: 80, paramedicFee: 200 },
    NEONATAL: { base: 300, distancePerKm: 15, emergency: 100, paramedicFee: 250 }
  };
  const r = rates[ambulanceType] || rates.BLS;
  const baseFare           = r.base;
  const distanceFare       = parseFloat((distanceKm * r.distancePerKm).toFixed(2));
  const emergencySurcharge = r.emergency;
  const paramedicFee       = r.paramedicFee;
  const subtotal           = baseFare + distanceFare + emergencySurcharge + paramedicFee;
  const taxRate            = 0.05;
  const tax                = parseFloat((subtotal * taxRate).toFixed(2));
  const total              = parseFloat((subtotal + tax).toFixed(2));
  return { baseFare, distanceFare, emergencySurcharge, paramedicFee, subtotal, tax, taxRate, total, distanceKm, currency: 'USD' };
}

module.exports = { calculateBilling };
