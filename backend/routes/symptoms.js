const express = require('express');
const router = express.Router();
const { callGroq } = require('../utils/groqClient');

// ─── Rule-based fallback ──────────────────────────────────────────────────────
const FIRST_AID_RULES = {
  ICU_cardiac: [
    'Call 108 immediately if not already done',
    'Begin CPR if the person is unresponsive and not breathing normally — push hard and fast in the centre of the chest (100–120 compressions/min)',
    'Use an AED (defibrillator) if one is nearby — follow its voice instructions',
    'Loosen any tight clothing around the neck and chest',
    'Keep the person still and calm; do not give food or water'
  ],
  ICU_neuro: [
    'Call 108 immediately',
    'Do NOT give food, water, or any medication by mouth',
    'If unconscious but breathing, place in the recovery position (on their side)',
    'If having a seizure, clear the area of hard objects — do not restrain the person',
    'Note the time the symptoms started — paramedics will need this'
  ],
  ALS_trauma: [
    'Call 108 immediately',
    'Control any bleeding by applying firm, direct pressure with a clean cloth',
    'Do NOT move the person if a spinal or neck injury is suspected',
    'Keep the person warm and still; reassure them help is coming',
    'Do not remove any embedded objects from wounds'
  ],
  ALS_breathing: [
    'Call 108 immediately',
    'Help the person sit upright — this opens the airway and makes breathing easier',
    'If they have a prescribed inhaler (asthma), help them use it now',
    'Loosen tight clothing around the neck and chest',
    'If they stop breathing, begin rescue breathing if you are trained'
  ],
  ALS_general: [
    'Call 108 immediately',
    'Keep the person calm, still, and comfortable',
    'Do not give food or drink',
    'Monitor breathing and consciousness until the ambulance arrives',
    'Collect any medications or medical ID to hand to paramedics'
  ],
  BLS_general: [
    'Stay calm and keep the patient reassured',
    'Help them sit or lie in the most comfortable position',
    'Loosen any tight clothing',
    'Monitor their breathing and level of consciousness',
    'Have their medications and ID ready for the paramedics'
  ],
  NEONATAL: [
    'Keep the newborn warm — wrap in a clean blanket or clothing immediately',
    'Do not cut the umbilical cord — leave it for the paramedics',
    'Keep the baby skin-to-skin with the mother if possible',
    'If the baby is not breathing, gently rub their back; begin infant CPR if trained',
    'Do not give the newborn anything to eat or drink'
  ]
};

