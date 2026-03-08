export type MedicalAuthorityRegion = 'domestic' | 'international';

export type MedicalAuthorityCategory =
  | 'literature'
  | 'guideline'
  | 'public_health'
  | 'regulation';

export interface AuthoritativeMedicalSource {
  id: string;
  name: string;
  region: MedicalAuthorityRegion;
  category: MedicalAuthorityCategory;
  homepageUrl: string;
  hostRules: string[];
  description: string;
}

export interface MedicalKnowledgeDocumentSeed {
  sourceId: string;
  title: string;
  url: string;
  keywords: string[];
  evidenceSummaryZh?: string;
}

export type AuthoritativeEvidenceOrigin = 'live_search' | 'catalog_seed';

export interface AuthoritativeMedicalEvidence {
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  snippet: string;
  publishedOn?: string;
  retrievedAt: string;
  origin?: AuthoritativeEvidenceOrigin;
  matchedQueryTokens?: string[];
}

export interface AuthoritativeMedicalSearchQuery {
  query: string;
  limit: number;
  sourceFilter?: string[];
  requiredSources?: string[];
}

export interface AuthoritativeMedicalSearchResult {
  query: string;
  results: AuthoritativeMedicalEvidence[];
  droppedByPolicy: number;
  usedSources: string[];
  sourceBreakdown: Array<{
    sourceId: string;
    count: number;
  }>;
  strategyVersion: string;
  generatedAt: string;
  realtimeCount: number;
  fallbackCount: number;
  fallbackReasons?: string[];
  missingRequiredSources?: string[];
}

export interface AuthoritativeMedicalSearchTraceEntry {
  traceId: string;
  generatedAt: string;
  query: string;
  limit: number;
  sourceFilter: string[];
  requiredSources: string[];
  fromCache: boolean;
  resultCount: number;
  realtimeCount: number;
  fallbackCount: number;
  droppedByPolicy: number;
  usedSources: string[];
  fallbackReasons: string[];
  missingRequiredSources: string[];
}

export interface MedicalSearchProviderRuntimeStats {
  providerId: string;
  calls: number;
  successes: number;
  failures: number;
  skippedByCircuit: number;
  lastErrorAt?: string;
  lastErrorMessage?: string;
  circuitState: 'open' | 'closed';
  circuitOpenUntil?: string;
}

export interface AuthoritativeMedicalSearchRuntimeStats {
  generatedAt: string;
  searches: number;
  cacheHits: number;
  cacheMisses: number;
  fallbackAppliedCount: number;
  providerStats: MedicalSearchProviderRuntimeStats[];
  recentSearches?: AuthoritativeMedicalSearchTraceEntry[];
}

export const AUTHORITATIVE_MEDICAL_SOURCES: readonly AuthoritativeMedicalSource[] = [
  {
    id: 'PUBMED',
    name: 'PubMed',
    region: 'international',
    category: 'literature',
    homepageUrl: 'https://pubmed.ncbi.nlm.nih.gov/',
    hostRules: ['pubmed.ncbi.nlm.nih.gov', 'eutils.ncbi.nlm.nih.gov'],
    description: 'NCBI biomedical literature database.',
  },
  {
    id: 'NICE',
    name: 'NICE Guidance',
    region: 'international',
    category: 'guideline',
    homepageUrl: 'https://www.nice.org.uk/guidance',
    hostRules: ['nice.org.uk', 'www.nice.org.uk', '*.nice.org.uk'],
    description: 'UK evidence-based guideline authority.',
  },
  {
    id: 'WHO',
    name: 'World Health Organization',
    region: 'international',
    category: 'public_health',
    homepageUrl: 'https://www.who.int/',
    hostRules: ['who.int', 'www.who.int', '*.who.int'],
    description: 'Global public health authority and guidance.',
  },
  {
    id: 'CDC_US',
    name: 'US CDC',
    region: 'international',
    category: 'public_health',
    homepageUrl: 'https://www.cdc.gov/',
    hostRules: ['cdc.gov', 'www.cdc.gov', '*.cdc.gov'],
    description: 'US Centers for Disease Control and Prevention.',
  },
  {
    id: 'NHC_CN',
    name: 'National Health Commission of China',
    region: 'domestic',
    category: 'guideline',
    homepageUrl: 'http://www.nhc.gov.cn/',
    hostRules: ['www.nhc.gov.cn', '*.nhc.gov.cn'],
    description: 'China national health authority policy and guideline portal.',
  },
  {
    id: 'CDC_CN',
    name: 'China CDC',
    region: 'domestic',
    category: 'public_health',
    homepageUrl: 'https://www.chinacdc.cn/',
    hostRules: ['www.chinacdc.cn', '*.chinacdc.cn'],
    description: 'China CDC public health knowledge portal.',
  },
  {
    id: 'NMPA',
    name: 'National Medical Products Administration',
    region: 'domestic',
    category: 'regulation',
    homepageUrl: 'https://www.nmpa.gov.cn/',
    hostRules: ['www.nmpa.gov.cn', '*.nmpa.gov.cn'],
    description: 'China medical product and drug regulation authority.',
  },
] as const;

