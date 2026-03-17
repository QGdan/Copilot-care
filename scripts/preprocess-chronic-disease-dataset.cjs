#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    inputDir: path.resolve('data/raw/chronic_disease_dataset'),
    outputDir: path.resolve('data/processed/chronic_disease_dataset'),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--input-dir' && argv[i + 1]) {
      args.inputDir = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--output-dir' && argv[i + 1]) {
      args.outputDir = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
  }
  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function readCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }
  const header = parseCsvLine(lines[0]).map((item) =>
    item.replace(/^\uFEFF/, '').trim(),
  );
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j += 1) {
      row[header[j]] = (cells[j] ?? '').trim();
    }
    rows.push(row);
  }
  return rows;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function toBoolean(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function mapSex(gender) {
  if (gender === '1') {
    return 'male';
  }
  if (gender === '2') {
    return 'female';
  }
  return 'other';
}

function parseYearMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return undefined;
  }
  if (month < 1 || month > 12) {
    return undefined;
  }
  return { year, month };
}

function parseVisitDateTime(value) {
  if (!value || typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.includes('T')
    ? value
    : value.trim().replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date;
}

function computeAge(birthYearMonth, visitDate) {
  const birth = parseYearMonth(birthYearMonth);
  if (!birth || !visitDate) {
    return 60;
  }
  const visitYear = visitDate.getUTCFullYear();
  const visitMonth = visitDate.getUTCMonth() + 1;
  let age = visitYear - birth.year;
  if (visitMonth < birth.month) {
    age -= 1;
  }
  if (!Number.isFinite(age) || age < 0) {
    return 60;
  }
  return Math.min(120, Math.max(0, age));
}

function splitBySeparators(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  return [...new Set(
    text
      .split(/[;；,，、。|]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )];
}

function normalizeSymptoms(chiefComplaint) {
  const parts = splitBySeparators(chiefComplaint);
  if (parts.length > 0) {
    return parts.slice(0, 6);
  }
  if (chiefComplaint && chiefComplaint.trim()) {
    return [chiefComplaint.trim()];
  }
  return ['常规慢病复诊'];
}

function normalizeLifestyleTags(patient) {
  const tags = [];
  if (patient.smoking_status === '3') {
    tags.push('smoking');
  }
  if (patient.alcohol_status === '3') {
    tags.push('alcohol');
  }
  if (patient.BMI) {
    const bmi = toNumber(patient.BMI);
    if (typeof bmi === 'number' && bmi >= 28) {
      tags.push('obesity');
    } else if (typeof bmi === 'number' && bmi >= 24) {
      tags.push('overweight');
    }
  }
  return tags;
}

function normalizeChronicDiseases(patient, visitDiagnoses) {
  const values = new Set();
  if (toBoolean(patient.has_hypertension)) {
    values.add('Hypertension');
  }
  if (toBoolean(patient.has_diabetes)) {
    values.add('Diabetes');
  }
  if (toBoolean(patient.has_heart_disease)) {
    values.add('Heart Disease');
  }
  for (const diagnosis of visitDiagnoses) {
    if (diagnosis.primary_name) {
      values.add(diagnosis.primary_name);
    }
    for (const secondaryName of splitBySeparators(diagnosis.secondary_names)) {
      values.add(secondaryName);
    }
  }
  if (values.size === 0) {
    values.add('Chronic Disease Followup');
  }
  return [...values].slice(0, 12);
}

function createGrouping(records, keyField) {
  const map = new Map();
  for (const row of records) {
    const key = row[keyField];
    if (!key) {
      continue;
    }
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      map.set(key, [row]);
    }
  }
  return map;
}

function pickMostRecentByDate(records, dateField) {
  if (!Array.isArray(records) || records.length === 0) {
    return undefined;
  }
  return [...records].sort((left, right) => {
    const leftDate = parseVisitDateTime(left[dateField] ?? left.test_date ?? left.followup_date);
    const rightDate = parseVisitDateTime(right[dateField] ?? right.test_date ?? right.followup_date);
    return (rightDate?.getTime() ?? 0) - (leftDate?.getTime() ?? 0);
  })[0];
}

function toIsoDateTime(input) {
  const parsed = parseVisitDateTime(input);
  if (!parsed) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function stableBucket(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
}

function writeNdjson(filePath, records) {
  const lines = records.map((item) => JSON.stringify(item));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function summarizeMissing(records, field) {
  let missing = 0;
  for (const row of records) {
    if (!row[field] || String(row[field]).trim() === '') {
      missing += 1;
    }
  }
  return missing;
}

function main() {
  const args = parseArgs(process.argv);
  const csvDir = path.join(args.inputDir, 'csv');

  if (!fs.existsSync(csvDir)) {
    throw new Error(`input csv directory not found: ${csvDir}`);
  }

  ensureDir(args.outputDir);

  const patientRows = readCsv(path.join(csvDir, 'patient.csv'));
  const visitRows = readCsv(path.join(csvDir, 'visit.csv'));
  const labRows = readCsv(path.join(csvDir, 'lab_result.csv'));
  const diagnosisRows = readCsv(path.join(csvDir, 'diagnosis.csv'));
  const medicationRows = readCsv(path.join(csvDir, 'medication.csv'));
  const followupRows = readCsv(path.join(csvDir, 'followup.csv'));

  const patientById = new Map(patientRows.map((item) => [item.patient_id, item]));
  const labsByVisit = createGrouping(labRows, 'visit_id');
  const diagnosesByVisit = createGrouping(diagnosisRows, 'visit_id');
  const medicationsByVisit = createGrouping(medicationRows, 'visit_id');
  const medicationsByPatient = createGrouping(medicationRows, 'patient_id');
  const followupsByVisit = createGrouping(followupRows, 'visit_id');

  const triageRequests = [];
  const evaluationCases = [];

  let missingPatientRef = 0;
  let invalidVitalsCount = 0;
  let missingComplaintCount = 0;

  for (const visit of visitRows) {
    const patient = patientById.get(visit.patient_id);
    if (!patient) {
      missingPatientRef += 1;
      continue;
    }

    const visitDate = parseVisitDateTime(visit.visit_datetime);
    const age = computeAge(patient.birth_year_month, visitDate);
    const visitDiagnoses = diagnosesByVisit.get(visit.visit_id) ?? [];
    const visitLabs = labsByVisit.get(visit.visit_id) ?? [];
    const visitMeds = medicationsByVisit.get(visit.visit_id) ?? [];
    const visitFollowups = followupsByVisit.get(visit.visit_id) ?? [];
    const recentLab = pickMostRecentByDate(visitLabs, 'test_date');
    const recentFollowup = pickMostRecentByDate(visitFollowups, 'followup_date');

    const systolicBP = toNumber(visit.systolic_bp);
    const diastolicBP = toNumber(visit.diastolic_bp);
    const heartRate = toNumber(visit.heart_rate);
    if (
      typeof systolicBP === 'number'
      && typeof diastolicBP === 'number'
      && systolicBP <= diastolicBP
    ) {
      invalidVitalsCount += 1;
    }

    const chiefComplaint = (visit.chief_complaint ?? '').trim();
    if (!chiefComplaint) {
      missingComplaintCount += 1;
    }

    const medRowsForProfile =
      visitMeds.length > 0
        ? visitMeds
        : (medicationsByPatient.get(visit.patient_id) ?? []).slice(0, 6);
    const medicationHistory = [...new Set(
      medRowsForProfile
        .map((item) => item.drug_name?.trim())
        .filter((item) => !!item),
    )];

    const chronicDiseases = normalizeChronicDiseases(patient, visitDiagnoses);

    const signalTimestamp = toIsoDateTime(visit.visit_datetime);
    const requestId = `cds_${visit.visit_id}`;

    const triageRequest = {
      requestId,
      sessionId: requestId,
      contextVersion: 'dataset.chronic.v1',
      consentToken: 'consent_local_demo',
      symptomText: chiefComplaint || '慢病复诊评估',
      profile: {
        patientId: visit.patient_id,
        age,
        sex: mapSex(patient.gender),
        chiefComplaint: chiefComplaint || '慢病复诊评估',
        symptoms: normalizeSymptoms(chiefComplaint),
        chronicDiseases,
        medicationHistory,
        lifestyleTags: normalizeLifestyleTags(patient),
        vitals: {
          systolicBP,
          diastolicBP,
          heartRate,
          bloodGlucose: toNumber(recentLab?.fasting_glucose_mmol_L),
          bloodLipid: toNumber(recentLab?.ldl_cholesterol_mmol_L),
        },
      },
      signals: [
        {
          timestamp: signalTimestamp,
          source: 'hospital',
          systolicBP,
          diastolicBP,
          heartRate,
          bloodGlucose: toNumber(recentLab?.fasting_glucose_mmol_L),
          bloodLipid: toNumber(recentLab?.ldl_cholesterol_mmol_L),
        },
        ...(recentFollowup
          ? [
            {
              timestamp: toIsoDateTime(recentFollowup.followup_date),
              source: 'manual',
              systolicBP: toNumber(recentFollowup.followup_systolic),
              diastolicBP: toNumber(recentFollowup.followup_diastolic),
              heartRate: toNumber(recentFollowup.followup_heart_rate),
            },
          ]
          : []),
      ],
    };
    triageRequests.push(triageRequest);

    const primaryDiagnosis = visitDiagnoses[0]
      ? {
        icd10: visitDiagnoses[0].primary_icd10 || '',
        name: visitDiagnoses[0].primary_name || '',
      }
      : undefined;
    const isRedFlagSuggested =
      (typeof systolicBP === 'number' && systolicBP >= 180)
      || (typeof diastolicBP === 'number' && diastolicBP >= 120)
      || ['3', '4', '6'].includes(String(visit.visit_type ?? ''));

    evaluationCases.push({
      caseId: `eval_${visit.visit_id}`,
      requestId,
      patientId: visit.patient_id,
      visitId: visit.visit_id,
      visitDateTime: signalTimestamp,
      expected: {
        diseaseFlags: {
          hasHypertension: toBoolean(patient.has_hypertension),
          hasDiabetes: toBoolean(patient.has_diabetes),
          hasHeartDisease: toBoolean(patient.has_heart_disease),
        },
        primaryDiagnosis,
        secondaryDiagnoses: visitDiagnoses.flatMap((row) =>
          splitBySeparators(row.secondary_names),
        ),
        riskHints: {
          redFlagSuggested: isRedFlagSuggested,
          bpStageHint:
            typeof systolicBP === 'number' && typeof diastolicBP === 'number'
              ? `${systolicBP}/${diastolicBP}`
              : undefined,
        },
      },
      evidence: {
        chiefComplaint: chiefComplaint || undefined,
        fastingGlucose: toNumber(recentLab?.fasting_glucose_mmol_L),
        hba1cPercent: toNumber(recentLab?.hba1c_percent),
        medications: medicationHistory.slice(0, 8),
        followupCount: visitFollowups.length,
      },
    });
  }

  const split = {
    train: [],
    dev: [],
    test: [],
  };
  for (const request of triageRequests) {
    const bucket = stableBucket(request.profile.patientId);
    if (bucket < 70) {
      split.train.push(request);
    } else if (bucket < 85) {
      split.dev.push(request);
    } else {
      split.test.push(request);
    }
  }

  writeNdjson(path.join(args.outputDir, 'triage_requests.ndjson'), triageRequests);
  writeNdjson(path.join(args.outputDir, 'triage_requests.train.ndjson'), split.train);
  writeNdjson(path.join(args.outputDir, 'triage_requests.dev.ndjson'), split.dev);
  writeNdjson(path.join(args.outputDir, 'triage_requests.test.ndjson'), split.test);
  writeNdjson(path.join(args.outputDir, 'evaluation_cases.ndjson'), evaluationCases);

  const qualityReport = {
    generatedAt: new Date().toISOString(),
    source: {
      inputDir: args.inputDir,
      csvRowCounts: {
        patient: patientRows.length,
        visit: visitRows.length,
        labResult: labRows.length,
        diagnosis: diagnosisRows.length,
        medication: medicationRows.length,
        followup: followupRows.length,
      },
    },
    output: {
      outputDir: args.outputDir,
      triageRequests: triageRequests.length,
      evaluationCases: evaluationCases.length,
      split: {
        train: split.train.length,
        dev: split.dev.length,
        test: split.test.length,
      },
    },
    dataQuality: {
      missingPatientRef,
      missingChiefComplaint: missingComplaintCount,
      invalidVitalsCount,
      missingRates: {
        visitChiefComplaint: Number(
          (summarizeMissing(visitRows, 'chief_complaint') / Math.max(1, visitRows.length)).toFixed(6),
        ),
        visitSystolicBp: Number(
          (summarizeMissing(visitRows, 'systolic_bp') / Math.max(1, visitRows.length)).toFixed(6),
        ),
        labFastingGlucose: Number(
          (summarizeMissing(labRows, 'fasting_glucose_mmol_L') / Math.max(1, labRows.length)).toFixed(6),
        ),
      },
    },
  };
  fs.writeFileSync(
    path.join(args.outputDir, 'quality_report.json'),
    `${JSON.stringify(qualityReport, null, 2)}\n`,
    'utf8',
  );

  const usageReadme = [
    '# chronic_disease_dataset 预处理产物',
    '',
    `- 生成时间: ${qualityReport.generatedAt}`,
    `- TriageRequest 样本: ${triageRequests.length}`,
    `- Evaluation 样本: ${evaluationCases.length}`,
    `- 切分: train=${split.train.length}, dev=${split.dev.length}, test=${split.test.length}`,
    '',
    '## 文件说明',
    '',
    '- `triage_requests.ndjson`: 可直接用于 `/orchestrate_triage` 批量回放',
    '- `triage_requests.train.ndjson` / `dev` / `test`: 按患者稳定切分',
    '- `evaluation_cases.ndjson`: 包含期望诊断/风险提示，用于真实性与复杂性评测',
    '- `quality_report.json`: 行数、缺失率、异常值等预处理质量报告',
    '',
    '## 运行命令',
    '',
    '```bash',
    'npm run dataset:preprocess:chronic',
    '```',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(args.outputDir, 'README.md'), usageReadme, 'utf8');

  console.log('[chronic-preprocess] completed');
  console.log(JSON.stringify({
    outputDir: args.outputDir,
    triageRequests: triageRequests.length,
    evaluationCases: evaluationCases.length,
    split: {
      train: split.train.length,
      dev: split.dev.length,
      test: split.test.length,
    },
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error('[chronic-preprocess] failed');
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}