function ruleBasedAnalysis(bodyArea, symptoms, duration, ageRange) {
  const text = [bodyArea, ...symptoms].join(' ').toLowerCase();

  let ambulanceType = 'BLS';
  let severity = 'Medium';
  let firstAidKey = 'BLS_general';

  if (text.includes('cardiac') || text.includes('chest') || text.includes('heart') || text.includes('no pulse') || text.includes('cardiac arrest')) {
    ambulanceType = 'ICU'; severity = 'Critical'; firstAidKey = 'ICU_cardiac';
  } else if (text.includes('stroke') || text.includes('seizure') || text.includes('unconscious') || text.includes('unresponsive') || text.includes('not responding')) {
    ambulanceType = 'ICU'; severity = 'Critical'; firstAidKey = 'ICU_neuro';
  } else if (text.includes('trauma') || text.includes('accident') || text.includes('fracture') || text.includes('penetrating') || text.includes('bleeding')) {
    ambulanceType = 'ALS'; severity = 'High'; firstAidKey = 'ALS_trauma';
  } else if (text.includes('breathing') || text.includes('respiratory') || text.includes('asthma') || text.includes('choking') || text.includes('cannot breathe')) {
    ambulanceType = 'ALS'; severity = 'High'; firstAidKey = 'ALS_breathing';
  } else if (text.includes('neonatal') || text.includes('newborn') || ageRange?.includes('Newborn')) {
    ambulanceType = 'NEONATAL'; severity = 'Critical'; firstAidKey = 'NEONATAL';
  } else if (text.includes('pregnancy') || text.includes('labour') || text.includes('delivery')) {
    ambulanceType = 'ALS'; severity = 'High'; firstAidKey = 'ALS_general';
  } else if (text.includes('burn') || text.includes('poison') || text.includes('overdose')) {
    ambulanceType = 'ALS'; severity = 'High'; firstAidKey = 'ALS_general';
  }

  if ((ageRange?.includes('Newborn') || ageRange?.includes('Child')) && severity === 'Medium') severity = 'High';
  if (ageRange?.includes('Senior') && severity === 'Medium') severity = 'High';

  const recommendations = {
    ICU:      'Immediate ICU Ambulance Required',
    ALS:      'Advanced Life Support (ALS) Ambulance',
    BLS:      'Basic Life Support (BLS) Ambulance',
    NEONATAL: 'Neonatal Transport Unit Required'
  };

  // Personalize based on selected symptoms
  const symText = symptoms.slice(0, 2).join(' and ').toLowerCase();

  const reasons = {
    ICU:      `Symptoms including ${symText} may indicate a life-threatening emergency requiring critical care during transport. An ICU ambulance carries a physician-level paramedic, a defibrillator, ventilator, and full cardiac monitoring.`,
    ALS:      `Symptoms including ${symText} indicate a serious but potentially stabilisable condition. An ALS paramedic with IV medication capability, advanced airway management, and cardiac monitoring is on the way.`,
    BLS:      `Your reported symptoms can be assessed and managed with basic emergency care. A trained EMT is en route to evaluate you and ensure safe transport to the hospital.`,
    NEONATAL: `A specialised neonatal transport unit with an incubator, advanced monitoring, and a neonatal nurse is required for the safe transport of a critically ill newborn.`
  };

  const conditionSummaries = {
    ICU_cardiac:  `You may be experiencing a serious cardiac event. The symptoms you described — including ${symText} — can indicate a heart attack or cardiac arrest. Stay as still and calm as possible. Help is on the way.`,
    ICU_neuro:    `You may be experiencing a neurological emergency such as a stroke or seizure. Symptoms like ${symText} require immediate specialist care. Do not eat or drink anything. Try to note when symptoms started.`,
    ALS_trauma:   `You have reported a significant traumatic injury including ${symText}. Paramedics are en route with equipment to stabilise you. Avoid unnecessary movement, especially of the head and neck.`,
    ALS_breathing:`You are experiencing significant breathing difficulty, including ${symText}. Sit upright, loosen any tight clothing, and try to breathe slowly. An ALS paramedic with airway support equipment is coming.`,
    ALS_general:  `You have reported a serious medical condition. Based on your symptoms — ${symText} — an advanced paramedic team is on the way. Stay still, calm, and keep someone with you.`,
    BLS_general:  `You have reported a medical concern including ${symText}. An ambulance crew is on their way. Stay comfortable, keep someone with you, and follow the first aid steps below.`,
    NEONATAL:     `A neonatal emergency team is on the way. Keep the baby warm and skin-to-skin with the mother if possible. Do not cut the umbilical cord — leave that for the paramedics.`
  };

  return {
    ambulanceType,
    severity,
    recommendation:   recommendations[ambulanceType],
    reason:           reasons[ambulanceType],
    conditionSummary: conditionSummaries[firstAidKey] || conditionSummaries.BLS_general,
    firstAidTips:     FIRST_AID_RULES[firstAidKey]    || FIRST_AID_RULES.BLS_general
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────
router.post('/analyze', async (req, res) => {
  const { bodyArea, symptoms, duration, ageRange, specialty } = req.body;

  if (!(process.env.GROQ_API_KEY || '').trim()) {
    return res.json(ruleBasedAnalysis(bodyArea, symptoms, duration, ageRange));
  }

  const prompt = `You are an emergency medical triage AI. A patient describes their condition. Analyse it and respond with a JSON object.

Patient details:
- Affected area/system: ${bodyArea}
- Symptoms: ${symptoms.join(', ')}
- Duration: ${duration}
- Age range: ${ageRange}
- Medical specialty context: ${specialty || 'General'}

You must return ONLY a raw JSON object (no markdown, no code fences) with exactly these fields:

{
  "ambulanceType": "ALS",
  "severity": "High",
  "recommendation": "Advanced Life Support ambulance recommended",
  "reason": "2-3 sentences explaining why this ambulance type is needed, in plain non-medical language the patient can understand.",
  "conditionSummary": "1-2 sentences describing what is likely happening to the patient right now, in plain language. Be calm and reassuring.",
  "firstAidTips": [
    "Step 1 — specific, actionable first aid action",
    "Step 2 — next most important action",
    "Step 3 — another action",
    "Step 4 — another action",
    "Step 5 — final action or what to avoid"
  ]
}

Rules:
- ambulanceType must be one of: BLS, ALS, ICU, NEONATAL
- severity must be one of: Low, Medium, High, Critical
- firstAidTips must have exactly 4-5 items, each starting with the step number
- Use simple language — the reader may be panicking
- Do NOT give any advice that could cause harm
- Do NOT tell them to drive themselves to hospital`;

  try {
    const text = await callGroq(prompt, { maxOutputTokens: 512 });

    // Strip any accidental markdown fences
    const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const match  = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in response');

    const result = JSON.parse(match[0]);

    // Validate required fields
    const validTypes      = ['BLS', 'ALS', 'ICU', 'NEONATAL'];
    const validSeverities = ['Low', 'Medium', 'High', 'Critical'];
    if (!validTypes.includes(result.ambulanceType))      result.ambulanceType = 'ALS';
    if (!validSeverities.includes(result.severity))      result.severity      = 'High';
    if (!Array.isArray(result.firstAidTips))             result.firstAidTips  = [];
    if (!result.conditionSummary)                        result.conditionSummary = result.reason;

    res.json(result);
  } catch (err) {
    console.error('Groq analysis error, using fallback:', err.message);
    res.json(ruleBasedAnalysis(bodyArea, symptoms, duration, ageRange));
  }
});

module.exports = router;
