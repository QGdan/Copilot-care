import {
  AuthoritativeMedicalSearchRuntimeStats,
  AuthoritativeMedicalSearchQuery,
  AuthoritativeMedicalSearchResult,
  AuthoritativeMedicalSource,
} from '../../domain/knowledge/AuthoritativeMedicalKnowledgeCatalog';

export interface AuthoritativeMedicalSearchPort {
  isEnabled(): boolean;
  getSources(): AuthoritativeMedicalSource[];
  getRuntimeStats?(): AuthoritativeMedicalSearchRuntimeStats;
  search(
    input: AuthoritativeMedicalSearchQuery,
  ): Promise<AuthoritativeMedicalSearchResult>;
}
