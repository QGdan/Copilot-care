import { CardiologyAgent } from '../../agents/CardiologyAgent';
import { GPAgent } from '../../agents/GPAgent';
import { AgentBase } from '../../agents/AgentBase';
import { DebateEngine } from '../../core/DebateEngine';
import { AgentOpinion, PatientProfile } from '@copilot-care/shared/types';

type ScriptedOpinion = Omit<AgentOpinion, 'agentId' | 'agentName' | 'role'>;

class ScriptedAgent extends AgentBase {
  private readonly scripted: ScriptedOpinion;

  constructor(
    id: string,
    name: string,
    role: AgentOpinion['role'],
    scripted: ScriptedOpinion,
  ) {
    super(id, name, role);
    this.scripted = scripted;
  }

  public async think(
    _profile: PatientProfile,
    _context: string,
  ): Promise<AgentOpinion> {
    return {
      agentId: this.id,
      agentName: this.name,
      role: this.role,
      ...this.scripted,
    };
  }
}

describe('Architecture Smoke - debate orchestration', () => {
  it('runs main orchestration flow and returns a typed status', async () => {
    const engine = new DebateEngine([new CardiologyAgent(), new GPAgent()]);
    const result = await engine.runSession({
      patientId: 'arch-smoke-001',
      age: 56,
      sex: 'male',
      chronicDiseases: ['Hypertension'],
      medicationHistory: ['none'],
      vitals: {
        systolicBP: 150,
        diastolicBP: 95,
      },
      symptoms: ['fatigue'],
    });

    expect(['OUTPUT', 'ESCALATE_TO_OFFLINE', 'ABSTAIN', 'ERROR']).toContain(
      result.status,
    );
    expect(result.auditTrail.length).toBeGreaterThan(0);
  });

  it('returns validation error when required profile fields are missing', async () => {
    const engine = new DebateEngine([new CardiologyAgent(), new GPAgent()]);
    const result = await engine.runSession({
      age: 56,
      sex: 'male',
      chronicDiseases: [],
      medicationHistory: [],
    } as any);

    expect(result.status).toBe('ERROR');
    expect(result.errorCode).toBe('ERR_MISSING_REQUIRED_DATA');
  });

  it('forces offline escalation when red-flag symptoms are present', async () => {
    const engine = new DebateEngine([new CardiologyAgent(), new GPAgent()]);
    const result = await engine.runSession({
      patientId: 'arch-smoke-002',
      age: 64,
      sex: 'female',
      chronicDiseases: ['Hypertension'],
      medicationHistory: ['none'],
      symptoms: ['severe headache'],
    });

    expect(result.status).toBe('ESCALATE_TO_OFFLINE');
    expect(result.errorCode).toBe('ERR_ESCALATE_TO_OFFLINE');
  });

  it('keeps dissent index above zero when confidence and action plans diverge', async () => {
    const engine = new DebateEngine(
      [
        new ScriptedAgent('spec-1', 'Spec-1', 'Specialist', {
          riskLevel: 'L1',
          confidence: 0.93,
          reasoning: 'prefer tighter safety margin',
          citations: ['SPEC-1'],
          actions: ['urgent referral to cardiology'],
        }),
        new ScriptedAgent('gp-1', 'GP-1', 'Generalist', {
          riskLevel: 'L1',
          confidence: 0.68,
          reasoning: 'monitor before escalation',
          citations: ['GP-1'],
          actions: ['home monitoring and follow-up'],
        }),
        new ScriptedAgent('safe-1', 'Safe-1', 'Safety', {
          riskLevel: 'L1',
          confidence: 0.8,
          reasoning: 'balanced risk management',
          citations: ['SAFE-1'],
          actions: ['recheck blood pressure in 72 hours'],
        }),
      ],
      { maxRounds: 1 },
    );

    const result = await engine.runSession({
      patientId: 'arch-smoke-003',
      age: 61,
      sex: 'male',
      chronicDiseases: ['Hypertension'],
      medicationHistory: ['amlodipine'],
      vitals: {
        systolicBP: 148,
        diastolicBP: 92,
      },
      symptoms: ['mild dizziness'],
    });

    expect(result.rounds.length).toBe(1);
    expect(result.rounds[0]?.dissentIndex).toBeGreaterThan(0);
  });
});
