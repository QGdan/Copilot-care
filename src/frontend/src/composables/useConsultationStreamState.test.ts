import { describe, expect, it, vi } from 'vitest';
import { useConsultationStreamState } from './useConsultationStreamState';

function createInitialStageRuntime() {
  return {
    START: { status: 'pending', message: '等待启动' },
    INFO_GATHER: { status: 'pending', message: '等待采集信息' },
    RISK_ASSESS: { status: 'pending', message: '等待风险评估' },
    ROUTING: { status: 'pending', message: '等待分流决策' },
    DEBATE: { status: 'pending', message: '等待仲裁' },
    CONSENSUS: { status: 'pending', message: '等待共识收敛' },
    REVIEW: { status: 'pending', message: '等待审校复核' },
    OUTPUT: { status: 'pending', message: '等待输出' },
    ESCALATION: { status: 'pending', message: '按需触发' },
  };
}

describe('useConsultationStreamState', () => {
  it('initializes all runtime fields with expected defaults', () => {
    const state = useConsultationStreamState({
      createInitialStageRuntime,
    });

    expect(state.clarificationQuestion.value).toBe('');
    expect(state.requiredFields.value).toEqual([]);
    expect(state.nextAction.value).toBe('');
    expect(state.systemError.value).toBe('');
    expect(state.rounds.value).toEqual([]);
    expect(state.routeInfo.value).toBeNull();
    expect(state.authoritativeSearch.value).toBeNull();
    expect(state.orchestrationSnapshot.value).toBeNull();
    expect(state.stageRuntime.value.START.status).toBe('pending');
  });

  it('supports writing stream fields before reset', () => {
    const state = useConsultationStreamState({
      createInitialStageRuntime,
    });

    state.clarificationQuestion.value = '请补充血压';
    state.requiredFields.value = ['systolicBP'];
    state.nextAction.value = 'Provide blood pressure values and retry.';
    state.systemError.value = 'ERR_INPUT';
    state.reasoningItems.value.push({
      id: 'reason-1',
      kind: 'query',
      text: '补充信息请求',
      timestamp: new Date().toISOString(),
    });
    state.routeInfo.value = {
      routeMode: 'LIGHT_DEBATE',
      complexityScore: 3,
      department: 'cardiology',
      collaborationMode: 'SINGLE_SPECIALTY_PANEL',
      reasons: ['复杂度中等'],
    };

    expect(state.clarificationQuestion.value).toContain('补充');
    expect(state.requiredFields.value).toContain('systolicBP');
    expect(state.nextAction.value).toContain('retry');
    expect(state.systemError.value).toBe('ERR_INPUT');
    expect(state.reasoningItems.value).toHaveLength(1);
    expect(state.routeInfo.value?.department).toBe('cardiology');
  });

  it('captures routing preview fields from reasoning text', () => {
    const state = useConsultationStreamState({
      createInitialStageRuntime,
    });

    state.captureRoutingFromText('路由=DEEP_DEBATE; 科室=cardiology; ComplexityScore=5.7; 协同模式=MULTI_DISCIPLINARY_CONSULT');

    expect(state.routingPreview.value.routeMode).toBe('DEEP_DEBATE');
    expect(state.routingPreview.value.department).toBe('cardiology');
    expect(state.routingPreview.value.complexityScore).toBe(5.7);
    expect(state.routingPreview.value.collaborationMode).toBe('MULTI_DISCIPLINARY_CONSULT');
  });

  it('deduplicates stage/reasoning events and updates stage lifecycle', () => {
    const state = useConsultationStreamState({
      createInitialStageRuntime,
    });

    const stageEvent = {
      stage: 'ROUTING' as const,
      status: 'running' as const,
      message: '开始分流',
    };

    expect(state.rememberStageEvent(stageEvent)).toBe(true);
    expect(state.rememberStageEvent(stageEvent)).toBe(false);

    state.updateStage(stageEvent.stage, stageEvent.status, stageEvent.message);
    expect(state.stageRuntime.value.ROUTING.status).toBe('running');
    expect(state.stageRuntime.value.ROUTING.startTime).toBeDefined();

    state.updateStage('ROUTING', 'done', '分流完成');
    expect(state.stageRuntime.value.ROUTING.endTime).toBeDefined();
    expect(state.stageRuntime.value.ROUTING.durationMs).toBeTypeOf('number');

    expect(state.rememberReasoning('证据A')).toBe(true);
    expect(state.rememberReasoning('证据A')).toBe(false);
    expect(state.shouldPushStageNarrative({
      stage: 'ROUTING',
      status: 'done',
      message: '分流完成',
    })).toBe(true);
    expect(state.shouldPushStageNarrative({
      stage: 'ROUTING',
      status: 'done',
      message: '分流完成',
    })).toBe(false);
  });

  it('resets stream fields back to initial values', () => {
    const state = useConsultationStreamState({
      createInitialStageRuntime,
    });

    state.clarificationQuestion.value = '请补充用药史';
    state.requiredFields.value = ['medicationHistory'];
    state.nextAction.value = 'Add medication history before rerun.';
    state.systemError.value = 'ERR_REQUIRED_FIELDS';
    state.resultNotes.value = ['缺失关键信息'];
    state.authoritativeSearch.value = {
      query: 'hypertension',
      queryVariants: ['hypertension'],
      strategyVersion: 'authority-multisource-v3.1+hybrid-v1',
      usedSources: ['WHO'],
      sourceBreakdown: [{ sourceId: 'WHO', count: 1 }],
      realtimeCount: 1,
      fallbackCount: 0,
      droppedByPolicy: 0,
    };
    state.routingPreview.value = { routeMode: 'DEEP_DEBATE' };
    state.stageRuntime.value.OUTPUT = {
      status: 'done',
      message: '已完成',
      startTime: new Date().toISOString(),
    };
    state.pushReasoning('system', '示例推理');

    state.resetStreamStateCore();

    expect(state.clarificationQuestion.value).toBe('');
    expect(state.requiredFields.value).toEqual([]);
    expect(state.nextAction.value).toBe('');
    expect(state.systemError.value).toBe('');
    expect(state.resultNotes.value).toEqual([]);
    expect(state.authoritativeSearch.value).toBeNull();
    expect(state.routingPreview.value).toEqual({});
    expect(state.stageRuntime.value.OUTPUT.status).toBe('pending');
    expect(state.reasoningItems.value).toEqual([]);
  });
});
