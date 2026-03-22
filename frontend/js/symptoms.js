/* ============================================================
   SYMPTOM CHECKER — Multi-step chatbot with AI analysis
   ============================================================ */

// Symptom chips per body area
const SYMPTOM_CHIPS = {
  'Chest / Heart': [
    'Chest pain / pressure', 'Rapid/irregular heartbeat', 'Shortness of breath',
    'Pain radiating to arm/jaw', 'Sweating / cold clammy skin', 'Dizziness / faintness',
    'No pulse', 'Loss of consciousness'
  ],
  'Head / Brain': [
    'Sudden severe headache', 'Confusion / disorientation', 'One-sided weakness or numbness',
    'Slurred speech', 'Vision problems', 'Seizure / convulsion',
    'Unresponsive', 'Loss of memory'
  ],
  'Breathing': [
    'Cannot breathe / stopped breathing', 'Severe wheezing', 'Rapid shallow breathing',
    'Choking / blocked airway', 'Blue lips or fingertips', 'Coughing up blood',
    'Difficulty speaking full sentences', 'Chest tightness'
  ],
  'Injury / Trauma': [
    'High-speed collision', 'Fall from height', 'Penetrating wound', 'Head / neck injury',
    'Suspected spinal injury', 'Severe bone fracture', 'Heavy bleeding',
    'Multiple injuries'
  ],
  'Pregnancy / Birth': [
    'Active labour', 'Crowning / imminent delivery', 'Heavy bleeding',
    'Severe abdominal pain', 'Fit / seizure (eclampsia)', 'No fetal movement',
    'Water has broken', 'Less than 37 weeks pregnant'
  ],
  'Child Emergency': [
    'Child unresponsive', 'Febrile seizure (convulsion with fever)', 'Difficulty breathing',
    'Severe allergic reaction', 'Choking', 'High fever (> 40°C)',
    'Severe injury', 'Suspected poisoning'
  ],
  'Unconscious / Unresponsive': [
    'Not breathing', 'No pulse', 'Eyes rolled back',
    'Not responding to voice / pain', 'Gasping only', 'Collapsed suddenly',
    'Drug/alcohol overdose', 'Diabetic coma'
  ],
  'Burns / Poisoning': [
    'Large area burned', 'Chemical burn', 'Electrical burn',
    'Inhalation injury', 'Drug overdose', 'Household chemical ingestion',
    'Pesticide exposure', 'Carbon monoxide exposure'
  ]
};

let selectedArea     = null;
let selectedSpecialty = null;
let aiResult          = null;

function openSymptomChecker() {
  // Reset state
  selectedArea = null; selectedSpecialty = null; aiResult = null;
  document.querySelectorAll('.area-card').forEach(c => c.classList.remove('selected'));
  const summaryBox  = document.getElementById('conditionSummaryBox');
  const firstAidBox = document.getElementById('firstAidBox');
  if (summaryBox)  summaryBox.style.display  = 'none';
  if (firstAidBox) firstAidBox.style.display = 'none';
  const step1Btn = document.getElementById('step1NextBtn');
  if (step1Btn) step1Btn.disabled = true;
  goStep(1);
  document.getElementById('symptomModal').classList.add('open');
}

function closeSymptomChecker() {
  document.getElementById('symptomModal').classList.remove('open');
}

function goStep(n) {
  document.querySelectorAll('.symptom-step').forEach((el, i) => {
    el.classList.toggle('active', i + 1 === n);
  });
  for (let i = 1; i <= 3; i++) {
    const pip = document.getElementById(`pip${i}`);
    if (pip) pip.classList.toggle('done', i <= n);
  }
}

function selectArea(card) {
  document.querySelectorAll('.area-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  selectedArea     = card.dataset.area;
  selectedSpecialty = card.dataset.specialty;
  document.getElementById('step1NextBtn').disabled = false;
}

// Single-select chip group (age)
function toggleSingleChip(chip, groupId) {
  document.querySelectorAll(`#${groupId} .chip`).forEach(c => c.classList.remove('selected'));
  chip.classList.add('selected');
}

function getSelectedChips(containerId) {
  return [...document.querySelectorAll(`#${containerId} .chip.selected`)].map(c => c.dataset.val || c.textContent.trim());
}

function buildSymptomChips(area) {
  const chips = SYMPTOM_CHIPS[area] || [];
  const container = document.getElementById('symptomChips');
  container.innerHTML = chips.map(s =>
    `<div class="chip" data-val="${s}" onclick="this.classList.toggle('selected')">${s}</div>`
  ).join('');
}

// Step 1 → Step 2
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('step1NextBtn')?.addEventListener('click', () => {
    buildSymptomChips(selectedArea);
    goStep(2);
  });

  document.getElementById('openSymptomBtn')?.addEventListener('click', openSymptomChecker);
  document.getElementById('closeSymptomModal')?.addEventListener('click', closeSymptomChecker);
  document.getElementById('symptomModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSymptomChecker();
  });
});