export const AUTHORITATIVE_MEDICAL_DOCUMENT_SEEDS: readonly MedicalKnowledgeDocumentSeed[] = [
  {
    sourceId: 'NICE',
    title: 'Hypertension in adults: diagnosis and management (NG136)',
    url: 'https://www.nice.org.uk/guidance/ng136/chapter/Recommendations',
    keywords: ['hypertension', 'blood pressure', 'high blood pressure', '高血压', '血压'],
    evidenceSummaryZh:
      'NICE NG136指出：成人高血压应基于规范测量结果确认，管理上需结合心血管风险分层，并按风险设定随访频率。',
  },
  {
    sourceId: 'WHO',
    title: 'WHO hypertension fact sheet',
    url: 'https://www.who.int/news-room/fact-sheets/detail/hypertension',
    keywords: ['hypertension', 'blood pressure', 'cardiovascular', '高血压', '心血管'],
    evidenceSummaryZh:
      'WHO强调控制高血压应以长期管理为核心，包括降低盐摄入、规律体力活动、体重管理和持续血压监测。',
  },
  {
    sourceId: 'WHO',
    title: 'WHO cardiovascular diseases topic',
    url: 'https://www.who.int/health-topics/cardiovascular-diseases',
    keywords: ['cardiovascular', 'heart', 'stroke', '心血管', '卒中'],
    evidenceSummaryZh:
      'WHO心血管专题提示：血压控制、戒烟、合理饮食和早期风险评估是降低卒中与心血管事件风险的关键措施。',
  },
  {
    sourceId: 'CDC_US',
    title: 'CDC high blood pressure basics',
    url: 'https://www.cdc.gov/high-blood-pressure/about/index.html',
    keywords: ['high blood pressure', 'hypertension', 'monitoring', '高血压', '监测'],
    evidenceSummaryZh:
      'CDC指出高血压常无明显症状，建议规律监测血压并结合生活方式干预，以降低心脑血管并发症风险。',
  },
  {
    sourceId: 'CDC_US',
    title: 'CDC stroke signs and symptoms',
    url: 'https://www.cdc.gov/stroke/signs-symptoms/index.html',
    keywords: ['stroke', 'warning signs', 'FAST', '卒中', '中风'],
    evidenceSummaryZh:
      'CDC卒中页面强调FAST预警信号（面口歪斜、上肢无力、言语异常），出现突发神经系统症状应立即急诊评估。',
  },
  {
    sourceId: 'NHC_CN',
    title: '国家卫生健康委员会指导文件与诊疗规范',
    url: 'http://www.nhc.gov.cn/yzygj/s7659/new_list.shtml',
    keywords: ['指南', '规范', '诊疗', '高血压', '慢病'],
    evidenceSummaryZh:
      '国家卫健委发布的诊疗规范可用于本土化流程校准，重点强调分级管理、规范随访和风险人群长期健康管理。',
  },
  {
    sourceId: 'CDC_CN',
    title: '中国疾控中心慢病与心脑血管防控',
    url: 'https://www.chinacdc.cn/jkzt/crb/zl/',
    keywords: ['慢病', '心脑血管', '防控', '高血压', '卒中'],
    evidenceSummaryZh:
      '中国疾控中心慢病防控资料指出，应通过危险因素筛查、健康教育和持续管理降低高血压及卒中相关风险。',
  },
  {
    sourceId: 'PUBMED',
    title: 'PubMed hypertension literature index',
    url: 'https://pubmed.ncbi.nlm.nih.gov/?term=hypertension+guideline',
    keywords: ['pubmed', 'hypertension', 'guideline', '文献', '高血压'],
    evidenceSummaryZh:
      'PubMed可用于补充最新循证文献，重点关注指南、系统综述与高质量临床研究的证据一致性。',
  },
  {
    sourceId: 'NMPA',
    title: '国家药监局药品安全信息',
    url: 'https://www.nmpa.gov.cn/xxgk/ggtg/',
    keywords: ['药品', '安全', '不良反应', '监管'],
    evidenceSummaryZh:
      '国家药监局信息可用于核查药品安全通告与不良反应风险提示，辅助评估用药相关风险。',
  },
] as const;

export function listAuthoritativeMedicalSources(): AuthoritativeMedicalSource[] {
  return [...AUTHORITATIVE_MEDICAL_SOURCES];
}

function matchHostRule(hostname: string, hostRule: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedRule = hostRule.toLowerCase();
  if (normalizedRule.startsWith('*.')) {
    const suffix = normalizedRule.slice(2);
    return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
  }
  return normalizedHost === normalizedRule;
}

export function isAuthoritativeMedicalHost(hostname: string): boolean {
  const normalizedHost = hostname.trim().toLowerCase();
  if (!normalizedHost) {
    return false;
  }
  return AUTHORITATIVE_MEDICAL_SOURCES.some((source) =>
    source.hostRules.some((rule) => matchHostRule(normalizedHost, rule)),
  );
}

export function isAuthoritativeMedicalUrl(url: string): boolean {
  try {
    const target = new URL(url);
    return isAuthoritativeMedicalHost(target.hostname);
  } catch {
    return false;
  }
}

export function resolveSourceByUrl(
  url: string,
): AuthoritativeMedicalSource | null {
  try {
    const target = new URL(url);
    const hostname = target.hostname.toLowerCase();
    return (
      AUTHORITATIVE_MEDICAL_SOURCES.find((source) =>
        source.hostRules.some((rule) => matchHostRule(hostname, rule)),
      ) ?? null
    );
  } catch {
    return null;
  }
}
