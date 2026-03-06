import { Request, Response, Router } from 'express';
import { HealthSignal, PatientProfile } from '@copilot-care/shared/types';
import { resolveBackendExposurePolicy } from '../../config/runtimePolicy';

interface MockPatientData {
  profilePatch: Partial<PatientProfile>;
  signals: HealthSignal[];
  insights: string[];
}

const mockPatientDatabase: Record<string, MockPatientData> = {
  'patient-001': {
    profilePatch: {
      age: 56,
      sex: 'male',
      name: 'Zhang San',
      chiefComplaint: 'Dizziness and elevated blood pressure',
      chronicDiseases: ['Hypertension', 'Hyperlipidemia'],
      medicationHistory: ['Amlodipine 5mg', 'Atorvastatin 20mg'],
      lifestyleTags: ['Smoking cessation', 'Moderate exercise'],
      tcmConstitution: 'Qi deficiency',
    },
    signals: [
      {
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        source: 'wearable',
        systolicBP: 148,
        diastolicBP: 95,
        heartRate: 76,
      },
      {
        timestamp: new Date(Date.now() - 172800000).toISOString(),
        source: 'wearable',
        systolicBP: 152,
        diastolicBP: 98,
        heartRate: 78,
      },
    ],
    insights: [
      'Recent blood pressure remained in the 148-152 mmHg range.',
      'Medication adherence should be reviewed.',
      'Lifestyle intervention can be intensified if tolerated.',
    ],
  },
  'patient-002': {
    profilePatch: {
      age: 49,
      sex: 'female',
      name: 'Li Si',
      chiefComplaint: 'Polyuria, polydipsia, and weight loss',
      chronicDiseases: ['Prediabetes', 'Obesity'],
      medicationHistory: ['Metformin 500mg'],
      lifestyleTags: ['Diet control', 'Scheduled exercise'],
      tcmConstitution: 'Phlegm dampness',
    },
    signals: [
      {
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        source: 'wearable',
        bloodGlucose: 6.8,
        heartRate: 72,
      },
      {
        timestamp: new Date(Date.now() - 172800000).toISOString(),
        source: 'hospital',
        bloodGlucose: 7.2,
      },
    ],
    insights: [
      'Fasting glucose has remained between 6.8 and 7.2 mmol/L.',
      'HbA1c follow-up is recommended.',
      'Complication screening should be planned if symptoms persist.',
    ],
  },
};

function normalizeBearerToken(request: Request): string {
  const headerValue = request.header('authorization');
  if (typeof headerValue !== 'string') {
    return '';
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return '';
  }
  return match[1].trim();
}

export function createMcpRouter(
  env: NodeJS.ProcessEnv = process.env,
): Router {
  const router = Router();
  const policy = resolveBackendExposurePolicy(env);

  router.use((request: Request, response: Response, next) => {
    if (!policy.mcpEnabled) {
      response.status(404).json({
        error: 'mcp_disabled',
        message: 'MCP mock endpoints are disabled in this environment.',
      });
      return;
    }

    if (policy.isProduction && !policy.mcpApiKey) {
      response.status(503).json({
        error: 'mcp_misconfigured',
        message: 'MCP route is not configured for production access.',
      });
      return;
    }

    if (policy.mcpApiKey) {
      const bearerToken = normalizeBearerToken(request);
      if (bearerToken !== policy.mcpApiKey) {
        response.status(401).json({
          error: 'unauthorized',
          message: 'Authorization bearer token required for MCP access.',
        });
        return;
      }
    }

    next();
  });

  router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      mode: 'mock',
      endpoints: [
        'POST /mcp/patient/context',
        'GET /mcp/patient/:id',
        'GET /mcp/patient/:id/signals',
        'GET /mcp/patient/:id/insights',
      ],
    });
  });

  router.post('/patient/context', (req: Request, res: Response) => {
    const { profile, consentToken } = req.body;

    if (!profile?.patientId) {
      res.status(400).json({
        error: 'missing_patient_id',
        message: 'Patient ID is required.',
      });
      return;
    }

    if (!consentToken) {
      res.status(401).json({
        error: 'missing_consent',
        message: 'Consent token is required for MCP access.',
      });
      return;
    }

    const mockData = mockPatientDatabase[profile.patientId];

    if (!mockData) {
      res.status(200).json({
        profilePatch: {},
        signals: [],
        insights: ['No cloud patient data found for this identifier.'],
      });
      return;
    }

    res.status(200).json(mockData);
  });

  router.get('/patient/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const mockData = mockPatientDatabase[id];

    if (!mockData) {
      res.status(404).json({
        error: 'not_found',
        message: `Patient ${id} not found.`,
      });
      return;
    }

    res.status(200).json({
      patientId: id,
      ...mockData.profilePatch,
    });
  });

  router.get('/patient/:id/signals', (req: Request, res: Response) => {
    const { id } = req.params;
    const mockData = mockPatientDatabase[id];

    if (!mockData) {
      res.status(404).json({
        error: 'not_found',
        message: `Patient ${id} not found.`,
      });
      return;
    }

    res.status(200).json({
      resourceType: 'Bundle',
      type: 'searchset',
      total: mockData.signals.length,
      entry: mockData.signals.map((signal) => ({ resource: signal })),
    });
  });

  router.get('/patient/:id/insights', (req: Request, res: Response) => {
    const { id } = req.params;
    const mockData = mockPatientDatabase[id];

    if (!mockData) {
      res.status(404).json({
        error: 'not_found',
        message: `Patient ${id} not found.`,
      });
      return;
    }

    res.status(200).json({
      patientId: id,
      insights: mockData.insights,
      generatedAt: new Date().toISOString(),
    });
  });

  return router;
}