async function analyzeSymptoms() {
  const symptoms  = getSelectedChips('symptomChips');
  const ageRange  = getSelectedChips('ageChips')[0] || 'Adult (18-60 yr)';
  const duration  = document.getElementById('symptomDuration')?.value || 'just now';

  if (symptoms.length === 0) {
    showToast('Please select at least one symptom', '', 2000);
    return;
  }

  // Show step 3 loading state
  goStep(3);
  document.getElementById('aiResultBox').classList.add('loading');
  document.getElementById('ai-recommendation').textContent = 'Analysing your symptoms...';
  document.getElementById('ai-reason').textContent = 'Please wait, AI is processing.';
  document.getElementById('ai-severity-badge').textContent = '...';
  document.getElementById('ai-amb-type').textContent = '';

  // Animate loading text
  const btn = document.getElementById('step2NextBtn');
  if (btn) {
    document.getElementById('analyse-text').style.display = 'none';
    document.getElementById('analyse-spinner').style.display = 'inline-block';
  }

  try {
    const result = await apiFetch('/symptoms/analyze', {
      method: 'POST',
      body: JSON.stringify({
        bodyArea:  selectedArea,
        symptoms,
        duration,
        ageRange,
        specialty: selectedSpecialty
      })
    });

    aiResult = result;

    // ── Ambulance recommendation box ──
    document.getElementById('aiResultBox').classList.remove('loading');
    document.getElementById('aiResultBox').style.background = '';

    const severityColors = { Critical: 'badge-critical', High: 'badge-high', Medium: 'badge-medium', Low: 'badge-low' };
    const badge = document.getElementById('ai-severity-badge');
    badge.textContent = result.severity;
    badge.className = `result-badge ${severityColors[result.severity] || 'badge-high'}`;

    const typeLabels = { BLS: 'Basic Life Support', ALS: 'Advanced Life Support', ICU: 'Mobile ICU', NEONATAL: 'Neonatal Unit' };
    document.getElementById('ai-amb-type').textContent = typeLabels[result.ambulanceType] || result.ambulanceType;
    document.getElementById('ai-recommendation').textContent = result.recommendation;
    document.getElementById('ai-reason').textContent = result.reason;

    // ── Condition summary ──
    if (result.conditionSummary) {
      document.getElementById('conditionSummaryBox').style.display = 'block';
      document.getElementById('ai-condition-summary').textContent = result.conditionSummary;
    }

    // ── First aid tips ──
    if (result.firstAidTips && result.firstAidTips.length > 0) {
      document.getElementById('firstAidBox').style.display = 'block';
      document.getElementById('ai-first-aid-list').innerHTML = result.firstAidTips
        .map(tip => {
          // Strip leading "Step N — " or "1. " if AI included it
          const clean = tip.replace(/^(step\s*\d+\s*[—\-–:\.]\s*|\d+\.\s*)/i, '').trim();
          return `<li>${clean}</li>`;
        })
        .join('');
    }

    // Set up apply button
    document.getElementById('applyRecommendationBtn').onclick = () => applyRecommendation(result);

  } catch (err) {
    document.getElementById('ai-recommendation').textContent = 'Analysis failed';
    document.getElementById('ai-reason').textContent = err.message + '. Please select manually or call 108.';
    showToast('AI analysis failed, using rule-based fallback', 'error', 3000);
  } finally {
    if (btn) {
      document.getElementById('analyse-text').style.display = '';
      document.getElementById('analyse-spinner').style.display = 'none';
    }
  }
}

function applyRecommendation(result) {
  // Apply to home form fields
  const ambTypeEl = document.getElementById('ambulanceType');
  const severityEl = document.getElementById('severity');
  const caseTypeEl = document.getElementById('caseType');

  if (ambTypeEl) ambTypeEl.value = result.ambulanceType;
  if (severityEl) severityEl.value = result.severity;

  // Try to match caseType dropdown based on area/specialty
  if (caseTypeEl && selectedSpecialty) {
    const options = [...caseTypeEl.options];
    const match = options.find(o => o.value.includes(selectedSpecialty));
    if (match) caseTypeEl.value = match.value;
  }

  closeSymptomChecker();
  showToast(`Applied: ${result.ambulanceType} ambulance, ${result.severity} severity`, 'success', 3000);
}
